// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed seed.json
var seedJSON string

// Every row of the books belongs to one user (ADR 0007): the primary key of
// each data table is (user_id, id), so ids only need to be unique per user
// and the fixed ids of the sample data and of the anonymous external
// account work for everyone.
const dataTables = `
CREATE TABLE IF NOT EXISTS accounts%[1]s (
  user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL,
  opening_balance_minor INTEGER NOT NULL DEFAULT 0, allow_negative INTEGER NOT NULL DEFAULT 0,
  credit_limit_minor INTEGER, statement_close_day INTEGER, payment_due_day INTEGER,
  PRIMARY KEY(user_id, id));
CREATE TABLE IF NOT EXISTS transactions%[1]s (
  user_id TEXT NOT NULL, id TEXT NOT NULL, account_id TEXT NOT NULL DEFAULT '', from_account_id TEXT NOT NULL DEFAULT '',
  to_account_id TEXT NOT NULL DEFAULT '', tag_id TEXT NOT NULL DEFAULT '', type TEXT NOT NULL,
  state TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, date TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '', tz TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '', transaction_template_id TEXT, occurrence_date TEXT,
  PRIMARY KEY(user_id, id), UNIQUE(user_id, transaction_template_id, occurrence_date));
CREATE TABLE IF NOT EXISTS tags%[1]s (
  user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, limit_minor INTEGER,
  cycle TEXT NOT NULL DEFAULT '', cycle_every INTEGER NOT NULL DEFAULT 0, cycle_start TEXT NOT NULL DEFAULT '',
  cycle_end TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT '', target_minor INTEGER, target_date TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(user_id, id));
CREATE TABLE IF NOT EXISTS transaction_tags%[1]s (
  user_id TEXT NOT NULL, transaction_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY(user_id, transaction_id, tag_id));
CREATE TABLE IF NOT EXISTS transaction_templates%[1]s (
  user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  template_json TEXT NOT NULL, schedule_json TEXT NOT NULL, PRIMARY KEY(user_id, id));
CREATE TABLE IF NOT EXISTS settings%[1]s (
  user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(user_id, key));
`

// authTables hold who may sign in and how (ADR 0007).
const authTables = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '', is_admin INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT NOT NULL DEFAULT '', totp_enabled INTEGER NOT NULL DEFAULT 0, totp_last_step INTEGER NOT NULL DEFAULT 0,
  recovery_codes TEXT NOT NULL DEFAULT '',
  avatar BLOB, avatar_type TEXT NOT NULL DEFAULT '', avatar_color TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(username COLLATE NOCASE) WHERE username <> '';
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
`

// tableNames are the per-user data tables, in an order safe for copying.
var tableNames = []string{"accounts", "transactions", "tags", "transaction_tags", "transaction_templates", "settings"}

// Store is the database plus each signed-in user's book, loaded on first use.
// All access happens under mu.
type Store struct {
	mu    sync.Mutex
	db    *sql.DB
	books map[string]*Data
}

func openStore(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // one writer; the in-memory books assume statements run in order
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='accounts'`).Scan(&n); err != nil {
		return nil, err
	}
	fresh := n == 0
	if _, err := db.Exec(authTables); err != nil {
		return nil, err
	}
	s := &Store{db: db, books: map[string]*Data{}}
	if fresh {
		// a new database starts in the current shape; there is nothing to migrate
		if _, err := db.Exec(fmt.Sprintf(dataTables, "")); err != nil {
			return nil, err
		}
		if _, err := db.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, len(migrations))); err != nil {
			return nil, err
		}
		return s, nil
	}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

// migrations are numbered by position and append-only: never edit or
// reorder a released one. PRAGMA user_version records how many have run.
// They upgrade databases created before the current schema; a new database
// is created in the current shape and skips them.
var migrations = []func(tx *sql.Tx) error{
	migrateExpenseIncomeToTransfers,  // 1
	migrateReleaseToNegativeAllocate, // 2
	migrateAddTransactionMemo,        // 3
	migrateTagKinds,                  // 4
	migrateBudgetPeriods,             // 5
	migrateAccountIcons,              // 6
	migrateTransactionTime,           // 7
	migrateMultiUser,                 // 8
	migrateRecoveryCodes,             // 9
}

func (s *Store) migrate() error {
	var version int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	if version >= len(migrations) {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i := version; i < len(migrations); i++ {
		if err := migrations[i](tx); err != nil {
			return fmt.Errorf("migration %d: %w", i+1, err)
		}
	}
	if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, len(migrations))); err != nil {
		return err
	}
	return tx.Commit()
}

// OwnerID is the user who inherits a single-user database (migration 8).
const OwnerID = "usr-owner"

// Migration 8 (ADR 0007): the books gain an owner. Each data table is
// rebuilt with user_id in its primary key, every existing row goes to the
// owner, and the owner is created without a username or password: the
// first visit claims it (see handleSetup).
func migrateMultiUser(tx *sql.Tx) error {
	if _, err := tx.Exec(fmt.Sprintf(dataTables, "_v8")); err != nil {
		return err
	}
	for _, t := range tableNames {
		cols, err := columnNames(tx, t)
		if err != nil {
			return err
		}
		list := strings.Join(cols, ",")
		if _, err := tx.Exec(`INSERT INTO `+t+`_v8(user_id,`+list+`) SELECT ?,`+list+` FROM `+t, OwnerID); err != nil {
			return fmt.Errorf("%s: %w", t, err)
		}
		if _, err := tx.Exec(`DROP TABLE ` + t); err != nil {
			return err
		}
		if _, err := tx.Exec(`ALTER TABLE ` + t + `_v8 RENAME TO ` + t); err != nil {
			return err
		}
	}
	_, err := tx.Exec(`INSERT OR IGNORE INTO users(id,is_admin,created_at) VALUES(?,1,?)`, OwnerID, time.Now().UTC().Format(time.RFC3339))
	return err
}

// Migration 9: TOTP recovery codes (hashes) on users.
func migrateRecoveryCodes(tx *sql.Tx) error {
	has, err := hasColumn(tx, "users", "recovery_codes")
	if err != nil || has {
		return err
	}
	_, err = tx.Exec(`ALTER TABLE users ADD COLUMN recovery_codes TEXT NOT NULL DEFAULT ''`)
	return err
}

// columnNames lists a table's columns in order.
func columnNames(tx *sql.Tx, table string) ([]string, error) {
	rows, err := tx.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var cid, notnull, pk int
		var name, typ string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

// hasColumn reports whether table already has a column (new databases get
// columns from the schema, so column-adding migrations must be conditional).
func hasColumn(tx *sql.Tx, table, column string) (bool, error) {
	rows, err := tx.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notnull, pk int
		var name, typ string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

// Migration 7 (ADR 0006): transactions may carry a local time and its time zone.
// Existing transactions stay date-only.
func migrateTransactionTime(tx *sql.Tx) error {
	for _, c := range []string{"time", "tz"} {
		has, err := hasColumn(tx, "transactions", c)
		if err != nil {
			return err
		}
		if !has {
			if _, err := tx.Exec(`ALTER TABLE transactions ADD COLUMN ` + c + ` TEXT NOT NULL DEFAULT ''`); err != nil {
				return err
			}
		}
	}
	return nil
}

// Migration 6 (ADR 0005): own accounts lose their type. The type becomes the
// account's icon, and kind is just "own" or "external". allow_negative is
// no longer read (any account may run negative).
func migrateAccountIcons(tx *sql.Tx) error {
	has, err := hasColumn(tx, "accounts", "icon")
	if err != nil {
		return err
	}
	if !has {
		if _, err := tx.Exec(`ALTER TABLE accounts ADD COLUMN icon TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	_, err = tx.Exec(`UPDATE accounts SET
		icon = CASE kind WHEN 'external' THEN icon WHEN 'own' THEN icon WHEN 'credit_card' THEN 'card' WHEN 'ewallet' THEN 'wallet' ELSE kind END,
		kind = CASE kind WHEN 'external' THEN 'external' ELSE 'own' END`)
	return err
}

// Migration 5 (ADR 0004): budget periods other than calendar months.
func migrateBudgetPeriods(tx *sql.Tx) error {
	for _, c := range []struct{ name, def string }{
		{"cycle_every", "INTEGER NOT NULL DEFAULT 0"},
		{"cycle_start", "TEXT NOT NULL DEFAULT ''"},
		{"cycle_end", "TEXT NOT NULL DEFAULT ''"},
	} {
		has, err := hasColumn(tx, "tags", c.name)
		if err != nil {
			return err
		}
		if !has {
			if _, err := tx.Exec(`ALTER TABLE tags ADD COLUMN ` + c.name + ` ` + c.def); err != nil {
				return err
			}
		}
	}
	return nil
}

// Migration 4 (ADR 0004): only category and goal tags remain; label and payee
// tags become categories, keeping their transactions.
func migrateTagKinds(tx *sql.Tx) error {
	_, err := tx.Exec(`UPDATE tags SET kind='category' WHERE kind IN ('label','payee')`)
	return err
}

// Migration 3: transactions get a free-text memo beside the short title.
func migrateAddTransactionMemo(tx *sql.Tx) error {
	has, err := hasColumn(tx, "transactions", "memo")
	if err != nil || has {
		return err
	}
	_, err = tx.Exec(`ALTER TABLE transactions ADD COLUMN memo TEXT NOT NULL DEFAULT ''`)
	return err
}

// Migration 2 (ADR 0003): release stops being a stored type; a release of N
// becomes an allocation of -N on the same account and money box.
func migrateReleaseToNegativeAllocate(tx *sql.Tx) error {
	_, err := tx.Exec(`UPDATE transactions SET type='allocate', amount_minor=-amount_minor WHERE type='release'`)
	return err
}

// Migration 1 (ADR 0002): expense and income stop being stored types. An
// expense becomes a transfer from its account to the anonymous external
// account, an income a transfer from it; templates are converted the same way.
func migrateExpenseIncomeToTransfers(tx *sql.Tx) error {
	if _, err := tx.Exec(`INSERT OR IGNORE INTO accounts(id,name,kind,currency,opening_balance_minor,allow_negative) VALUES(?,?,?,?,0,0)`, ExternalAccountID, "External", "external", ""); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE transactions SET type='transfer', from_account_id=account_id, to_account_id=?, account_id='' WHERE type='expense'`, ExternalAccountID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE transactions SET type='transfer', from_account_id=?, to_account_id=account_id, account_id='' WHERE type='income'`, ExternalAccountID); err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT id, template_json FROM transaction_templates`)
	if err != nil {
		return err
	}
	type tplRow struct{ id, js string }
	var tpls []tplRow
	for rows.Next() {
		var r tplRow
		if err := rows.Scan(&r.id, &r.js); err != nil {
			rows.Close()
			return err
		}
		tpls = append(tpls, r)
	}
	rows.Close()
	for _, r := range tpls {
		var b TemplateBody
		if err := json.Unmarshal([]byte(r.js), &b); err != nil {
			return err
		}
		switch b.Type {
		case "expense":
			b.Type, b.FromAccountID, b.ToAccountID, b.AccountID = "transfer", b.AccountID, ExternalAccountID, ""
		case "income":
			b.Type, b.FromAccountID, b.ToAccountID, b.AccountID = "transfer", ExternalAccountID, b.AccountID, ""
		default:
			continue
		}
		js, err := json.Marshal(b)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE transaction_templates SET template_json=? WHERE id=?`, string(js), r.id); err != nil {
			return err
		}
	}
	return nil
}

// Book is one user's books: their data in memory and writes scoped to them.
// Every query here carries user_id; nothing outside a Book touches data rows.
type Book struct {
	s    *Store
	uid  string
	data *Data
}

// book returns a user's books, loading them on first use. Caller holds s.mu.
func (s *Store) book(uid string) (*Book, error) {
	b := &Book{s: s, uid: uid}
	if d, ok := s.books[uid]; ok {
		b.data = d
		return b, nil
	}
	if err := b.reload(); err != nil {
		return nil, err
	}
	return b, nil
}

func (b *Book) exec(q string, args ...interface{}) (sql.Result, error) {
	return b.s.db.Exec(q, append([]interface{}{b.uid}, args...)...)
}

func (b *Book) reload() error {
	db, uid := b.s.db, b.uid
	d := &Data{Version: 1}
	rows, err := db.Query(`SELECT id,name,kind,icon,currency,opening_balance_minor,credit_limit_minor,statement_close_day,payment_due_day FROM accounts WHERE user_id=? ORDER BY name`, uid)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var a Account
		var cl sql.NullInt64
		var sc, pd sql.NullInt64
		if err := rows.Scan(&a.ID, &a.Name, &a.Kind, &a.Icon, &a.Currency, &a.OpeningBalanceMinor, &cl, &sc, &pd); err != nil {
			return err
		}
		if cl.Valid {
			a.LimitMinor = &cl.Int64
		}
		if sc.Valid {
			v := int(sc.Int64)
			a.StatementCloseDay = &v
		}
		if pd.Valid {
			v := int(pd.Int64)
			a.PaymentDueDay = &v
		}
		d.Accounts = append(d.Accounts, a)
	}
	rows.Close()
	tr, err := db.Query(`SELECT id,account_id,from_account_id,to_account_id,tag_id,type,state,amount_minor,currency,date,time,tz,note,memo,transaction_template_id,occurrence_date FROM transactions WHERE user_id=? ORDER BY date,time,id`, uid)
	if err != nil {
		return err
	}
	defer tr.Close()
	for tr.Next() {
		var t Transaction
		var tplID, occ sql.NullString
		if err := tr.Scan(&t.ID, &t.AccountID, &t.FromAccountID, &t.ToAccountID, &t.TagID, &t.Type, &t.State, &t.AmountMinor, &t.Currency, &t.Date, &t.Time, &t.TZ, &t.Note, &t.Memo, &tplID, &occ); err != nil {
			return err
		}
		t.At = instant(t.Date, t.Time, t.TZ)
		t.TransactionTemplateID = tplID.String
		t.OccurrenceDate = occ.String
		d.Transactions = append(d.Transactions, t)
	}
	tr.Close()
	tg, err := db.Query(`SELECT id,name,kind,limit_minor,cycle,cycle_every,cycle_start,cycle_end,currency,target_minor,target_date FROM tags WHERE user_id=? ORDER BY name`, uid)
	if err != nil {
		return err
	}
	defer tg.Close()
	for tg.Next() {
		var t Tag
		var lm, tm sql.NullInt64
		if err := tg.Scan(&t.ID, &t.Name, &t.Kind, &lm, &t.Cycle, &t.CycleEvery, &t.CycleStart, &t.CycleEnd, &t.Currency, &tm, &t.TargetDate); err != nil {
			return err
		}
		if lm.Valid {
			t.LimitMinor = &lm.Int64
		}
		if tm.Valid {
			t.TargetMinor = &tm.Int64
		}
		d.Tags = append(d.Tags, t)
	}
	tg.Close()
	tt, err := db.Query(`SELECT transaction_id,tag_id FROM transaction_tags WHERE user_id=?`, uid)
	if err != nil {
		return err
	}
	defer tt.Close()
	for tt.Next() {
		var x TransactionTag
		if err := tt.Scan(&x.TransactionID, &x.TagID); err != nil {
			return err
		}
		d.TransactionTags = append(d.TransactionTags, x)
	}
	tt.Close()
	tp, err := db.Query(`SELECT id,name,enabled,template_json,schedule_json FROM transaction_templates WHERE user_id=? ORDER BY name`, uid)
	if err != nil {
		return err
	}
	defer tp.Close()
	for tp.Next() {
		var x TransactionTemplate
		var en int
		var tj, sj string
		if err := tp.Scan(&x.ID, &x.Name, &en, &tj, &sj); err != nil {
			return err
		}
		x.Enabled = en != 0
		if err := json.Unmarshal([]byte(tj), &x.Template); err != nil {
			return err
		}
		if err := json.Unmarshal([]byte(sj), &x.Schedule); err != nil {
			return err
		}
		d.TransactionTemplates = append(d.TransactionTemplates, x)
	}
	tp.Close()
	b.s.books[uid] = d
	b.data = d
	return nil
}

// startBook gives a new user the anonymous external account; withSample also
// loads the sample books (the first user of a new install, to explore with).
func (b *Book) startBook(withSample bool) error {
	if _, err := b.exec(`INSERT OR IGNORE INTO accounts(user_id,id,name,kind,currency) VALUES(?,?,?,?,?)`, ExternalAccountID, "External", "external", ""); err != nil {
		return err
	}
	if withSample {
		var seed Data
		if err := json.Unmarshal([]byte(seedJSON), &seed); err != nil {
			return fmt.Errorf("seed: %w", err)
		}
		for _, a := range seed.Accounts {
			if a.ID == ExternalAccountID {
				continue
			}
			if err := b.insertAccount(a); err != nil {
				return err
			}
		}
		for _, t := range seed.Tags {
			if err := b.insertTag(t); err != nil {
				return err
			}
		}
		for _, t := range seed.Transactions {
			if err := b.insertTransaction(t); err != nil {
				return err
			}
		}
		for _, tt := range seed.TransactionTags {
			if err := b.linkTag(tt.TransactionID, tt.TagID); err != nil {
				return err
			}
		}
		for _, tp := range seed.TransactionTemplates {
			if err := b.insertTemplate(tp); err != nil {
				return err
			}
		}
	}
	return b.reload()
}

func (d *Data) hasOwnAccounts() bool {
	for _, a := range d.Accounts {
		if !a.IsExternal() {
			return true
		}
	}
	return false
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}
func n64(p *int64) interface{} {
	if p == nil {
		return nil
	}
	return *p
}
func nint(p *int) interface{} {
	if p == nil {
		return nil
	}
	return *p
}
func nullEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func (b *Book) insertAccount(a Account) error {
	_, err := b.exec(`INSERT INTO accounts(user_id,id,name,kind,icon,currency,opening_balance_minor,credit_limit_minor,statement_close_day,payment_due_day) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		a.ID, a.Name, a.Kind, a.Icon, a.Currency, a.OpeningBalanceMinor, n64(a.LimitMinor), nint(a.StatementCloseDay), nint(a.PaymentDueDay))
	return err
}
func (b *Book) insertTag(t Tag) error {
	_, err := b.exec(`INSERT INTO tags(user_id,id,name,kind,limit_minor,cycle,cycle_every,cycle_start,cycle_end,currency,target_minor,target_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
		t.ID, t.Name, t.Kind, n64(t.LimitMinor), t.Cycle, t.CycleEvery, t.CycleStart, t.CycleEnd, t.Currency, n64(t.TargetMinor), t.TargetDate)
	return err
}
func (b *Book) insertTransaction(t Transaction) error {
	_, err := b.exec(`INSERT INTO transactions(user_id,id,account_id,from_account_id,to_account_id,tag_id,type,state,amount_minor,currency,date,time,tz,note,memo,transaction_template_id,occurrence_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		t.ID, t.AccountID, t.FromAccountID, t.ToAccountID, t.TagID, t.Type, t.State, t.AmountMinor, t.Currency, t.Date, t.Time, t.TZ, t.Note, t.Memo, nullEmpty(t.TransactionTemplateID), nullEmpty(t.OccurrenceDate))
	return err
}
func (b *Book) insertTemplate(t TransactionTemplate) error {
	tj, _ := json.Marshal(t.Template)
	sj, _ := json.Marshal(t.Schedule)
	_, err := b.exec(`INSERT INTO transaction_templates(user_id,id,name,enabled,template_json,schedule_json) VALUES(?,?,?,?,?,?)`, t.ID, t.Name, b2i(t.Enabled), string(tj), string(sj))
	return err
}

// linkTag links a transaction to a tag (its category or money box).
func (b *Book) linkTag(txID, tagID string) error {
	_, err := b.exec(`INSERT OR IGNORE INTO transaction_tags(user_id,transaction_id,tag_id) VALUES(?,?,?)`, txID, tagID)
	return err
}

func (b *Book) getSetting(key string) (string, bool, error) {
	var v string
	err := b.s.db.QueryRow(`SELECT value FROM settings WHERE user_id=? AND key=?`, b.uid, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}
func (b *Book) setSetting(key, value string) error {
	_, err := b.exec(`INSERT INTO settings(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

func (b *Book) updateAccount(a Account) error {
	if _, err := b.s.db.Exec(`UPDATE accounts SET name=?,kind=?,icon=?,currency=?,opening_balance_minor=?,credit_limit_minor=?,statement_close_day=?,payment_due_day=? WHERE user_id=? AND id=?`,
		a.Name, a.Kind, a.Icon, a.Currency, a.OpeningBalanceMinor, n64(a.LimitMinor), nint(a.StatementCloseDay), nint(a.PaymentDueDay), b.uid, a.ID); err != nil {
		return err
	}
	return b.reload()
}
func (b *Book) updateTag(t Tag) error {
	if _, err := b.s.db.Exec(`UPDATE tags SET name=?,kind=?,limit_minor=?,cycle=?,cycle_every=?,cycle_start=?,cycle_end=?,currency=?,target_minor=?,target_date=? WHERE user_id=? AND id=?`,
		t.Name, t.Kind, n64(t.LimitMinor), t.Cycle, t.CycleEvery, t.CycleStart, t.CycleEnd, t.Currency, n64(t.TargetMinor), t.TargetDate, b.uid, t.ID); err != nil {
		return err
	}
	return b.reload()
}
func (b *Book) updateTransaction(t Transaction) error {
	if _, err := b.s.db.Exec(`UPDATE transactions SET account_id=?,from_account_id=?,to_account_id=?,tag_id=?,type=?,state=?,amount_minor=?,currency=?,date=?,time=?,tz=?,note=?,memo=? WHERE user_id=? AND id=?`,
		t.AccountID, t.FromAccountID, t.ToAccountID, t.TagID, t.Type, t.State, t.AmountMinor, t.Currency, t.Date, t.Time, t.TZ, t.Note, t.Memo, b.uid, t.ID); err != nil {
		return err
	}
	// refresh category links: replace with the single tagId link for transfers, keep the money box on allocations
	if t.Type == "transfer" {
		if _, err := b.exec(`DELETE FROM transaction_tags WHERE user_id=? AND transaction_id=?`, t.ID); err != nil {
			return err
		}
		if t.TagID != "" {
			if err := b.linkTag(t.ID, t.TagID); err != nil {
				return err
			}
		}
	}
	return b.reload()
}

// deleteTransaction removes a transaction and its tag links; false if there was none.
func (b *Book) deleteTransaction(id string) (bool, error) {
	if _, err := b.exec(`DELETE FROM transaction_tags WHERE user_id=? AND transaction_id=?`, id); err != nil {
		return false, err
	}
	res, err := b.exec(`DELETE FROM transactions WHERE user_id=? AND id=?`, id)
	if err != nil {
		return false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return false, nil
	}
	return true, b.reload()
}
func (b *Book) updateTemplate(t TransactionTemplate) error {
	tj, _ := json.Marshal(t.Template)
	sj, _ := json.Marshal(t.Schedule)
	if _, err := b.s.db.Exec(`UPDATE transaction_templates SET name=?,enabled=?,template_json=?,schedule_json=? WHERE user_id=? AND id=?`,
		t.Name, b2i(t.Enabled), string(tj), string(sj), b.uid, t.ID); err != nil {
		return err
	}
	return b.reload()
}

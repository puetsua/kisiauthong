// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	_ "modernc.org/sqlite"
)

//go:embed seed.json
var seedJSON string

const schema = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL,
  opening_balance_minor INTEGER NOT NULL DEFAULT 0, allow_negative INTEGER NOT NULL DEFAULT 0,
  credit_limit_minor INTEGER, statement_close_day INTEGER, payment_due_day INTEGER);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL DEFAULT '', from_account_id TEXT NOT NULL DEFAULT '',
  to_account_id TEXT NOT NULL DEFAULT '', tag_id TEXT NOT NULL DEFAULT '', type TEXT NOT NULL,
  state TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '', transaction_template_id TEXT, occurrence_date TEXT,
  UNIQUE(transaction_template_id, occurrence_date));
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, limit_minor INTEGER,
  cycle TEXT NOT NULL DEFAULT '', cycle_every INTEGER NOT NULL DEFAULT 0, cycle_start TEXT NOT NULL DEFAULT '',
  cycle_end TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT '', target_minor INTEGER, target_date TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY(transaction_id, tag_id));
CREATE TABLE IF NOT EXISTS transaction_templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  template_json TEXT NOT NULL, schedule_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

type Store struct {
	mu   sync.Mutex
	db   *sql.DB
	data Data
}

func openStore(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	if err := s.reload(); err != nil {
		return nil, err
	}
	if !s.data.hasOwnAccounts() { // a new database: only the system external account exists
		existing := map[string]bool{}
		for _, a := range s.data.Accounts {
			existing[a.ID] = true
		}
		var seed Data
		if err := json.Unmarshal([]byte(seedJSON), &seed); err != nil {
			return nil, fmt.Errorf("seed: %w", err)
		}
		for _, a := range seed.Accounts {
			if existing[a.ID] {
				continue
			}
			if err := s.insertAccount(a); err != nil {
				return nil, err
			}
		}
		for _, t := range seed.Tags {
			if err := s.insertTag(t); err != nil {
				return nil, err
			}
		}
		for _, t := range seed.Transactions {
			if err := s.insertTransaction(t); err != nil {
				return nil, err
			}
		}
		for _, tt := range seed.TransactionTags {
			if _, err := db.Exec(`INSERT OR IGNORE INTO transaction_tags(transaction_id,tag_id) VALUES(?,?)`, tt.TransactionID, tt.TagID); err != nil {
				return nil, err
			}
		}
		for _, tp := range seed.TransactionTemplates {
			if err := s.insertTemplate(tp); err != nil {
				return nil, err
			}
		}
		if err := s.reload(); err != nil {
			return nil, err
		}
	}
	return s, nil
}

func (d *Data) hasOwnAccounts() bool {
	for _, a := range d.Accounts {
		if !a.IsExternal() {
			return true
		}
	}
	return false
}

// migrations are numbered by position and append-only: never edit or
// reorder a released one. PRAGMA user_version records how many have run.
var migrations = []func(tx *sql.Tx) error{
	migrateExpenseIncomeToTransfers,  // 1
	migrateReleaseToNegativeAllocate, // 2
	migrateAddTransactionMemo,        // 3
	migrateTagKinds,                  // 4
	migrateBudgetPeriods,             // 5
	migrateAccountIcons,              // 6
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

func (s *Store) reload() error {
	d := Data{Version: 1}
	rows, err := s.db.Query(`SELECT id,name,kind,icon,currency,opening_balance_minor,credit_limit_minor,statement_close_day,payment_due_day FROM accounts ORDER BY name`)
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
	tr, err := s.db.Query(`SELECT id,account_id,from_account_id,to_account_id,tag_id,type,state,amount_minor,currency,date,note,memo,transaction_template_id,occurrence_date FROM transactions ORDER BY date,id`)
	if err != nil {
		return err
	}
	defer tr.Close()
	for tr.Next() {
		var t Transaction
		var tplID, occ sql.NullString
		if err := tr.Scan(&t.ID, &t.AccountID, &t.FromAccountID, &t.ToAccountID, &t.TagID, &t.Type, &t.State, &t.AmountMinor, &t.Currency, &t.Date, &t.Note, &t.Memo, &tplID, &occ); err != nil {
			return err
		}
		t.TransactionTemplateID = tplID.String
		t.OccurrenceDate = occ.String
		d.Transactions = append(d.Transactions, t)
	}
	tr.Close()
	tg, err := s.db.Query(`SELECT id,name,kind,limit_minor,cycle,cycle_every,cycle_start,cycle_end,currency,target_minor,target_date FROM tags ORDER BY name`)
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
	tt, err := s.db.Query(`SELECT transaction_id,tag_id FROM transaction_tags`)
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
	tp, err := s.db.Query(`SELECT id,name,enabled,template_json,schedule_json FROM transaction_templates ORDER BY name`)
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
	s.data = d
	return nil
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

func (s *Store) insertAccount(a Account) error {
	_, err := s.db.Exec(`INSERT INTO accounts(id,name,kind,icon,currency,opening_balance_minor,credit_limit_minor,statement_close_day,payment_due_day) VALUES(?,?,?,?,?,?,?,?,?)`,
		a.ID, a.Name, a.Kind, a.Icon, a.Currency, a.OpeningBalanceMinor, n64(a.LimitMinor), nint(a.StatementCloseDay), nint(a.PaymentDueDay))
	return err
}
func (s *Store) insertTag(t Tag) error {
	_, err := s.db.Exec(`INSERT INTO tags(id,name,kind,limit_minor,cycle,cycle_every,cycle_start,cycle_end,currency,target_minor,target_date) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		t.ID, t.Name, t.Kind, n64(t.LimitMinor), t.Cycle, t.CycleEvery, t.CycleStart, t.CycleEnd, t.Currency, n64(t.TargetMinor), t.TargetDate)
	return err
}
func (s *Store) insertTransaction(t Transaction) error {
	_, err := s.db.Exec(`INSERT INTO transactions(id,account_id,from_account_id,to_account_id,tag_id,type,state,amount_minor,currency,date,note,memo,transaction_template_id,occurrence_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		t.ID, t.AccountID, t.FromAccountID, t.ToAccountID, t.TagID, t.Type, t.State, t.AmountMinor, t.Currency, t.Date, t.Note, t.Memo, nullEmpty(t.TransactionTemplateID), nullEmpty(t.OccurrenceDate))
	return err
}
func (s *Store) getSetting(key string) (string, bool, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key=?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}
func (s *Store) setSetting(key, value string) error {
	_, err := s.db.Exec(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}
func (s *Store) updateAccount(a Account) error {
	_, err := s.db.Exec(`UPDATE accounts SET name=?,kind=?,icon=?,currency=?,opening_balance_minor=?,credit_limit_minor=?,statement_close_day=?,payment_due_day=? WHERE id=?`,
		a.Name, a.Kind, a.Icon, a.Currency, a.OpeningBalanceMinor, n64(a.LimitMinor), nint(a.StatementCloseDay), nint(a.PaymentDueDay), a.ID)
	if err != nil {
		return err
	}
	return s.reload()
}
func (s *Store) updateTag(t Tag) error {
	_, err := s.db.Exec(`UPDATE tags SET name=?,kind=?,limit_minor=?,cycle=?,cycle_every=?,cycle_start=?,cycle_end=?,currency=?,target_minor=?,target_date=? WHERE id=?`,
		t.Name, t.Kind, n64(t.LimitMinor), t.Cycle, t.CycleEvery, t.CycleStart, t.CycleEnd, t.Currency, n64(t.TargetMinor), t.TargetDate, t.ID)
	if err != nil {
		return err
	}
	return s.reload()
}
func (s *Store) updateTransaction(t Transaction) error {
	_, err := s.db.Exec(`UPDATE transactions SET account_id=?,from_account_id=?,to_account_id=?,tag_id=?,type=?,state=?,amount_minor=?,currency=?,date=?,note=?,memo=? WHERE id=?`,
		t.AccountID, t.FromAccountID, t.ToAccountID, t.TagID, t.Type, t.State, t.AmountMinor, t.Currency, t.Date, t.Note, t.Memo, t.ID)
	if err != nil {
		return err
	}
	// refresh category links: replace with the single tagId link for transfers, keep the money box on allocations
	if t.Type == "transfer" {
		if _, err := s.db.Exec(`DELETE FROM transaction_tags WHERE transaction_id=?`, t.ID); err != nil {
			return err
		}
		if t.TagID != "" {
			if _, err := s.db.Exec(`INSERT OR IGNORE INTO transaction_tags(transaction_id,tag_id) VALUES(?,?)`, t.ID, t.TagID); err != nil {
				return err
			}
		}
	}
	return s.reload()
}
func (s *Store) updateTemplate(t TransactionTemplate) error {
	tj, _ := json.Marshal(t.Template)
	sj, _ := json.Marshal(t.Schedule)
	_, err := s.db.Exec(`UPDATE transaction_templates SET name=?,enabled=?,template_json=?,schedule_json=? WHERE id=?`, t.Name, b2i(t.Enabled), string(tj), string(sj), t.ID)
	if err != nil {
		return err
	}
	return s.reload()
}
func (s *Store) insertTemplate(t TransactionTemplate) error {
	tj, _ := json.Marshal(t.Template)
	sj, _ := json.Marshal(t.Schedule)
	_, err := s.db.Exec(`INSERT INTO transaction_templates(id,name,enabled,template_json,schedule_json) VALUES(?,?,?,?,?)`, t.ID, t.Name, b2i(t.Enabled), string(tj), string(sj))
	return err
}

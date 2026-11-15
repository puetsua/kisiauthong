// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

var store *Store

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
func newID(prefix string) string { return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano()) }

func stateView(d *Data) map[string]interface{} {
	today := time.Now().Format("2006-01-02")
	accounts := []map[string]interface{}{}
	for _, a := range d.Accounts {
		bal := d.Balance(a.ID)
		alloc := d.AllocatedForAccount(a.ID)
		m := map[string]interface{}{
			"id": a.ID, "name": a.Name, "kind": a.Kind, "icon": a.Icon, "currency": a.Currency, "openingBalanceMinor": a.OpeningBalanceMinor,
			"balanceMinor": bal, "allocatedMinor": alloc, "unallocatedMinor": bal - alloc,
		}
		if a.LimitMinor != nil {
			owed := -bal
			if owed < 0 {
				owed = 0
			}
			m["limitMinor"] = *a.LimitMinor
			m["owedMinor"] = owed
			if *a.LimitMinor > 0 {
				m["utilisation"] = float64(owed) / float64(*a.LimitMinor)
			}
		}
		accounts = append(accounts, m)
	}
	tags := []map[string]interface{}{}
	for _, t := range d.Tags {
		m := map[string]interface{}{"id": t.ID, "name": t.Name, "kind": t.Kind, "currency": t.Currency}
		if t.LimitMinor != nil {
			start, end := BudgetPeriod(t, today)
			spent := d.BudgetSpent(t.ID, start, end)
			m["limitMinor"] = *t.LimitMinor
			m["cycle"] = t.Cycle
			m["cycleEvery"] = max(t.CycleEvery, 1)
			m["cycleStart"] = t.CycleStart
			m["cycleEnd"] = t.CycleEnd
			m["periodStart"] = start
			m["periodEnd"] = end
			m["spentMinor"] = spent
			m["remainingMinor"] = *t.LimitMinor - spent
		}
		if t.TargetMinor != nil {
			saved := d.TagSaved(t.ID)
			m["targetMinor"] = *t.TargetMinor
			m["targetDate"] = t.TargetDate
			m["savedMinor"] = saved
		}
		tags = append(tags, m)
	}
	templates := []map[string]interface{}{}
	for _, tp := range d.TransactionTemplates {
		next := ""
		for _, occ := range Occurrences(tp, today, "2099-12-31") {
			next = occ
			break
		}
		templates = append(templates, map[string]interface{}{
			"id": tp.ID, "name": tp.Name, "enabled": tp.Enabled, "template": tp.Template, "schedule": tp.Schedule, "nextDue": next,
		})
	}
	txns := d.Transactions
	if txns == nil {
		txns = []Transaction{}
	}
	links := d.TransactionTags
	if links == nil {
		links = []TransactionTag{}
	}
	return map[string]interface{}{
		"accounts": accounts, "transactions": txns, "tags": tags,
		"transactionTags": links, "transactionTemplates": templates, "today": today,
		"spendingThisMonth": d.SpendingByCategory(today),
	}
}

func decode(w http.ResponseWriter, r *http.Request, v interface{}) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeErr(w, 400, "invalid JSON: "+err.Error())
		return false
	}
	return true
}

// pathID is the {id} of /api/<things>/{id}[/<action>]; action is "" when absent.
func pathID(r *http.Request) (id, action string, ok bool) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	switch len(parts) {
	case 3:
		return parts[2], "", true
	case 4:
		return parts[2], parts[3], true
	}
	return "", "", false
}

func main() {
	dbPath := os.Getenv("KISIAUTHONG_DB")
	if dbPath == "" {
		// default: data/ at the repo root, whether started from server/ or from the root.
		// An explicit KISIAUTHONG_DB is always used as given, even when the file does not exist yet.
		dbPath = "../data/kisiauthong.db"
		if _, err := os.Stat(dbPath); os.IsNotExist(err) {
			if _, err2 := os.Stat("data/kisiauthong.db"); err2 == nil {
				dbPath = "data/kisiauthong.db"
			}
		}
	}
	var err error
	store, err = openStore(dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}

	webDir := os.Getenv("KISIAUTHONG_WEB")
	if webDir == "" {
		for _, c := range []string{"../web", "web"} {
			if _, err := os.Stat(c); err == nil {
				webDir = c
				break
			}
		}
	}
	addr := listenAddr(os.Getenv("KISIAUTHONG_HOST"), os.Getenv("PORT"))
	log.Printf("kisiauthong listening on http://%s (db %s, web %s)", addr, dbPath, webDir)
	log.Fatal(http.ListenAndServe(addr, newMux(webDir)))
}

// newMux wires every route; tests use it too.
func newMux(webDir string) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })

	// sign-in and the signed-in user's own account (ADR 0007)
	mux.HandleFunc("/api/auth/status", handleAuthStatus)
	mux.HandleFunc("/api/auth/setup", handleSetup)
	mux.HandleFunc("/api/auth/login", handleLogin)
	mux.HandleFunc("/api/auth/logout", handleLogout)
	mux.HandleFunc("/api/auth/totp", handleLoginTOTP)
	mux.HandleFunc("/api/me/totp/setup", sessionOnly(handleTOTPSetup))
	mux.HandleFunc("/api/me/totp/enable", sessionOnly(handleTOTPEnable))
	mux.HandleFunc("/api/me/totp/disable", sessionOnly(handleTOTPDisable))
	mux.HandleFunc("/api/me/passkeys", sessionOnly(handlePasskeys))
	mux.HandleFunc("/api/me/passkeys/", sessionOnly(handlePasskey))
	mux.HandleFunc("/api/auth/passkey", handlePasskeyLogin)
	mux.HandleFunc("/api/me/avatar", sessionOnly(handleMyAvatar))
	mux.HandleFunc("/api/users", adminOnly(handleUsers))
	mux.HandleFunc("/api/users/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/avatar") {
			handleAvatar(w, r) // any signed-in user
			return
		}
		adminOnly(handleUser)(w, r)
	})
	mux.HandleFunc("/api/me", sessionOnly(handleMe))
	mux.HandleFunc("/api/me/password", sessionOnly(handleChangePassword))

	// the books: every handler sees only the caller's own data
	mux.HandleFunc("/api/settings", apiRW(ScopeSettings, handleSettings))
	mux.HandleFunc("/api/export", api(ScopeRead, handleExport))
	mux.HandleFunc("/api/state", api(ScopeRead, func(w http.ResponseWriter, r *http.Request, b *Book) {
		writeJSON(w, 200, stateView(b.data))
	}))
	mux.HandleFunc("/api/accounts", api(ScopeAccounts, handleCreateAccount))
	mux.HandleFunc("/api/accounts/", api(ScopeAccounts, handleUpdateAccount))
	mux.HandleFunc("/api/tags", api(ScopeTags, handleCreateTag))
	mux.HandleFunc("/api/tags/", api(ScopeTags, handleUpdateTag))
	mux.HandleFunc("/api/transactions", api(ScopeTransactions, handleCreateTransaction))
	mux.HandleFunc("/api/transactions/", api(ScopeTransactions, handleTransaction))
	mux.HandleFunc("/api/templates", api(ScopeTemplates, handleCreateTemplate))
	mux.HandleFunc("/api/templates/", api(ScopeTemplates, handleTemplate))
	mux.HandleFunc("/api/generate", api(ScopeTemplates, handleGenerate))

	if webDir != "" {
		mux.Handle("/", http.FileServer(http.Dir(webDir)))
	}
	return mux
}

func handleCreateAccount(w http.ResponseWriter, r *http.Request, b *Book) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	var a Account
	if !decode(w, r, &a) {
		return
	}
	a.ID = newID("acc")
	if err := validateAccount(&a); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if err := b.insertAccount(a); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if err := b.reload(); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, a)
}

func handleUpdateAccount(w http.ResponseWriter, r *http.Request, b *Book) {
	id, action, ok := pathID(r)
	if !ok || action != "" || r.Method != http.MethodPut {
		writeErr(w, 404, "not found")
		return
	}
	var a Account
	if !decode(w, r, &a) {
		return
	}
	a.ID = id
	if a.ID == ExternalAccountID {
		a.Kind = "external" // the anonymous external account can be renamed, not turned into an own account
	}
	if err := validateAccount(&a); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	old := b.data.accountByID(a.ID)
	if old == nil {
		writeErr(w, 404, "account not found")
		return
	}
	if old.IsExternal() != a.IsExternal() && b.data.accountHasTransactions(a.ID) {
		writeErr(w, 400, "an account with transactions cannot switch between your own and external")
		return
	}
	if err := b.updateAccount(a); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, a)
}

func handleCreateTag(w http.ResponseWriter, r *http.Request, b *Book) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	var t Tag
	if !decode(w, r, &t) {
		return
	}
	t.ID = newID("tag")
	t.Name = strings.TrimSpace(t.Name)
	if t.Name == "" {
		writeErr(w, 400, "name required")
		return
	}
	if err := normalizeTag(&t); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if err := b.insertTag(t); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if err := b.reload(); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, t)
}

func handleUpdateTag(w http.ResponseWriter, r *http.Request, b *Book) {
	id, action, ok := pathID(r)
	if !ok || action != "" || r.Method != http.MethodPut {
		writeErr(w, 404, "not found")
		return
	}
	var t Tag
	if !decode(w, r, &t) {
		return
	}
	t.ID = id
	t.Name = strings.TrimSpace(t.Name)
	if t.Name == "" {
		writeErr(w, 400, "name required")
		return
	}
	if err := normalizeTag(&t); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	old := b.data.tagByID(t.ID)
	if old == nil {
		writeErr(w, 404, "tag not found")
		return
	}
	if old.Kind != t.Kind && b.data.tagInUse(t.ID) {
		writeErr(w, 400, "this tag is used by transactions, so it cannot switch between category and money box")
		return
	}
	if err := b.updateTag(t); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, t)
}

func handleCreateTransaction(w http.ResponseWriter, r *http.Request, b *Book) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	var body struct {
		Transaction
		TagIDs []string `json:"tagIds"`
	}
	if !decode(w, r, &body) {
		return
	}
	t, err := b.addTransaction(body.Transaction, body.TagIDs)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 201, t)
}

// addTransaction validates and stores a new transaction with its tag links.
func (b *Book) addTransaction(t Transaction, tagIDs []string) (Transaction, error) {
	if t.Date == "" {
		t.Date = time.Now().Format("2006-01-02")
	}
	if t.State == "" {
		t.State = "posted"
	}
	if t.Type == "" {
		return t, fmt.Errorf("type required")
	}
	t.ID = newID("txn")
	if err := b.data.normalizeTransaction(&t); err != nil {
		return t, err
	}
	if err := b.insertTransaction(t); err != nil {
		return t, err
	}
	for _, tagID := range tagIDs {
		if b.data.tagByID(tagID) == nil {
			continue // only the caller's own tags
		}
		if err := b.linkTag(t.ID, tagID); err != nil {
			return t, err
		}
	}
	if t.TagID != "" && t.Type == "transfer" {
		if err := b.linkTag(t.ID, t.TagID); err != nil {
			return t, err
		}
	}
	return t, b.reload()
}

func handleTransaction(w http.ResponseWriter, r *http.Request, b *Book) {
	id, action, ok := pathID(r)
	if !ok {
		writeErr(w, 404, "not found")
		return
	}
	switch {
	case r.Method == http.MethodPut && action == "":
		var body struct {
			Transaction
			TagIDs []string `json:"tagIds"`
		}
		if !decode(w, r, &body) {
			return
		}
		t := body.Transaction
		t.ID = id
		if t.Type == "" || t.Date == "" {
			writeErr(w, 400, "type and date required")
			return
		}
		old := b.data.transactionByID(id)
		if old == nil {
			writeErr(w, 404, "transaction not found")
			return
		}
		if t.TransactionTemplateID == "" { // keep the generator identity unless explicitly supplied
			t.TransactionTemplateID, t.OccurrenceDate = old.TransactionTemplateID, old.OccurrenceDate
		}
		if err := b.data.normalizeTransaction(&t); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		if err := b.updateTransaction(t); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, t)
	case r.Method == http.MethodDelete && action == "":
		found, err := b.deleteTransaction(id)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if !found {
			writeErr(w, 404, "transaction not found")
			return
		}
		writeJSON(w, 200, map[string]string{"deleted": id})
	case r.Method == http.MethodPost && action == "post":
		// confirm an expected transaction, optionally with the actual amount
		var body struct {
			AmountMinor *int64 `json:"amountMinor"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		old := b.data.transactionByID(id)
		if old == nil {
			writeErr(w, 404, "transaction not found")
			return
		}
		t := *old
		if body.AmountMinor != nil && *body.AmountMinor > 0 {
			t.AmountMinor = *body.AmountMinor
		}
		t.State = "posted"
		if err := b.updateTransaction(t); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, t)
	default:
		writeErr(w, 404, "not found")
	}
}

func handleCreateTemplate(w http.ResponseWriter, r *http.Request, b *Book) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	var tp TransactionTemplate
	if !decode(w, r, &tp) {
		return
	}
	if tp.Name == "" || tp.Template.AmountMinor <= 0 {
		writeErr(w, 400, "name and template amount required")
		return
	}
	tp.ID = newID("tpl")
	tp.Enabled = true
	if tp.Schedule.Interval < 1 {
		tp.Schedule.Interval = 1
	}
	if tp.Schedule.Frequency == "" {
		tp.Schedule.Frequency = "monthly"
	}
	if err := b.data.normalizeTemplate(&tp.Template); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if err := b.insertTemplate(tp); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if err := b.reload(); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, tp)
}

func handleTemplate(w http.ResponseWriter, r *http.Request, b *Book) {
	id, action, ok := pathID(r)
	if !ok {
		writeErr(w, 404, "not found")
		return
	}
	old := b.data.templateByID(id)
	if old == nil {
		writeErr(w, 404, "template not found")
		return
	}
	switch {
	case r.Method == http.MethodPut && action == "":
		var tp TransactionTemplate
		if !decode(w, r, &tp) {
			return
		}
		tp.ID = id
		if tp.Name == "" || tp.Template.AmountMinor <= 0 {
			writeErr(w, 400, "name and template amount required")
			return
		}
		if tp.Schedule.Interval < 1 {
			tp.Schedule.Interval = 1
		}
		if err := b.data.normalizeTemplate(&tp.Template); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		if err := b.updateTemplate(tp); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, tp)
	case r.Method == http.MethodPost && action == "toggle":
		tp := *old
		tp.Enabled = !tp.Enabled
		if err := b.updateTemplate(tp); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, tp)
	default:
		writeErr(w, 404, "not found")
	}
}

func handleGenerate(w http.ResponseWriter, r *http.Request, b *Book) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	var body struct {
		Date string `json:"date"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Date == "" {
		body.Date = time.Now().Format("2006-01-02")
	}
	n, err := b.GenerateDue(body.Date)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"created": n})
}

// listenAddr defaults to loopback only; set KISIAUTHONG_HOST (e.g. 0.0.0.0
// in a container or for LAN access) to serve other machines, ideally behind
// HTTPS so sign-in cookies and passkeys stay safe.
func listenAddr(host, port string) string {
	if host == "" {
		host = "127.0.0.1"
	}
	if port == "" {
		port = "8080"
	}
	return net.JoinHostPort(host, port)
}

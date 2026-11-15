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
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
func newID(prefix string) string { return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano()) }

func stateView() map[string]interface{} {
	d := store.data
	today := time.Now().Format("2006-01-02")
	accounts := []map[string]interface{}{}
	for _, a := range d.Accounts {
		bal := d.Balance(a.ID)
		alloc := d.AllocatedForAccount(a.ID)
		m := map[string]interface{}{
			"id": a.ID, "name": a.Name, "kind": a.Kind, "currency": a.Currency, "openingBalanceMinor": a.OpeningBalanceMinor,
			"balanceMinor": bal, "allocatedMinor": alloc, "unallocatedMinor": bal - alloc,
			"allowNegative": a.AllowNegative,
		}
		if a.CreditLimitMinor != nil {
			owed := -bal
			if owed < 0 {
				owed = 0
			}
			m["creditLimitMinor"] = *a.CreditLimitMinor
			m["owedMinor"] = owed
			if *a.CreditLimitMinor > 0 {
				m["utilisation"] = float64(owed) / float64(*a.CreditLimitMinor)
			}
		}
		accounts = append(accounts, m)
	}
	tags := []map[string]interface{}{}
	for _, t := range d.Tags {
		m := map[string]interface{}{"id": t.ID, "name": t.Name, "kind": t.Kind, "currency": t.Currency}
		if t.LimitMinor != nil {
			spent := d.BudgetSpent(t.ID, today)
			m["limitMinor"] = *t.LimitMinor
			m["cycle"] = t.Cycle
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
	return map[string]interface{}{
		"accounts": accounts, "transactions": d.Transactions, "tags": tags,
		"transactionTags": d.TransactionTags, "transactionTemplates": templates, "today": today,
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

func main() {
	dbPath := os.Getenv("KISIAUTHONG_DB")
	if dbPath == "" {
		dbPath = "../data/kisiauthong.db"
	}
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		if _, err2 := os.Stat("data/kisiauthong.db"); err2 == nil {
			dbPath = "data/kisiauthong.db"
		}
	}
	var err error
	store, err = openStore(dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("/api/settings", handleSettings)
	mux.HandleFunc("/api/export", handleExport)
	mux.HandleFunc("/api/state", func(w http.ResponseWriter, r *http.Request) {
		store.mu.Lock()
		defer store.mu.Unlock()
		writeJSON(w, 200, stateView())
	})
	mux.HandleFunc("/api/accounts/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) != 3 || r.Method != http.MethodPut {
			writeErr(w, 404, "not found")
			return
		}
		var a Account
		if !decode(w, r, &a) {
			return
		}
		a.ID = parts[2]
		if a.Name == "" || a.Currency == "" {
			writeErr(w, 400, "name and currency required")
			return
		}
		store.mu.Lock()
		defer store.mu.Unlock()
		if store.data.accountByID(a.ID) == nil {
			writeErr(w, 404, "account not found")
			return
		}
		if err := store.updateAccount(a); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, a)
	})
	mux.HandleFunc("/api/tags/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) != 3 || r.Method != http.MethodPut {
			writeErr(w, 404, "not found")
			return
		}
		var t Tag
		if !decode(w, r, &t) {
			return
		}
		t.ID = parts[2]
		if t.Name == "" {
			writeErr(w, 400, "name required")
			return
		}
		store.mu.Lock()
		defer store.mu.Unlock()
		found := false
		for _, x := range store.data.Tags {
			if x.ID == t.ID {
				found = true
			}
		}
		if !found {
			writeErr(w, 404, "tag not found")
			return
		}
		if err := store.updateTag(t); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, t)
	})
	mux.HandleFunc("/api/accounts", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "POST only")
			return
		}
		var a Account
		if !decode(w, r, &a) {
			return
		}
		if a.Name == "" || a.Currency == "" {
			writeErr(w, 400, "name and currency required")
			return
		}
		a.ID = newID("acc")
		if a.Kind == "" {
			a.Kind = "bank"
		}
		store.mu.Lock()
		defer store.mu.Unlock()
		if err := store.insertAccount(a); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		store.data.Accounts = append(store.data.Accounts, a)
		writeJSON(w, 201, a)
	})
	mux.HandleFunc("/api/tags", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, 405, "POST only")
			return
		}
		var t Tag
		if !decode(w, r, &t) {
			return
		}
		if t.Name == "" {
			writeErr(w, 400, "name required")
			return
		}
		t.ID = newID("tag")
		if t.Kind == "" {
			t.Kind = "label"
		}
		store.mu.Lock()
		defer store.mu.Unlock()
		if err := store.insertTag(t); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		store.data.Tags = append(store.data.Tags, t)
		writeJSON(w, 201, t)
	})
	mux.HandleFunc("/api/transactions", func(w http.ResponseWriter, r *http.Request) {
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
		t := body.Transaction
		if t.AmountMinor <= 0 {
			writeErr(w, 400, "amountMinor must be positive")
			return
		}
		if t.Date == "" {
			t.Date = time.Now().Format("2006-01-02")
		}
		if t.State == "" {
			t.State = "posted"
		}
		if t.Type == "" {
			writeErr(w, 400, "type required")
			return
		}
		if (t.Type == "allocate" || t.Type == "release") && t.TagID == "" {
			writeErr(w, 400, "tagId required for allocate/release")
			return
		}
		t.ID = newID("txn")
		store.mu.Lock()
		defer store.mu.Unlock()
		if err := store.data.normalizeTransaction(&t); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		if err := store.insertTransaction(t); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		store.data.Transactions = append(store.data.Transactions, t)
		for _, tagID := range body.TagIDs {
			tt := TransactionTag{TransactionID: t.ID, TagID: tagID}
			if _, err := store.db.Exec(`INSERT OR IGNORE INTO transaction_tags(transaction_id,tag_id) VALUES(?,?)`, tt.TransactionID, tt.TagID); err == nil {
				store.data.TransactionTags = append(store.data.TransactionTags, tt)
			}
			// also honour a single category tag passed via tagId on expense/income
			_ = tt
		}
		if t.TagID != "" && (t.Type == "expense" || t.Type == "income") {
			tt := TransactionTag{TransactionID: t.ID, TagID: t.TagID}
			if _, err := store.db.Exec(`INSERT OR IGNORE INTO transaction_tags(transaction_id,tag_id) VALUES(?,?)`, tt.TransactionID, tt.TagID); err == nil {
				store.data.TransactionTags = append(store.data.TransactionTags, tt)
			}
		}
		writeJSON(w, 201, t)
	})
	mux.HandleFunc("/api/transactions/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if r.Method == http.MethodPut && len(parts) == 3 {
			var body struct {
				Transaction
				TagIDs []string `json:"tagIds"`
			}
			if !decode(w, r, &body) {
				return
			}
			t := body.Transaction
			t.ID = parts[2]
			if t.AmountMinor <= 0 || t.Type == "" || t.Date == "" {
				writeErr(w, 400, "type, positive amount and date required")
				return
			}
			if (t.Type == "allocate" || t.Type == "release") && t.TagID == "" {
				writeErr(w, 400, "tagId required for allocate/release")
				return
			}
			store.mu.Lock()
			defer store.mu.Unlock()
			exists := false
			for _, x := range store.data.Transactions {
				if x.ID == t.ID {
					exists = true
					// preserve generator identity unless explicitly supplied
					if t.TransactionTemplateID == "" {
						t.TransactionTemplateID = x.TransactionTemplateID
						t.OccurrenceDate = x.OccurrenceDate
					}
				}
			}
			if !exists {
				writeErr(w, 404, "transaction not found")
				return
			}
			if err := store.data.normalizeTransaction(&t); err != nil {
				writeErr(w, 400, err.Error())
				return
			}
			if err := store.updateTransaction(t); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			writeJSON(w, 200, t)
			return
		}
		if r.Method == http.MethodDelete && len(parts) == 3 {
			store.mu.Lock()
			defer store.mu.Unlock()
			if _, err := store.db.Exec(`DELETE FROM transaction_tags WHERE transaction_id=?`, parts[2]); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			res, err := store.db.Exec(`DELETE FROM transactions WHERE id=?`, parts[2])
			if err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			if n, _ := res.RowsAffected(); n == 0 {
				writeErr(w, 404, "transaction not found")
				return
			}
			if err := store.reload(); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			writeJSON(w, 200, map[string]string{"deleted": parts[2]})
			return
		}
		if len(parts) != 4 || parts[3] != "post" || r.Method != http.MethodPost {
			writeErr(w, 404, "not found")
			return
		}
		id := parts[2]
		var body struct {
			AmountMinor *int64 `json:"amountMinor"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		store.mu.Lock()
		defer store.mu.Unlock()
		for i := range store.data.Transactions {
			if store.data.Transactions[i].ID == id {
				if body.AmountMinor != nil && *body.AmountMinor > 0 {
					store.data.Transactions[i].AmountMinor = *body.AmountMinor
				}
				store.data.Transactions[i].State = "posted"
				_, err := store.db.Exec(`UPDATE transactions SET state='posted', amount_minor=? WHERE id=?`, store.data.Transactions[i].AmountMinor, id)
				if err != nil {
					writeErr(w, 500, err.Error())
					return
				}
				writeJSON(w, 200, store.data.Transactions[i])
				return
			}
		}
		writeErr(w, 404, "transaction not found")
	})
	mux.HandleFunc("/api/templates", func(w http.ResponseWriter, r *http.Request) {
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
		store.mu.Lock()
		defer store.mu.Unlock()
		if err := store.insertTemplate(tp); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		store.data.TransactionTemplates = append(store.data.TransactionTemplates, tp)
		writeJSON(w, 201, tp)
	})
	mux.HandleFunc("/api/templates/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if r.Method == http.MethodPut && len(parts) == 3 {
			var tp TransactionTemplate
			if !decode(w, r, &tp) {
				return
			}
			tp.ID = parts[2]
			if tp.Name == "" || tp.Template.AmountMinor <= 0 {
				writeErr(w, 400, "name and template amount required")
				return
			}
			if tp.Schedule.Interval < 1 {
				tp.Schedule.Interval = 1
			}
			store.mu.Lock()
			defer store.mu.Unlock()
			found := false
			for _, x := range store.data.TransactionTemplates {
				if x.ID == tp.ID {
					found = true
				}
			}
			if !found {
				writeErr(w, 404, "template not found")
				return
			}
			if err := store.updateTemplate(tp); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			writeJSON(w, 200, tp)
			return
		}
		if len(parts) != 4 || parts[3] != "toggle" || r.Method != http.MethodPost {
			writeErr(w, 404, "not found")
			return
		}
		store.mu.Lock()
		defer store.mu.Unlock()
		for i := range store.data.TransactionTemplates {
			if store.data.TransactionTemplates[i].ID == parts[2] {
				store.data.TransactionTemplates[i].Enabled = !store.data.TransactionTemplates[i].Enabled
				_, err := store.db.Exec(`UPDATE transaction_templates SET enabled=? WHERE id=?`, b2i(store.data.TransactionTemplates[i].Enabled), parts[2])
				if err != nil {
					writeErr(w, 500, err.Error())
					return
				}
				writeJSON(w, 200, store.data.TransactionTemplates[i])
				return
			}
		}
		writeErr(w, 404, "template not found")
	})
	mux.HandleFunc("/api/generate", func(w http.ResponseWriter, r *http.Request) {
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
		n, err := store.GenerateDue(body.Date)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]interface{}{"created": n})
	})

	webDir := os.Getenv("KISIAUTHONG_WEB")
	if webDir == "" {
		for _, c := range []string{"../web", "web"} {
			if _, err := os.Stat(c); err == nil {
				webDir = c
				break
			}
		}
	}
	mux.Handle("/", http.FileServer(http.Dir(webDir)))

	addr := listenAddr(os.Getenv("KISIAUTHONG_HOST"), os.Getenv("PORT"))
	log.Printf("kisiauthong listening on http://%s (db %s, web %s)", addr, dbPath, webDir)
	log.Fatal(http.ListenAndServe(addr, mux))
}

// listenAddr defaults to loopback only: there is no login yet, so the books
// must not be reachable from the network unless the host opts in with
// KISIAUTHONG_HOST (e.g. 0.0.0.0 in a container or for LAN access).
func listenAddr(host, port string) string {
	if host == "" {
		host = "127.0.0.1"
	}
	if port == "" {
		port = "8080"
	}
	return net.JoinHostPort(host, port)
}

// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
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

// newID is time-ordered with a random tail: the clock alone repeats within a
// tick on some systems (Windows), and ids must never collide.
func newID(prefix string) string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return fmt.Sprintf("%s-%d-%s", prefix, time.Now().UnixNano(), hex.EncodeToString(b))
}

// stateView is everything the web client shows, as of today (the user's date, see Book.today).
func stateView(d *Data, today string, curOrder []string) map[string]interface{} {
	accounts := []map[string]interface{}{}
	for _, a := range d.Accounts {
		bal := d.Balance(a.ID, today)
		reserved, held := d.Reserved(a.ID), d.Held(a.ID, today)
		m := map[string]interface{}{
			"id": a.ID, "name": a.Name, "kind": a.Kind, "icon": a.Icon, "currency": a.Currency, "openingBalanceMinor": a.OpeningBalanceMinor,
			"balanceMinor": bal, "reservedMinor": reserved, "freeMinor": bal - reserved - held,
			// scheduled transactions (ADR 0014): held leaves free now, incoming is only shown
			"heldMinor": held, "incomingMinor": d.Incoming(a.ID, today),
		}
		if !a.IsExternal() { // an external account has no balance, so nothing to project
			m["projectedMinor"] = d.Projected(a.ID)
		}
		if next := d.NextScheduled(a.ID, today, true); next != "" {
			m["nextHeldDate"] = next
		}
		if next := d.NextScheduled(a.ID, today, false); next != "" {
			m["nextIncomingDate"] = next
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
		if a.Memo != "" {
			m["memo"] = a.Memo // the user's own note (issue #42)
		}
		accounts = append(accounts, m)
	}
	tags := []map[string]interface{}{}
	for _, t := range d.Tags {
		m := map[string]interface{}{"id": t.ID, "name": t.Name, "currency": t.Currency}
		if t.Memo != "" {
			m["memo"] = t.Memo // the user's own note (issue #42)
		}
		if t.Group != "" {
			m["group"] = t.Group // the heading it is listed under in tag pickers (ADR 0028)
		}
		if t.LimitMinor != nil {
			start, end := BudgetPeriod(t, today)
			spent := d.BudgetSpent(t.ID, start, end, today)
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
		tags = append(tags, m)
	}
	reserves := []map[string]interface{}{}
	for _, r := range d.Reserves {
		m := map[string]interface{}{
			"id": r.ID, "name": r.Name, "currency": r.Currency, "targetDate": r.TargetDate,
			"savedMinor": d.ReserveSaved(r.ID), "split": d.ReserveSplit(r.ID),
		}
		if r.TargetMinor != nil {
			m["targetMinor"] = *r.TargetMinor
		}
		reserves = append(reserves, m)
	}
	allocs := d.Allocations
	if allocs == nil {
		allocs = []Allocation{}
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
	txns := make([]Transaction, len(d.Transactions))
	for i, t := range d.Transactions {
		t.State = ServedState(t, today)
		txns[i] = t
	}
	links := d.TransactionTags
	if links == nil {
		links = []TransactionTag{}
	}
	return map[string]interface{}{
		"accounts": accounts, "transactions": txns, "tags": tags,
		"reserves": reserves, "allocations": allocs,
		"transactionTags": links, "transactionTemplates": templates, "today": today,
		"spendingThisMonth": d.SpendingByCategory(today, today, curOrder),
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
	addr := listenAddr(os.Getenv("KISIAUTHONG_HOST"), os.Getenv("PORT"))
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "version", "-version", "--version":
			fmt.Println("kisiauthong", appVersion)
			return
		case "healthcheck": // for container health checks: the image has no shell or curl
			os.Exit(healthcheck(addr))
		default:
			fmt.Fprintf(os.Stderr, "usage: kisiauthong [version|healthcheck]\nsettings come from environment variables, see README.md\n")
			os.Exit(2)
		}
	}
	dbPath := os.Getenv("KISIAUTHONG_DB")
	if dbPath == "" && embeddedWeb != nil {
		dbPath = filepath.Join("data", "kisiauthong.db") // a release build: data/ in the working directory
	}
	if dbPath == "" {
		// in the repository: data/ at its root, whether started from server/ or from the root.
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

	webDir := os.Getenv("KISIAUTHONG_WEB") // overrides the built-in web UI of a release build
	if webDir == "" && embeddedWeb == nil {
		for _, c := range []string{"../web", "web"} {
			if _, err := os.Stat(c); err == nil {
				webDir = c
				break
			}
		}
	}
	web := webDir
	if web == "" && embeddedWeb != nil {
		web = "built in"
	}
	basePath = normBasePath(os.Getenv("KISIAUTHONG_BASE_PATH"))
	log.Printf("kisiauthong %s listening on http://%s%s (db %s, web %s)", appVersion, addr, basePath, dbPath, web)
	log.Fatal(http.ListenAndServe(addr, withBasePath(newMux(webDir), basePath)))
}

// basePath is where the app lives on its host: "/" or e.g. "/kisiauthong/"
// behind a reverse proxy that serves several apps on one name.
var basePath = "/"

// normBasePath turns "kisiauthong", "/kisiauthong" or "/kisiauthong/" into "/kisiauthong/".
func normBasePath(p string) string {
	p = strings.Trim(strings.TrimSpace(p), "/")
	if p == "" {
		return "/"
	}
	return "/" + p + "/"
}

// withBasePath serves h under base: /kisiauthong/api/x reaches h as /api/x,
// /kisiauthong redirects to /kisiauthong/, and /healthz stays at the root
// for health checks. Anything else is not ours.
func withBasePath(h http.Handler, base string) http.Handler {
	if base == "/" {
		return h
	}
	strip := http.StripPrefix(strings.TrimSuffix(base, "/"), h)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == strings.TrimSuffix(base, "/"):
			http.Redirect(w, r, base, http.StatusMovedPermanently)
		case strings.HasPrefix(r.URL.Path, base):
			strip.ServeHTTP(w, r)
		case r.URL.Path == "/healthz":
			h.ServeHTTP(w, r)
		default:
			http.NotFound(w, r)
		}
	})
}

// healthcheck asks the server on addr for /healthz: 0 when it answers ok.
func healthcheck(addr string) int {
	host, port, _ := net.SplitHostPort(addr)
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	c := &http.Client{Timeout: 3 * time.Second}
	res, err := c.Get("http://" + net.JoinHostPort(host, port) + "/healthz")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthz:", res.Status)
		return 1
	}
	return 0
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
	mux.HandleFunc("/api/me/keys", sessionOnly(handleKeys))
	mux.HandleFunc("/api/me/keys/", sessionOnly(handleKey))
	mux.HandleFunc("/api/admin/server", adminOnly(handleAdminServer))
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
	mux.HandleFunc("/api/state", api(ScopeRead, handleState))
	mux.HandleFunc("/api/events", handleEvents)
	mux.HandleFunc("/api/accounts", api(ScopeAccounts, handleCreateAccount))
	mux.HandleFunc("/api/accounts/", api(ScopeAccounts, handleUpdateAccount))
	mux.HandleFunc("/api/tags", api(ScopeTags, handleCreateTag))
	mux.HandleFunc("/api/tags/", api(ScopeTags, handleUpdateTag))
	mux.HandleFunc("/api/tag-merges/", api(ScopeTags, handleTagMerge))
	mux.HandleFunc("/api/reserves", api(ScopeReserves, handleCreateReserve))
	mux.HandleFunc("/api/reserves/", api(ScopeReserves, handleReserve))
	mux.HandleFunc("/api/allocations/", api(ScopeReserves, handleAllocation))
	mux.HandleFunc("/api/transactions", api(ScopeTransactions, handleCreateTransaction))
	mux.HandleFunc("/api/transactions/", api(ScopeTransactions, handleTransaction))
	mux.HandleFunc("/api/templates", api(ScopeTemplates, handleCreateTemplate))
	mux.HandleFunc("/api/templates/", api(ScopeTemplates, handleTemplate))
	mux.HandleFunc("/api/generate", api(ScopeTemplates, handleGenerate))

	// MCP for AI agents, with an API key (ADR 0008)
	mux.HandleFunc("/mcp", handleMCP)

	switch {
	case webDir != "":
		mux.Handle("/", http.FileServer(http.Dir(webDir)))
	case embeddedWeb != nil:
		mux.Handle("/", http.FileServer(http.FS(embeddedWeb)))
	}
	return mux
}

// handleState serves GET /api/state: everything the web client shows, as of today.
func handleState(w http.ResponseWriter, r *http.Request, b *Book) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "GET only") // issue #105: other methods used to get the state too
		return
	}
	st := stateView(b.data, b.today(), b.currencyOrder())
	st["rev"] = b.s.live.revision(b.uid) // what a page compares live change events with (issue #55)
	writeJSON(w, 200, st)
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
	if old.IsExternal() != a.IsExternal() && b.data.accountInUse(a.ID) {
		writeErr(w, 400, "an account with transactions or allocations cannot switch between your own and external")
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
	if ok && action == "merge" && r.Method == http.MethodPost {
		handleMergeTags(w, r, b, id)
		return
	}
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
	if b.data.tagByID(t.ID) == nil {
		writeErr(w, 404, "tag not found")
		return
	}
	if err := b.updateTag(t); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, t)
}

func handleCreateReserve(w http.ResponseWriter, r *http.Request, b *Book) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	var res Reserve
	if !decode(w, r, &res) {
		return
	}
	res.ID = newID("rsv")
	if err := normalizeReserve(&res); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if err := b.insertReserve(res); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if err := b.reload(); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, res)
}

// handleReserve serves /api/reserves/{id} (PUT, DELETE) and its actions:
// POST allocations adds one allocation; POST complete takes out everything it holds.
func handleReserve(w http.ResponseWriter, r *http.Request, b *Book) {
	id, action, ok := pathID(r)
	if !ok {
		writeErr(w, 404, "not found")
		return
	}
	if b.data.reserveByID(id) == nil {
		writeErr(w, 404, "reserve not found")
		return
	}
	switch {
	case r.Method == http.MethodPut && action == "":
		var res Reserve
		if !decode(w, r, &res) {
			return
		}
		res.ID = id
		if err := normalizeReserve(&res); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		if err := b.updateReserve(res); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, res)
	case r.Method == http.MethodDelete && action == "":
		if err := b.deleteReserve(id); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]string{"deleted": id})
	case r.Method == http.MethodPost && action == "allocations":
		var a Allocation
		if !decode(w, r, &a) {
			return
		}
		a.ReserveID = id
		a, err := b.addAllocation(a)
		if err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		writeJSON(w, 201, a)
	case r.Method == http.MethodPost && action == "complete":
		var body struct {
			Date string `json:"date"`
			Note string `json:"note"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		out, err := b.completeReserve(id, body.Date, body.Note)
		if err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		writeJSON(w, 201, out)
	default:
		writeErr(w, 404, "not found")
	}
}

// addAllocation validates and stores one allocation.
func (b *Book) addAllocation(a Allocation) (Allocation, error) {
	if a.Date == "" {
		a.Date = b.today()
	}
	a.ID, a.CreatedAt = newID("alc"), createdStamp()
	a.TransactionTemplateID, a.OccurrenceDate = "", ""
	if err := b.data.normalizeAllocation(&a); err != nil {
		return a, err
	}
	if err := b.insertAllocation(a); err != nil {
		return a, err
	}
	return a, b.reload()
}

// completeReserve takes out everything a reserve holds, one negative allocation per account,
// all or nothing.
func (b *Book) completeReserve(id, date, note string) ([]Allocation, error) {
	if date == "" {
		date = b.today()
	}
	var out []Allocation
	for _, s := range b.data.ReserveSplit(id) {
		if s.AmountMinor <= 0 {
			continue
		}
		a := Allocation{ID: newID("alc"), CreatedAt: createdStamp(), ReserveID: id, AccountID: s.AccountID, AmountMinor: -s.AmountMinor, Date: date, Note: note}
		if err := b.data.normalizeAllocation(&a); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("this reserve holds nothing to take out")
	}
	if err := b.insertAllocations(out); err != nil {
		return nil, err
	}
	return out, b.reload()
}

// handleAllocation serves /api/allocations/{id}: PUT fixes a typo, DELETE removes one.
func handleAllocation(w http.ResponseWriter, r *http.Request, b *Book) {
	id, action, ok := pathID(r)
	if !ok || action != "" {
		writeErr(w, 404, "not found")
		return
	}
	old := b.data.allocationByID(id)
	if old == nil {
		writeErr(w, 404, "allocation not found")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var a Allocation
		if !decode(w, r, &a) {
			return
		}
		a.ID = id
		if a.ReserveID == "" {
			a.ReserveID = old.ReserveID
		}
		a.CreatedAt, a.TransactionTemplateID, a.OccurrenceDate = old.CreatedAt, old.TransactionTemplateID, old.OccurrenceDate
		if a.ReserveID != old.ReserveID || a.AccountID != old.AccountID { // it leaves its old pair
			if err := b.data.leavesPairHeld(old); err != nil {
				writeErr(w, 400, err.Error())
				return
			}
		}
		if err := b.data.normalizeAllocation(&a); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		if err := b.updateAllocation(a); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, a)
	case http.MethodDelete:
		if err := b.data.leavesPairHeld(old); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		if _, err := b.deleteAllocation(id); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]string{"deleted": id})
	default:
		writeErr(w, 405, "PUT or DELETE only")
	}
}

func handleCreateTransaction(w http.ResponseWriter, r *http.Request, b *Book) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	var body Transaction
	if !decode(w, r, &body) {
		return
	}
	today := b.today() // once per request, so a request across midnight sees one date
	if body.Date == "" {
		body.Date = today
	}
	t, err := b.addTransaction(body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	t.State = ServedState(t, today)
	writeJSON(w, 201, t)
}

// addTransaction validates and stores a new transaction with its category links.
// A posted transaction dated after today is scheduled (ADR 0014).
func (b *Book) addTransaction(t Transaction) (Transaction, error) {
	if t.Date == "" {
		t.Date = b.today()
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
	for _, id := range t.TagIDs {
		if err := b.linkTag(t.ID, id); err != nil {
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
		var t Transaction
		if !decode(w, r, &t) {
			return
		}
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
		t.State = ServedState(t, b.today())
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
		// confirm an expected transaction, optionally with the actual amount; a scheduled
		// one posts now: its date becomes today (ADR 0014)
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
		if today := b.today(); t.Date > today {
			t.Date, t.At = today, instant(today, t.Time, t.TZ)
		}
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
	if err := normalizeSchedule(&tp.Schedule); err != nil {
		writeErr(w, 400, err.Error())
		return
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
		if err := normalizeSchedule(&tp.Schedule); err != nil {
			writeErr(w, 400, err.Error())
			return
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
		body.Date = b.today()
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

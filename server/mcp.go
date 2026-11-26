// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"sort"
	"strings"
)

// MCP (ADR 0008): an AI agent reaches the user's books through the Model
// Context Protocol over Streamable HTTP at /mcp, with an API key as its
// Bearer token. Each tool needs one scope; tools the key lacks are not
// listed and refuse to run. The server answers every POST with one JSON
// response and opens no event stream, which the transport allows.

var mcpVersions = []string{"2025-11-25", "2025-06-18", "2025-03-26"} // newest first

const mcpInstructions = `The books of one person in 記數通 (KiSiauThong). Amounts are decimal strings in the currency of the account they belong to ("1234.5"); each also comes as amountMinor, an integer in the currency's minor unit. Spending is money leaving an own account to an external one, income the reverse; a transfer moves money between two own accounts of the same currency. A reserve sets money aside for a purpose: its allocations earmark part of an account's balance and move no cash; spending never changes a reserve. Dates are the person's local YYYY-MM-DD. Call list_accounts, list_tags and list_reserves first to learn ids.`

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func rpcReply(w http.ResponseWriter, id json.RawMessage, result interface{}, e *rpcError) {
	if id == nil {
		id = json.RawMessage("null")
	}
	m := map[string]interface{}{"jsonrpc": "2.0", "id": id}
	if e != nil {
		m["error"] = e
	} else {
		m["result"] = result
	}
	writeJSON(w, 200, m)
}

// handleMCP serves POST /mcp. Only API keys are accepted, never the session cookie.
func handleMCP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		writeErr(w, 405, "POST only: this server sends no event stream")
		return
	}
	if !sameOrigin(r) { // DNS-rebinding guard the transport asks for
		writeErr(w, 403, "cross-site request refused")
		return
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	h := r.Header.Get("Authorization")
	if h == "" {
		w.Header().Set("WWW-Authenticate", `Bearer realm="kisiauthong"`)
		writeErr(w, 401, "send an API key: Authorization: Bearer kst_…")
		return
	}
	p, err := store.keyPrincipal(h)
	if err != nil {
		w.Header().Set("WWW-Authenticate", `Bearer realm="kisiauthong", error="invalid_token"`)
		writeErr(w, 401, err.Error())
		return
	}
	var req rpcRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		rpcReply(w, nil, nil, &rpcError{-32700, "parse error: send one JSON-RPC message per request"})
		return
	}
	if req.JSONRPC != "2.0" || req.Method == "" {
		rpcReply(w, req.ID, nil, &rpcError{-32600, "invalid JSON-RPC request"})
		return
	}
	if req.ID == nil { // a notification (e.g. notifications/initialized): nothing to answer
		w.WriteHeader(http.StatusAccepted)
		return
	}
	switch req.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(req.Params, &params)
		version := mcpVersions[0]
		for _, v := range mcpVersions {
			if v == params.ProtocolVersion {
				version = v
			}
		}
		rpcReply(w, req.ID, map[string]interface{}{
			"protocolVersion": version,
			"capabilities":    map[string]interface{}{"tools": map[string]interface{}{}},
			"serverInfo":      map[string]string{"name": "kisiauthong", "title": "記數通 KiSiauThong", "version": appVersion},
			"instructions":    mcpInstructions,
		}, nil)
	case "ping":
		rpcReply(w, req.ID, map[string]interface{}{}, nil)
	case "tools/list":
		list := []map[string]interface{}{}
		for _, t := range mcpTools {
			if p.can(t.scope) {
				list = append(list, map[string]interface{}{"name": t.name, "description": t.desc, "inputSchema": t.schema,
					"annotations": map[string]bool{"readOnlyHint": t.scope == ScopeRead, "destructiveHint": t.name == "delete_transaction" || t.name == "merge_tags"}})
			}
		}
		rpcReply(w, req.ID, map[string]interface{}{"tools": list}, nil)
	case "tools/call":
		var params struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			rpcReply(w, req.ID, nil, &rpcError{-32602, "invalid params"})
			return
		}
		tool := mcpTool(params.Name)
		if tool == nil {
			rpcReply(w, req.ID, nil, &rpcError{-32602, "unknown tool: " + params.Name})
			return
		}
		if !p.can(tool.scope) {
			rpcReply(w, req.ID, toolError("this API key lacks the "+tool.scope+" permission"), nil)
			return
		}
		b, err := store.book(p.UserID)
		if err != nil {
			rpcReply(w, req.ID, nil, &rpcError{-32603, err.Error()})
			return
		}
		argv := params.Arguments
		if len(argv) == 0 || string(argv) == "null" {
			argv = json.RawMessage("{}")
		}
		out, err := tool.run(b, argv)
		if err != nil {
			rpcReply(w, req.ID, toolError(err.Error()), nil)
			return
		}
		text, _ := json.Marshal(out)
		rpcReply(w, req.ID, map[string]interface{}{
			"content":           []map[string]string{{"type": "text", "text": string(text)}},
			"structuredContent": out,
		}, nil)
	default:
		rpcReply(w, req.ID, nil, &rpcError{-32601, "method not found: " + req.Method})
	}
}

func toolError(msg string) map[string]interface{} {
	return map[string]interface{}{"content": []map[string]string{{"type": "text", "text": msg}}, "isError": true}
}

/* ---------- money as text ---------- */

// currencyExp is the ISO 4217 minor-unit exponent: the number of digits after
// the decimal point that an amountMinor stands for.
func currencyExp(cur string) int {
	switch cur {
	case "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF":
		return 0
	case "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND":
		return 3
	case "CLF", "UYW":
		return 4
	}
	return 2
}

// formatMinor writes an amount as a plain decimal string ("-1234.50").
func formatMinor(m int64, cur string) string {
	e := currencyExp(cur)
	neg := m < 0
	if neg {
		m = -m
	}
	s := fmt.Sprintf("%0*d", e+1, m)
	if e > 0 {
		s = s[:len(s)-e] + "." + s[len(s)-e:]
	}
	if neg {
		s = "-" + s
	}
	return s
}

var decimalRe = regexp.MustCompile(`^-?[0-9]+(\.[0-9]+)?$`)

// parseAmount reads a decimal amount ("1234.5", "-20") into minor units exactly, with no floats.
func parseAmount(n json.Number, cur string) (int64, error) {
	s := strings.TrimSpace(string(n))
	r, ok := new(big.Rat).SetString(s)
	if !ok || !decimalRe.MatchString(s) {
		return 0, fmt.Errorf("amount must be a decimal number such as 1234.5")
	}
	r.Mul(r, new(big.Rat).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(currencyExp(cur))), nil)))
	if !r.IsInt() {
		return 0, fmt.Errorf("%s has %d decimal places at most", cur, currencyExp(cur))
	}
	if !r.Num().IsInt64() || r.Num().CmpAbs(big.NewInt(1e15)) > 0 {
		return 0, fmt.Errorf("amount is too large")
	}
	return r.Num().Int64(), nil
}

func money(m int64, cur string) map[string]interface{} {
	return map[string]interface{}{"amount": formatMinor(m, cur), "amountMinor": m, "currency": cur}
}

/* ---------- tools ---------- */

type mcpToolDef struct {
	name, desc, scope string
	schema            map[string]interface{}
	run               func(b *Book, args json.RawMessage) (map[string]interface{}, error)
}

func obj(props map[string]interface{}, required ...string) map[string]interface{} {
	m := map[string]interface{}{"type": "object", "properties": props, "additionalProperties": false}
	if len(required) > 0 {
		m["required"] = required
	}
	return m
}
func str(desc string) map[string]interface{} {
	return map[string]interface{}{"type": "string", "description": desc}
}
func enum(desc string, vals ...string) map[string]interface{} {
	return map[string]interface{}{"type": "string", "description": desc, "enum": vals}
}
func num(desc string) map[string]interface{} {
	return map[string]interface{}{"type": []string{"string", "number"}, "description": desc}
}
func strs(desc string) map[string]interface{} {
	return map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}, "description": desc}
}
func integer(desc string) map[string]interface{} {
	return map[string]interface{}{"type": "integer", "description": desc}
}

var mcpTools []mcpToolDef

func init() {
	mcpTools = []mcpToolDef{
		{"list_accounts", "List own accounts with their balances, what they hold for reserves (reserved) and the rest (free), limits, and the external accounts (shops, employers) transactions can go to.", ScopeRead,
			obj(map[string]interface{}{}), toolListAccounts},
		{"list_tags", "List categories, with budget progress for the current period where a category has a budget (spent is spending minus income with the same category, and can be negative).", ScopeRead,
			obj(map[string]interface{}{}), toolListTags},
		{"list_reserves", "List reserves (money set aside for a purpose) with the amount saved, the optional target, and how much each account holds.", ScopeRead,
			obj(map[string]interface{}{}), toolListReserves},
		{"list_allocations", "Find allocations (money put into or taken out of reserves), newest first.", ScopeRead, obj(map[string]interface{}{
			"reserveId": str("Only this reserve"),
			"accountId": str("Only this account"),
			"from":      str("Earliest date, YYYY-MM-DD"),
			"to":        str("Latest date, YYYY-MM-DD"),
			"limit":     integer("At most this many (default 50, up to 500)"),
		}), toolListAllocations},
		{"list_transactions", "Find transactions, newest first.", ScopeRead, obj(map[string]interface{}{
			"from":      str("Earliest date, YYYY-MM-DD"),
			"to":        str("Latest date, YYYY-MM-DD"),
			"accountId": str("Only transactions touching this account"),
			"tagId":     str("Only transactions with this category"),
			"kind":      enum("Only this kind", "spending", "income", "transfer"),
			"state":     enum("posted = happened; planned = expected, waiting to be confirmed; scheduled = posted but dated after today, so not in balances yet and its amount is held in the paying account until the date", "posted", "planned", "scheduled"),
			"search":    str("Text to find in the title or note"),
			"limit":     integer("At most this many (default 50, up to 500)"),
			"offset":    integer("Skip this many first, for paging"),
		}), toolListTransactions},
		{"spending_by_category", "Total posted spending per category and currency in one calendar month.", ScopeRead, obj(map[string]interface{}{
			"month": str("YYYY-MM; this month when left out"),
		}), toolSpending},
		{"list_templates", "List recurring transaction templates (salary, rent, subscriptions, automatic saving) and when each is next due.", ScopeRead,
			obj(map[string]interface{}{}), toolListTemplates},
		{"add_transaction", "Record a transaction. spending: accountId pays (toAccountId may name an external account, e.g. the shop). income: accountId receives (fromAccountId may name the external payer). transfer: fromAccountId to toAccountId, both own accounts in one currency. To set money aside use add_allocation.",
			ScopeTransactions, obj(map[string]interface{}{
				"kind":          enum("What happened", "spending", "income", "transfer"),
				"amount":        num("Positive decimal amount in the own account's currency, e.g. \"120.5\""),
				"accountId":     str("The own account (spending, income)"),
				"fromAccountId": str("Where the money comes from (transfer; optional external payer for income)"),
				"toAccountId":   str("Where the money goes (transfer; optional external payee for spending)"),
				"tagIds":        strs("Categories of spending, income or a transfer; a transaction can have several"),
				"date":          str("YYYY-MM-DD, local; today when left out. A date after today schedules it: it is held in the paying account and posts by itself on that date"),
				"time":          str("HH:MM, local, optional"),
				"tz":            str("IANA time zone of date and time, e.g. Asia/Taipei; needed with time"),
				"title":         str("Short title shown in lists, e.g. the shop or what was bought"),
				"note":          str("Longer free-text note"),
				"state":         enum("posted (default) or planned (expected, confirm later)", "posted", "planned"),
			}, "kind", "amount"), toolAddTransaction},
		{"update_transaction", "Change fields of a transaction; fields left out stay as they are.", ScopeTransactions, obj(map[string]interface{}{
			"id":     str("Transaction id"),
			"amount": num("New decimal amount in the transaction's currency"),
			"tagIds": strs("New categories (replace the current ones); empty list removes them"),
			"date":   str("YYYY-MM-DD"),
			"time":   str("HH:MM; empty string removes the time"),
			"tz":     str("IANA time zone"),
			"title":  str("Short title"),
			"note":   str("Longer note"),
			"state":  enum("posted confirms a planned transaction, or posts a scheduled one now (its date becomes today unless a date is given)", "posted", "planned"),
		}, "id"), toolUpdateTransaction},
		{"delete_transaction", "Delete a transaction for good.", ScopeTransactions, obj(map[string]interface{}{"id": str("Transaction id")}, "id"), toolDeleteTransaction},
		{"create_account", "Create an own account (cash, bank, card, loan…) or, with external, a named place outside the books such as an employer or shop.", ScopeAccounts, obj(map[string]interface{}{
			"name":           str("Account name"),
			"external":       map[string]interface{}{"type": "boolean", "description": "A place outside the books: no currency or balance"},
			"currency":       str("ISO 4217 code of an own account, e.g. TWD"),
			"openingBalance": num("Decimal balance the account starts with; negative for debt"),
			"limit":          num("Optional credit or loan limit, tracked against the amount owed"),
			"icon":           str("Optional icon name: wallet, bank, card, piggy, chart, loan, phone"),
			"note":           str("Optional free-text note for the user's own records, up to 4000 characters"),
		}, "name"), toolCreateAccount},
		{"create_tag", "Create a category, optionally with a budget.", ScopeTags, obj(map[string]interface{}{
			"name":        str("Name"),
			"currency":    str("ISO 4217 code of the budget"),
			"budget":      num("Budget per period, decimal"),
			"period":      enum("Budget period (monthly by default)", "daily", "weekly", "monthly", "yearly"),
			"periodEvery": integer("Budget period length in periods, e.g. 2 with weekly for every two weeks"),
			"note":        str("Optional free-text note for the user's own records, up to 4000 characters"),
			"group":       str("Optional group the category is listed under in the app's tag pickers, e.g. Food; empty for ungrouped"),
		}, "name"), toolCreateTag},
		{"merge_tags", "Merge categories the user chose into one: every transaction, template and dashboard widget with a merged category gets the kept one instead (once), and the merged ones are deleted. Only merge tags the user asked to merge; similar names may be kept apart on purpose. Use dryRun first to see what changes. The result has a mergeId that the web app can undo.", ScopeTags, obj(map[string]interface{}{
			"targetId":   str("The category to keep"),
			"sourceIds":  strs("The categories to merge into it; they are deleted"),
			"name":       str("Optional new name of the kept category"),
			"budgetFrom": str("Which budget the kept category gets when it has none and two or more merged categories have one: one of their ids, or \"none\""),
			"dryRun":     map[string]interface{}{"type": "boolean", "description": "Only report what would change"},
		}, "targetId", "sourceIds"), toolMergeTags},
		{"create_reserve", "Create a reserve: money set aside for a purpose, optionally with a target.", ScopeReserves, obj(map[string]interface{}{
			"name":       str("Name"),
			"currency":   str("ISO 4217 code the reserve counts in"),
			"target":     num("Optional target, decimal"),
			"targetDate": str("Optional target date, YYYY-MM-DD"),
		}, "name", "currency"), toolCreateReserve},
		{"add_allocation", "Put money of an own account into a reserve, or take it back out with a negative amount. No cash moves.", ScopeReserves, obj(map[string]interface{}{
			"reserveId": str("The reserve"),
			"accountId": str("The own account whose balance is set aside"),
			"amount":    num("Decimal amount in the account's currency; negative takes money out"),
			"date":      str("YYYY-MM-DD, local; today when left out"),
			"title":     str("Short title"),
			"note":      str("Longer note"),
		}, "reserveId", "accountId", "amount"), toolAddAllocation},
		{"delete_allocation", "Delete an allocation entered by mistake. To undo a decision, add a new allocation instead.", ScopeReserves, obj(map[string]interface{}{"id": str("Allocation id")}, "id"), toolDeleteAllocation},
		{"generate_due", "Create what recurring templates have due up to today: planned transactions, and allocations of automatic saving.", ScopeTemplates, obj(map[string]interface{}{}), toolGenerateDue},
	}
}

func mcpTool(name string) *mcpToolDef {
	for i := range mcpTools {
		if mcpTools[i].name == name {
			return &mcpTools[i]
		}
	}
	return nil
}

func args[T any](raw json.RawMessage) (T, error) {
	var v T
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&v); err != nil {
		return v, fmt.Errorf("invalid arguments: %v", err)
	}
	return v, nil
}

func toolListAccounts(b *Book, _ json.RawMessage) (map[string]interface{}, error) {
	today := b.today()
	own, ext := []map[string]interface{}{}, []map[string]interface{}{}
	for _, a := range b.data.Accounts {
		if a.IsExternal() {
			m := map[string]interface{}{"id": a.ID, "name": a.Name}
			if a.Memo != "" {
				m["note"] = a.Memo
			}
			ext = append(ext, m)
			continue
		}
		bal, reserved, held := b.data.Balance(a.ID, today), b.data.Reserved(a.ID), b.data.Held(a.ID, today)
		m := map[string]interface{}{"id": a.ID, "name": a.Name, "currency": a.Currency, "icon": a.Icon,
			"balance": money(bal, a.Currency), "reserved": money(reserved, a.Currency), "free": money(bal-reserved-held, a.Currency),
			// scheduled transactions (ADR 0014): held is taken from free until they post; incoming is not free yet
			"held": money(held, a.Currency), "incoming": money(b.data.Incoming(a.ID, today), a.Currency),
			"projected": money(b.data.Projected(a.ID), a.Currency)}
		if a.LimitMinor != nil {
			owed := max(-bal, 0)
			m["limit"], m["owed"] = money(*a.LimitMinor, a.Currency), money(owed, a.Currency)
		}
		if a.Memo != "" {
			m["note"] = a.Memo // the user's own note (issue #42)
		}
		own = append(own, m)
	}
	return map[string]interface{}{"today": today, "accounts": own, "externalAccounts": ext}, nil
}

func toolListTags(b *Book, _ json.RawMessage) (map[string]interface{}, error) {
	today := b.today()
	cats := []map[string]interface{}{}
	for _, t := range b.data.Tags {
		m := map[string]interface{}{"id": t.ID, "name": t.Name}
		if t.Memo != "" {
			m["note"] = t.Memo // the user's own note (issue #42)
		}
		if t.Group != "" {
			m["group"] = t.Group // ADR 0028
		}
		if t.LimitMinor != nil {
			start, end := BudgetPeriod(t, today)
			spent := b.data.BudgetSpent(t.ID, start, end, today)
			m["budget"] = map[string]interface{}{"limit": money(*t.LimitMinor, t.Currency), "spent": money(spent, t.Currency),
				"remaining": money(*t.LimitMinor-spent, t.Currency), "period": t.Cycle, "periodEvery": max(t.CycleEvery, 1),
				"periodStart": start, "periodEnd": end}
		}
		cats = append(cats, m)
	}
	return map[string]interface{}{"today": today, "categories": cats}, nil
}

func toolListReserves(b *Book, _ json.RawMessage) (map[string]interface{}, error) {
	out := []map[string]interface{}{}
	for _, r := range b.data.Reserves {
		m := map[string]interface{}{"id": r.ID, "name": r.Name, "saved": money(b.data.ReserveSaved(r.ID), r.Currency)}
		if r.TargetMinor != nil {
			m["target"] = money(*r.TargetMinor, r.Currency)
		}
		if r.TargetDate != "" {
			m["targetDate"] = r.TargetDate
		}
		held := []map[string]interface{}{}
		for _, s := range b.data.ReserveSplit(r.ID) {
			h := money(s.AmountMinor, s.Currency)
			h["accountId"] = s.AccountID
			if a := b.data.accountByID(s.AccountID); a != nil {
				h["account"] = a.Name
			}
			held = append(held, h)
		}
		m["accounts"] = held
		out = append(out, m)
	}
	return map[string]interface{}{"today": b.today(), "reserves": out}, nil
}

func (d *Data) allocationView(a Allocation) map[string]interface{} {
	m := map[string]interface{}{"id": a.ID, "reserveId": a.ReserveID, "accountId": a.AccountID, "date": a.Date, "title": a.Note}
	for k, v := range money(a.AmountMinor, a.Currency) {
		m[k] = v
	}
	if r := d.reserveByID(a.ReserveID); r != nil {
		m["reserve"] = r.Name
	}
	if acc := d.accountByID(a.AccountID); acc != nil {
		m["account"] = acc.Name
	}
	if a.Memo != "" {
		m["note"] = a.Memo
	}
	if a.TransactionTemplateID != "" {
		m["templateId"] = a.TransactionTemplateID
	}
	return m
}

func toolListAllocations(b *Book, raw json.RawMessage) (map[string]interface{}, error) {
	q, err := args[struct {
		ReserveID, AccountID, From, To string
		Limit                          int
	}](raw)
	if err != nil {
		return nil, err
	}
	if q.Limit <= 0 {
		q.Limit = 50
	}
	q.Limit = min(q.Limit, 500)
	hits := []Allocation{}
	for _, a := range b.data.Allocations {
		if (q.ReserveID != "" && a.ReserveID != q.ReserveID) || (q.AccountID != "" && a.AccountID != q.AccountID) ||
			(q.From != "" && a.Date < q.From) || (q.To != "" && a.Date > q.To) {
			continue
		}
		hits = append(hits, a)
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].Date != hits[j].Date {
			return hits[i].Date > hits[j].Date
		}
		return hits[i].CreatedAt > hits[j].CreatedAt
	})
	out := []map[string]interface{}{}
	for _, a := range hits[:min(q.Limit, len(hits))] {
		out = append(out, b.data.allocationView(a))
	}
	return map[string]interface{}{"total": len(hits), "allocations": out}, nil
}

func toolCreateReserve(b *Book, raw json.RawMessage) (map[string]interface{}, error) {
	in, err := args[struct {
		Name, Currency, TargetDate string
		Target                     json.Number
	}](raw)
	if err != nil {
		return nil, err
	}
	r := Reserve{ID: newID("rsv"), Name: in.Name, Currency: normCurrency(in.Currency), TargetDate: in.TargetDate}
	if in.Target != "" {
		v, err := parseAmount(in.Target, r.Currency)
		if err != nil {
			return nil, err
		}
		r.TargetMinor = &v
	}
	if err := normalizeReserve(&r); err != nil {
		return nil, err
	}
	if err := b.insertReserve(r); err != nil {
		return nil, err
	}
	if err := b.reload(); err != nil {
		return nil, err
	}
	return map[string]interface{}{"reserve": map[string]interface{}{"id": r.ID, "name": r.Name, "currency": r.Currency}}, nil
}

func toolAddAllocation(b *Book, raw json.RawMessage) (map[string]interface{}, error) {
	in, err := args[struct {
		ReserveID, AccountID, Date, Title, Note string
		Amount                                  json.Number
	}](raw)
	if err != nil {
		return nil, err
	}
	acc := b.data.accountByID(in.AccountID)
	if acc == nil || acc.IsExternal() {
		return nil, fmt.Errorf("unknown own account %q: call list_accounts for ids", in.AccountID)
	}
	if b.data.reserveByID(in.ReserveID) == nil {
		return nil, fmt.Errorf("unknown reserve %q: call list_reserves for ids", in.ReserveID)
	}
	a := Allocation{ReserveID: in.ReserveID, AccountID: in.AccountID, Date: in.Date, Note: in.Title, Memo: in.Note}
	if a.AmountMinor, err = parseAmount(in.Amount, acc.Currency); err != nil {
		return nil, err
	}
	saved, err := b.addAllocation(a)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"allocation": b.data.allocationView(saved)}, nil
}

func toolDeleteAllocation(b *Book, raw json.RawMessage) (map[string]interface{}, error) {
	in, err := args[struct{ ID string }](raw)
	if err != nil {
		return nil, err
	}
	if old := b.data.allocationByID(in.ID); old != nil {
		if err := b.data.leavesPairHeld(old); err != nil {
			return nil, err
		}
	}
	found, err := b.deleteAllocation(in.ID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("allocation %q not found", in.ID)
	}
	return map[string]interface{}{"deleted": in.ID}, nil
}

// txnKind is the label a person thinks in: spending, income or transfer.
func (d *Data) txnKind(t Transaction) string {
	switch {
	case d.IsSpending(t):
		return "spending"
	case d.IsIncome(t):
		return "income"
	}
	return "transfer"
}

func (d *Data) txnView(t Transaction, tagsOf map[string][]string, today string) map[string]interface{} {
	name := func(id string) string {
		if a := d.accountByID(id); a != nil {
			return a.Name
		}
		return ""
	}
	tagName := func(id string) string {
		if t := d.tagByID(id); t != nil {
			return t.Name
		}
		return ""
	}
	m := map[string]interface{}{"id": t.ID, "kind": d.txnKind(t), "date": t.Date, "state": ServedState(t, today), "title": t.Note}
	for k, v := range money(t.AmountMinor, t.Currency) {
		m[k] = v
	}
	if t.Time != "" {
		m["time"], m["tz"] = t.Time, t.TZ
	}
	if t.Memo != "" {
		m["note"] = t.Memo
	}
	m["fromAccountId"], m["fromAccount"] = t.FromAccountID, name(t.FromAccountID)
	m["toAccountId"], m["toAccount"] = t.ToAccountID, name(t.ToAccountID)
	tags := []string{}
	for _, id := range tagsOf[t.ID] {
		tags = append(tags, tagName(id))
	}
	if len(tags) > 0 {
		m["categoryIds"], m["categories"] = tagsOf[t.ID], tags
	}
	if t.TransactionTemplateID != "" {
		m["templateId"] = t.TransactionTemplateID
	}
	return m
}

func (d *Data) tagsByTransaction() map[string][]string {
	out := map[string][]string{}
	for _, tt := range d.TransactionTags {
		if d.tagByID(tt.TagID) != nil {
			out[tt.TransactionID] = append(out[tt.TransactionID], tt.TagID)
		}
	}
	return out
}

func toolListTransactions(b *Book, raw json.RawMessage) (map[string]interface{}, error) {
	q, err := args[struct {
		From, To, AccountID, TagID, Kind, State, Search string
		Limit, Offset                                   int
	}](raw)
	if err != nil {
		return nil, err
	}
	if q.Limit <= 0 {
		q.Limit = 50
	}
	q.Limit = min(q.Limit, 500)
	d, today := b.data, b.today()
	tagsOf := d.tagsByTransaction()
	search := strings.ToLower(strings.TrimSpace(q.Search))
	hits := []Transaction{}
	for _, t := range d.Transactions {
		if (q.From != "" && t.Date < q.From) || (q.To != "" && t.Date > q.To) || (q.State != "" && ServedState(t, today) != q.State) ||
			(q.Kind != "" && d.txnKind(t) != q.Kind) {
			continue
		}
		if q.AccountID != "" && t.FromAccountID != q.AccountID && t.ToAccountID != q.AccountID {
			continue
		}
		if q.TagID != "" {
			linked := false
			for _, id := range tagsOf[t.ID] {
				linked = linked || id == q.TagID
			}
			if !linked {
				continue
			}
		}
		if search != "" && !strings.Contains(strings.ToLower(t.Note+"\n"+t.Memo), search) {
			continue
		}
		hits = append(hits, t)
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].Date != hits[j].Date {
			return hits[i].Date > hits[j].Date
		}
		return hits[i].Time > hits[j].Time
	})
	total := len(hits)
	start := min(max(q.Offset, 0), total)
	end := min(start+q.Limit, total)
	out := []map[string]interface{}{}
	for _, t := range hits[start:end] {
		out = append(out, d.txnView(t, tagsOf, today))
	}
	return map[string]interface{}{"total": total, "offset": start, "transactions": out}, nil
}

func toolSpending(b *Book, raw json.RawMessage) (map[string]interface{}, error) {
	q, err := args[struct{ Month string }](raw)
	if err != nil {
		return nil, err
	}
	today := b.today()
	ref := today
	if q.Month != "" {
		if !validDate(q.Month + "-01") {
			return nil, fmt.Errorf("month must be YYYY-MM")
		}
		ref = q.Month + "-01"
	}
	rows := []map[string]interface{}{}
	for _, s := range b.data.SpendingByCategory(ref, today, b.currencyOrder()) {
		m := money(s.AmountMinor, s.Currency)
		m["categoryId"] = s.TagID
		if t := b.data.tagByID(s.TagID); t != nil {
			m["category"] = t.Name
		} else {
			m["category"] = "(no category)"
		}
		rows = append(rows, m)
	}
	return map[string]interface{}{"month": ref[:7], "spending": rows}, nil
}

func toolListTemplates(b *Book, _ json.RawMessage) (map[string]interface{}, error) {
	today := b.today()
	out := []map[string]interface{}{}
	for _, tp := range b.data.TransactionTemplates {
		next := ""
		for _, occ := range Occurrences(tp, today, "2099-12-31") {
			next = occ
			break
		}
		cur := tp.Template.Currency
		m := map[string]interface{}{"id": tp.ID, "name": tp.Name, "enabled": tp.Enabled, "nextDue": next,
			"amount": money(tp.Template.AmountMinor, cur), "frequency": tp.Schedule.Frequency, "every": max(tp.Schedule.Interval, 1)}
		out = append(out, m)
	}
	return map[string]interface{}{"today": today, "templates": out}, nil
}

func toolAddTransaction(b *Book, raw json.RawMessage) (map[string]interface{}, error) {
	in, err := args[struct {
		Kind                                  string
		Amount                                json.Number
		AccountID, FromAccountID, ToAccountID string
		Date, Time, TZ                        string
		TagIDs                                []string
		Title, Note, State                    string
	}](raw)
	if err != nil {
		return nil, err
	}
	types := map[string]string{"spending": "expense", "income": "income", "transfer": "transfer"}
	t := Transaction{Type: types[in.Kind], AccountID: in.AccountID, FromAccountID: in.FromAccountID, ToAccountID: in.ToAccountID,
		TagIDs: in.TagIDs, Date: in.Date, Time: in.Time, TZ: in.TZ, Note: in.Title, Memo: in.Note, State: in.State}
	if t.Type == "" {
		return nil, fmt.Errorf("kind must be spending, income or transfer (use add_allocation to set money aside)")
	}
	// the amount is in the own account's currency
	ownID := in.AccountID
	if t.Type == "transfer" {
		ownID = in.FromAccountID
	}
	a := b.data.accountByID(ownID)
	if a == nil || a.IsExternal() {
		return nil, fmt.Errorf("unknown own account %q: call list_accounts for ids", ownID)
	}
	if t.AmountMinor, err = parseAmount(in.Amount, a.Currency); err != nil {
		return nil, err
	}
	if t.AmountMinor <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}
	for _, id := range t.TagIDs {
		if b.data.tagByID(id) == nil {
			return nil, fmt.Errorf("unknown tag %q: call list_tags for ids", id)
		}
	}
	today := b.today() // once per call, so a call across midnight sees one date
	if t.Date == "" {
		t.Date = today
	}
	saved, err := b.addTransaction(t)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"transaction": b.data.txnView(*b.data.transactionByID(saved.ID), b.data.tagsByTransaction(), today)}, nil
}

func toolUpdateTransaction(b *Book, raw json.RawMessage) (map[string]interface{}, error) {
	in, err := args[struct {
		ID                                 string
		Amount                             *json.Number
		Date, Time, TZ, Title, Note, State *string
		TagIDs                             *[]string
	}](raw)
	if err != nil {
		return nil, err
	}
	old := b.data.transactionByID(in.ID)
	if old == nil {
		return nil, fmt.Errorf("transaction %q not found", in.ID)
	}
	t, today := *old, b.today() // once per call, so a call across midnight sees one date
	if in.Amount != nil {
		if t.AmountMinor, err = parseAmount(*in.Amount, t.Currency); err != nil {
			return nil, err
		}
	}
	set := func(dst *string, v *string) {
		if v != nil {
			*dst = *v
		}
	}
	if in.TagIDs != nil {
		t.TagIDs = *in.TagIDs
	}
	if in.State != nil && *in.State == "posted" && in.Date == nil && t.Date > today {
		t.Date = today // posting a future-dated transaction posts it now, as the HTTP post endpoint does (ADR 0014)
	}
	set(&t.Date, in.Date)
	set(&t.Time, in.Time)
	set(&t.TZ, in.TZ)
	set(&t.Note, in.Title)
	set(&t.Memo, in.Note)
	set(&t.State, in.State)
	if in.Time != nil && *in.Time == "" {
		t.TZ = ""
	}
	if err := b.data.normalizeTransaction(&t); err != nil {
		return nil, err
	}
	if err := b.updateTransaction(t); err != nil {
		return nil, err
	}
	return map[string]interface{}{"transaction": b.data.txnView(*b.data.transactionByID(t.ID), b.data.tagsByTransaction(), today)}, nil
}

func toolDeleteTransaction(b *Book, raw json.RawMessage) (map[string]interface{}, error) {
	in, err := args[struct{ ID string }](raw)
	if err != nil {
		return nil, err
	}
	found, err := b.deleteTransaction(in.ID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("transaction %q not found", in.ID)
	}
	return map[string]interface{}{"deleted": in.ID}, nil
}

func toolCreateAccount(b *Book, raw json.RawMessage) (map[string]interface{}, error) {
	in, err := args[struct {
		Name, Currency, Icon, Note string
		External                   bool
		OpeningBalance             json.Number
		Limit                      json.Number
	}](raw)
	if err != nil {
		return nil, err
	}
	a := Account{ID: newID("acc"), Name: in.Name, Kind: "own", Currency: normCurrency(in.Currency), Icon: in.Icon, Memo: in.Note}
	if in.External {
		a.Kind = "external"
	} else {
		if !currencyRe.MatchString(a.Currency) {
			return nil, fmt.Errorf("currency must be a 3-letter ISO 4217 code")
		}
		if in.OpeningBalance != "" {
			if a.OpeningBalanceMinor, err = parseAmount(in.OpeningBalance, a.Currency); err != nil {
				return nil, err
			}
		}
		if in.Limit != "" {
			l, err := parseAmount(in.Limit, a.Currency)
			if err != nil {
				return nil, err
			}
			a.LimitMinor = &l
		}
	}
	if err := validateAccount(&a); err != nil {
		return nil, err
	}
	if err := b.insertAccount(a); err != nil {
		return nil, err
	}
	if err := b.reload(); err != nil {
		return nil, err
	}
	return map[string]interface{}{"account": map[string]interface{}{"id": a.ID, "name": a.Name, "kind": a.Kind, "currency": a.Currency}}, nil
}

func toolCreateTag(b *Book, raw json.RawMessage) (map[string]interface{}, error) {
	in, err := args[struct {
		Name, Currency, Period, Note, Group string
		Budget                              json.Number
		PeriodEvery                         int
	}](raw)
	if err != nil {
		return nil, err
	}
	t := Tag{ID: newID("tag"), Name: strings.TrimSpace(in.Name), Currency: normCurrency(in.Currency),
		Cycle: in.Period, CycleEvery: in.PeriodEvery, Memo: in.Note, Group: in.Group}
	if t.Name == "" {
		return nil, fmt.Errorf("name required")
	}
	if in.Budget != "" {
		v, err := parseAmount(in.Budget, t.Currency)
		if err != nil {
			return nil, err
		}
		t.LimitMinor = &v
	}
	if err := normalizeTag(&t); err != nil {
		return nil, err
	}
	if err := b.insertTag(t); err != nil {
		return nil, err
	}
	if err := b.reload(); err != nil {
		return nil, err
	}
	return map[string]interface{}{"tag": map[string]interface{}{"id": t.ID, "name": t.Name}}, nil
}

func toolMergeTags(b *Book, raw json.RawMessage) (map[string]interface{}, error) {
	in, err := args[struct {
		TargetID   string   `json:"targetId"`
		SourceIDs  []string `json:"sourceIds"`
		Name       *string  `json:"name"`
		BudgetFrom string   `json:"budgetFrom"`
		DryRun     bool     `json:"dryRun"`
	}](raw)
	if err != nil {
		return nil, err
	}
	p, err := b.mergeTags(in.TargetID, MergeRequest{SourceIDs: in.SourceIDs, Name: in.Name, BudgetFrom: in.BudgetFrom, DryRun: in.DryRun})
	if err != nil {
		return nil, err
	}
	js, err := json.Marshal(p)
	if err != nil {
		return nil, err
	}
	var out map[string]interface{}
	if err := json.Unmarshal(js, &out); err != nil {
		return nil, err
	}
	out["dryRun"] = in.DryRun
	return out, nil
}

func toolGenerateDue(b *Book, _ json.RawMessage) (map[string]interface{}, error) {
	n, err := b.GenerateDue(b.today())
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"created": n}, nil
}

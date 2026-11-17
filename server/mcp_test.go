// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"encoding/json"
	"strings"
	"testing"
)

type rpcResult struct {
	Result struct {
		ProtocolVersion string                   `json:"protocolVersion"`
		Tools           []map[string]interface{} `json:"tools"`
		IsError         bool                     `json:"isError"`
		Content         []struct{ Text string }  `json:"content"`
		Structured      map[string]interface{}   `json:"structuredContent"`
	}
	Error *rpcError
}

func TestMCP(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	addTestUser(t, s, "bob", false)
	alice, bob := newClient(t, srv), newClient(t, srv)
	signedIn(t, alice, "alice")
	signedIn(t, bob, "bob")
	reader := createKey(t, alice, "Reader", ScopeRead)
	writer := createKey(t, alice, "Agent", ScopeRead, ScopeTransactions)
	saver := createKey(t, alice, "Saver", ScopeRead, ScopeReserves)
	bobKey := createKey(t, bob, "Bob", ScopeRead)
	anon := newClient(t, srv)
	id := 0
	call := func(k newKey, method string, params interface{}) (int, rpcResult) {
		t.Helper()
		id++
		var out rpcResult
		code := anon.do("POST", "/mcp", map[string]interface{}{"jsonrpc": "2.0", "id": id, "method": method, "params": params}, &out,
			"Authorization", "Bearer "+k.Key, "Accept", "application/json, text/event-stream")
		return code, out
	}
	tool := func(k newKey, name string, args map[string]interface{}) rpcResult {
		t.Helper()
		code, out := call(k, "tools/call", map[string]interface{}{"name": name, "arguments": args})
		if code != 200 || out.Error != nil {
			t.Fatalf("%s: %d %+v", name, code, out.Error)
		}
		return out
	}

	// handshake
	if code, out := call(reader, "initialize", map[string]interface{}{"protocolVersion": "2025-06-18", "capabilities": map[string]interface{}{},
		"clientInfo": map[string]string{"name": "test", "version": "1"}}); code != 200 || out.Result.ProtocolVersion != "2025-06-18" {
		t.Fatalf("initialize: %d %+v", code, out)
	}
	if code := anon.do("POST", "/mcp", map[string]string{"jsonrpc": "2.0", "method": "notifications/initialized"}, nil,
		"Authorization", "Bearer "+reader.Key); code != 202 {
		t.Fatalf("notification: %d", code)
	}
	// no key, a session cookie, a revoked-looking key: refused
	if code := anon.do("POST", "/mcp", map[string]interface{}{"jsonrpc": "2.0", "id": 1, "method": "ping"}, nil); code != 401 {
		t.Fatalf("no key: %d", code)
	}
	if code := alice.do("POST", "/mcp", map[string]interface{}{"jsonrpc": "2.0", "id": 1, "method": "ping"}, nil); code != 401 {
		t.Fatalf("session cookie on /mcp: %d", code)
	}
	if code := anon.do("POST", "/mcp", map[string]interface{}{"jsonrpc": "2.0", "id": 1, "method": "ping"}, nil, "Authorization", "Bearer kst_nope"); code != 401 {
		t.Fatalf("made-up key: %d", code)
	}
	if code := anon.do("POST", "/mcp", map[string]interface{}{"jsonrpc": "2.0", "id": 1, "method": "ping"}, nil,
		"Authorization", "Bearer "+reader.Key, "Origin", "https://evil.example"); code != 403 {
		t.Fatalf("cross-site: %d", code)
	}
	if code := anon.do("GET", "/mcp", nil, nil, "Authorization", "Bearer "+reader.Key); code != 405 {
		t.Fatalf("GET: %d", code)
	}
	if _, out := call(reader, "resources/list", nil); out.Error == nil || out.Error.Code != -32601 {
		t.Fatalf("unknown method: %+v", out)
	}

	// tools follow the key's scopes
	names := func(k newKey) string {
		_, out := call(k, "tools/list", nil)
		n := []string{}
		for _, tl := range out.Result.Tools {
			n = append(n, tl["name"].(string))
		}
		return strings.Join(n, ",")
	}
	if n := names(reader); strings.Contains(n, "add_transaction") || !strings.Contains(n, "list_transactions") {
		t.Fatalf("reader tools: %s", n)
	}
	if n := names(writer); !strings.Contains(n, "add_transaction") || strings.Contains(n, "create_account") {
		t.Fatalf("writer tools: %s", n)
	}
	if out := tool(reader, "add_transaction", map[string]interface{}{"kind": "spending", "amount": "10", "accountId": "acc-b"}); !out.Result.IsError {
		t.Fatalf("reader wrote")
	}

	// reading
	accts := tool(reader, "list_accounts", nil).Result.Structured
	var bankB map[string]interface{}
	for _, a := range accts["accounts"].([]interface{}) {
		if a.(map[string]interface{})["id"] == "acc-b" {
			bankB = a.(map[string]interface{})
		}
	}
	if bankB == nil || !strings.HasSuffix(bankB["balance"].(map[string]interface{})["amount"].(string), ".00") {
		t.Fatalf("accounts: %+v", accts)
	}
	tags := tool(reader, "list_tags", nil).Result.Structured
	if len(tags["categories"].([]interface{})) == 0 || tags["moneyBoxes"] != nil {
		t.Fatalf("tags: %+v", tags)
	}
	res := tool(reader, "list_reserves", nil).Result.Structured["reserves"].([]interface{})
	if len(res) != 2 || res[0].(map[string]interface{})["saved"].(map[string]interface{})["amountMinor"].(float64) <= 0 {
		t.Fatalf("reserves: %+v", res)
	}
	list := tool(reader, "list_transactions", map[string]interface{}{"kind": "spending", "limit": 5}).Result
	if n := len(list.Structured["transactions"].([]interface{})); n != 5 || list.Content[0].Text == "" {
		t.Fatalf("list: %d", n)
	}
	if out := tool(reader, "list_transactions", map[string]interface{}{"bogus": 1}); !out.Result.IsError {
		t.Fatalf("unknown argument accepted")
	}

	// writing: a spending of NT$120.5 lands in minor units, exactly
	added := tool(writer, "add_transaction", map[string]interface{}{"kind": "spending", "amount": "120.5", "accountId": "acc-b",
		"tagIds": []string{"tag-food"}, "title": "Lunch", "date": "2026-11-15"}).Result.Structured["transaction"].(map[string]interface{})
	if added["amountMinor"].(float64) != 12050 || added["kind"] != "spending" || added["categories"].([]interface{})[0] != "Food" {
		t.Fatalf("added: %+v", added)
	}
	txID := added["id"].(string)
	if out := tool(writer, "add_transaction", map[string]interface{}{"kind": "spending", "amount": 1.234, "accountId": "acc-b"}); !out.Result.IsError {
		t.Fatalf("three decimals in TWD accepted")
	}
	if out := tool(writer, "add_transaction", map[string]interface{}{"kind": "spending", "amount": "1e3", "accountId": "acc-b"}); !out.Result.IsError {
		t.Fatalf("exponent accepted")
	}
	jpy := tool(writer, "add_transaction", map[string]interface{}{"kind": "spending", "amount": 980, "accountId": "acc-jpy"}).Result.Structured["transaction"].(map[string]interface{})
	if jpy["amountMinor"].(float64) != 980 || jpy["amount"] != "980" {
		t.Fatalf("JPY: %+v", jpy)
	}
	upd := tool(writer, "update_transaction", map[string]interface{}{"id": txID, "amount": "99", "note": "with a friend"}).Result.Structured["transaction"].(map[string]interface{})
	if upd["amountMinor"].(float64) != 9900 || upd["title"] != "Lunch" || upd["note"] != "with a friend" {
		t.Fatalf("updated: %+v", upd)
	}
	if out := tool(writer, "delete_transaction", map[string]interface{}{"id": txID}); out.Result.IsError {
		t.Fatalf("delete: %+v", out)
	}
	if out := tool(writer, "delete_transaction", map[string]interface{}{"id": txID}); !out.Result.IsError {
		t.Fatalf("deleted twice")
	}

	// reserves take allocations, with their own scope
	if out := tool(writer, "add_allocation", map[string]interface{}{"reserveId": "rsv-house", "accountId": "acc-b", "amount": "10"}); !out.Result.IsError {
		t.Fatalf("a key without reserves:write allocated")
	}
	if out := tool(writer, "add_transaction", map[string]interface{}{"kind": "allocate", "amount": "10", "accountId": "acc-b"}); !out.Result.IsError {
		t.Fatalf("allocate as a transaction accepted")
	}
	alc := tool(saver, "add_allocation", map[string]interface{}{"reserveId": "rsv-house", "accountId": "acc-b", "amount": "-12.5", "title": "Back out"}).Result
	if alc.IsError {
		t.Fatalf("allocation: %+v", alc.Content)
	}
	a := alc.Structured["allocation"].(map[string]interface{})
	if a["amountMinor"].(float64) != -1250 || a["reserve"] != "House fund" {
		t.Fatalf("allocation: %+v", a)
	}
	if n := tool(saver, "list_allocations", map[string]interface{}{"reserveId": "rsv-house", "accountId": "acc-b"}).Result.Structured["total"].(float64); n != 2 {
		t.Fatalf("allocations in Bank B: %v", n)
	}
	if out := tool(saver, "delete_allocation", map[string]interface{}{"id": a["id"]}); out.Result.IsError {
		t.Fatalf("delete allocation: %+v", out.Result.Content)
	}
	if out := tool(saver, "create_reserve", map[string]interface{}{"name": "Trip", "currency": "JPY", "target": "50000"}); out.Result.IsError {
		t.Fatalf("create reserve: %+v", out.Result.Content)
	}

	// a key sees its own user's books only
	bobList := tool(bobKey, "list_transactions", nil).Result.Structured
	if bobList["total"].(float64) != 0 {
		t.Fatalf("bob saw alice's books: %+v", bobList)
	}
	if out := tool(bobKey, "list_transactions", map[string]interface{}{"accountId": "acc-b"}).Result.Structured; out["total"].(float64) != 0 {
		t.Fatalf("bob read acc-b")
	}
	if _, out := call(reader, "tools/call", map[string]interface{}{"name": "drop_tables"}); out.Error == nil {
		t.Fatalf("unknown tool")
	}
}

func TestParseAmount(t *testing.T) {
	cases := []struct {
		in, cur string
		want    int64
		ok      bool
	}{
		{"120.5", "TWD", 12050, true}, {"-20", "USD", -2000, true}, {"980", "JPY", 980, true}, {"1.5", "JPY", 0, false},
		{"1.234", "KWD", 1234, true}, {"0.001", "USD", 0, false}, {"1e3", "USD", 0, false}, {"1/2", "USD", 0, false}, {"", "USD", 0, false},
		{"9999999999999999", "USD", 0, false},
	}
	for _, c := range cases {
		got, err := parseAmount(json.Number(c.in), c.cur)
		if (err == nil) != c.ok || got != c.want {
			t.Errorf("parseAmount(%q, %s) = %d, %v", c.in, c.cur, got, err)
		}
	}
	for _, c := range []struct {
		m    int64
		cur  string
		want string
	}{{12050, "TWD", "120.50"}, {-5, "USD", "-0.05"}, {980, "JPY", "980"}, {1234, "KWD", "1.234"}, {0, "USD", "0.00"}} {
		if got := formatMinor(c.m, c.cur); got != c.want {
			t.Errorf("formatMinor(%d, %s) = %s", c.m, c.cur, got)
		}
	}
}

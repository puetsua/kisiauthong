// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"sort"
	"strings"
	"time"
)

// Merging tags (issue #13, ADR 0017): the user picks tags and one of them to keep (the
// target); every other one (a source) is folded into it and deleted. Everything that
// held a source id is repointed to the target in one database transaction, and what
// the merge changed is written to the tag_merges log so it can be undone.
//
// The app never proposes what to merge (ADR 0015): this code only merges what it is
// given and has no notion of similar tags.

// tagMergeTable is the merge log (migration 15). before/after hold a mergeLog as JSON.
const tagMergeTable = `
CREATE TABLE IF NOT EXISTS tag_merges%[1]s (
  user_id TEXT NOT NULL, id TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL,
  undone_at TEXT NOT NULL DEFAULT '', log_json TEXT NOT NULL, PRIMARY KEY(user_id, id));
`

// Migration 15: the tag merge log.
func migrateTagMerges(tx *sql.Tx) error {
	_, err := tx.Exec(fmt.Sprintf(tagMergeTable, ""))
	return err
}

// BudgetNone in budgetFrom drops every source budget when the target has none.
const BudgetNone = "none"

// MergeRequest is the body of POST /api/tags/{target}/merge.
type MergeRequest struct {
	SourceIDs  []string `json:"sourceIds"`
	Name       *string  `json:"name,omitempty"`       // rename the target; nil keeps its name
	BudgetFrom string   `json:"budgetFrom,omitempty"` // a source id or "none"; needed only when 2+ sources have budgets and the target has none
	DryRun     bool     `json:"dryRun,omitempty"`
}

// linkChange is one transaction's categories, in order, before and after the merge.
type linkChange struct {
	TransactionID string   `json:"transactionId"`
	Before        []string `json:"before"`
	After         []string `json:"after"`
}

// textChange is a stored template_json before and after the merge.
type textChange struct {
	ID     string `json:"id"`
	Before string `json:"before"`
	After  string `json:"after"`
}

// includeChange is a dashboard widget's include list before and after the merge.
type includeChange struct {
	ID     string   `json:"id"`
	Before []string `json:"before"`
	After  []string `json:"after"`
}

// mergeLog is everything a merge changed: enough to put every row back.
type mergeLog struct {
	Target       Tag             `json:"target"`      // as it was
	TargetAfter  Tag             `json:"targetAfter"` // as the merge left it
	Sources      []Tag           `json:"sources"`     // the deleted tags, whole
	Links        []linkChange    `json:"links"`
	TargetTxns   []string        `json:"targetTransactions"` // sorted ids linked to the target after the merge
	Templates    []textChange    `json:"templates"`
	Widgets      []includeChange `json:"widgets"`
	DroppedKeys  []string        `json:"droppedKeys"` // dismissed notification keys of the sources
	dashboard    *DashboardSettings
	dashboardRaw string
	dismissed    []string
}

// BudgetOutcome says which budget the merged tag ends with.
type BudgetOutcome struct {
	// "target": the target keeps its own; "source": From's budget moves to the target;
	// "none": no budget; "choose": 2+ sources have budgets and budgetFrom must pick one or "none".
	Outcome    string   `json:"outcome"`
	From       string   `json:"from,omitempty"`
	Candidates []string `json:"candidates,omitempty"` // the sources with budgets, when Outcome is "choose"
}

// MergePreview is what a merge does (dryRun) or did.
type MergePreview struct {
	MergeID              string        `json:"mergeId,omitempty"`
	Tag                  Tag           `json:"tag"` // the merged tag
	SourceIDs            []string      `json:"sourceIds"`
	Transactions         int           `json:"transactions"`         // with the merged tag afterwards
	AffectedTransactions int           `json:"affectedTransactions"` // that had a source
	DuplicateLinks       int           `json:"duplicateLinks"`       // that had two or more of the merged tags
	Templates            []string      `json:"templates"`            // ids of templates repointed
	Widgets              []string      `json:"widgets"`              // ids of dashboard widgets repointed
	DroppedKeys          int           `json:"droppedNotificationKeys"`
	Budget               BudgetOutcome `json:"budget"`
	Conflicts            []string      `json:"conflicts"` // "budget-choice" until budgetFrom picks one
}

// mergeError is a refusal with an HTTP status (4xx).
type mergeError struct {
	code int
	msg  string
}

func (e *mergeError) Error() string { return e.msg }

func badMerge(code int, format string, a ...interface{}) error {
	return &mergeError{code, fmt.Sprintf(format, a...)}
}

func hasBudget(t Tag) bool { return t.LimitMinor != nil }

func sameTag(a, b Tag) bool {
	return a.ID == b.ID && a.Name == b.Name && (a.LimitMinor == nil) == (b.LimitMinor == nil) &&
		(a.LimitMinor == nil || *a.LimitMinor == *b.LimitMinor) && a.Cycle == b.Cycle && a.CycleEvery == b.CycleEvery &&
		a.CycleStart == b.CycleStart && a.CycleEnd == b.CycleEnd && a.Currency == b.Currency
}

// repoint replaces the sources in ids by the target, keeping the order and the first
// of any repeats; changed is false when no source was in ids.
func repoint(ids []string, target string, sources map[string]bool) (out []string, changed bool) {
	seen := map[string]bool{}
	for _, id := range ids {
		if sources[id] {
			id, changed = target, true
		}
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out, changed
}

// planMerge validates a request and works out every change, touching nothing.
func (b *Book) planMerge(targetID string, req MergeRequest) (*mergeLog, *MergePreview, error) {
	d := b.data
	target := d.tagByID(targetID)
	if target == nil {
		return nil, nil, badMerge(404, "tag not found")
	}
	if len(req.SourceIDs) == 0 {
		return nil, nil, badMerge(400, "sourceIds: pick at least one tag to merge into this one")
	}
	sources := map[string]bool{}
	var srcTags []Tag
	for _, id := range req.SourceIDs {
		switch {
		case id == targetID:
			return nil, nil, badMerge(400, "sourceIds: the tag kept cannot also be merged away")
		case sources[id]:
			return nil, nil, badMerge(400, "sourceIds: %s is listed twice", id)
		}
		t := d.tagByID(id)
		if t == nil {
			return nil, nil, badMerge(404, "sourceIds: tag %s not found", id)
		}
		sources[id] = true
		srcTags = append(srcTags, *t)
	}
	after := *target
	if req.Name != nil {
		after.Name = strings.TrimSpace(*req.Name)
		if after.Name == "" {
			return nil, nil, badMerge(400, "name required")
		}
	}

	// budgets: the target's wins; else a lone source budget moves; else the caller picks
	p := &MergePreview{SourceIDs: req.SourceIDs, Templates: []string{}, Widgets: []string{}, Conflicts: []string{}}
	var withBudget []string
	for _, s := range srcTags {
		if hasBudget(s) {
			withBudget = append(withBudget, s.ID)
		}
	}
	if req.BudgetFrom != "" && req.BudgetFrom != BudgetNone && !sources[req.BudgetFrom] {
		return nil, nil, badMerge(400, "budgetFrom: must be one of the merged tags or %q", BudgetNone)
	}
	from := ""
	switch {
	case hasBudget(*target):
		p.Budget = BudgetOutcome{Outcome: "target"}
	case len(withBudget) == 0:
		p.Budget = BudgetOutcome{Outcome: "none"}
	case len(withBudget) == 1:
		from = withBudget[0]
	case req.BudgetFrom == BudgetNone:
		p.Budget = BudgetOutcome{Outcome: "none", Candidates: withBudget}
	case req.BudgetFrom != "":
		if !slices.Contains(withBudget, req.BudgetFrom) {
			return nil, nil, badMerge(400, "budgetFrom: %s has no budget", req.BudgetFrom)
		}
		from = req.BudgetFrom
	default:
		p.Budget = BudgetOutcome{Outcome: "choose", Candidates: withBudget}
		p.Conflicts = append(p.Conflicts, "budget-choice")
	}
	if from != "" {
		s := d.tagByID(from)
		after.LimitMinor, after.Cycle, after.CycleEvery, after.CycleStart, after.CycleEnd, after.Currency =
			s.LimitMinor, s.Cycle, s.CycleEvery, s.CycleStart, s.CycleEnd, s.Currency
		p.Budget = BudgetOutcome{Outcome: "source", From: from}
		if len(withBudget) > 1 {
			p.Budget.Candidates = withBudget
		}
	} else if p.Budget.Outcome == "none" && !hasBudget(*target) {
		after.LimitMinor, after.Cycle, after.CycleEvery, after.CycleStart, after.CycleEnd, after.Currency = nil, "", 0, "", "", ""
	}

	lg := &mergeLog{Target: *target, TargetAfter: after, Sources: srcTags, Links: []linkChange{}, Templates: []textChange{},
		Widgets: []includeChange{}, DroppedKeys: []string{}}

	// transactions: the sources become the target, once
	merged := map[string]bool{targetID: true}
	for id := range sources {
		merged[id] = true
	}
	for _, t := range d.Transactions {
		n := 0
		for _, id := range t.TagIDs {
			if merged[id] {
				n++
			}
		}
		if n == 0 {
			continue
		}
		p.Transactions++
		lg.TargetTxns = append(lg.TargetTxns, t.ID)
		if n > 1 {
			p.DuplicateLinks++
		}
		if ids, changed := repoint(t.TagIDs, targetID, sources); changed {
			p.AffectedTransactions++
			lg.Links = append(lg.Links, linkChange{TransactionID: t.ID, Before: slices.Clone(t.TagIDs), After: ids})
		}
	}
	sort.Strings(lg.TargetTxns)

	// templates keep their categories in template_json
	rows, err := b.s.db.Query(`SELECT id,template_json FROM transaction_templates WHERE user_id=? ORDER BY id`, b.uid)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, js string
		if err := rows.Scan(&id, &js); err != nil {
			return nil, nil, err
		}
		var body TemplateBody
		if err := json.Unmarshal([]byte(js), &body); err != nil {
			return nil, nil, err
		}
		ids, changed := repoint(body.TagIDs, targetID, sources)
		if !changed {
			continue
		}
		body.TagIDs = ids
		nj, err := json.Marshal(body)
		if err != nil {
			return nil, nil, err
		}
		lg.Templates = append(lg.Templates, textChange{ID: id, Before: js, After: string(nj)})
		p.Templates = append(p.Templates, id)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	rows.Close()

	// settings: dashboard widgets that pick tags, and dismissed budget notifications
	set, err := b.loadSettings()
	if err != nil {
		return nil, nil, err
	}
	for i, it := range set.Dashboard.Items {
		if ids, changed := repoint(it.Include, targetID, sources); changed {
			lg.Widgets = append(lg.Widgets, includeChange{ID: it.ID, Before: slices.Clone(it.Include), After: ids})
			set.Dashboard.Items[i].Include = ids
			p.Widgets = append(p.Widgets, it.ID)
		}
	}
	if len(lg.Widgets) > 0 {
		lg.dashboard = &set.Dashboard
	}
	kept := []string{}
	for _, k := range set.Notifications.Dismissed {
		if notificationTag(k) != "" && sources[notificationTag(k)] {
			lg.DroppedKeys = append(lg.DroppedKeys, k)
		} else {
			kept = append(kept, k)
		}
	}
	if len(lg.DroppedKeys) > 0 {
		lg.dismissed = kept
	}
	p.DroppedKeys = len(lg.DroppedKeys)
	p.Tag = after
	return lg, p, nil
}

// notificationTag is the tag id in a budget notification key ("budget-over:<tagId>:<periodStart>").
func notificationTag(key string) string {
	parts := strings.SplitN(key, ":", 3)
	if len(parts) == 3 && strings.HasPrefix(parts[0], "budget-") {
		return parts[1]
	}
	return ""
}

// tagMergeTestHook, when set (tests only), runs inside the merge's database transaction
// just before it commits; an error rolls everything back.
var tagMergeTestHook func(tx *sql.Tx) error

func execTx(tx *sql.Tx, uid, q string, args ...interface{}) error {
	_, err := tx.Exec(q, append([]interface{}{uid}, args...)...)
	return err
}

func writeTagRow(tx *sql.Tx, uid string, t Tag, insert bool) error {
	if insert {
		return execTx(tx, uid, `INSERT INTO tags(user_id,id,name,limit_minor,cycle,cycle_every,cycle_start,cycle_end,currency,memo,tag_group) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
			t.ID, t.Name, n64(t.LimitMinor), t.Cycle, t.CycleEvery, t.CycleStart, t.CycleEnd, t.Currency, t.Memo, t.Group)
	}
	_, err := tx.Exec(`UPDATE tags SET name=?,limit_minor=?,cycle=?,cycle_every=?,cycle_start=?,cycle_end=?,currency=?,memo=?,tag_group=? WHERE user_id=? AND id=?`,
		t.Name, n64(t.LimitMinor), t.Cycle, t.CycleEvery, t.CycleStart, t.CycleEnd, t.Currency, t.Memo, t.Group, uid, t.ID)
	return err
}

// setLinks replaces a transaction's categories, in order.
func setLinks(tx *sql.Tx, uid, txnID string, ids []string) error {
	if err := execTx(tx, uid, `DELETE FROM transaction_tags WHERE user_id=? AND transaction_id=?`, txnID); err != nil {
		return err
	}
	for _, id := range ids {
		if err := execTx(tx, uid, `INSERT OR IGNORE INTO transaction_tags(user_id,transaction_id,tag_id) VALUES(?,?,?)`, txnID, id); err != nil {
			return err
		}
	}
	return nil
}

func saveSettingTx(tx *sql.Tx, uid, key string, v interface{}) error {
	js, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return execTx(tx, uid, `INSERT INTO settings(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value`, key, string(js))
}

// mergeTags previews (dryRun) or applies a merge into targetID, all or nothing.
func (b *Book) mergeTags(targetID string, req MergeRequest) (*MergePreview, error) {
	lg, p, err := b.planMerge(targetID, req)
	if err != nil {
		return nil, err
	}
	if req.DryRun {
		return p, nil
	}
	if len(p.Conflicts) > 0 {
		return nil, &mergeError{409, fmt.Sprintf("budgetFrom required: %s have budgets; pick one of them or %q",
			strings.Join(p.Budget.Candidates, ", "), BudgetNone)}
	}
	tx, err := b.s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	uid := b.uid
	if err := writeTagRow(tx, uid, lg.TargetAfter, false); err != nil {
		return nil, err
	}
	for _, s := range lg.Sources {
		if err := execTx(tx, uid, `DELETE FROM tags WHERE user_id=? AND id=?`, s.ID); err != nil {
			return nil, err
		}
	}
	for _, l := range lg.Links {
		if err := setLinks(tx, uid, l.TransactionID, l.After); err != nil {
			return nil, err
		}
	}
	// links of transactions that no longer exist must not outlive their tag
	for _, s := range lg.Sources {
		if err := execTx(tx, uid, `DELETE FROM transaction_tags WHERE user_id=? AND tag_id=?`, s.ID); err != nil {
			return nil, err
		}
	}
	for _, t := range lg.Templates {
		if _, err := tx.Exec(`UPDATE transaction_templates SET template_json=? WHERE user_id=? AND id=?`, t.After, uid, t.ID); err != nil {
			return nil, err
		}
	}
	if lg.dashboard != nil {
		if err := saveSettingTx(tx, uid, "dashboard", lg.dashboard); err != nil {
			return nil, err
		}
	}
	if lg.dismissed != nil {
		if err := saveSettingTx(tx, uid, "notifications", NotificationSettings{Dismissed: lg.dismissed}); err != nil {
			return nil, err
		}
	}
	js, err := json.Marshal(lg)
	if err != nil {
		return nil, err
	}
	p.MergeID = newID("merge")
	if err := execTx(tx, uid, `INSERT INTO tag_merges(user_id,id,target_id,created_at,log_json) VALUES(?,?,?,?,?)`,
		p.MergeID, targetID, time.Now().UTC().Format(time.RFC3339), string(js)); err != nil {
		return nil, err
	}
	if tagMergeTestHook != nil {
		if err := tagMergeTestHook(tx); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return p, b.reload()
}

// undoMerge puts back what a merge changed. It refuses, changing nothing, unless the
// merge is still in effect exactly as it left things: not undone yet, the target as the
// merge left it, no tag with a source's id, every repointed transaction and template
// unchanged since, and no transaction added to or taken from the target. Dashboard
// widgets are put back only where their include list is still as the merge left it, and
// the dropped notification keys come back (both are preferences, not books).
func (b *Book) undoMerge(id string) (*mergeLog, error) {
	var js, undone string
	err := b.s.db.QueryRow(`SELECT log_json,undone_at FROM tag_merges WHERE user_id=? AND id=?`, b.uid, id).Scan(&js, &undone)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, badMerge(404, "merge not found")
	}
	if err != nil {
		return nil, err
	}
	if undone != "" {
		return nil, badMerge(409, "this merge was already undone")
	}
	var lg mergeLog
	if err := json.Unmarshal([]byte(js), &lg); err != nil {
		return nil, err
	}
	d := b.data
	stale := func(why string) error { return badMerge(409, "cannot undo: %s since the merge", why) }
	if cur := d.tagByID(lg.Target.ID); cur == nil {
		return nil, stale("the merged tag was deleted")
	} else if !sameTag(*cur, lg.TargetAfter) {
		return nil, stale("the merged tag was edited")
	}
	for _, s := range lg.Sources {
		if d.tagByID(s.ID) != nil {
			return nil, stale("a tag with the id " + s.ID + " was added")
		}
	}
	linked := []string{}
	for _, t := range d.Transactions {
		if slices.Contains(t.TagIDs, lg.Target.ID) {
			linked = append(linked, t.ID)
		}
		for _, s := range lg.Sources {
			if slices.Contains(t.TagIDs, s.ID) {
				return nil, stale("a transaction got the id of a merged tag")
			}
		}
	}
	sort.Strings(linked)
	if !slices.Equal(linked, lg.TargetTxns) {
		return nil, stale("transactions were added to or removed from the merged tag")
	}
	for _, l := range lg.Links {
		t := d.transactionByID(l.TransactionID)
		if t == nil || !slices.Equal(t.TagIDs, l.After) {
			return nil, stale("the categories of a merged transaction were changed")
		}
	}
	set, err := b.loadSettings() // before the transaction: the store has one connection
	if err != nil {
		return nil, err
	}
	tx, err := b.s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	uid := b.uid
	for _, t := range lg.Templates {
		var cur string
		err := tx.QueryRow(`SELECT template_json FROM transaction_templates WHERE user_id=? AND id=?`, uid, t.ID).Scan(&cur)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, stale("a template that used a merged tag was deleted")
		}
		if err != nil {
			return nil, err
		}
		if cur != t.After {
			return nil, stale("a template that used a merged tag was edited")
		}
		if _, err := tx.Exec(`UPDATE transaction_templates SET template_json=? WHERE user_id=? AND id=?`, t.Before, uid, t.ID); err != nil {
			return nil, err
		}
	}
	if err := writeTagRow(tx, uid, lg.Target, false); err != nil {
		return nil, err
	}
	for _, s := range lg.Sources {
		if err := writeTagRow(tx, uid, s, true); err != nil {
			return nil, err
		}
	}
	for _, l := range lg.Links {
		if err := setLinks(tx, uid, l.TransactionID, l.Before); err != nil {
			return nil, err
		}
	}
	if len(lg.Widgets) > 0 {
		changed := false
		for _, w := range lg.Widgets {
			for i, it := range set.Dashboard.Items {
				if it.ID == w.ID && slices.Equal(it.Include, w.After) {
					set.Dashboard.Items[i].Include, changed = w.Before, true
				}
			}
		}
		if changed {
			if err := saveSettingTx(tx, uid, "dashboard", set.Dashboard); err != nil {
				return nil, err
			}
		}
	}
	if len(lg.DroppedKeys) > 0 {
		n := NotificationSettings{Dismissed: append(set.Notifications.Dismissed, lg.DroppedKeys...)}
		if err := n.validate(); err != nil {
			return nil, err
		}
		if err := saveSettingTx(tx, uid, "notifications", n); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(`UPDATE tag_merges SET undone_at=? WHERE user_id=? AND id=?`, time.Now().UTC().Format(time.RFC3339), uid, id); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &lg, b.reload()
}

func writeMergeErr(w http.ResponseWriter, err error) {
	var me *mergeError
	if errors.As(err, &me) {
		writeErr(w, me.code, me.msg)
		return
	}
	writeErr(w, 500, err.Error())
}

// handleMergeTags serves POST /api/tags/{id}/merge, {id} being the tag kept.
func handleMergeTags(w http.ResponseWriter, r *http.Request, b *Book, targetID string) {
	var req MergeRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeErr(w, 400, "invalid JSON: "+err.Error())
		return
	}
	p, err := b.mergeTags(targetID, req)
	if err != nil {
		writeMergeErr(w, err)
		return
	}
	writeJSON(w, 200, p)
}

// handleTagMerge serves POST /api/tag-merges/{id}/undo.
func handleTagMerge(w http.ResponseWriter, r *http.Request, b *Book) {
	id, action, ok := pathID(r)
	if !ok || action != "undo" {
		writeErr(w, 404, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	lg, err := b.undoMerge(id)
	if err != nil {
		writeMergeErr(w, err)
		return
	}
	ids := []string{lg.Target.ID}
	for _, s := range lg.Sources {
		ids = append(ids, s.ID)
	}
	writeJSON(w, 200, map[string]interface{}{"undone": id, "tagIds": ids})
}

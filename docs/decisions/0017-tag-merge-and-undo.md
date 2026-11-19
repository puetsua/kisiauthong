<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0017 — Merging tags, with a merge log for undo

Date: 2026-11-19
Status: accepted (issue #13)

## Context

After an import a book can hold several tags for one meaning ("Lunch",
"lunch", 「午餐」 with a trailing space). There was no way to combine them:
no tag delete, no merge, in the UI, the REST API or MCP. A tag id is held
in more places than its row: transaction links, `template_json` of
templates, dashboard widget `include` lists, and dismissed budget
notification keys (`budget-over:<tagId>:…`).

Three designs were mocked up. Suggested merge groups (B) and a per-tag
"Merge into…" with similar tags first (C) were rejected: the app must not
point at tags it thinks are duplicates (ADR 0015). A multi-select the user
starts (A) was chosen.

## Decision

- **UI.** The Tags page has a "Merge tags…" button. It switches the page to
  select mode: every tag as a checkbox card, sorted by name with width,
  case and spacing folded (a plain sort; nothing is highlighted, labelled
  or pre-selected). A sticky bar "Merge N tags" opens the confirmation:
  which tag is kept (the most used one to start with), its name, the
  budget when that needs a choice, and what changes, from the server's dry
  run. The result is the kept tag's page with a 10-second Undo toast.
- **API.** `POST /api/tags/{id}/merge`, `{id}` being the kept tag (the
  target), body `{sourceIds, name?, budgetFrom?, dryRun?}`, scope
  `tags:write`. Sources must exist, be non-empty, distinct and not the
  target. `dryRun` returns the preview (transactions, templates, widgets,
  budget outcome, conflicts) and changes nothing. MCP gets `merge_tags`
  with the same arguments plus `targetId`, under `tags:write`.
- **What a merge does**, in one SQL transaction: each transaction's
  categories have every source replaced by the target in place, once (no
  duplicate link); templates' tag ids and dashboard `include` lists are
  repointed the same way; dismissed `budget-*:<sourceId>:…` keys are
  dropped; the target is renamed if asked; the sources are deleted.
- **Budgets.** The target's budget wins. Otherwise a lone source budget
  moves to the target. With two or more source budgets and none on the
  target, `budgetFrom` must name one of them or `"none"`; without it the
  merge is refused with 409 and the dry run reports `budget-choice`.
- **Merge log.** Migration 15 adds `tag_merges(user_id, id, target_id,
  created_at, undone_at, log_json)`, written in the merge's transaction.
  The log holds the target before and after, the deleted tags whole, each
  changed transaction's ordered categories before and after, the ids of
  every transaction on the target afterwards, each changed template's
  `template_json` before and after, each changed widget's include list,
  and the dropped notification keys.
- **Undo** is `POST /api/tag-merges/{id}/undo` (scope `tags:write`). It
  restores everything above in one transaction, keeping ids and order. It
  is refused with 409, changing nothing, when the merge is no longer in
  effect exactly as it left things: already undone; the target edited or
  gone; a tag with a source's id exists; a merged transaction's categories
  changed or it was deleted; a transaction was added to or removed from the
  target; a repointed template was edited or deleted. A later merge of the
  target counts as an edit. Preferences are restored leniently: a widget's
  include list is put back only if it is still as the merge left it, and
  the dropped notification keys come back.

## Consequences

- Undo stays available after the toast (the log is kept), but in practice
  only until the merged tag or its transactions are touched; the rule
  errs on refusing rather than overwriting later work.
- Names stay non-unique and there are no aliases; both are possible
  follow-ups, each needing its own decision.
- Anything that later stores a tag id must be repointed by the merge and
  restored by the undo, and get a test.

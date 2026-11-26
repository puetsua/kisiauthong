<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0028 — Tag groups and the tag picker

Date: 2026-11-26
Status: accepted

## Context

The add form showed every tag as a toggle, in the order the server returned
them (code points, neither stroke nor Zhuyin order). With 30–40 tags the
field filled most of a phone screen, and finding a tag meant reading all of
them (issue #127). Tags had no grouping: AGENTS.md mentioned a two-level
`parent_id`, but it was never built, and a parent tag would change what
budgets and reports count.

## Decision

- **Group:** a tag has an optional **`group`**, which sets where it is
  listed in tag pickers, and nothing more.
  - It is free text, trimmed, with runs of white space folded into one
    space, at most 100 characters.
  - An empty group means *Ungrouped*.
  - It is stored as `tags.tag_group`, added by migration 17.
  - `PUT /api/tags/{id}` replaces it like the tag's other fields.
  - The state, the export, tag merges and their undo, and the MCP
    `create_tag` and `list_tags` tools carry it.
  - It does not change budgets, reports, filters or merges.
  - It is not a parent: groups do not nest, and a group has no budget of
    its own.
- **Tag picker:** one control chooses tags everywhere: the add/edit form
  (spending and income), the template dialog, and the Transactions tag
  filter.
  - **The field:** a search field (an ARIA combobox) holds the chosen tags
    as removable chips, in the order they were picked.
  - **The list:** one flat list of every tag, with no group or type
    headings.
    - The order is by group: groups in stroke order (筆畫, the zh-Hant
      collation), with Ungrouped last.
    - Tags within a group come in stroke order too.
  - **Budget marks:** a budget (a tag with a limit) is told apart from a
    plain tag on the chips, in the list and in Recently used.
    - A running budget has a gauge icon after its name on chips, Recently
      used pills and list rows. There is no side bar.
    - A plain tag has no mark. A budget whose fixed date range has ended
      looks the same as a plain tag: not dimmed, no "Ended".
    - A screen reader hears ", budget" after a running budget's name, so
      colour is never the only cue.
    - There is no legend, and no amounts or progress bars.
    - Reserves are not tags (ADR 0013), so they never appear here.
  - **Search:** typing filters by name (a substring, folding width and
    case); Zhuyin or pinyin initials are not matched. An input method's
    unfinished word does not filter.
  - **Recently used:** a row under the field shows the tags of the latest
    entries, the most recently entered first. It is a plain order: nothing
    is pre-selected or highlighted (ADR 0015).
  - **Creating a tag:** in the form and the template dialog, a name that no
    tag has can be created on the spot from the list (Create tag "…"). The
    new tag is ungrouped.
  - **The filter:** it picks one tag or Uncategorised, never creates a tag,
    and has no Recently used row.
  - **Small books:** the picker is used even when a book has only a few
    tags; there is no second look.
- **Setting the group:** the category/budget form has a Group field that
  suggests the groups already in use.

## Consequences

- One component replaces the toggle wall and the filter dropdown, so tag
  order and search behave the same everywhere.
- Choosing a tag no longer takes one tap on a visible pill. A tag in the
  Recently used row still takes one tap. Any other tag takes a focus, then
  typing or scrolling, then a tap.
- Grouping is by a label only. If a two-level hierarchy with its own
  budgets is ever wanted, it needs its own ADR.

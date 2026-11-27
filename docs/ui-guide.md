<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# UI guide

How the web UI (`web/`) is put together, so new screens look and behave like
the existing ones. When code and this guide disagree, fix one of them in the
same change. Styles live in `web/style.css`, markup in `web/index.html` and
`web/app.js`.

## Principles

- **Let the layout explain.** No secondary labels or descriptions that repeat
  what the layout already says. A short hint is fine only where an action
  would otherwise be undiscoverable (e.g. an empty state).
- **Do not nudge** (ADR 0015). Similar items may be kept on purpose: no
  suggested merges, "did you mean", highlighted duplicates or pre-selected
  groups. Offer tools the user starts and controls (a multi-select merge);
  a plain sort order with nothing highlighted or pre-selected is fine.
- **One way per job.** Reuse an existing component before adding a new one;
  a new pattern needs an entry here.
- **Phone and desktop are both first class.** Every screen works from 360px
  wide; the single breakpoint is `max-width: 800px` ("phone" below).
- **Money and dates go through the helpers** (see [Formatting](#formatting)),
  never hand-formatted.
- **Every string is translated** (see [Text](#text)).

## Tokens

Colours are theme tokens (issue #85, ADR 0027), set at the top of
`web/style.css` once per theme and mode: `[data-theme=default|contrast|warm|cool]`
for light and `[data-theme=X][data-mode=dark]` for dark. `web/theme.js` puts both
attributes on `<html>`. Use the tokens, never a literal colour: a new colour is a
new token in all eight blocks, and `node scripts/test-themes.js` fails on a
literal colour in a rule, a token missing from a theme, or a text pair under
WCAG AA (4.5:1; controls and icons 3:1).

| Token | Use |
|---|---|
| `--bg`, `--panel`, `--surface` | page background; cards and panels; raised things on top of them: top bar, tab bar, menus, dialogs, the drawer, chips, outline buttons |
| `--field`, `--fieldline` | form controls' fill and border (`--fieldline` is 3:1 against the field and the card) |
| `--soft`, `--hover`, `--hover2` | subtle fills, hover backgrounds |
| `--line`, `--rule`, `--track` | borders of cards and chips, row dividers, empty bar tracks |
| `--ink`, `--muted` | text, secondary text (also placeholders) |
| `--on-accent`, `--on-status` | text on an `--accent` fill; text on a solid `--amber` or `--red` (due chip, badge, error toast) |
| `--side`, `--side2`, `--sidehover`, `--sidetext`, `--sidemuted`, `--sidestrong`, `--sideline` | the sidebar: background, current page, hover, text, secondary text, the brand and current page's text, the Administration link's border |
| `--accent`, `--accent2`, `--accentsoft`, `--focus` | primary actions, selected state and hover, selected fill, focus rings |
| `--amt-in`, `--amt-out` | income and spending amounts (issue #66); not `--pos` / `--red`, which mean good and over budget or danger |
| `--pos`/`--posbg`, `--amber`/`--amberbg`, `--red`/`--redbg` | good, warning, bad/over |
| `--amberline`, `--amberink`, `--plannedbg` | border and text of an amber note; the planned row's fill |
| `--sched`, `--schedbg`, `--schedink`, `--schedline` | scheduled (dated after today, ADR 0014): bar segment and dot, section/note fill, text on that fill, its border |
| `--ico-out`/`-bg`, `--ico-move`/`-bg`, `--ico-rsv`/`-bg` | the row icon of spending, a transfer, a reserve allocation (income uses `--pos`) |
| `--nightlybg`, `--nightlyline`, `--nightlyink`, `--nightlysideink` | the teal `nightly` chip beside the version (ADR 0018); solid `--nightlyline` with `--nightlysideink` text on the sidebar |
| `--peekbg` | a hidden amount being peeked at |
| `--scrim`, `--shadow-rgb` | backdrops behind dialogs and sheets; shadows as `rgba(var(--shadow-rgb),alpha)` |
| `--toast-bg`, `--toast-ink`, `--toast-line`, `--toast-hover` | toasts, the drag ghost, and the Undo button in a toast |
| `--cropbg`, `--series-1` … `--series-5` | the photo cropper's backdrop; the reserve split bar's segments (`app.js`) |
| `--page-max` | content width (Settings → Page width) |

- Fixed on purpose, not tokens: avatar colours and their white initials (each
  user's chosen colour), the white behind a QR code, mask gradients, the photo
  cropper's canvas over the photo, and the Windows close button's red in the
  app frame.
- An element with `data-theme` and `data-mode` draws its contents in that
  theme (the Settings theme cards); a custom theme adds its colours as inline
  tokens on top (`setThemeTokens` in `web/theme.js`, the editor's preview).
- The theme editor (`#theme?id=…`, a Settings sub-page): the form on the
  left (name, the light/dark split, grouped main colours with the picker under
  the chosen one's group, the theme JSON, then Delete · Cancel · Save) and the
  live preview on the right, sticky; on phones the preview is pinned under the
  top bar. A live refresh does not redraw it.

- Type: body in the system sans stack (Segoe UI, Microsoft JhengHei, PingFang
  TC, Noto Sans TC); headings, the brand and big amounts in Georgia / Noto Serif TC.
- Radii: 6–7px for inputs and buttons, 10px panels, 12px cards, menus and
  dialogs, 14px the transaction panel, 999px pills.
- Icons: inline SVG, `viewBox="0 0 24 24"`, stroke `currentColor`, width
  1.8–2, round caps and joins, `aria-hidden="true"`. No icon fonts or images.

## Shell

```text
desktop                                  phone (≤ 800px)
┌────────┬──────────────────────────┐    ┌──────────────────────┐
│sidebar │ top bar: title  🔔  (DE) │    │ top bar: title 🔔 (DE)│
│ nav    ├──────────────────────────┤    ├──────────────────────┤
│        │ page (.view)             │    │ page (.view)         │
│        │                      (+) │    │                      │
│ admin  │                          │    ├──────────────────────┤
│ footer │                          │    │ tab bar  ▣ ☰ (+) ▭ ⋯ │
└────────┴──────────────────────────┘    └──────────────────────┘
```

### Left pane (sidebar) — desktop

- `.sidebar`, 218px, dark (`--side`), sticky full height.
- Top to bottom: brand (記數通 + KiSiauThong), `#nav` with the book pages
  (Dashboard, Transactions, Accounts, Templates, Tags, Settings), then the
  Administration link (admins only) and the licence footer at the bottom,
  with the version under it (ADR 0018): muted monospace text, plus the teal
  `.verchip` for a nightly build, linking to Settings → About.
- The current page's link has `.on`. On admin pages `#nav` is swapped for
  `#adminNav` (Server, Users) and the foot link becomes "Back to my books".
- New book pages go into `#nav`, the phone tab bar or More sheet, and
  `SCREENS` in `app.js` together.

### Top bar

- `.topbar`, sticky, white: page title (`#pageTitle`, serif) on the left,
  the hide-amounts eye (`#hideBtn`), the notifications bell and the user
  avatar menu on the right. Nothing else; page actions belong in the page.

### Phone navigation

- The sidebar and the floating + are hidden. `#tabbar` is fixed at the bottom:
  Dashboard, Transactions, **+** (raised, opens the transaction panel),
  Accounts, More. It pads for `env(safe-area-inset-bottom)`.
- **More** opens `#moreSheet`, a bottom sheet with the remaining pages
  (Templates, Tags, Settings; Server and Users for admins). It closes on a
  link, the backdrop, or Esc. The More tab is `.on` while one of its pages
  is shown. Its foot (`#moreVer`) shows the version like the sidebar does.
- Keep the tab bar at five items. A new page goes into the More sheet.

### Floating add button

- `#addBtn` (`.fab`), bottom right on desktop, opens the transaction panel.
  Hidden where nothing can be added (admin pages, dashboard editing) and on
  phones, where the tab bar's + replaces it.

## Phone (≤ 800px)

Everything that changes at the breakpoint, and the rules for anything new.
Check every UI change at 390×844 and 360 wide as well as on desktop.

### Layout

- Only two fixed bars: the top bar and the tab bar. No sidebar, no floating
  +, and nothing else pinned to the screen.
- `.view` has 16px 14px padding; its bottom padding clears the tab bar and
  the safe area.
- No sideways page scrolling: wide content wraps or stacks. Two-column
  layouts (`.grid2`, half-width dashboard widgets, the dialog form) become
  one column; Settings drops its section list.
- Tables become one card per row (labels from `data-label`); expected
  (planned) rows keep their amber card.
- Panel headings wrap their buttons onto a second line (`.panelhead`); the
  period navigation spans the full width.

### Filters and toolbars

- Transactions shows the search box and a **Filters** button that counts
  the filters in use ("Filters · 2"); the dropdowns and Clear unfold below
  it. A new filter goes inside `.fmore`, never beside the search box.
- The search and filters live in the address (`#transactions?tag=…`). A
  filter value the dropdown cannot show (a category merged away, an unknown
  account in an old or shared link) makes the page fetch its data again,
  its dropdown saying "Checking…" meanwhile; a value that is still unknown
  is then dropped from the screen and the address. An unknown type is
  dropped at once (issue #79).
- Keep a page's own toolbar to one row of small buttons; more belongs in a
  menu.

### Popups

- Transaction panel: full width minus 12px each side, at most the screen
  height, scrolling inside; quick picks two per row.
- Dialog: 19px from each side (the browser's own dialog margin), one column.
- Notifications: full width minus 12px, under the bell. Menus stay inside
  the screen.
- Bottom sheets are for navigation (More) only; actions use menus or the
  panel.

### Touch and input

- Touch targets are at least 40px (tab bar items 52px); text links inside
  a sentence are the exception. A name link in a table keeps its look and
  gets a taller hit area through padding with a matching negative margin.
- Nothing important is hover-only: a `title` tooltip is an extra, and
  whatever it says must also be visible or reachable by tapping.
- No gestures the UI depends on (long-press, swipe), and no dragging on
  phones: dashboard editing there uses arrow buttons only (see Dashboard).
- Use the right keyboard: amounts `type="number" inputmode="decimal"`,
  codes `inputmode="numeric" autocomplete="one-time-code"`.

### Safe areas and the installed app

- Fixed bottom elements pad with `env(safe-area-inset-bottom)` (tab bar,
  More sheet) and the toast sits above the tab bar.
- `manifest.json` opens an installed app without the browser bar, so every
  page must be reachable from the tab bar or More. Pages are hash routes,
  so the system Back button returns to the previous page; popups are not
  history entries.

## Pages

- A page renders into `#view` (`.view`, centred, max `--page-max`, bottom
  padding clears the + / tab bar).
- Content sits in **panels**: `section.panel` (white, 1px `--line` border,
  10px radius, 18px padding). The heading row is `.panelhead`: an `h3` on the
  left, the panel's small buttons on the right.
- **Lists of records** use `table(headers, rows)` / `row(cells)`. On phones
  tables become one card per row with each cell labelled from `data-label`,
  so give every cell a short label.
- **Long lists** that are not tied to a period (search results) page with
  ‹ Previous / Next ›, a "1–20 of 57" count and a 10 / 20 / 50 / 100
  page-size select remembered per browser; a new search starts at page 1.
- **State in the address**: a screen whose view is worth sharing keeps it in
  the hash query (`#transactions?q=rent&page=2&per=50`), written with
  `history.replaceState` so typing does not fill the history; a bare
  `#screen` keeps what is on screen.
- **Cards** (`.tcard`, `.acard` …) are for things scanned at a glance (budgets,
  reserves, accounts); each card is a button that opens its details. A
  budget's or reserve's name comes first and its period or target date goes
  on the line below; a reserve's name wraps rather than being cut off. A
  budget card ends with one line: what is left (or over), then, lighter, the
  days left in the period, or its start date before it starts and its end
  date once it has ended (`剩 TWD 631 · 還有 7 天`); no per-day amount
  (issue #97). The
  Accounts and Reserves pages start with their cards, with no summed total
  above them.
- **Record pages** (a category: `#tag?id=…&range=month&at=2026-10-01`, a
  reserve: `#reserve?id=…`, an account, own or external: `#acct?id=…`): the
  top bar shows the record's name and the nav keeps its parent page `.on`.
  The page starts with `.pagebar` (‹ parent link left, Edit right), then
  figures as `.totcard` tiles, then panels of transactions. A period to page
  through reuses the Transactions `.periodbar` (mode `.seg`, ‹ Previous /
  Next ›, Back to today); unlike typing, each step is a new history entry, so
  Back steps back (`periodBar` / `bindPeriodBar`). Actions on the record
  (a reserve's Put in, Take out) sit in a row under its card, the main one
  as `.primarybtn`. An unknown id returns to the parent page. A record
  page that opens with the record's card shows the same card as its list
  (not a button there: `.acard.static`), never a longer one;
  details go in the panels under it. An account's page puts its blue
  Scheduled panel beside the card on wide screens (`.acctpage.withsched`).
  An external account's page (issue #125) has no balance: its card is the
  icon, name and "External account"; then Transactions / Received / Paid
  tiles (all time, posted only, a money tile only when it has an amount);
  the period line (`.psum`) shows the period's Received (+, `.amt.in`) and
  Paid (−, `.amt.out`) per currency; rows are signed as the user sees them
  (money from it +); the period line and the rows are `.amtstyle`, so
  Settings → Spending and income applies to them as on the Transactions list.
- **Select mode** (Tags → Manage tags): the page becomes checkbox cards
  (real `<input type="checkbox">` in a `<label class="tcard pcard">`), with a
  Cancel in a head panel and a sticky `.mergebar` holding the live count
  (`aria-live`) and the action (Merge options, which opens the
  confirmation dialog); the + button hides. Leaving the page ends
  it. Nothing is pre-selected and the order is a plain sort (ADR 0015).
- **Empty states**: `.empty`, one short sentence; add how to create the first
  item only when it is not obvious.
- **Settings-style pages** (Settings, My account, Server): `.settings` with a
  sticky section list (`.snav`, desktop only) and `.scard` cards of
  `.srow` rows, label (`.sl`) left, control right; one column on phones.
- **Settings → Servers** (only inside the Tauri apps, ADR 0019): the last
  section before About. One `.srow.srvrow` per saved server: name (or host)
  with a `.pill.on` *In use* on the active one, the address in mono below,
  Switch / Edit / Remove (`.smallbtn`, Remove `.danger`) on the right, then an
  Add server `.ghostbtn` row. Nothing is suggested or pre-filled.
- **Server row on the sign-in card** (only inside the Tauri apps, ADR 0019,
  issue #35): the last row of every signed-out step (sign in, two-step code,
  setup), `.srvfoot` under a `--rule` hairline. Left, muted "Server" and the
  host[:port] in mono ink (`.host`); right, a *Change server* `.linkbtn` whose
  `aria-label` includes the host. On narrow phones it wraps, the link staying
  on the right.
- **Settings → About → App** (only inside the Tauri apps, ADR 0018, 0020,
  0025): the first version row, before *Server version*; the foot of the
  sidebar and More sheet shows this version too (issue #69). A `.srow` with
  the app's version, then, when the app's check found a newer
  one, a muted "Version X is available", then *Check for updates*
  (`.smallbtn`) where the app can update itself. That muted text is the only
  place an available update shows: no badge, dot or banner (ADR 0015).
- **The apps' App updates screen** (`apps/tauri/src/`, `mode=update`): the
  app's version, the status line, one primary button (Check → Download and
  install / Update and restart), Back, then a plain checkbox *Check for
  updates when the app opens* and a hint saying where updates come from.
- **The desktop apps' window frame** (`apps/tauri/src/frame.html`, ADR 0026):
  a bar in the sidebar purple across the top of the window, above every page:
  icon and name, then on Windows minimize, maximize/restore and close at the
  right; on macOS the system traffic lights at the left. The bar drags the
  window and double-click maximizes. Pages draw no title area of their own.
- **The apps' server screen** (`apps/tauri/src/`, outside the web UI): the
  brand panel with the large icon beside the form on desktop, a purple header
  above a white sheet on phones; one address field, a hint with an example,
  a red `.errbox` naming what went wrong and the address tried, and Connect.
  It copies the `:root` tokens of `web/style.css` (checked by
  `scripts/test-app.js`).
- **Dashboard**: widgets in `.dashgrid`, full or half width, user-arranged
  through Customize dashboard. A new widget must work at both widths. A
  widget with columns shows its table on desktop and, through
  `phoneSwap(table, cards)`, the same cards as its full page on phones
  (budget cards, account cards, a spending list). A widget whose amounts
  come in several currencies and are compared with each other (Spending,
  Income) shows one currency at a time behind `.seg.curtabs` currency tabs, in the
  currency order below; the
  picked tab is remembered per widget on the device, otherwise the first tab
  is shown (the default currency when it has spending). Currencies are never mixed in one list.
  Income this month (issue #125) puts a `.psum` total line (the tab's
  currency, its transaction count) above its rows, since an income with two
  categories sits on both rows; its rows are by category or, as a widget
  setting, by source (the external account). Some widget types are not on
  the default dashboard (`extra` in `DASH_WIDGETS`, `extraWidgets` on the
  server): a user adds them in Customize.
  - **Customize dashboard, desktop:** the dashboard itself is edited, with
    previews. The pane on the right lists the widget types to add, or the
    settings of the selected widget. Widgets move by dragging (a mouse from
    anywhere on the tile) or with ↑ ↓.
  - **Customize dashboard, phones (issue #40):** each tile is only its bar.
    The bar shows the name, a muted line with the width and rows
    (`.tmeta`) and ↑ ↓ ⚙ ✕ (40px).
    - ⚙ (or the name) opens that widget's settings under its bar
      (`.tileset`, `aria-expanded` on ⚙), and tapping it again closes them.
    - Below the last tile, **Add widget** is a two-column grid of
      "+ type" buttons (`.palgrid` / `.paladd`). Every type stays there, so a
      type can be added again. A new widget goes to the bottom and flashes.
    - There are no grips and no dragging.
- **Ended budgets** (issue #59): wherever budgets are listed (the Tags page,
  the Budgets widget as table and as cards), a budget whose fixed date range
  has passed (`today > periodEnd`) moves into a `details.endedsec` below the
  running ones, summary "Ended (n)" (已結束 (n)), 40px tall. It is closed by
  default; the browser remembers the last choice (`localStorage`) for every
  such list. With no ended budget there is no section.
- **Tag groups** (issue #127, ADR 0028): the category/budget form has Group
  after Name: a text field suggesting the groups in use (`datalist`), with
  Ungrouped (未分組) as its placeholder when empty. The group only orders
  the tag picker's list (which shows no headings); the Tags page cards do
  not show it.
- **Notes on accounts and tags** (issue #42): the user's own free text, edited
  as the last field of the account or category/budget form (a `textarea`
  labelled Note, 4000 characters, like a transaction note). The account page
  (under its card) and the tag page (under its totals) show it read-only in a
  `.panel.notepanel`, with line breaks kept, only when there is a note. Lists
  and cards never show notes. An external account's page shows its note under
  the totals. Merging tags keeps the kept tag's note; the merged
  tags' notes go with them, and Undo brings them back.

- **Live updates** (ADR 0023): a page fetches the books again when they change
  elsewhere and keeps its scroll position. It never redraws under an open
  dialog, transaction panel, Customize dashboard or Manage tags, or a focused
  field; it waits until they are closed or left. A new pattern with its own
  form or editing mode must add itself to `liveBusy()` in `web/app.js`.
  The exception is a field marked `data-live-keep` (the Transactions search
  box and filters): its screen sets `state.viewRedraw`, and while such a field
  has focus a refresh redraws only the results under it, never the field
  itself, so a search box left focused never holds updates back (issue #77).

## Popups

Open one popup at a time; the exception is a dialog opened from the
transaction panel (Save as template), which stacks above it. Esc closes the
topmost popup only.

| Popup | Element | Use | Closes with |
|---|---|---|---|
| Transaction panel | `#drawer` + `#drawerBackdrop` | adding, editing, confirming a transaction | ✕, backdrop, Esc, saving |
| Dialog | `<dialog id="dialog">` via `openDialog(title, html)` | create/edit forms (accounts, tags, templates), details, confirmations with content | ✕, Esc, submitting |
| Menu | `.usermenu`, `.actmenu` | a short list of actions on one thing | choosing, clicking outside, Esc (focus returns to the trigger) |
| Notifications | `#notifPanel` | the bell's list | the bell, clicking outside, Esc |
| Bottom sheet | `#moreSheet` | phone navigation only | link, backdrop, Esc |
| `askConfirm(text, action)` | browser `confirm()`; the system dialog inside the app (ADR 0019) | one-line yes/no before deleting; `action` names the button ("Delete") | — |

### Transaction panel

- Centred (`.drawer` keeps its old name): as wide as the page content
  (`--page-max`, so Settings → Page width applies), 12px clear of the screen
  edges, scrolls inside itself, 14px radius.
- On desktop the form is two columns: short fields pair up (account with
  payee or target account; amount; date and time with time
  zone), while notes, quick picks, the type selector, the title, categories
  and the note field span both. The order is set in CSS (`order`), so fields
  that a type hides leave no gaps. On phones it is one column.
- Date and time share `.daterow` with an icon-only now button
  (`#fNowBtn.nowbtn`, ⟲ around clock hands, `aria-label`/`title` "Fill in
  current date and time"): it sets Date, Time and Time zone to this moment in
  the device's zone, for a new or an existing transaction, and saves
  nothing. If the device zone is missing from the list it is added, so the
  zone always matches the date and time. Each input is at least as wide as
  its value (that width depends on the locale and 12/24-hour clock, so no
  fixed breakpoint is used): when the row does not fit, Time and the button
  (`.timenow`) wrap together below the date. Below 480px the inputs get
  less padding.
- A date after today makes the saved row scheduled: a blue `#fSchedNote`
  above the form says so live while the date, accounts or amount change
  (and, for a scheduled row moved to today or earlier, that saving posts it);
  on a scheduled row it carries Post now (`#fPostNow`), which sets the date to
  today and saves. Amounts in it go through `fmt()`, so hiding amounts masks
  them.
- Order: title row, type selector (`.seg`), quick picks (add only, for the
  chosen type), Title (`#fTitleWrap`, issue #121), the other fields, then
  the save row.
- **Save row** (`.saverow`): the primary button (full width on phones,
  320px at the right on desktop) and an icon-only ⋯
  button (`#fMoreBtn`, `aria-label` "More actions") that opens `.actmenu`
  upwards. Secondary or destructive actions (Save as template, Delete) go in
  that menu, never as extra buttons under Save.
- Quick picks (`#fQuick.quickbox`) are labelled groups (`.qgroup`, a small
  `.qhead` title: Templates, then Recent), each an even grid (`.quickpicks`)
  of `.qpick` buttons (name, then amount · account), long names cut with an
  ellipsis. A template's name carries a bookmark icon (`.qtpl`). A shortcut
  without an amount shows the account only and, when used, leaves Amount
  empty with the focus there (issue #121).
- One form for every type (ADR 0029): every tab has the same fields, From
  (`#fFromWrap`) before To (`#fToWrap`), and Tags. The tab only decides
  which accounts each side offers: Expense keeps To (Paid to) to external
  accounts, Income keeps From (Received from) to them, and Transfer offers
  any account on both sides (`sidesFor`, `fillSides`, shared with the
  template dialog). Labels are the field names only, with no qualifier
  hints. A side kept to the only external account is a disabled (greyed)
  select, never hidden. Switching tabs keeps the tags and carries the
  accounts over; the type sent is what the accounts make it.
- Tags are the tag picker (`#fCatsWrap`, see [Tag picker](#tag-picker))
  with Recently used and Create tag, on every tab.

### Dialog

- Build the body with `dialogForm(fields, submitLabel, extra)` and
  `field(label, control, cls)`. On desktop the form is two columns; give
  long fields the `wide` class. Secondary buttons go in `extra`
  (`.formactions`) above the full-width submit button.
- Groups of toggles use a `div.drawerfield` with a heading span, not a
  `label`, so clicking the heading toggles nothing. Choosing tags is the tag
  picker (the template dialog's Tags, `#tplCats`), never a group of toggles.
- The template dialog starts with Template name and, under it, Title (both
  `wide`); Amount, Tags and Title of a shortcut may stay empty (issue #121).
- A button that fills a field sits beside it in a flex row and wraps below
  it when the row is too narrow: Take out's **Fill remaining**
  (`.amtfill`, `#dlgFill`, a `.smallbtn` as tall as the input) sets Amount
  to `decimal()` of what the reserve holds in the chosen account and saves
  nothing. Its `aria-label`/`title` carries the amount through `fmt()`, so
  hiding amounts masks it; changing the account updates the label, never
  the field.

## Toast

- `msg(text)` after every successful change ("Saved.", "Account added.");
  `errMsg(err)` or `msg(text, "error")` for failures.
- Bottom centre, dark (`--side`), one line, above the tab bar on phones.
  Success: `role="status"`, 3 s. Error: red, `role="alert"`, 7 s, click to
  dismiss. A new toast replaces the old one.
- Phrase it as the result, short, ending with a full stop.
- Copying to the clipboard goes through `copyText(text, done)`: it toasts
  `done` ("Copied." by default) or "Copy failed.", and where
  `navigator.clipboard` is missing (plain `http://` on the local network) it
  copies through a hidden textarea and gives focus back to the button.
- A change that can be taken back (merging tags) uses `msgUndo(text, undo)`:
  the toast carries an Undo button and stays 10 s, longer while the pointer
  or keyboard focus is on it.

## Controls

| Control | Class | Use |
|---|---|---|
| Primary button | `.primarybtn` (`.big`: full width) | the one main action of a form or panel |
| Small button | `.smallbtn` (`.danger`) | panel-header and secondary actions |
| Outline button | `.ghostbtn` | a secondary action next to a primary one |
| Icon button | `.iconbtn`, `.morebtn` | ✕, bell, ⋯; always with `aria-label` |
| Segmented choice | `.seg` with `button.on` | one of a few modes (type, period) |
| Theme cards | `.themecards` of `button.themecard` with `aria-pressed`, a `.themeprev` drawn in its own `data-theme` (custom themes: inline tokens too) | Settings → Appearance: one card per theme, built-in then *My themes*, the chosen one ringed |
| Checkbox row | `label.checkrow` with an `input[type=checkbox]` and its text | an on/off choice inside a settings row or panel (theme sync, the editor's light/dark split) |
| Sync state | `p.syncstate` (`.busy`, `.ok`, `.err`, `.off`: a ring) with a `.dot` and the text in a `span`; Retry as a `.smallbtn` after it | where synced data stands: on this device only, syncing, synced at a time, failed with Retry; Settings → Sync's live updates (on, connecting, offline) |
| Info button | `button.infobtn` (an (i) icon, 40px, `aria-haspopup="dialog"`, `aria-label` "About “{label}”") after a `label.checkrow`, both in a `div.checkline`; or after a settings row label (`label.sl`), both in a `div.slline`, the control (a select) in the row's `.sc` | opens a short explanation of a choice in the dialog (`dialog.helpdlg`, a `.helplist` and Close; Close gives the focus back to the (i)); beside the label, never in it, so it toggles or opens nothing. For a rule a label cannot carry, in place of a permanent hint under the control, not for hints the layout already gives (Settings → Sync's theme choices, Settings → Appearance → Spending and income) |
| Colour swatch | `.tswatches` of `button.tswatch` (`aria-pressed`) with the colour, its name and hex | the theme editor's main colours; the chosen one opens the picker under its group |
| Colour picker | `.tpick`: `.tpsv` (`role=slider`, arrow keys), `.tphue` range, hex field, a plain contrast figure | the theme editor only; a figure, never a warning (ADR 0015) |
| Secret key | `code.secret` holding a mask of the same groups (`keyMask()`), then `span.keybtns`: an eye `button.keybtn` (`aria-pressed`, "Show key" / "Hide key") and a copy `button.keybtn` ("Copy key") | a secret shown for typing by hand (two-step setup, issue #122): hidden by default, the real value not in the page until the eye shows it, hidden again on every new draw; Copy uses `copyText()` with the spaces removed and never shows it |
| Tag picker | `makeTagPicker(id, opts)` → `.tagpicker`: `.tgpbox` (chips + `input.tgpq`, `role=combobox`), `.tgplist` (`role=listbox`, `.tgpopt` options; `.ty-budget` marks), `.tgprecent` | choosing tags: the add form, the template dialog, the Transactions filter (`multiple: false`); see below |

### Tag picker

Issue #127, ADR 0028. One control for choosing tags. A screen puts its
`html()` in its markup and calls `bind()`; `value()` gives the chosen ids.

- **The field.** It looks like one input (`.tgpbox`). The chosen tags sit in
  it as `.chip.cur.tgpchip` chips, in the order they were picked, each with
  × (`aria-label` "Remove {name}"). Backspace in the empty field removes the
  last chip.
- **The list.** Focusing or clicking the field opens the list *in place*
  under it (in the filter bar it opens over the results).
  - It is one flat list of every tag, with no headings. The order is by
    group: groups in stroke order (筆畫, `TAG_ORDER`), with Ungrouped last;
    tags within a group are in stroke order too.
  - Typing filters by name. An input method's unfinished word does not
    filter.
  - Keys: ↑/↓ move the active option (`aria-activedescendant`), Enter picks
    it, and Esc closes the list, not the panel or dialog around it. While
    the list is open, Enter never submits the form.
  - Leaving the field closes the list. On a phone, opening it scrolls the
    field to the top. Nothing focuses the field by itself, so the keyboard
    only appears when the user taps.
- **Budget marks** (the gauge of variant B in the issue #127 mockups). No
  legend, no side bar, no amounts, no progress bars.
  - A running budget (`.ty-budget`) has a gauge icon (`GAUGE_SVG`,
    `.tgpicon`, in the text colour) *after* its name on chips, Recently used
    pills and list rows.
  - A plain tag has no mark. A budget whose date range has ended
    (`budgetEnded()`) looks the same as a plain tag.
  - `.tgpsr` (visually hidden) adds ", budget" for screen readers.
- **Recently used** (`recent: true`): a `.tagpick` row of toggles under the
  field, holding the tags of the latest entries, the most recently entered
  first. It hides while the list is open. It is a plain order, never
  pre-selected (ADR 0015).
- **Create tag** (`create: true`): when no tag has the typed name, the list
  ends with Create tag "…", which adds an ungrouped tag and picks it. When
  nothing matches, a note above it says so.
- **Filter mode** (`multiple: false`): one choice replaces the last and
  closes the list. Extra options (Uncategorised) come first. The
  placeholder says what no choice means (All categories). There is no
  create and no recent row. A tag the address names that is not known yet
  is a "Checking…" chip (issue #79).
- **Live updates.** The field keeps `data-live-keep`; `refresh()` redraws the
  chips and the list, never the input.
| Toggle chips | `.tagpick` buttons with `aria-pressed` | many-of-many (categories) |
| Status chip | `.chip` (`.due`, `.cur`) | a small state or value inside a row |
| Version chip | `.verchip` after `.vertext` | marks a nightly build; never on a release or dev build |
| Bar | `.bar` + `i` fill | progress; purple normal, amber `warn`, red `over` |
| Split bar | `.splitbar` (`.bar.split` on cards with a limit) + one `i` per segment | how an account's balance divides: reserved (`.earmarked`, `--accent2`), scheduled (`.sched`, `--sched`), the rest is free (the track) |
| Legend dot | `.dot` (`.free`, `.earmarked`, `.sched`) before a text label | names a bar segment; always with text and the amount |

- **Scheduled is blue.** A posted transaction dated after today (ADR 0014)
  uses the `--sched` tokens wherever it shows: the blue segment and dot,
  the `.chip.sched` ("Posts 11/20", on its own `.fpost` line under the row
  so a narrow phone never cuts the date short), the account page's `.feedpanel.sched`
  list (left border, like the amber Expected section, but needs no action),
  the Transactions page's `.schedsum` line (a `button` with `aria-expanded`
  that shows the rows in place), and the drawer's `.formnote.sched` note with
  Post now. Never reuse amber (expected, needs confirming) or purple
  (reserved) for it.
- **Scheduled details live on the account page** (ADR 0016). Cards and other
  top-level views show the scheduled *amount* only; post dates, incoming
  items and the rows themselves are listed on `#acct?id=…`.
- **Bar segments and legend.** Each segment of a split bar has a legend line
  under it: a `.dot` plus a text label with the amount (Free, Reserved,
  Scheduled), so the
  segments never rely on colour alone. A segment after another one gets a
  2px `--panel` gap (`i + .sched`): blue and purple are too close in
  lightness (1.4:1) to meet the 3:1 non-text contrast, while each meets it
  against the gap and the track (`--sched` 5.4:1 on white, 4.6:1 on
  `--accentsoft`; `--accent2` 7.6:1 and 6.4:1). New segments follow the same
  rule and take their colours from variables so a theme can override them.
  When the segments together exceed the balance they share the full bar in
  proportion, so none of them disappears, and the over-balance warning
  replaces the Free line.
- Labels sit above their field (`label > span + control`).
- Disabled controls use `disabled` (shown at .35 opacity), not hiding, when
  the user should know the action exists.
- A form that saves to the server is wired with `onSubmit(form, fn)`, never
  its own `addEventListener("submit")` (issue #131): while the request is
  under way its submit button is disabled and a second tap, Enter or
  `requestSubmit()` does nothing, so one tap saves once; when the request
  ends, saved or failed, the button is enabled again so a failed save can be
  retried.
- Hide with the `hidden` attribute; `[hidden]` is `display:none !important`.

## Formatting

- Amounts: `fmt(minor, currency)` for display, `decimal(minor, currency)` for
  form values, `toMinor(text, currency)` back. Never floats for money.
- Every displayed amount goes through `fmt()`: it marks the digits so that,
  while amounts are hidden (the header eye, kept per device in
  `localStorage`), they show as a `••••` pill (`.amtmask`) with the currency
  and sign beside it. A tap or Enter shows that one value for about five
  seconds and never reaches the row or card around it. Text built for anything
  but the page (search, clipboard) must use `plainAmounts()` or skip amounts.
  Form inputs use `decimal()` and are never masked.
- Currency order (issue #71): wherever currencies are listed (amounts,
  cards, tabs, checkboxes, pickers, and any future chart or series), they
  follow Settings → Frequently used currencies in the order set there, so
  the default currency first, then any other currency by code. Use
  `curSort(codes)` or `curOrder(perCurrency)` (both on `curCmp()`), never
  the data's own order or plain alphabetical; the server sorts its
  per-currency rows the same way (`currencyLess()`). The only exception is a
  list with its own order setting (the Frequently used chips themselves).
- Amounts in several currencies (issue #62; a category's net, the Spent and
  Received tiles, a reserve's Put in and Taken out, the period lines' net):
  `moneyBlock(perCurrency)`, never one long line. The first currency in the
  currency order (the default currency when the list has it) is the large
  primary amount. The others sit
  below it, smaller, one per line. Each code is a small label (`.ccode`)
  apart from the digits (`fmtNum()`, which marks them like `fmt()`). One-line
  summaries such as a day's net use the same order. The figures use the UI font: Georgia's
  old-style digits make small amounts such as −399 uneven. Amounts are never
  converted (ADR 0011).
- Number format (Settings): groups of three `1,074,958`, groups of four
  `107 4958` split by `FOUR_SEP` (a no-break space, so an amount never wraps
  inside its digits), or plain. Never parse displayed amounts back; a search
  that matches them treats any white space as a plain space.
- Negative is shown with a minus; income in `--amt-in` where direction matters.
- The Transactions list (rows and each day's net, inside `.amtstyle`) follows
  Settings → Appearance → Spending and income (issue #66), set as
  `data-amounts` on `<html>`: `both` (default) signs plus `--amt-in` for income
  and `--amt-out` for spending, `sign` only + / − in ink, `color` only the colors.
  The sign is always in the markup as `.asign`; `color` shrinks it to
  `font-size:0` (not `display:none`, not out of flow), so screen readers and
  copied text keep it on the same line. Transfers
  between own accounts stay `--muted` with no sign in every mode. The account
  page, category and reserve totals and the dashboard keep their own rules.
- Dates the user thinks in: `dayLabel(iso)`; periods: `periodLabel()`.
- Versions have no `v` prefix: `0.2.0`, `0.2.0-1118-c22ff51`, as in the
  release tags (ADR 0009).

## Text

- English source strings, sentence case, short. Wrap with `__()` at use or
  `N_()` where the string is stored for later; HTML uses `data-i18n`,
  `data-i18n-aria`, `data-i18n-title`, `data-i18n-placeholder`.
- Every string needs a Traditional Chinese (Taiwan) translation in
  `web/i18n.js`; `node scripts/check-i18n.js` must report all strings
  translated. Use Taiwan terms (帳戶, 範本, 捷徑, 設定).

## Accessibility

- Buttons are `<button>`, links are `<a href>`. Menus and popups set
  `aria-haspopup`, `aria-expanded`, `aria-controls` on their trigger; a
  toggle sets `aria-pressed`.
- Esc closes the topmost popup; focus moves into a popup when it opens and
  back to the trigger when a menu closes.
- Phone touch and input rules are under [Phone](#phone--800px); respect
  `prefers-reduced-motion`.

## Layers

Keep new fixed elements inside these bands (`z-index`):

| z | Element |
|---|---|
| 3 | top bar |
| 6 | phone tab bar |
| 7 | floating + |
| 8–9 | transaction panel backdrop, panel |
| 10–11 | More sheet backdrop, sheet |
| 30 | notifications panel, user menu |
| 40 | toast |
| 50 | drag ghost (dashboard editing) |
| top layer | `<dialog>` |

## Assets

- Web asset links carry `?v=N` in `web/index.html`; bump it in every change to
  `app.js`, `i18n.js` or `style.css` so browsers reload them.
- Paths stay relative (`icon.svg`, `api/…`) so the app works under
  `KISIAUTHONG_BASE_PATH`.
- The site icon is `web/icon.svg` (ledger page and coin on the purple
  gradient); PNG sizes and `manifest.json` are generated from it.

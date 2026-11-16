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
- **One way per job.** Reuse an existing component before adding a new one;
  a new pattern needs an entry here.
- **Phone and desktop are both first class.** Every screen works from 360px
  wide; the single breakpoint is `max-width: 800px` ("phone" below).
- **Money and dates go through the helpers** (see [Formatting](#formatting)),
  never hand-formatted.
- **Every string is translated** (see [Text](#text)).

## Tokens

Colours are CSS custom properties on `:root`; use them, not literal colours.

| Token | Use |
|---|---|
| `--ink`, `--muted` | text, secondary text |
| `--bg`, `--panel`, `--soft` | page background, cards, subtle fills |
| `--line`, `--rule`, `--track` | borders, row dividers, empty bar tracks |
| `--hover`, `--hover2` | hover backgrounds |
| `--side`, `--side2`, `--sidehover`, `--sidetext`, `--sidemuted` | the dark sidebar |
| `--accent`, `--accent2`, `--accentsoft` | primary actions, selected state, selected fill |
| `--pos`/`--posbg`, `--amber`/`--amberbg`, `--red`/`--redbg` | good, warning, bad/over |
| `--page-max` | content width (Settings → Page width) |

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
  Administration link (admins only) and the licence footer at the bottom.
- The current page's link has `.on`. On admin pages `#nav` is swapped for
  `#adminNav` (Server, Users) and the foot link becomes "Back to my books".
- New book pages go into `#nav`, the phone tab bar or More sheet, and
  `SCREENS` in `app.js` together.

### Top bar

- `.topbar`, sticky, white: page title (`#pageTitle`, serif) on the left,
  notifications bell and the user avatar menu on the right. Nothing else;
  page actions belong in the page.

### Phone navigation

- The sidebar and the floating + are hidden. `#tabbar` is fixed at the bottom:
  Dashboard, Transactions, **+** (raised, opens the transaction panel),
  Accounts, More. It pads for `env(safe-area-inset-bottom)`.
- **More** opens `#moreSheet`, a bottom sheet with the remaining pages
  (Templates, Tags, Settings; Server and Users for admins). It closes on a
  link, the backdrop, or Esc. The More tab is `.on` while one of its pages
  is shown.
- Keep the tab bar at five items. A new page goes into the More sheet.

### Floating add button

- `#addBtn` (`.fab`), bottom right on desktop, opens the transaction panel.
  Hidden where nothing can be added (admin pages, dashboard editing) and on
  phones, where the tab bar's + replaces it.

## Pages

- A page renders into `#view` (`.view`, centred, max `--page-max`, bottom
  padding clears the + / tab bar).
- Content sits in **panels**: `section.panel` (white, 1px `--line` border,
  10px radius, 18px padding). The heading row is `.panelhead`: an `h3` on the
  left, the panel's small buttons on the right.
- **Lists of records** use `table(headers, rows)` / `row(cells)`. On phones
  tables become one card per row with each cell labelled from `data-label`,
  so give every cell a short label.
- **Cards** (`.tcard`, `.acard` …) are for things scanned at a glance (budgets,
  money boxes, accounts); each card is a button that opens its details.
- **Empty states**: `.empty`, one short sentence; add how to create the first
  item only when it is not obvious.
- **Settings-style pages** (Settings, My account, Server): `.settings` with a
  sticky section list (`.snav`, desktop only) and `.scard` cards of
  `.srow` rows, label (`.sl`) left, control right; one column on phones.
- **Dashboard**: widgets in `.dashgrid`, full or half width, user-arranged
  through Customize dashboard. A new widget must work at both widths.

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
| `confirm()` | browser | one-line yes/no before deleting | — |

### Transaction panel

- Centred (`.drawer` keeps its old name): up to 680px wide, 12px clear of the
  screen edges, scrolls inside itself, 14px radius.
- Order: title row, quick picks (add only), type selector (`.seg`), fields,
  then the save row.
- **Save row** (`.saverow`): the full-width primary button and an icon-only ⋯
  button (`#fMoreBtn`, `aria-label` "More actions") that opens `.actmenu`
  upwards. Secondary or destructive actions (Save as template, Delete) go in
  that menu, never as extra buttons under Save.
- Quick picks (`.quickpicks`) are an even grid of `.qpick` buttons
  (name, then amount · account), long names cut with an ellipsis.

### Dialog

- Build the body with `dialogForm(fields, submitLabel, extra)` and
  `field(label, control, cls)`. On desktop the form is two columns; give
  long fields the `wide` class. Secondary buttons go in `extra`
  (`.formactions`) above the full-width submit button.
- Groups of toggles (category chips) use a `div.drawerfield` with a heading
  span, not a `label`, so clicking the heading toggles nothing.

## Toast

- `msg(text)` after every successful change ("Saved.", "Account added.");
  `errMsg(err)` or `msg(text, "error")` for failures.
- Bottom centre, dark (`--side`), one line, above the tab bar on phones.
  Success: `role="status"`, 3 s. Error: red, `role="alert"`, 7 s, click to
  dismiss. A new toast replaces the old one.
- Phrase it as the result, short, ending with a full stop.

## Controls

| Control | Class | Use |
|---|---|---|
| Primary button | `.primarybtn` (`.big`: full width) | the one main action of a form or panel |
| Small button | `.smallbtn` (`.danger`) | panel-header and secondary actions |
| Outline button | `.ghostbtn` | a secondary action next to a primary one |
| Icon button | `.iconbtn`, `.morebtn` | ✕, bell, ⋯; always with `aria-label` |
| Segmented choice | `.seg` with `button.on` | one of a few modes (type, period) |
| Toggle chips | `.tagpick` buttons with `aria-pressed` | many-of-many (categories) |
| Status chip | `.chip` (`.due`, `.cur`) | a small state or value inside a row |
| Bar | `.bar` + `i` fill | progress; purple normal, amber `warn`, red `over` |

- Labels sit above their field (`label > span + control`).
- Disabled controls use `disabled` (shown at .35 opacity), not hiding, when
  the user should know the action exists.
- Hide with the `hidden` attribute; `[hidden]` is `display:none !important`.

## Formatting

- Amounts: `fmt(minor, currency)` for display, `decimal(minor, currency)` for
  form values, `toMinor(text, currency)` back. Never floats for money.
- Negative is shown with a minus; income in `--pos` where direction matters.
- Dates the user thinks in: `dayLabel(iso)`; periods: `periodLabel()`.

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
- Touch targets are at least 40px on phones; respect
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

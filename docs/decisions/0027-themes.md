<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0027 — Themes: colour tokens, four built-in themes, light and dark

Date: 2026-11-24
Status: accepted (issue #85); tokens and built-in themes in #100, the theme editor and sync after it

## Context

The web UI had one light appearance and no dark mode (#85). Its colours were
partly CSS custom properties and partly literals (`#fff` for most surfaces,
shadows, the planned-row amber, row icons, the reserve chart in `app.js`), so
no theme could reach every colour. #66 added a spending colour (`--neg`) and
reused `--pos` (good) for income, and the issue asks that users can set those
two colours.

## Decision

- **Every colour is a theme token.** `web/style.css` starts with one block of
  tokens per theme and mode (`[data-theme=X]`, `[data-theme=X][data-mode=dark]`);
  no rule outside them names a colour, except a few fixed on purpose:
  avatar initials on the avatar's own colour, the white quiet zone of a QR
  code, a mask gradient, and the photo cropper's canvas over the photo.
  `docs/ui-guide.md` lists the tokens. Amounts have their own pair,
  `--amt-in` and `--amt-out` (replacing `--neg`), apart from the status colours
  `--pos` and `--red`. Form-control borders use `--fieldline`, which meets the
  3:1 of WCAG 1.4.11 against the field and the card in every theme.
- **Four built-in themes**, each with light and dark: Default (the original
  purple look), High contrast (navy on white; yellow on black), Warm
  (terracotta) and Cool (teal). `scripts/test-themes.js` checks that every
  theme sets every token and that text pairs meet WCAG AA (4.5:1) and controls
  3:1.
- **Mode:** follow the system (the default), light or dark.
- **The system can ask for more contrast.** When it prefers more contrast or
  forces its own colours, the page shows High contrast whatever theme was
  chosen, and Settings says so.
- **The choice is kept on the device**, not the account: `localStorage` of the
  server's origin (in the apps, one per saved server, which is accepted).
  `web/theme.js` runs in `<head>` after the stylesheet, so the page is drawn in
  its theme from the first frame. Storage that cannot be written keeps the
  choice for the open page and says so.
- **Signed out**, the sign-in screen is Default in the system's light or
  dark. The apps' own server screen and window frame (ADR 0019, 0026) belong
  to no account and do the same.
- **Settings → Appearance**, after Display: theme cards, each drawn in its own
  theme, the mode, and the spending and income display moved here from
  Display (it stays an account setting on the server).
- The browser's bar colour (`theme-color`) follows the theme's sidebar
  colour; the reserve chart colours are tokens; avatar colours stay fixed,
  since they are each user's chosen identity colour.

## Custom themes and the editor

- **A custom theme is a copy.** Settings → Appearance → *Duplicate as a custom
  theme* copies the selected theme (built-in or custom) into the editor, a
  Settings sub-page (`#theme?id=thm-…`). It is not kept until saved; a saved
  new theme becomes the selected one. A device keeps at most 20.
- **Main colours only.** The editor offers 14 main colours in groups
  (amounts, page, accent, sidebar, status). Every other colour (hover and soft
  fills, input borders, text on the accent, the sidebar's current page, status
  fills, row icons, toasts) is derived from them by `deriveTheme` in
  `web/theme.js` whenever one changes; the nightly chip, the cropper and the
  chart colours after the first stay as in the theme it was copied from. A
  derived input border is moved toward the text colour until it reaches 3:1.
- **The picker** is inline (a saturation/brightness square, a hue slider, a
  hex field), not the system's picker, so it is the same in every browser and
  app. Beside it, a plain contrast figure ("Contrast with cards: 6.4:1"):
  a fact, no warning, colour or verdict (ADR 0015).
- **A live preview** (a small sidebar, rows with income and spending, a
  budget bar, buttons) is drawn in the colours being edited; it stays in view
  beside the form and is pinned at the top on phones.
- **Light and dark.** A custom theme is light only until *Separate colours
  for light and dark* is turned on, which copies the light colours into dark
  to edit. Light only means light in either mode. Turning the split off when
  the dark colours differ from the light ones asks first, in a dialog with a
  Copy JSON button, since the dark colours are lost.
- **Theme JSON**: the editor shows the theme as JSON (`format:
  "kisiauthong-theme"`, `version: 1`, `name`, `basedOn`, `split`, and every
  colour in `light` and `dark`). Copy JSON copies it; *Apply pasted JSON* reads
  one: missing colours are filled from its `basedOn` theme, keys a theme does
  not have are ignored and named in a notice, and anything but a hex colour is
  refused with the key named. A pasted theme is applied to the editor, saved
  only with Save.

## Sync

- **Local first.** The selected theme, the custom themes and the mode are
  kept in the browser's storage for the server's origin. Sync is off until
  the user turns it on, per device, with two separate checkboxes in Settings →
  Sync (issue #104): *Sync themes across devices* (跨裝置主題同步) and *Sync
  theme selection* (主題選擇同步). An (i) button after each label opens a short
  explanation of the rules below in plain words. The mode is never synced.
- **Storage on the server** is the settings object: `general.theme
  {selected}` (a built-in name or a custom id) and `themes[]` (id, name,
  basedOn, split, light, dark, updatedAt). The server checks the shape: at most
  20 themes, ids `thm-` and 6-32 lower-case letters or digits, names 1-60
  characters, a built-in `basedOn`, an RFC 3339 `updatedAt`, at most 100
  colours per mode, hex only (`#rgb` is stored as `#rrggbb`), dark only with
  split. A `themes` PUT replaces the list; devices merge before they send it.
  `api/openapi.yaml` describes it.
- **Sync themes across devices** (the custom themes): the device's and the server's lists are merged by
  id, the newer `updatedAt` winning, on turning it on (the first sync) and
  whenever either side changes. A theme deleted on the device is deleted on
  the server too, and on every other device that syncs its custom themes: a
  device remembers which themes the server had at its last sync, and one of
  those the server no longer has is deleted there as well (a delete wins over
  an edit, as everywhere in sync). A saved theme with a colour missing (from
  before a colour was added) gets it from its base theme instead of being
  dropped. Turning it off keeps the copies on the server; turning it on again
  is a fresh merge.
- **Sync theme selection**: its own choice. Turning it on, or picking a
  theme while it is on, sends this device's choice; with nothing chosen here
  since the last sync, the server's choice (another device's) is taken here
  instead. A custom theme that is selected goes up with the choice even when
  custom themes are not synced, so every other device can draw it, and a
  device that takes such a choice keeps the theme. When the server did not
  have the theme, a notice says it was uploaded so other devices can use it
  (a statement of what happened, no prompt or suggestion, ADR 0015).
- **States** under the checkboxes: kept on this device only (both off),
  syncing, synced at a time, or failed at a time with the error and Retry; a
  failed change stays on the device and goes up on the next sync.
- **Settings → Sync** is its own section, after Appearance (issue #104; it
  first sat under Appearance). Besides the theme choices it shows what the
  page already knows of its link to the server: live updates (on, connecting,
  offline, or not available in this browser, from the ADR 0023 stream) and
  when the books were last fetched. It adds no new kind of sync.
- Another device's changes arrive with the settings on every load and live
  update (ADR 0023); the device sends only when it has something the server
  lacks.

## Sign-in screen

- Signing out leaves a flag on the device, so a reload of the sign-in screen
  is Default from the first frame instead of the device's theme for a moment
  (issue #101). Signing in clears it.

## Consequences

- A new colour in the UI needs a token in all eight blocks; the test fails
  otherwise, and fails on a literal colour in a rule.
- The apps' server screen repeats Default's light and dark blocks;
  `scripts/test-app.js` checks they match `web/style.css`.
- Users of the same browser share its theme and custom themes (they are the
  browser's, not the account's), and each user's sync choices on it.

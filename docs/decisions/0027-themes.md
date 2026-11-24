<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0027 — Themes: colour tokens, four built-in themes, light and dark

Date: 2026-11-24
Status: accepted (issue #85); the first part lands now, the theme editor and sync follow

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

## Later (the theme editor)

- **Custom themes**: duplicate a built-in theme and edit its main colours
  (grouped swatches, an inline picker with a neutral contrast figure and no
  warnings, ADR 0015, a live preview, pinned on phones); hover, soft and other
  derived colours are computed. A light/dark split is off by default; turning
  it on copies light into dark; turning it off after edits warns in a dialog
  with a Copy JSON button.
- **Theme JSON** holds the full token set with `format` and `version`; a pasted
  theme fills missing keys from its `basedOn` theme, ignores unknown keys with a
  notice, and accepts hex colours only.
- **Sync is opt-in, with two separate choices.** Both are stored in the
  settings object (`general.theme {selected}` and `themes[]`, with validation
  limits); the mode stays per device either way.
  - *Sync custom themes*: the custom themes go to the server and are merged by
    id, the newer `updatedAt` winning. Turning it off keeps the copies already
    on the server.
  - *Sync the selected theme*: its own toggle, chosen independently. When it is
    on, the selected theme is stored as `general.theme.selected`, and a custom
    theme that is selected is uploaded to `themes[]` as well, even while custom
    themes are not synced, so every other device can resolve it. Selecting a
    theme the server does not have yet shows a plain notice that it will be
    uploaded so other devices can use it (a statement of what happens, no
    prompt or suggestion, ADR 0015).

## Consequences

- A new colour in the UI needs a token in all eight blocks; the test fails
  otherwise, and fails on a literal colour in a rule.
- The apps' server screen repeats Default's light and dark blocks;
  `scripts/test-app.js` checks they match `web/style.css`.
- Users of the same browser share its theme until sync arrives.

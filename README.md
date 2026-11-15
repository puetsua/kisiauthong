<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 記數通 KiSiauThong

Self-hosted personal bookkeeping: budgets (monthly by default, or daily, weekly, every N weeks or months, yearly, or a fixed date range), billing cycles for memberships and bills, bank and wallet balances, multi-currency wallets (e.g. JPY beside TWD), credit card usage, and money boxes for future plans such as travel.

Platforms: web server (self-hosted), desktop (Windows, Linux, macOS), and Android.

- Portal: open `.docs/index.html` in a browser (local-only, not committed)
- Use cases: open `.docs/use-cases.html` in a browser (local-only, not committed)
- Contributor and agent guidance: see `agents.md`

## Run the web app

```powershell
cd server
go run .          # http://127.0.0.1:8080  (SQLite at ../data/kisiauthong.db, seeded on first run)
go test ./...     # domain tests
node ../scripts/check-i18n.js   # every UI string translated
```

Data lives in `data/kisiauthong.db` (SQLite; `data/` is gitignored). Override with `KISIAUTHONG_DB`, port with `PORT`. The server listens on `127.0.0.1` only (there is no login yet); set `KISIAUTHONG_HOST=0.0.0.0` to reach it from other devices or a container, and only on a network you trust. Passkeys need a host name, so open the app as `http://localhost:8080` (not `127.0.0.1`) or by its domain; behind a proxy set `KISIAUTHONG_ORIGIN` (e.g. `https://books.example.org`). Set `KISIAUTHONG_SOURCE_URL` to the source repository of the code you run; it is shown under Settings → About (AGPL §13). Desktop and Android clients are future plans.

Several people can use one server, each with private books. On first visit the app asks for a username and password: on a new install that creates the first user (an administrator) with sample data; on a database from before users existed it claims the existing books. Sign out and My account (profile, password, two-step verification with an authenticator app and recovery codes, passkeys, a photo or colour for the avatar, API keys for scripts and agents with chosen permissions and expiry; administrators also add, reset and remove users) are under the avatar. An API key is sent as `Authorization: Bearer kst_…` (see `docs/decisions/0008-api-keys-and-mcp.md`) at the top right (see `docs/decisions/0007-users-and-sign-in.md`).

Every money movement is a transfer between accounts. Spending is a transfer to an *external* account and income a transfer from one: the built-in "External" account by default, or one you add (an employer, a shop) under Accounts → External accounts. The add-transaction form keeps simple Expense / Income tabs for this (see `docs/decisions/0002-external-accounts.md`).

Tags are categories and money boxes. Give a category a limit to make it a budget; the Tags page shows budgets, categories and money boxes as cards (see `docs/decisions/0004-tag-kinds-and-budget-periods.md`).

Settings (sidebar → Settings): language (English or 繁體中文（台灣）, default follows the browser), page width (default, wide or full width), number format (1,074,958, groups of four 107,4958, or plain 1074958), time zone (Auto follows the device, or a fixed zone), how many of the newest days the transaction list shows expanded (default 7; each day collapses; the list pages by week, month or a custom range of up to 180 days), default currency and a short list of frequently used currencies (e.g. USD, TWD, JPY) shown first in currency pickers, with every ISO 4217 currency still available below them; dashboard layout (Dashboard → Customize edits the dashboard in place: add widgets from the side pane — any widget can be added more than once, e.g. one Accounts widget per group of accounts — drag or ↑ ↓ to reorder, remove, and set each widget's width, title, row count, columns (show, hide and reorder for the Budgets, Spending and Accounts tables) and which accounts / budgets / money boxes / currencies it shows; works with touch), JSON export of all data (`GET /api/export`), and About.

## License

GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`). See `LICENSE`. If you run a modified version as a network service, AGPL §13 requires you to offer its source to users of that service.

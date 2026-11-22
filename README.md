<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 記數通 KiSiauThong

Self-hosted personal bookkeeping: budgets (monthly by default, or daily, weekly, every N weeks or months, yearly, or a fixed date range), billing cycles for memberships and bills, bank and wallet balances, multi-currency wallets (e.g. JPY beside TWD), credit card usage, reserves that set money aside for future plans such as travel, and shortcuts that fill in everyday entries such as breakfast in one tap. The eye in the header hides every amount on screen for privacy in public places; tap a hidden amount to peek at it.

Platforms: web server (self-hosted), and apps for macOS, Windows, iOS and Android (Tauri 2) that open the web UI of your own server; Linux later.

- Portal: open `.docs/index.html` in a browser (local-only, not committed)
- Use cases: open `.docs/use-cases.html` in a browser (local-only, not committed)
- Contributor and agent guidance: see `AGENTS.md`

## Install

**Docker** (Linux amd64, arm64 and armv7):

```sh
docker run -d --name kisiauthong -p 127.0.0.1:8080:8080 -v kisiauthong-data:/data ghcr.io/puetsua/kisiauthong:latest
```

or `docker compose -f deploy/docker-compose.yml up -d`. Your books live in the `kisiauthong-data` volume. Give the container at least 256 MB of memory: each sign-in hashes the password with Argon2id using 64 MiB (with a limit, also set `GOMEMLIMIT`, e.g. `200MiB`).

**Download**: each [release](https://github.com/puetsua/kisiauthong/releases) has one archive per system (Windows, macOS, Linux; Intel/AMD and ARM). Unpack it and run `kisiauthong` (`kisiauthong.exe` on Windows): it is a single file with the web UI built in and keeps its data in `data/` under the folder you start it from. `kisiauthong version` prints the version; Settings → About shows it with the commit and build time, and the sidebar shows it under the licence line.

Then open http://localhost:8080 and create the first user, who is the administrator. Settings are environment variables, listed in `.env.example`. To reach it from other devices, put it behind an HTTPS reverse proxy and set `KISIAUTHONG_ORIGIN`; to share a host name with other apps, set `KISIAUTHONG_BASE_PATH` (e.g. `/kisiauthong`) and proxy that path unchanged.

## Develop

```powershell
cd server
go run .          # http://127.0.0.1:8080  (SQLite at ../data/kisiauthong.db)
go test ./...     # domain tests
node ../scripts/check-i18n.js   # every UI string translated
```

Data lives in `data/kisiauthong.db` (SQLite; `data/` is gitignored). Override with `KISIAUTHONG_DB`, port with `PORT`. The server listens on `127.0.0.1` only; set `KISIAUTHONG_HOST=0.0.0.0` to reach it from other devices or a container, ideally behind HTTPS. Passkeys need a host name, so open the app as `http://localhost:8080` (not `127.0.0.1`) or by its domain; behind a proxy set `KISIAUTHONG_ORIGIN` (e.g. `https://books.example.org`). Settings → About links to the source (AGPL §13): this repository by default; if you run a modified version, set `KISIAUTHONG_SOURCE_URL` to yours. `KISIAUTHONG_TZ` (an IANA zone such as `Asia/Taipei`) sets the server's "today" for users whose time zone setting is Auto; without it the server's own zone is used (UTC in most containers).

Open pages stay current: when anything changes the books (another device or tab, the API, an assistant over MCP, template generation), every open page of that user fetches them again within a moment, without a reload, and waits while a form is being filled in (`GET /api/events`, Server-Sent Events; see `docs/decisions/0023-live-updates.md`).

Several people can use one server, each with private books. On first visit the app asks for a username and password: on a new install that creates the first user (an administrator) with an empty book; on a database from before users existed it claims the existing books. Sign out and My account (profile, password, two-step verification with an authenticator app and recovery codes, passkeys, a photo or colour for the avatar, API keys for scripts and agents with chosen permissions and expiry) are under the avatar at the top right; administrators also get an Administration area, entered from the foot of the sidebar, to add, reset and remove users and see how the server is doing (see `docs/decisions/0007-users-and-sign-in.md`).

An API key is sent as `Authorization: Bearer kst_…` to the REST API, or used by an AI agent through MCP at `/mcp` (Streamable HTTP), where it gets tools to list accounts, categories, budgets, reserves, allocations, transactions and spending, and, if the key allows, to add, change and delete transactions, create accounts, tags and reserves, merge tags, put money into or take it out of reserves, and generate due recurring transactions. For Claude Code:

```sh
claude mcp add --transport http kisiauthong http://localhost:8080/mcp --header "Authorization: Bearer kst_…"
```

See `docs/decisions/0008-api-keys-and-mcp.md`.

Every money movement is a transfer between accounts. Spending is a transfer to an *external* account and income a transfer from one: the built-in "External" account by default, or one you add (an employer, a shop) under Accounts → External accounts. The add-transaction form keeps simple Expense / Income tabs for this (see `docs/decisions/0002-external-accounts.md`). In the form, the button next to Time (an arrow around clock hands) fills in the current date, time and time zone of your device, for a new or an existing transaction; it does not save.

Tags are categories. Give a category a limit to make it a budget; the Tags page shows budgets and categories as cards (a budget for a fixed date range moves, once its last day has passed, into an Ended section below the running budgets, closed until you open it; the Budgets dashboard widget does the same, and each browser remembers whether you left it open), the categories with their net amount per currency (what came in minus what went out, as budgets count it) today, this week, month or year; with several currencies the default currency is the large figure and the others are listed smaller below it, never converted (see `docs/decisions/0004-tag-kinds-and-budget-periods.md`). Each category or budget has its own page: all-time totals, its note when it has one, and its transactions by day, week, month or year. A transaction can have several categories, and counts in full toward each of their budgets (see `docs/decisions/0010-several-categories-per-transaction.md`). A budget counts net spending: income with the same category, such as a refund or a friend paying back their share, takes it off, so spent can go below zero; the Spending widget still shows spending only (see `docs/decisions/0021-budgets-net-tagged-income.md`). Tags → Manage tags combines tags you pick into one: their transactions, templates and dashboard widgets move to the tag you keep (which keeps its own note; the merged tags' notes go with them), and an Undo toast takes it back (`POST /api/tags/{id}/merge` with `dryRun` to preview, `POST /api/tag-merges/{id}/undo`; see `docs/decisions/0017-tag-merge-and-undo.md`).

Reserves (預留款) set money aside for a purpose, such as a trip or a house fund, with an optional target and date. Putting money in or taking it out is an allocation on the reserve, not a transaction: it moves no money, and an account shows how much of its balance is reserved and how much is free (with a warning when it reserves more than it holds). Each reserve has its own page with Put in and Take out (whose Fill remaining fills in all the reserve holds in the chosen account), and its allocations by day, week, month or year. A template can put money in every month (see `docs/decisions/0013-reserves-and-allocations.md`).

A transaction dated after today is *scheduled*: it is not in balances, budgets or reports until its date, and posts by itself on that date (nothing to confirm, nothing runs in the background). Until then, spending and transfers out of an own account hold their amount, so the account's free amount is its balance minus what is reserved minus what is held; income only shows as scheduled incoming. Account cards show the held amount as a blue segment with one Scheduled total, the dashboard lists free / reserved / scheduled, and Transactions folds the scheduled rows into one line ("7 scheduled") that opens in place. Accounts and tags (categories and budgets) can have a free-text note for your own records, such as the last digits of an account or what a category includes: set it in their form (up to 4000 characters, like a transaction note); it shows on the account or tag page, never in the lists. Tap an account to open its page: its card, its note when it has one, then every scheduled row that touches it, soonest first, with its post date and an amount signed from that account (− leaving, + arriving), then its transactions by day, week, month or year; Edit there opens the account form (external accounts open the form directly). Post now in the form moves a scheduled transaction's date to today. Existing future-dated transactions start holding when you upgrade. "Today" is the date in your Settings time zone; with Auto, the server uses `KISIAUTHONG_TZ` (e.g. `Asia/Taipei`), else its own zone (see `docs/decisions/0014-scheduled-holds.md`).

Settings (sidebar → Settings): language (English or 繁體中文（台灣）, default follows the browser), page width (default, wide or full width), number format (1,074,958, groups of four 107 4958 split by a no-break space, or plain 1074958), time zone (Auto follows the device, or a fixed zone), how many of the newest days the transaction list shows expanded (default 7; each day collapses; the list pages by week, month or a custom range of up to 180 days), default currency and a short list of frequently used currencies (e.g. USD, TWD, JPY) shown first in currency pickers, with every ISO 4217 currency still available below them; dashboard layout (Dashboard → Customize edits the dashboard in place: add widgets from the side pane — any widget can be added more than once, e.g. one Accounts widget per group of accounts — drag or ↑ ↓ to reorder, remove, and set each widget's width, title, row count, columns (show, hide and reorder for the Budgets, Spending and Accounts tables) and which accounts / budgets / reserves / currencies it shows; with spending in two or more currencies, the Spending widget shows one currency at a time behind currency tabs and remembers the last one picked on that device; on phones each widget shrinks to a bar with ↑ ↓ ⚙ ✕, ⚙ opens its settings right under it, and "+ widget" buttons below the last one add more, with no dragging), JSON export of all data (`GET /api/export`), and About.

### Releases and checks

GitHub Actions run the tests (`ci.yml`) and vulnerability scans (`security.yml`: govulncheck, Trivy on the repository and the image, CodeQL) on every push and weekly. Pushing a version tag such as `0.1.0` (no `v`; `0.2.0-beta.1` for a pre-release) runs `release.yml`: tests, the downloads built by `scripts/build-release.sh`, the multi-platform image on `ghcr.io/puetsua/kisiauthong`, and the GitHub release. `app.yml` builds the macOS app and `android.yml` an installable Android APK (a workflow artifact; signed with the release key from the secrets when they are set, otherwise with a throwaway key) for changes to `apps/tauri`; see `apps/tauri/README.md`.

## Apps

`apps/tauri/` holds one Tauri 2 project for macOS, Windows, iOS and Android. The first version is online-only: on first start it asks for your server's address (for example `https://example.com/kisiauthong/`; `https://` is added when you leave out the scheme), checks that a KiSiauThong server answers there, and then shows that server's own web UI and sign-in. Unencrypted `http://` is allowed only on your own network (such as `192.168.x.x`, a `.local` name or a Tailscale `100.x.y.z` address). Inside the app, Settings → Servers (just above About) lists the saved servers: switch, edit, remove, or add one. Links that leave your server open in the system browser. Each release has the Windows setup `.exe`, the macOS `.dmg` and the Android `.apk`. Settings → About shows the app's version. On Windows, macOS and Android the app asks GitHub for a newer release each time it opens (a switch on the App updates screen turns this off) and says so in Settings → About, nowhere else; Check for updates installs it when you ask. That is the only request the app makes beyond your server, and it carries nothing about you or your server (see `docs/decisions/0020-app-updates.md`, `0024-desktop-apps-and-updates.md` and `0025-update-check-at-launch.md`). The desktop apps are not code-signed yet, so Windows SmartScreen and macOS warn on the first install. Passkeys do not work inside the app (sign in with your password); offline use comes later. Build steps, including iOS and Android, are in `apps/tauri/README.md`; see `docs/decisions/0019-tauri-apps-load-the-server.md`.

## License

GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`). See `LICENSE`. If you run a modified version as a network service, AGPL §13 requires you to offer its source to users of that service.

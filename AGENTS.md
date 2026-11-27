# AGENTS.md — kisiauthong

Guidance for AI agents and human contributors working in this repository. Read this file before making changes. If instructions here conflict with a direct user request, the user request wins.

## License

This project is licensed under the **GNU Affero General Public License v3.0 or later** (`AGPL-3.0-or-later`). The full verbatim text is in `LICENSE` at the repository root — do not edit it. Implications agents must respect:

- Source files you add should carry an SPDX header where the language supports it: `SPDX-License-Identifier: AGPL-3.0-or-later` (plus a copyright line for the project).
- Anyone who modifies this software and runs it as a network service (the web server is exactly that) must offer the modified source to its users (AGPL §13). Keep the source-offer / license notice visible in the web UI (e.g. footer / About page linking to the source repository and license).
- Dependencies must be license-compatible with AGPL-3.0-or-later. Do not add dependencies under licenses incompatible with the AGPL (e.g. proprietary, SSPL, or Commons Clause) without explicit user approval recorded in an ADR.
- Do not relicense, add a second license, or strip copyright/license notices.

## 1. What this project is

**kisiauthong** (記數通, *KiSiauThong*; repo/package name `kisiauthong`) is a self-hostable personal bookkeeping / personal-finance application.

Users record and organise their own financial life:

- income, expenses, and transfers between accounts
- accounts: cash, bank, credit card, e-wallet, savings, investment, debt/loan
- categories and tags for transactions
- budgets (per category / per account / overall, monthly or custom period)
- recurring transactions (salary, rent, subscriptions, bills)
- reports: cash-flow, spending by category, balance over time, budget vs. actual
- search, filters, attachments (receipts), and data export/import

It is **single-user-first, multi-user-ready**: the data model always carries an owner (`user_id`), but no social / shared-ledger features are required for v1.

### Platforms (all first-class, none is a port of another)

| Platform | Deliverable | Notes |
|---|---|---|
| Web server | Self-hosted server + web UI, Docker image | **Current phase (see `docs/decisions/0001-web-first.md`)**; the canonical deployment, other clients will sync against it |
| Desktop | macOS and Windows app (Tauri 2, `apps/tauri/`) | **First version (ADR 0019)**: online-only, opens the web UI of the user's own server; the release workflow builds the Windows setup `.exe` and macOS `.dmg` with signed updates (ADR 0024); Linux later |
| Mobile | iOS and Android app (the same Tauri 2 project) | **First version scripted (ADR 0019)**, same shell as desktop; builds need Xcode / the Android SDK; the release workflow builds and signs the Android APK (ADR 0020), iOS is not in CI yet |

### Non-goals (v1)

- Bank auto-sync / open-banking aggregation, payment processing, trading
- Multi-currency FX trading (multi-currency *recording* is in scope, see §6)
- Tax filing, invoicing for businesses, double-entry accounting for companies (personal double-sided transfers are still modelled correctly)
- Split transactions (one bank line split into legs with separate categories/accounts) — would require nested legs inside Transaction; deferred, representable today only as separate Transactions losing atomicity, see `.docs/four-elements-ezbookkeeping-firefly.md`
- Event-driven rule engine (`trigger → action` on Transaction create/import, Firefly-style) and webhooks — TransactionTemplate is time-driven only; a Rule would be a sixth element, deferred

## 2. Architecture

Target: offline-first, server-authoritative sync. Every client works fully offline against a local database and syncs changes to the server when reachable. **The first app version is not there yet** (ADR 0019): the Tauri apps are online-only and load the web UI from the user's server; offline use and sync come with their own ADR. Do not design new features that would make that later step harder (keep domain rules on the server and in shared code, not in the web UI only).

```text
                ┌─────────────┐
   Web UI ─────▶│             │
 Desktop ──────▶│  Server API │──── PostgreSQL (hosted) / SQLite (small self-host)
 Mobile  ──────▶│             │
                └─────────────┘
        each client also has: local SQLite DB + sync engine
```

### Recommended stack (change only with a recorded decision in `docs/decisions/`)

| Layer | Choice | Why |
|---|---|---|
| Server | Go (stdlib `net/http` or chi), REST/JSON API | Single static binary, easy self-hosting, cross-compiles everywhere |
| Server DB | **SQLite first** (single file, pure-Go driver `modernc.org/sqlite`); PostgreSQL is the planned alternative | Keep SQL portable (no SQLite-only features in domain queries, repository-style store) so a Postgres adapter can be added; plain JSON is seed/import/export only, never the live store (JSONC deprecated) |
| Web UI | React + TypeScript + Vite | Shared components/types with desktop |
| Desktop + mobile | Tauri 2, one project (`apps/tauri/`) for macOS, Windows, iOS, Android (Linux later); first version loads the server's web UI (ADR 0019) | Small binaries, one UI (the web UI), cookies/base path/passkey host stay the server's; no Electron |
| Client DB | SQLite (Tauri SQL), when offline sync arrives — not in the first app version | Offline-first local store on every client |
| Shared code | TypeScript package `@kisiauthong/core`: domain types, validation, money math, sync protocol | One implementation of the rules that matter (money, budgets) |
| API contract | OpenAPI spec in `api/openapi.yaml`, generated TS/Go types | Contract-first; clients never hand-write diverging DTOs |
| Money | Integer minor units (cents) + ISO 4217 currency code, never `float` | No floating-point money anywhere |

Alternatives already considered: Flutter (rejected: splits language from web), Electron (rejected: size), and React Native (Expo) for Android (the earlier plan; replaced for the first version by the Tauri project, ADR 0019). If you propose changing the stack, write an ADR first — do not silently re-scaffold.

### Repository layout (create directories as features land, do not pre-create empty trees)

```text
kisiauthong/
  agents.md                  # this file
  .docs/                     # local-only (gitignored): static HTML portal (index.html) + use-case page (use-cases.html); open from disk, no build step
  README.md                  # user-facing: what it is, how to self-host
  docs/
    decisions/               # ADRs: NNNN-short-title.md
    sync-protocol.md         # sync semantics (see §7)
  api/
    openapi.yaml             # single source of truth for the HTTP API
  server/                    # Go server (cmd/, internal/, migrations/)
  web/                       # React web UI (also embedded/served by server in release builds)
  apps/tauri/                # Tauri 2 apps for macOS, Windows, iOS, Android (ADR 0019)
  packages/
    core/                    # shared TS: domain types, money, validation, budget math
    api-client/              # generated + hand-written API/sync client
  deploy/
    Dockerfile               # server + web UI in one image
    docker-compose.yml       # server + PostgreSQL example
  scripts/                   # build/release helpers
```

Keep platform code in its own app folder. Only genuinely platform-independent logic goes in `packages/`. The Tauri apps ship no copy of the web UI: they load it from the server, plus their own small server screen (ADR 0019).

## 3. Domain model (core entities)

The stored kernel is exactly five elements — **Account, Transaction, Tag, TransactionTemplate, Reserve** (with its Allocations) — the first four confirmed against ezBookkeeping and Firefly III use cases in `.docs/four-elements-ezbookkeeping-firefly.md` (local note), Reserve added by ADR 0013. Everything else (Category, Budget, credit card, billing cycle) is a view or a field on those, not an element. Defined once in `packages/core` and mirrored in server migrations. Field-level detail lives in the OpenAPI spec and migrations, but these rules are invariant:

- **User** — `id`, email/login, password hash (server only), display currency default.
- **Account** — `id`, `user_id`, name, `kind` (`own|external`), `icon` (a display choice, no behaviour — own accounts have no type, ADR 0005), currency, opening balance, optional `limit_minor`, archived flag, `memo` (the user's own free-text note, up to 4000 characters; shown on the account page, never in lists). Balances are *derived* from transactions, never stored as a mutable number (a cached balance must be recomputable). An **`external`** account is a place outside the user's books (employer, shop, "the world"): no currency, no opening balance, no balance of its own, never shown in balances or totals. The system account `acc-external` ("External") is the anonymous one; users may add named external accounts (ADR 0002).
- **No CreditCard entity (minimal-modules rule).** A credit card is decomposed, not modelled: (a) an own `Account` whose balance runs negative, with an optional `limit_minor` (the same field serves a loan) and `statement_close_day?`, `payment_due_day?`; there is no account type, all behaviour comes from those fields (ADR 0005); (b) a shared `Cycle` date utility (monthly period anchored on a day-of-month) reused by Budget periods, TransactionTemplate schedules, and statement cycles — same date math, different semantics, one implementation in `packages/core`; (c) ordinary transactions: purchases are spending from the card (card → external), payment is a bank → card transfer, interest/fees are spending, cashback is income (external → card). Derived, never stored: amount owed = `max(0, -balance)`, utilisation = owed ÷ limit, current-cycle usage = net transactions in `(last close, next close]`, statement amount due = balance as of the close date (keep this distinct from the current balance, which includes post-close spending). The limit is a warning threshold, not a hard block on recording — the purchase already happened at the till. Minimum-payment and interest computation are out of scope for v1; interest appears when the user records the charged transaction.
- **Transaction** — only a money movement (ADR 0013): `id` (UUID, client-generated for offline creation), `user_id`, a type derived from its two accounts and never stored (ADR 0029: own → external `expense`, external → own `income`, own → own `transfer`; external → external is rejected), amount in positive integer minor units (direction comes from the accounts), currency (from the user's own side), `tag_ids` (zero or more categories, via TransactionTag links — ADR 0010), `note` (short title shown in lists), `memo` (free-text note, up to 4000 characters), `transaction_date`, `created_at/updated_at/deleted_at` (soft delete for sync), attachment refs. Every money movement is a **transfer**: one record with `from_account_id` / `to_account_id`, at least one of them the user's own. **Spending** (expense) is own → external, **income** is external → own; these are derived labels, not stored types (the API accepts `expense`/`income` as shorthands and stores transfers). Between two own accounts the currency must match — converting currency is spending in one currency and income in the other; there are no FX transfers. Spending reports count own → external transfers; budgets count them minus external → own transfers carrying the same tag (refunds, shared costs paid back — ADR 0021), plus own → own transfers carrying it only when the budget's `countTransfers` is on (off by default; the spending report then counts them under that tag too — ADR 0029). Setting money aside is not a transaction: it is an Allocation of a Reserve (below).
- **Category and Budget are not elements** — both are folded into Tag (see Tag below): a category is a Tag, and a budget is that Tag's `limit_minor` + `currency` + period (`cycle` `daily|weekly|monthly|yearly|range`, `cycle_every` N, `cycle_start` anchor, `cycle_end` for a fixed range — ADR 0004; monthly by default, month-end clamped). Budget progress is computed from tagged Transactions in the budget's currency in the current period — spending minus tagged income, not floored at 0 (ADR 0021) — never stored; a Transaction in another currency carries the tag only as a label (ADR 0011). Changing a limit changes future periods; rewriting past reports by editing a limit is a known strain (effective-dated limit history) deferred until a real case needs it.
- **TransactionTemplate (generator)** — a first-class element beside Account, Transaction and Tag: a template + schedule that *generates* Transactions, so nothing recurs by hand. `id`, `user_id`, `name`, `enabled`, template fields copied onto each generated record (`account_id`/`from_account_id`/`to_account_id`, `type` — a transaction, or `allocate` for an **allocation template** with `reserve_id` that generates Allocations for automatic saving, `amount_minor`, `currency`, `tag_ids?`, note, and optional `expected_range_minor: {min, max}` for variable bills such as utilities: expectation metadata only for forecast/matching/anomaly checks, never stored on a Transaction and never used as its amount — the generated Transaction always uses the fixed `amount_minor`, is confirmed with the amount editable before posting, and a Transaction only ever has one fixed amount), and `schedule`: `frequency` (`daily|weekly|monthly|quarterly|yearly`, or `never` for a shortcut that only fills in the add form and generates nothing — ADR 0012; a shortcut's `amount_minor` may be 0 (none) for an amount that differs every time, and using it leaves the add form's amount empty, while a template that repeats always needs a positive one, issue #121), `interval` (every N), `day_of_month?`/`weekday?`, `start_date`, `end_date?`, `max_occurrences?`. This one element covers billing cycles for memberships and bills, salary, and automatic saving into reserves; the old names RecurringRule/BillingCycle are retired in its favour. Semantics: (1) an occurrence is identified by (`transaction_template_id`, `occurrence_date`) and is generated at most once — re-running the generator, sync retries, and client/server both generating must never duplicate it (generated Transactions carry both fields); (2) before its date an occurrence is only a computed preview, after its date the generator materialises it as a `planned` Transaction, and it becomes `posted` when the real charge/income is confirmed or matched — the generator never silently posts money movements the user has not seen; an allocation template's occurrence is an Allocation, final at once because no cash moves; (3) editing a TransactionTemplate affects future occurrences only, never already-generated Transactions; pausing sets `enabled=false` and generates nothing while paused; (4) month-end schedules clamp (a monthly rule on the 31st fires on the last day of shorter months) and that clamp is computed by the shared `Cycle` date utility, tested at month boundaries.
- **Reserve (UI "Reserve" / 預留款, formerly money box)** — money set aside for a purpose, not a sub-account and never a money movement (ADR 0013): `id`, `user_id`, `name`, `currency`, optional `target_minor` and `target_date`. Its **Allocations** are its sub-records: `id`, `reserve_id`, `account_id` (an own account), signed `amount_minor` (+ puts money in, − takes it out, never 0), `currency` (the account's), `date`, optional `time`/`tz`, `note`, `memo`, `created_at`, and `transaction_template_id` + `occurrence_date` when an allocation template made it. Every decision to set money aside (or take it back) is a dated, noted Allocation the user can list on the reserve's page — that history is how the user knows what they decided, and when; undoing a decision is a new allocation, while editing or deleting one fixes a typo. One reserve may be split over several accounts (House fund across accounts A, B and C) and one account may serve several reserves. A complete worked example is in `examples/sample-data.json` (plain JSON; JSONC is deprecated — do not add comment parsing or a compatibility shim, derivation rules live in prose here and in the docs). Derived, never stored: a reserve's saved amount = Σ its allocations in the reserve's currency (in another currency an allocation is shown, never converted — ADR 0011); an account's reserved amount = Σ allocations on it, its free amount = balance − reserved − held, where held = Σ scheduled transactions leaving it (posted with a date after today; ADR 0014 — balances, budgets and reports count a transaction only once its date is today or earlier, in the user's zone). Invariant: per (reserve, account), Σ allocations ≥ 0. Reserving more than the balance, or spending below what is reserved, is allowed and shows a warning on the account. Spending never changes a reserve: Use on a reserve's page records a take-out and then a normal expense, two independent records. Deleting a reserve deletes its allocations and allocation templates.
- **Tag** — a category (ADR 0004, 0013: no kinds; `payee` became named external accounts, `goal` became Reserve): `id`, `user_id`, name, icon/color, `group` (optional; orders it in tag pickers, which show no headings; empty = Ungrouped; a label, not a parent — ADR 0028), `memo` (the user's own free-text note, up to 4000 characters; shown on the tag page, never in lists), plus optional `limit_minor` + `currency` + period fields that make it a budget. Tags are many-to-many with Transactions via TransactionTag links. System default categories are seeded per user as Tags and remain editable.
- **Attachment** — files stored server-side with metadata rows, referenced by id from Transactions, never embedded as blobs in sync payloads.
- **Sync metadata** on every syncable row: `updated_at` (server-assigned revision or Lamport/version counter per §7), `deleted_at` for tombstones.

All ids are UUIDs generated on the client so offline creation never needs the server. All timestamps are UTC ISO 8601 on the wire; dates the user thinks in (`transaction_date`) are plain `YYYY-MM-DD` in the user's timezone — never shift them through UTC conversion. A transaction may also carry `transaction_time` (`HH:MM`, local) with the IANA `tz` it was entered in; the server derives the UTC instant (`at`) from date + time + tz, clients show timed transactions in the display zone (Settings, or the device's when Auto), and budgets/reports keep using the stored local date (ADR 0006).

## 4. Money, dates, and numbers — hard rules

1. Money is **integer minor units + currency code** everywhere: DB, API, client. Display formatting is the only place a decimal point appears. Minor units follow each currency's ISO 4217 precision (JPY 0, USD 2, KWD 3). Display drops the decimals of currencies whose minor unit exists only on paper (TWD, HUF) unless an amount actually has a fraction; calculated figures (per-day amounts, averages, forecasts) always show full precision.
2. Never use floating point for money math, budget totals, or balances. Percentages for reports may use floats only at render time.
3. Multi-currency: each account has one currency; each transaction is in its account's currency. Cross-currency transfers record both amounts and the rate used. Reports convert with a stored/recorded rate or show per-currency subtotals — never silently invent an FX rate.
4. Sum/balance/budget logic lives in `packages/core` (clients) and is mirrored by server tests; if the two disagree, that is a bug, not a platform difference.

## 5. Server rules

- REST/JSON under `/api/v1/…`, described by `api/openapi.yaml`. Update the spec in the same change as the handler.
- Auth: password login issuing a revocable session/JWT access token + refresh token; passwords hashed with Argon2id or bcrypt. All endpoints except login/health require auth and must scope every query by the authenticated `user_id` — never trust a `user_id` from the request body.
- Validation on the server even though clients also validate; the server is the trust boundary.
- Migrations: numbered, append-only, never edit a merged migration. Must apply cleanly on an empty DB.
- Config via environment variables only (port, DB URL, data/attachment dir, session secret). No secrets in the repo; provide `.env.example` with fake values.
- `GET /healthz` for Docker/orchestrator checks. Structured logs, no transaction contents (amounts, notes, payees) in logs.
- The release server serves the built web UI as static files from the same process/port, so a self-hoster runs exactly one thing.

## 6. Client rules (desktop, mobile, web)

- **Offline-first** (target, after the online-only first version of ADR 0019): create/edit/delete works with no network; the UI never blocks on sync. Show a sync state (synced / pending / conflict / error) — never silently drop a failed sync. Local SQLite will then be the client's source of truth for rendering; the network layer only syncs.
- Tauri apps (`apps/tauri/`, ADR 0019): the window shows the server's web UI; the shell owns only the server screen, the App updates screen (Android ADR 0020, Windows and macOS ADR 0024), the desktop window frame (ADR 0026), the saved server list (`servers.json`) and the `kisiauthongApp` bridge, reachable from the bundled screen and saved server origins only. Target Windows 10+, macOS 12+ (Apple Silicon + Intel), iOS, Android 10+ (API 29+); Linux later. No platform-specific forks of business logic — platform differences live in the Tauri shell layer only. Unencrypted `http://` only on the local network. Check `apps/tauri/README.md` for what webviews cannot do (passkeys, `window.confirm()` on iOS, downloads on mobile); ask before destructive actions with `askConfirm` in `web/app.js`, never a bare `confirm()`.
- Web: evergreen browsers, responsive down to phone widths (the web UI may be the only UI a self-hoster's family uses on mobile browsers). Follow `docs/ui-guide.md` for layout, navigation, popups, toasts and controls, and update it when adding a pattern. Its Principles bind every design, including no nudging (ADR 0015): offer tools the user starts, never suggestions, "did you mean", highlighted duplicates or pre-selected groups.
- Accessibility and i18n from the start: all user-visible strings go through the i18n layer (English source strings; Traditional Chinese as used in Taiwan, `zh-TW`, is a first-class target — the project name 記數通 is Taiwanese Hokkien; web: `__()`/`N_()` from `web/i18n.js`, coverage checked by `node scripts/check-i18n.js`), no hardcoded currency/date formats.

## 7. Sync protocol

Document the implemented protocol in `docs/sync-protocol.md` and keep both in step. Minimum semantics:

- Push/pull by entity with per-entity revision cursors; clients send locally-changed rows (including tombstones), server returns rows changed since the client's cursor.
- Conflict policy: **last-writer-wins per row** using server revision order for v1, except deletes always win over edits of the same row. Any smarter merge needs an ADR. Conflicts must be detectable and logged on the client, never resolved by dropping data silently.
- Sync is idempotent: re-sending the same change (same UUID + revision) is a no-op. Retries after timeout must not duplicate transactions.
- Attachments sync separately (upload/download by id, content-hash checked), after the transaction rows that reference them.

## 8. Security & privacy

- This app holds a person's full financial life: treat all transaction data as sensitive. No analytics/telemetry by default; any future telemetry is opt-in and documented in the README.
- Passwords never leave the server in any form; tokens stored in OS secure storage on desktop/mobile (Keychain / Credential Manager / Android Keystore), `httpOnly` cookies or secure storage on web — never `localStorage` for refresh tokens if avoidable.
- Encrypt backups/exports at rest when the user sets a passphrase; warn clearly that a lost passphrase means lost data.
- Dependencies: pin versions, keep lockfiles committed, run the platform's audit tool in CI.

## 9. Development workflow

### Setup (once the code exists)

```powershell
# server
cd server; go run ./cmd/server        # reads env, see .env.example
# web / desktop UI
npm install                            # from repo root (workspaces)
npm run dev --workspace=web
# desktop and mobile apps (Tauri 2, ADR 0019)
cd apps/tauri; npm ci                  # requires Rust; iOS/Android: see apps/tauri/README.md
npx tauri build --debug --no-bundle --config src-tauri/tauri.dev.conf.json   # the dev build, not `npx tauri dev` (#115)
node scripts/test-app.js               # the app's server screen rules
# everything via Docker (server + web + Postgres)
docker compose -f deploy/docker-compose.yml up --build
```

### Conventions

- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`…), one logical change per commit. Do not commit, push, or tag unless the user asks.
- **Branches/PRs**: feature branches off the default branch; PR description states platform(s) affected and how it was tested.
- **Code style**: `gofmt` + `go vet` (server), ESLint + Prettier + `tsc --noEmit` (all TS). Formatting is enforced in CI, not debated in review.
- **Testing** (tests ship with the change, in the same commit):
  - `packages/core`: unit tests for money math, budget progress, recurring-date generation — boundary cases (month-end, leap year, zero/negative) required.
  - Server: handler tests incl. auth-scoping (user A cannot read user B's data), migration-up test, sync idempotency test.
  - Clients: at least a smoke test that the app renders and can create a transaction offline; sync tests against a local server where the platform allows. The online-only Tauri apps (ADR 0019): `node scripts/test-app.js`, `cargo test` in `apps/tauri/src-tauri`, and a build of each platform you touched. Run and install test builds on a developer's machine only as the **dev build** (`--config src-tauri/tauri.dev.conf.json`, its own identity and app data); a release-identity installer replaces the developer's installed app (#114).
  - Run the tests for every package you touched before declaring done; if a configured gate (lint/typecheck) exists, run that exact gate.
- **API changes**: edit `api/openapi.yaml`, regenerate clients, update server handler + clients + tests together. A breaking API change needs a new version path or an ADR.
- **Docs**: user-visible behaviour changes update `README.md`; architectural changes add an ADR in `docs/decisions/`.

### Definition of done for any change

1. Works offline on clients / on a fresh DB on the server, as applicable.
2. Tests for the touched area pass locally; new behaviour has new tests.
3. Money/date rules in §4 respected; no floats, no timezone-shifted dates.
4. OpenAPI spec, migrations, and i18n strings updated where relevant.
5. No secrets, real financial data, or personal data in code, tests, fixtures, or commits — test data is obviously fake.

## 10. Instructions for agents

- Start by reading this file, `README.md`, and any ADR touching your area. Check `git status` / open changes before editing; do not overwrite uncommitted user work.
- Keep changes scoped to the platform(s) the task names. A fix in shared logic belongs in `packages/core` (with tests), not copied into each app.
- Before proposing UI, read the Principles in `docs/ui-guide.md`; the app does not nudge or second-guess the user (ADR 0015). Version strings have no `v` prefix (`0.2.0`, ADR 0009); builds stamp version, commit, build time and channel (ADR 0018). The server and the apps share one version until offline sync gives the apps their own (ADR 0022).
- Prefer the existing stack and layout in §2. Creating a new app, swapping a framework, or changing the sync/conflict model requires an ADR and explicit user approval.
- Never invent a second money representation, date format, or DTO shape — reuse `packages/core` and the OpenAPI contract.
- Verify before reporting done: run the touched package's build + tests and quote the result. If you cannot run a platform (e.g. no Android SDK here), say which platforms are unverified instead of claiming full verification.
- Do not add telemetry, ads, third-party trackers, or external network calls beyond the user's own server. The one exception is the app's update check against GitHub releases, when the app opens (unless the user turned it off) and when the user asks; it sends no account, server or user data (ADR 0020, 0024, 0025).
- When a task is ambiguous about platform scope, ask — desktop, web, and mobile have separate release pipelines and "fix it everywhere" is rarely free.

## 11. Open decisions (resolve with an ADR, then update this file)

- [ ] Sync revision scheme: server sequence number vs. per-row version counter
- [x] Web session model: cookie session (ADR 0007)
- [ ] Attachment storage limits and whether encryption-at-rest is default-on
- [ ] Budget rollover semantics (carry surplus, deficit, both, or neither)
- [ ] Whether recurring transactions auto-post or require user confirmation (hand-entered future-dated transactions post by their date, ADR 0014; templates still confirm)

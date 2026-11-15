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
| Desktop | Windows, Linux, macOS app | **Future plan** — not built yet; will sync with the server |
| Mobile | Android app (APK + Play Store build) | **Future plan** — not built yet; will sync with the server; iOS is out of scope unless requested |

### Non-goals (v1)

- Bank auto-sync / open-banking aggregation, payment processing, trading
- Multi-currency FX trading (multi-currency *recording* is in scope, see §6)
- Tax filing, invoicing for businesses, double-entry accounting for companies (personal double-sided transfers are still modelled correctly)
- Split transactions (one bank line split into legs with separate categories/accounts) — would require nested legs inside Transaction; deferred, representable today only as separate Transactions losing atomicity, see `.docs/four-elements-ezbookkeeping-firefly.md`
- Event-driven rule engine (`trigger → action` on Transaction create/import, Firefly-style) and webhooks — TransactionTemplate is time-driven only; a Rule would be a fifth element, deferred

## 2. Architecture

Offline-first, server-authoritative sync. Every client works fully offline against a local database and syncs changes to the server when reachable. Never design a feature that requires a live server on desktop/mobile.

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
| Desktop | Tauri 2 (Rust shell + React UI) for Windows/Linux/macOS | Small binaries, reuses web UI, no Electron |
| Mobile | React Native (Expo) for Android, TypeScript | Reuses domain logic/types with web/desktop |
| Client DB | SQLite (`expo-sqlite` / Tauri SQL / better-sqlite3 as appropriate) | Offline-first local store on every client |
| Shared code | TypeScript package `@kisiauthong/core`: domain types, validation, money math, sync protocol | One implementation of the rules that matter (money, budgets) |
| API contract | OpenAPI spec in `api/openapi.yaml`, generated TS/Go types | Contract-first; clients never hand-write diverging DTOs |
| Money | Integer minor units (satang/cents) + ISO 4217 currency code, never `float` | No floating-point money anywhere |

Alternatives already considered: Flutter (rejected: splits language from web) and Electron (rejected: size). If you propose changing the stack, write an ADR first — do not silently re-scaffold.

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
  desktop/                   # Tauri app (src-tauri/ + shared React UI)
  mobile/                    # React Native / Expo Android app
  packages/
    core/                    # shared TS: domain types, money, validation, budget math
    api-client/              # generated + hand-written API/sync client
  deploy/
    Dockerfile               # server + web UI in one image
    docker-compose.yml       # server + PostgreSQL example
  scripts/                   # build/release helpers
```

Keep platform code in its own app folder. Only genuinely platform-independent logic goes in `packages/` — UI components are shared between `web/` and `desktop/` only; mobile UI is separate.

## 3. Domain model (core entities)

The stored kernel is exactly four elements — **Account, Transaction, Tag, TransactionTemplate** — confirmed against ezBookkeeping and Firefly III use cases in `.docs/four-elements-ezbookkeeping-firefly.md` (local note). Everything else (Category, Budget, MoneyBox, credit card, billing cycle) is a view or a field on those four, not an element. Defined once in `packages/core` and mirrored in server migrations. Field-level detail lives in the OpenAPI spec and migrations, but these rules are invariant:

- **User** — `id`, email/login, password hash (server only), display currency default.
- **Account** — `id`, `user_id`, name, type (`cash|bank|credit_card|ewallet|savings|investment|loan`), currency, opening balance, archived flag. Balances are *derived* from transactions, never stored as a mutable number (a cached balance must be recomputable).
- **No CreditCard entity (minimal-modules rule).** A credit card is decomposed, not modelled: (a) an `Account` with `allow_negative=true`, `credit_limit_minor?`, `statement_close_day?`, `payment_due_day?` (only set when `type=credit_card`); `type` is a display label, all behaviour comes from those fields; (b) a shared `Cycle` date utility (monthly period anchored on a day-of-month) reused by Budget periods, TransactionTemplate schedules, and statement cycles — same date math, different semantics, one implementation in `packages/core`; (c) ordinary transactions: purchases are expenses on the card, payment is a bank→card `transfer`, interest/fees are expenses, cashback is income. Derived, never stored: amount owed = `max(0, -balance)`, utilisation = owed ÷ limit, current-cycle usage = net transactions in `(last close, next close]`, statement amount due = balance as of the close date (keep this distinct from the current balance, which includes post-close spending). The limit is a warning threshold, not a hard block on recording — the purchase already happened at the till. Minimum-payment and interest computation are out of scope for v1; interest appears when the user records the charged transaction.
- **Transaction** — `id` (UUID, client-generated for offline creation), `user_id`, `account_id`, type (`income|expense|transfer|allocate|release`), amount in integer minor units (always positive; direction comes from `type`), currency, `tag_id?` (required for `allocate`/`release`), payee/note, `transaction_date`, `created_at/updated_at/deleted_at` (soft delete for sync), attachment refs. A **transfer** is one record with `from_account_id` / `to_account_id` (amounts may differ only when currencies differ, with an explicit FX rate recorded). `allocate`/`release` are decision records for money boxes: they never change an account balance (balance derivation ignores them); they only change the allocated total for their (`account_id`, `tag_id`) pair. Undoing a decision is a new `release` record, not an edit of history.
- **Category and Budget are not elements** — both are folded into Tag (see Tag below): a category is a Tag, and a budget is that Tag's `limit_minor` + `cycle`. Budget progress is computed from tagged Transactions, never stored. Changing a limit changes future periods; rewriting past reports by editing a limit is a known strain (effective-dated limit history) deferred until a real case needs it.
- **TransactionTemplate (generator)** — a first-class element beside Account, Transaction and Tag: a template + schedule that *generates* Transactions, so nothing recurs by hand. `id`, `user_id`, `name`, `enabled`, template fields copied onto each generated Transaction (`account_id`/`from_account_id`/`to_account_id`, `type` — any Transaction type incl. `allocate` for automatic money-box saving, `amount_minor`, `currency`, `tag_id?`, note, and optional `expected_range_minor: {min, max}` for variable bills such as utilities: expectation metadata only for forecast/matching/anomaly checks, never stored on a Transaction and never used as its amount — the generated Transaction always uses the fixed `amount_minor`, is confirmed with the amount editable before posting, and a Transaction only ever has one fixed amount), and `schedule`: `frequency` (`daily|weekly|monthly|quarterly|yearly`), `interval` (every N), `day_of_month?`/`weekday?`, `start_date`, `end_date?`, `max_occurrences?`. This one element covers billing cycles for memberships and bills, salary, and automatic money-box allocations; the old names RecurringRule/BillingCycle are retired in its favour. Semantics: (1) an occurrence is identified by (`transaction_template_id`, `occurrence_date`) and is generated at most once — re-running the generator, sync retries, and client/server both generating must never duplicate it (generated Transactions carry both fields); (2) before its date an occurrence is only a computed preview, after its date the generator materialises it as a `planned` Transaction, and it becomes `posted` when the real charge/income is confirmed or matched — the generator never silently posts money movements the user has not seen, except `allocate` generations which may post immediately because no cash moves; (3) editing a TransactionTemplate affects future occurrences only, never already-generated Transactions; pausing sets `enabled=false` and generates nothing while paused; (4) month-end schedules clamp (a monthly rule on the 31st fires on the last day of shorter months) and that clamp is computed by the shared `Cycle` date utility, tested at month boundaries.
- **MoneyBox (savings goal)** — a money box is *not* a new element and not a sub-account: in the Account/Transaction/Tag kernel it is a Tag with `kind: goal` plus `target_minor`, `currency`, `target_date`. There is no stored allocation row: the allocated amount for an (account, money box) pair is *derived* as Σ `allocate` − Σ `release` Transactions carrying that `tag_id` on that account, so every decision to move money into (or out of) a money box is a dated, noted Transaction the user can list — that history is how the user knows what they decided, and when. One money box may be split over several accounts (House fund across accounts A, B and C) and one account may serve several money boxes, with only part of its balance earmarked. A complete worked example is in `examples/sample-data.json` (plain JSON; JSONC is deprecated — do not add comment parsing or a compatibility shim, derivation rules live in prose here and in the docs). Invariants: per account, Σ derived allocations across all money boxes ≤ that account's derived balance (the remainder is the account's *unallocated* balance); per money box, saved = Σ its derived allocations (per-currency subtotals; a combined total in the target currency only via a visible, user-editable rate). An actual movement of money between accounts is still a normal `transfer` Transaction, recorded separately. Spending from a money box = a `release` Transaction on the account actually spent from + the expense Transaction on that account.
- **Tag** — `id`, `user_id`, name, icon/color, `kind` (`category|goal|payee|label`), `parent_id?` (two-level categories), plus kind-specific optional fields: `limit_minor` + `cycle` for a budgeted category, `target_minor` + `currency` + `target_date` for a goal (money box). Tags are many-to-many with Transactions via TransactionTag links. System default categories are seeded per user as Tags and remain editable.
- **Attachment** — files stored server-side with metadata rows, referenced by id from Transactions, never embedded as blobs in sync payloads.
- **Sync metadata** on every syncable row: `updated_at` (server-assigned revision or Lamport/version counter per §7), `deleted_at` for tombstones.

All ids are UUIDs generated on the client so offline creation never needs the server. All timestamps are UTC ISO 8601 on the wire; dates the user thinks in (`transaction_date`) are plain `YYYY-MM-DD` in the user's timezone — never shift them through UTC conversion.

## 4. Money, dates, and numbers — hard rules

1. Money is **integer minor units + currency code** everywhere: DB, API, client. Display formatting is the only place a decimal point appears.
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

- **Offline-first**: create/edit/delete works with no network; the UI never blocks on sync. Show a sync state (synced / pending / conflict / error) — never silently drop a failed sync.
- Local SQLite is the client's source of truth for rendering; the network layer only syncs.
- Desktop (Tauri): target Windows 10+, macOS 12+ (Apple Silicon + Intel), and mainstream Linux (`.AppImage`/`.deb`). No platform-specific forks of business logic — platform differences live in the Tauri shell layer only.
- Mobile: Android 10+ (API 29+). Respect Android back behaviour, scoped storage for exports/attachments, and no hardcoded sizes — support small phones and tablets.
- Web: evergreen browsers, responsive down to phone widths (the web UI may be the only UI a self-hoster's family uses on mobile browsers).
- Accessibility and i18n from the start: all user-visible strings go through the i18n layer (English source strings; Thai translation is a first-class target — the project name is Thai), no hardcoded currency/date formats.

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
# desktop
npm run tauri dev --workspace=desktop  # requires Rust toolchain
# mobile
npm run start --workspace=mobile       # Expo; Android emulator or device
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
  - Clients: at least a smoke test that the app renders and can create a transaction offline; sync tests against a local server where the platform allows.
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
- Prefer the existing stack and layout in §2. Creating a new app, swapping a framework, or changing the sync/conflict model requires an ADR and explicit user approval.
- Never invent a second money representation, date format, or DTO shape — reuse `packages/core` and the OpenAPI contract.
- Verify before reporting done: run the touched package's build + tests and quote the result. If you cannot run a platform (e.g. no Android SDK here), say which platforms are unverified instead of claiming full verification.
- Do not add telemetry, ads, third-party trackers, or external network calls beyond the user's own server.
- When a task is ambiguous about platform scope, ask — desktop, web, and mobile have separate release pipelines and "fix it everywhere" is rarely free.

## 11. Open decisions (resolve with an ADR, then update this file)

- [ ] Sync revision scheme: server sequence number vs. per-row version counter
- [ ] Web session model: cookie session vs. JWT in secure storage
- [ ] Attachment storage limits and whether encryption-at-rest is default-on
- [ ] Budget rollover semantics (carry surplus, deficit, both, or neither)
- [ ] Whether recurring transactions auto-post or require user confirmation

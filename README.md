<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 記數通 KiSiauThong

Self-hosted personal bookkeeping: monthly budgets, billing cycles for memberships and bills, bank and wallet balances, multi-currency wallets (e.g. JPY beside TWD), credit card usage, and money boxes for future plans such as travel.

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

Data lives in `data/kisiauthong.db` (SQLite; `data/` is gitignored). Override with `KISIAUTHONG_DB`, port with `PORT`. The server listens on `127.0.0.1` only (there is no login yet); set `KISIAUTHONG_HOST=0.0.0.0` to reach it from other devices or a container, and only on a network you trust. Set `KISIAUTHONG_SOURCE_URL` to the source repository of the code you run; it is shown under Settings → About (AGPL §13). Desktop and Android clients are future plans.

Settings (sidebar → Settings): language (English or 繁體中文（台灣）, default follows the browser), default currency and a short list of frequently used currencies (e.g. USD, TWD, JPY) shown first in currency pickers, with every ISO 4217 currency still available below them; dashboard layout (Dashboard → Customize: show/hide, drag or ↑ ↓ to reorder, full or half width, custom titles, row counts, and which accounts / budgets / money boxes / currencies each widget shows, with a live preview), JSON export of all data (`GET /api/export`), and About.

## License

GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`). See `LICENSE`. If you run a modified version as a network service, AGPL §13 requires you to offer its source to users of that service.

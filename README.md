<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# kisiauthong

Self-hosted personal bookkeeping: monthly budgets, billing cycles for memberships and bills, bank and wallet balances, multi-currency wallets (e.g. JPY beside TWD), credit card usage, and money boxes for future plans such as travel.

Platforms: web server (self-hosted), desktop (Windows, Linux, macOS), and Android.

- Portal: open `.docs/index.html` in a browser (local-only, not committed)
- Use cases: open `.docs/use-cases.html` in a browser (local-only, not committed)
- Contributor and agent guidance: see `agents.md`

## Run the web app

```powershell
cd server
go run .          # http://localhost:8080  (SQLite at ../data/kisiauthong.db, seeded on first run)
go test ./...     # domain tests
```

Data lives in `data/kisiauthong.db` (SQLite; `data/` is gitignored). Override with `KISIAUTHONG_DB`, port with `PORT`. Desktop and Android clients are future plans.

## License

GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`). See `LICENSE`. If you run a modified version as a network service, AGPL §13 requires you to offer its source to users of that service.

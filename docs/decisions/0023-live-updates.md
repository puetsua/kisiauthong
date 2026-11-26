<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0023 — Live updates over Server-Sent Events

Date: 2026-11-21
Status: accepted (issue #55)

## Context

An open page showed the books as they were when it loaded. Changes made
elsewhere stayed invisible until a reload:
- another device or tab
- an assistant adding transactions through the REST API or MCP
- template generation

The Tauri apps load the same web UI (ADR 0019). Self-hosters often reach the
server through a reverse proxy such as Tailscale serve, and use it from mobile
browsers that pause pages in the background.

## Decision

- **One event stream per open page.** `GET /api/events` is a Server-Sent
  Events stream with the same authentication and per-user scoping as every
  other endpoint: a session cookie, or an API key with `read`.
  - It sends a `ready` event when it opens and a `change` event after every
    write to that user's books.
  - Events carry only the books' revision, never book data.
  - A comment line every 25 seconds keeps proxies from closing an idle stream,
    and the sign-in is checked again then; the stream ends after signing out.
  - The headers ask proxies not to buffer or transform the stream
    (`X-Accel-Buffering: no`, `Cache-Control: no-transform`).
  - At most 16 streams per user are open at once.
- **Writes are announced where they land.**
  - Every write path ends in `Book.reload()`: REST, MCP tools, a tag merge and
    its undo. A reload of books that were already loaded announces a change.
  - Writing a setting announces one, and so does template generation, which
    updates the books in place.
  - Reads announce nothing, so a page's own refetch never triggers another.
- **The revision.** `/api/state` returns `rev`, written `<server start>-<n>`.
  - A page compares the revision of an event with the one it shows. Equal means
    nothing to fetch, as after its own write. Anything else means fetch again.
  - After a server restart the prefix differs, so pages fetch once.
- **The page refreshes carefully.**
  - It fetches again 0.4 s after a change, so a burst of writes is fetched once,
    and keeps the scroll position: only on the screen where the refresh
    began, and only when its own answer is drawn (issue #88).
  - It waits while the user is in a form: the dialog, the transaction panel,
    Customize dashboard, Manage tags, or a focused field in the page. The
    Transactions search box and filters do not count: while one has focus,
    only the results under it are redrawn (issue #77).
  - A Transactions filter in the address that names a value the page does
    not know (a category made elsewhere, or one merged away) asks for a
    refresh, even when no newer revision was announced. Only a fetch begun
    after that may drop the value from the filter and the address; an older
    one leaves it to the next. A refresh that fails is tried again with the
    next event or visit (issue #79).
  - Fetches can overlap (a refresh, the page's own write). An answer to a
    fetch that began before the one on screen is dropped whole, and so is
    any answer that arrives after sign-out.
  - The page hears of its own write before the write is answered. A refresh
    that comes due while a request of the page's own is under way waits for
    it: the fetch after that write brings the announced revision. Fetching
    the books a second time beside it halved the speed of both on a phone's
    network, so a saved transaction took twice as long to appear. A request
    under way for more than 10 s (a stalled connection) no longer holds a
    refresh back. A fetch asks for the books and the settings at once
    (issue #130).
  - A setting saved and applied from its own answer (Settings, Customize
    dashboard, a dismissed notification) is not put back by a fetch begun
    before that: such a fetch draws its books but keeps the settings on
    screen (issue #87).
  - The browser reconnects a dropped stream itself. One it gives up on (a
    proxy's error page, a restart) is retried every 2 s, doubling up to a
    minute.
  - Coming back to a page that sat in the background for more than 10 s, or
    coming back online, fetches again. This covers phones, which pause
    background tabs and drop their connections.

## Consequences

- Pages stay current without polling and without any new dependency. SSE is
  plain HTTP and works in every evergreen browser and webview, including
  Android WebView and WKWebView.
- **Server cost:** a held connection per open page, and a write wakes the
  user's streams. The store lock is not held while a stream waits.
- **Granularity:** a change re-fetches the whole state, as the page already
  does after its own writes. Smaller updates would need per-entity events,
  which belong to the sync protocol (AGENTS.md §7), not to this.
- **Revocation lag:** a revoked API key or ended session keeps its stream until
  the next heartbeat, up to 25 s. Events carry no data, so nothing leaks in
  that time.

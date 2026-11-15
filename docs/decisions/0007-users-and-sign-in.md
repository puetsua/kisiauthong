<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0007 — Users, sessions and sign-in

Date: 2026-11-15
Status: accepted (resolves the open "web session model" decision)

## Context

The server held one person's books and relied on listening only on
127.0.0.1. It now has to serve several people, each with private books,
and sign them in with a password, TOTP and passkeys.

## Decision

- **Books per user.** Every data table (`accounts`, `transactions`,
  `tags`, `transaction_tags`, `transaction_templates`, `settings`) has
  `user_id`, and its primary key is `(user_id, id)`. Ids are unique per
  user only, so the sample data and the anonymous external account
  (`acc-external`) keep their fixed ids for everyone. All reads and writes
  go through a per-user `Book`, whose queries always carry `user_id`; the
  user comes from the session or API key, never from the request body.
- **Users** have a username (case-insensitive, unique), an optional
  display name, an Argon2id password hash (m=64 MiB, t=3, p=2), an admin
  flag, and later TOTP, passkeys and an avatar.
- **Sessions** are random 256-bit tokens in an `httpOnly`,
  `SameSite=Lax` cookie (`Secure` behind HTTPS), stored only as SHA-256
  hashes, valid 30 days and revocable (sign-out deletes the row; changing
  the password signs out every other session). Writes made with the cookie
  must come from the same origin (the `Origin` header is checked).
- **First run.** While nobody can sign in, the web app shows a setup form.
  On a new database it creates the first user, an administrator, with the
  sample books. On a database from before users existed, migration 8 gave
  every row to an owner without credentials, and setup claims that owner,
  keeping the books.
- **TOTP** (RFC 6238: SHA-1, 6 digits, 30 s, ±1 step) is an optional
  second factor. Turning it on needs a code from the new secret (shown as
  a QR code generated on the server); a used step is not accepted again.
  Ten one-time recovery codes are issued then, stored as hashes. Signing
  in with a password then returns a five-minute ticket instead of a
  session, and the session starts once a code or recovery code is given.
  Turning TOTP off needs a code. Migration 9 adds `users.recovery_codes`.
- **Passkeys** (WebAuthn, go-webauthn v0.10.2, the last release for Go
  1.21) are added from My account and sign in on their own, without a
  username: they must be discoverable credentials with user verification
  (PIN or biometrics), so a passkey counts as both factors and skips TOTP.
  The relying party is the host the browser used (or `KISIAUTHONG_ORIGIN`);
  WebAuthn refuses IP addresses, so the app must be opened as
  `http://localhost:…` or by a domain name. Credentials are stored per
  user (migration 10, table `passkeys`) with their signature counters.
- **Avatars**: a photo (PNG or JPEG, 16–512 px, at most 512 KB; clients
  resize before uploading: the web app lets the user move and zoom the photo
  in a round frame, then sends that square as JPEG of at most 512 px) stored with the user and served
  to signed-in users at `/api/users/{id}/avatar?v=<version>`, or a colour
  for the initials. Migration 11 adds `users.avatar_version`.
- **Administrators** add users (who start with an empty book), reset
  passwords (ending that user's sessions), grant or remove admin rights
  (one administrator always remains) and delete users with all their
  books, sessions, passkeys and API keys. Nobody can delete themselves.
- Administrators have an **Administration** area, entered from the foot of
  the sidebar (shown to administrators only). Inside it the sidebar lists
  only its pages, and the same foot link leads back to the books. **Users**
  (`#admin/users`) manages users; **Server** (`#admin`, from
  `GET /api/admin/server`) shows version, start time, runtime, database path,
  size and schema version, and counts of users, administrators, two-step
  users, passkeys, live sessions and unexpired API keys. It never shows
  anything from anyone's books.
- Failed sign-ins are limited per client address (10 per 15 minutes), and
  an unknown username costs the same time as a wrong password.
- Account management (password, TOTP, passkeys, API keys, users) needs a
  signed-in session; an API key can never manage sign-in methods.

## Migration

Migration 8 rebuilds each data table with `user_id` in its key, gives all
rows to the user `usr-owner` and creates that user as an administrator
with no username or password. A new database is created in the current
shape and skips migrations.

## Consequences

- The server can be reached from other machines more safely, but still
  needs HTTPS for that (cookies and passkeys).
- Until the first user is set up, whoever opens the app first claims it;
  the server still listens on 127.0.0.1 by default.

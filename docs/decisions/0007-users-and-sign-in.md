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

<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0015 — The app does not nudge the user

Date: 2026-11-19
Status: accepted (issue #18)

## Context

While designing merge categories (#13), one option suggested groups of
similar tags for the user to merge. It was rejected: similar tags,
categories and other items are often kept apart on purpose ("Food" and
"Food (work)", two accounts with the same bank name), and only the user
knows why. A product that keeps pointing at them second-guesses that
choice, adds noise to every visit, and pushes the books towards what the
app thinks they should look like.

## Decision

- **Tools, not suggestions.** The app offers tools the user starts on
  purpose and controls, such as a multi-select merge they enter and
  choose items in. It does not steer the user towards an action.
- **Not allowed:** auto-suggested merges of similar tags, categories or
  other items; "did you mean" prompts; highlighting supposed duplicates;
  pre-selecting items the app thinks belong together; similar banners,
  badges or notifications that recommend tidying up.
- **Neutral order is fine.** Where a chosen design already needs a sort
  order, a plain one (alphabetical, or by similar spelling) is allowed as
  long as nothing is highlighted, labelled "similar" or pre-selected. Do not
  add new grouping UI to be helpful.
- Warnings about the user's own money (over budget, reserved more than the
  balance) are facts about their numbers, not nudges, and stay.
- The #13 decision stands as it is.

## Consequences

- The UI guide carries this as a principle and AGENTS.md points to it, so
  new designs start from it.
- A user who wants to clean up similar items finds them on their own, for
  example by sorting a list; no real case needs more.
- A future proposal that suggests, highlights or pre-selects on the user's
  behalf needs a new ADR that replaces this one.

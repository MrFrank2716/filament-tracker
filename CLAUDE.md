# Notes for Claude

`CONTRIBUTING.md` is the source of truth for commands, code layout and
conventions. Read it before changing code. This file adds the rules that matter
most when working here.

## Branch naming

Name branches after the work they hold, never a random or auto-generated name
(e.g. not `claude/amazing-dirac-q934iz`).

- Format: `claude/<short-description>` in lowercase kebab-case, 2–5 words.
- Describe the change, e.g. `claude/qr-labels-locations-openspool`,
  `claude/fix-scanner-focus`, `claude/h2d-laser-jobs`.
- If a session starts on an auto-named branch, rename it to a descriptive name
  once the task is clear, before the first push (or ask first if it is already
  pushed or has an open PR).

## Setting up a fresh copy

- Copy `server/.env.example` to `server/.env` and set `JWT_SECRET` and
  `SEED_PASSWORD`, then run `npm run setup`.
- Use only the demo data from the seed, never real workshop data, in tests,
  fixtures and screenshots.

## Rules that are easy to break

- Stock only changes through `moveStock` (`server/src/services/stock.ts`), so
  every change leaves an audit row and can be undone.
- A new route that changes data is admin-only until it is added to
  `OPERATOR_WRITES` in `server/src/auth.ts`. Decide whether operators need it.
- Schema changes go through `npm run db:migrate`. Never edit a migration that
  has already been applied.
- No inline styles (CSS Modules with the design tokens), `@/` imports, Lucide
  icons only.

## Printer work

- Test with the bridge's `--simulate` mode and the made-up data in
  `protocol/src/fixtures.ts`.
- Never invent how a printer behaves or a machine spec. Only add a spec
  confirmed on the maker's own website; mark guesses as guesses.

## Docs go with the change

- Anything a user will notice gets a matching update in `docs/wiki/`, written
  for someone who runs a workshop: no file paths or code, bold for anything on
  screen.
- Never edit the GitHub wiki directly; the sync from `docs/wiki/` overwrites it.

## Before opening a PR

- GitHub runs `npm run typecheck` and `npm test` on every pull request (the
  Tests workflow). Run both yourself first and fix any failure. Never
  merge on a red run.
- Fill in the PR template. Tick a checklist item only if it actually passed;
  mark the ones that don't apply as not applicable.

## Commit and PR style

- Titles are short, plain sentences saying what changes for the user, e.g.
  "Make barcode scanners work on every screen".

## Pull requests

- Do not wait for a Graphify review: the project has used up its Graphify PR
  review allowance and is not upgrading for now. Treat Graphify as absent
  until the user says otherwise.
- After opening a PR, subscribe to its activity. Read every review comment
  that does arrive, from a person or another bot. Fix the valid ones and push;
  reply on the PR to explain any that you don't act on.
- Merge only after any review comments are handled, the GitHub checks
  (Tests and CodeQL) pass, `npm test` and `npm run typecheck` pass, and the user has
  said to merge.

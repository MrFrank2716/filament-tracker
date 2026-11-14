# Handoff: admin inbox and admin site

Status: planning only. Nothing in this document is built yet. Written 2026-11-14.

## Why this exists
The legal pages (`/privacy`, `/terms`, `/notices`) publish `hello@wrkbench.xyz` as the contact address. People will use it for privacy requests (access, deletion, export) and general questions. The operator wants those emails to land in an admin page inside Wrkbench instead of a separate mailbox. This inbox is intended to be the first part of a larger admin-side site.

## What is decided
- Contact address: `hello@wrkbench.xyz` (set as `LEGAL_CONTACT` in `client/src/pages/LegalPages.tsx`).
- Inbound mail is received by Resend and delivered to the app by webhook.
- Governing law in the Terms: England and Wales.
- The messages are shown on an admin page.

## What is not decided (open questions)
1. **Who counts as an admin.** The app has no platform-level admin today, only workspace roles (owner, admin, operator, viewer). Workspace owners must not see mail sent to the operator. Proposed: a platform-admin flag, set through an `ADMIN_EMAILS` environment variable or a boolean on `User`.
2. **Scope of the "admin side site".** Is it a section of the existing SPA behind an admin guard (for example `/admin/*`), or a separate app? The existing app is one Node process serving the API and the built client, so a section of the SPA is the cheapest option.
3. **What is stored.** Proposed: sender, recipients, subject, text and HTML body, received time, a read/handled status and the Resend message id. Attachments are an open choice (store, link to Resend, or ignore).
4. **Replies.** Read-only, or a reply box sending from `hello@` through Resend with proper threading headers.
5. **Retention.** Messages contain personal data, so the Privacy Policy retention wording needs to cover them (for example, delete handled messages after N months).
6. **Spam and abuse.** Whether to filter, rate-limit or only log.
7. **Other admin features** the larger site should include (user and workspace lookup, privacy-request tracking, guest cleanup status, and so on).

## What is already in the codebase (verified)
- Stack: React 19 + Vite SPA, Express 5, Prisma 6 on SQLite, one Docker container with a volume at `/data` (`Dockerfile`, `server/prisma/schema.prisma`).
- Auth: email and password, JWT in localStorage, `tokenVersion` for revocation (`server/src/auth.ts`, `client/src/lib/api.ts`). Routes are guarded by `RequireAuth` in `client/src/App.tsx`.
- Outbound email: `server/src/services/mail.ts` calls `https://api.resend.com/emails` when `RESEND_API_KEY` is set, with `SMTP_URL` as an alternative. If neither is set, mail is logged to the console.
- Helmet default CSP and CORS limited to `CLIENT_ORIGIN` (`server/src/index.ts`).
- Public, unauthenticated routes already exist under `/api/public` (job requests), so a new webhook route fits beside them.
- An in-memory rate limiter exists in `server/src/rateLimit.ts`.
- No generic admin concept, no inbound email handling and no raw-body handling for webhooks.

## Proposed design to react to (not final)
### Data flow
1. Resend receives mail for `hello@wrkbench.xyz` (needs an MX record, see below).
2. Resend posts a webhook event to `POST /api/webhooks/resend`.
3. The server verifies the signature against the raw request body, using the signing secret, and rejects anything unsigned or stale.
4. The event carries message metadata. The server fetches the full message (body, headers, attachments list) from Resend's received-email API using `RESEND_API_KEY`, then stores it.
5. The handler is idempotent on the Resend message id, since webhooks can be retried.
6. The admin page lists messages (unread first), shows a message, and lets an admin mark it handled.

### Suggested model
`InboundEmail`: id, resendId (unique), fromAddress, fromName, toAddress, subject, text, html, receivedAt, status (new, read, handled), handledAt, handledById. Optionally a `InboundAttachment` table.

### Server pieces
- A webhook route mounted before the JSON body parser, or with a raw-body parser, because signature checks need the exact bytes.
- A `requirePlatformAdmin` middleware, separate from workspace role checks.
- `GET /api/admin/inbox`, `GET /api/admin/inbox/:id`, `PATCH /api/admin/inbox/:id`.
- New env vars: the webhook signing secret and the admin list.

### Client pieces
- An `/admin` route group behind an admin guard, and a link shown only to admins.
- Inbox list and message view. HTML bodies must be sanitised or shown in a sandboxed iframe, because they are untrusted input.

## Risks to plan for
- **Untrusted HTML:** inbound mail is attacker-controlled. Never render raw HTML in the app origin.
- **Webhook authenticity:** a missing or weak signature check lets anyone inject messages.
- **Privilege boundary:** the admin guard must be server-enforced, not only hidden in the UI.
- **Privacy:** the inbox holds personal data and privacy requests, so it needs retention and access rules, and the Privacy Policy should mention it.
- **Deliverability and DNS:** adding Resend's MX record on a domain that already receives mail would redirect that mail. Use a subdomain if the root domain has existing email.
- **Persistence:** SQLite lives on the volume at `/data`, so check backups cover the new table.

## Setup needed outside the code (operator)
- Verify `wrkbench.xyz` in Resend and enable receiving. I could not check the domain's current state from this session.
- Add the MX record Resend specifies in DNS.
- Create the webhook in Resend pointing at the production URL, and store its signing secret as an environment variable on the host.
- Confirm in Resend's documentation the exact event names, payload shape and signature headers. The details above come from general knowledge of the product and must be checked against current docs before building.

## Suggested next steps
1. Answer the open questions, especially 1, 2 and 4.
2. Decide the admin site's overall scope, so the inbox is built as the first module of it rather than a one-off.
3. Plan the work in phases: (a) platform-admin concept and guard, (b) webhook ingest and storage, (c) inbox UI, (d) replies, (e) retention and policy wording.

## Related branches and PRs
- Merged: [hussxin5046/filament-tracker#8](https://github.com/hussxin5046/filament-tracker/pull/8), legal pages, consent text, LICENSE.
- Open branch, unmerged: `claude/legal-contact-email` (contact address and governing law).

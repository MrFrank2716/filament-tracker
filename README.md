# Filament Tracker

A configurable workshop inventory and maintenance manager. It started as a 3D printing filament tracker and works for any maker space, home workshop, school lab or small business: categories, fields, units, machines and maintenance schedules are all data you define, not code.

## Run it

Requires Node.js 20 or newer.

```bash
npm install
```

Copy `server/.env.example` to `server/.env`, set a long random `JWT_SECRET`, and choose a `SEED_PASSWORD` for the demo account. Then:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

Open http://localhost:5173 and sign in with `SEED_EMAIL` / `SEED_PASSWORD` from `server/.env`, or create your own account and start from a template (or blank).

For a single-process deployment, `npm run build` then `npm start`: the API serves the built client on its own port (4000 by default).

## Layout

| Path | What lives there |
| --- | --- |
| `server/prisma/schema.prisma` | Data model: generic `ItemType` / `CustomField` / `Item`, machines, attached hardware and slots, maintenance, jobs, stock audit trail |
| `server/src/routes` | REST API. Everything under `/api/workspaces/:id` is membership- and role-checked |
| `server/src/services/snapshot.ts` | The portable workspace format behind JSON import/export, templates and the seed |
| `server/src/routes/requests.ts` | Outside job requests: the public submit and progress routes (the only ones that need no account) and the review queue |
| `server/src/templates` | Workspace templates and the example maker space, as data |
| `client/src/styles/tokens.css` | Design tokens (light and dark) |
| `client/src/components/ui` | Shared components |
| `client/src/pages` | One file per screen |

## Conventions

- No inline styles: CSS Modules that reference tokens only.
- `@/` import alias in both client and server.
- Lucide icons only. Icons a workspace can pick are listed in `client/src/lib/icons.ts`.
- Stock only changes through `moveStock` (`server/src/services/stock.ts`), so every change leaves an audit row.

## How a few things work

- **Inventory views**: a board with one column per category, per machine (what is loaded in it, then what fits it) or per storage location, plus a flat list. An item belongs to a machine when it is loaded in that machine's hardware or lists it under "Fits these machines". The chosen view is remembered per device.
- **Machine focus**: the bar above every screen switches between the whole workshop and one machine. With a machine picked, Overview becomes that machine's own page (what is loaded, what it needs, its maintenance and jobs), and Inventory, Jobs, Maintenance, Reorder, Machines and the sidebar badges narrow to it. Remembered per workspace on each device.
- **Job requests from outside**: an owner switches on a request link under Settings → Job requests. Anyone with the link can describe a job and attach files at `/submit/<token>`, without an account. Requests queue under Jobs → Requests, oldest first. An editor downloads the files, then approves (which creates a planned job carrying the requester and files), asks for changes (the requester sends new files) or rejects. The requester follows it at `/request/<token>`; there is no email. Uploaded files are stored under `server/uploads` with random names, limited by type, size and count (`UPLOAD_*` in `server/.env`), and are only ever handed to signed-in members as downloads. They are not part of the JSON export.
- **Daily report**: the first time you open a workspace each day (signing in, or coming back to a tab left open overnight) a report opens over whatever screen you are on. It is a numbered plan, "Do today" (overdue service, machines flagged as needing service, open jobs that ask for more than is in stock, job requests waiting, what to order) then "Coming up" (service due soon, stock that will cross its minimum within 14 days at the rate of the last 30 days, tooling past 80 % of its life), followed by how the last 7 days went. Every line links to where it is dealt with. "Daily report" in the sidebar (under More on a phone) opens it again. Shown once per person, workspace and day, remembered on the device; the rules live in `server/src/services/dailyReport.ts` and the wording in `client/src/components/report/DailyReport.tsx`.
- **Low stock** means below the item's minimum. The reorder list groups those by supplier, plus tooling that has reached its expected life, and suggests whole packs when a pack size is set.
- **Maintenance** is due when either interval runs out (days, hours of use, or both) since the last logged service for that machine. A task on a machine type covers every machine of that type.
- **Finishing a job** (completed or failed) takes its materials out of stock, adds cutting hours to tooling, adds run time to the machine, and snapshots the cost: materials + tool wear + machine time + other.
- **Roles**: owners manage members and the workspace, editors change data, viewers read only. Enforced on the server.

## Not built yet

Smart scales and sensors, QR/barcode scanning and label printing (locations store a label code ready for it), machine integrations, and AI suggestions.

# Self-hosting

How to run your own copy of Wrkbench for your workshop. If you only want to try it on your own computer, the quick start in the [README](../../README.md#try-it-on-your-computer) is enough.

## What you are running

Wrkbench is a single Node.js program. It serves the web app, its API and live updates on one port, and keeps everything in two places:

- a **SQLite database file** (no separate database server is needed), and
- an **uploads folder** for files sent with [job requests](Job-requests.md).

So the host needs:

- **A persistent disk** for those two. Without one, every redeploy starts from empty.
- **Exactly one running copy.** Rate limits, live updates and connected printers are held in the program's memory, so two copies behind a load balancer would not see each other.
- **HTTPS in front of it**, from your host or a reverse proxy such as Caddy or nginx. The proxy must pass WebSocket connections, which live updates and printer bridges use.

## Option 1: Docker (recommended)

The `Dockerfile` at the root of the repository builds the whole app into one image. The image keeps everything under `/data`: the database is `/data/app.db` and uploads go to `/data/uploads`. Mount a persistent volume there.

```bash
docker build -t wrkbench .
```

```bash
docker run -d --name wrkbench --restart unless-stopped \
  -p 4000:4000 -v wrkbench-data:/data \
  -e JWT_SECRET="<a long random string>" \
  -e CLIENT_ORIGIN="https://wrkbench.example.com" \
  wrkbench
```

Each time it starts, the container applies any pending database changes and then starts the app. To update: pull the new code, build again, and replace the container. The volume keeps your data.

Building the image also type-checks the code and runs the server's tests, so a broken change fails the build instead of reaching your site.

Any host that runs a Docker image with a persistent volume works: a VPS, a home server, or a platform such as Railway, Fly.io or Render. On a platform, set the variables below in its dashboard and attach a volume at `/data`.

## Option 2: Node.js without Docker

You need Node.js 22.9 or newer.

```bash
npm ci
```

```bash
npm run build
```

```bash
npm run db:deploy
```

```bash
npm start
```

Set the variables below in the environment, or in a `server/.env` file (read when present). Run `npm ci` without `NODE_ENV=production`, because the build needs the development tools. Keep the app running with whatever you use for services, such as systemd or pm2.

Without Docker, set `DATABASE_URL` yourself (for example `file:/var/lib/wrkbench/app.db`) and an absolute `UPLOAD_DIR`. A relative upload folder is taken from inside `server/`.

**Do not run `npm run db:seed` on a live site.** It creates a demo account with the password from `server/.env`.

## Settings

All settings are environment variables. The server checks them when it starts, and refuses to start with a message naming any that are wrong.

### Required

| Variable | What to set |
| --- | --- |
| `JWT_SECRET` | A long random string, at least 16 characters, used to sign people in. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Never reuse the one from your own computer. Changing it signs everyone out |
| `DATABASE_URL` | Where the database file is, for example `file:/data/app.db`. The Docker image sets this |

### Your site's address

| Variable | Default | What it does |
| --- | --- | --- |
| `CLIENT_ORIGIN` | `http://localhost:5173` | The address people open Wrkbench at, for example `https://wrkbench.example.com`. **Set this on every live site** |
| `APP_URL` | same as `CLIENT_ORIGIN` | The address used in links in emails and in the printer bridge set-up command, if it differs from `CLIENT_ORIGIN` |
| `PORT` | `4000` | The port the app listens on. Change it only if your host tells you to |
| `TRUST_PROXY` | `0` (Docker image: `1`) | How many proxies sit in front of the app. Usually `1` behind a host or reverse proxy, `0` when reached directly. If this is wrong, every visitor shares one rate limit |

### Email

Without email, password-reset links and job request updates are only printed to the server's log. To send them, set **one** of these, and `MAIL_FROM`:

| Variable | What it does |
| --- | --- |
| `RESEND_API_KEY` | Sends through [Resend](https://resend.com) over HTTPS. Use this on hosts that block outgoing mail ports. Wins if both are set |
| `SMTP_URL` | Sends through any mail server, for example `smtps://user:password@smtp.example.com:465` |
| `MAIL_FROM` | Who emails come from, for example `Workshop <workshop@example.com>`. It must be an address on a domain your mail provider has verified. Default `Wrkbench <no-reply@localhost>` |

### Uploads from job requests

| Variable | Default | What it does |
| --- | --- | --- |
| `UPLOAD_DIR` | `uploads` (Docker image: `/data/uploads`) | Where uploaded files are kept |
| `UPLOAD_MAX_MB` | `50` | Largest file, in MB (up to 2048). Keep it small enough that requests cannot fill your disk |
| `UPLOAD_MAX_FILES` | `5` | Most files per request (up to 50) |
| `UPLOAD_EXTENSIONS` | `3mf,stl,step,stp,obj,amf,gcode,nc,svg,dxf,pdf,png,jpg,jpeg,txt` | File types accepted, comma separated |

### Connected printers

| Variable | Default | What it does |
| --- | --- | --- |
| `PRINTERS_ENABLED` | `true` | `false` hides connected printers and refuses bridges. Must be exactly `true` or `false` |
| `BRIDGE_MAX_PER_WORKSPACE` | `3` | Most bridges per workspace |
| `PRINTER_MAX_PER_BRIDGE` | `20` | Most printers per bridge |
| `BRIDGE_IMAGE` | `ghcr.io/hussxin5046/wrkbench-bridge:latest` | The bridge image named in the set-up command. See [Running a fork](#running-a-fork) |

## Backups

The database and uploads together are the only things to back up. With Docker, that is the volume mounted at `/data`. Turn on scheduled volume backups if your host offers them, or copy the folder regularly. Copy the database while the app is stopped, or use SQLite's own backup command, so the copy is not caught half-written.

Members can also export each workspace themselves. See [Backups, import and export](Backups-and-data.md).

## Running a fork

Wrkbench is licensed under the AGPL-3.0. If you change it and let other people use your changed copy over a network, you must offer them its source code. If you run a fork:

- **Source link and contact details.** The privacy, terms and notices pages are in `client/src/pages/LegalPages.tsx`. Change `SOURCE_URL` to your fork, `LEGAL_CONTACT` to your own address, and review the privacy and terms text, which describes the original operator.
- **The bridge image.** The default `BRIDGE_IMAGE` is the upstream image. If you change the bridge or the shared protocol, publish your own image (below) and set `BRIDGE_IMAGE` to it.

### Publishing the bridge image

The workflow in `.github/workflows/bridge-image.yml` builds the bridge for 64-bit PCs, 64-bit Raspberry Pi and 32-bit Raspberry Pi, and publishes it to the GitHub Container Registry as `ghcr.io/<your account>/wrkbench-bridge`. It runs when the bridge changes on `main`, when a tag such as `bridge-v0.1.0` is pushed, or by hand.

GitHub makes a new package private. Set it to public once (your profile, **Packages**, `wrkbench-bridge`, **Package settings**, **Change visibility**), or bridges are refused with "denied" when they pull it.

To build it yourself instead, from the root of the repository:

```bash
docker build -f bridge/Dockerfile -t wrkbench-bridge .
```

## Problems

See [Troubleshooting](Troubleshooting.md).

# Troubleshooting

Common problems and what to do about them. Problems with connected printers and the bridge have their own table in the [Bridge reference](Bridge-reference.md#when-something-is-wrong).

## Using Wrkbench

| What you see | What to do |
| --- | --- |
| A button you expect is missing, or a change is refused | Your role may not allow it. See [Members and roles](Members-and-roles.md) and ask an owner to change your role |
| "No account uses that email yet" when adding a member | The person must sign up with that email address before an owner can add them |
| "You are the only owner" when leaving a workspace or deleting your account | Make another member an owner first, or delete the workspace |
| The password reset email never arrives | Check your spam folder. If it is not there, whoever runs your copy of Wrkbench has not set up email yet |
| A requester lost their progress link | Find the request under **Jobs**, **Requests**, press **Copy progress link** and send it to them again |
| The request form says "Attach at least one file" | Every request needs at least one file for the workshop to check |
| The daily report did not open today | It only opens once per person, workspace and day on each device. Use **Daily report** in the sidebar |
| A maintenance task shows as due straight away | Log the last service you actually did with **Done**, so the clock starts from then. See [Maintenance](Maintenance.md#when-a-task-is-due) |
| Stock went down by mistake | An admin can press **Undo** on the change under **Activity** |
| The app looks out of date after an update | Reload the page. Wrkbench installs as an app and refreshes itself, but an open tab can hold the old version until reloaded |

## Running your own copy

| What you see | Likely cause and what to do |
| --- | --- |
| The server stops at start with "Invalid environment" | A setting is missing or wrong; the lines below the message name it. Most often `JWT_SECRET` (missing or under 16 characters) or `DATABASE_URL`. See [Self-hosting](Self-hosting.md#settings) |
| `PRINTERS_ENABLED` is named in that error | It must be exactly `true` or `false`, not `0`, `1`, `yes` or `no` |
| Links in emails, or the bridge set-up command, point at `localhost:5173` | `CLIENT_ORIGIN` (or `APP_URL`) is not set to your site's real address |
| Emails only appear in the server log | Neither `RESEND_API_KEY` nor `SMTP_URL` is set. See [Self-hosting](Self-hosting.md#email) |
| Emails are rejected by the provider | `MAIL_FROM` must be an address on a domain your mail provider has verified |
| Everything is gone after a redeploy | The data folder is not on a persistent volume. With Docker, mount one at `/data` |
| Everyone gets "Too many requests from this connection" at once | `TRUST_PROXY` does not match the number of proxies in front of the app, so all visitors look like one. Usually it should be `1` |
| Live updates or printer bridges do not connect | The proxy in front of the app is not passing WebSocket connections |
| `npm run build` fails on a test | The build runs the server tests on purpose. Run `npm test -w server` to see which one fails |
| `npm run dev` says the port is in use | Another copy is already running on port 4000 or 5173. Stop it, or see [CONTRIBUTING.md](../../CONTRIBUTING.md#running-two-copies) |

Still stuck? [Open an issue](https://github.com/hussxin5046/filament-tracker/issues/new/choose) and say what you did, what you expected and what happened instead. For security problems, follow [SECURITY.md](../../SECURITY.md) instead of opening an issue.

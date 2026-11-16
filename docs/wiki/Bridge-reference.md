# Bridge reference

The bridge is the small program that reads your printers and reports to Wrkbench. Setting it up is covered in [Connecting printers](Connecting-printers.md); this page is for everything after that.

## What it does and does not do

- Connects to each printer you have added, on your own network, using that printer's access code.
- Keeps one outgoing connection to Wrkbench and sends what the printers report.
- Listens for printers announcing themselves, so they can be listed when you add one.

It cannot start, pause, stop or change a print, send G-code, update firmware or change a printer's settings: the program contains no code for any of that. It only connects to private network addresses (`10.x`, `172.16` to `172.31`, `192.168.x`) on the printer's own port, whatever the server asks.

## Where its settings are

One file, `config.json`:

| Running as | Location |
| --- | --- |
| Docker | `/data` inside the container: the `wrkbench-bridge` volume |
| From source on Linux or macOS | `~/.config/wrkbench-bridge/` (or `$XDG_CONFIG_HOME/wrkbench-bridge/` if that is set) |
| From source on Windows | `%APPDATA%\wrkbench-bridge\` |

It holds the server address, the bridge's own token, and each printer's access code. Treat it like a password file: it is written so only your user can read it. `--dir <folder>` or `WRKBENCH_BRIDGE_DIR` puts it somewhere else.

## Commands

| Command | What it does |
| --- | --- |
| `wrkbench-bridge --server <address> --pair <code>` | First run: pair with a workspace and start |
| `wrkbench-bridge` | Start, using stored settings |
| `wrkbench-bridge status` | Show where the settings are, the server, and how many printers it holds |
| `wrkbench-bridge record ...` | Save what one printer reports to a file (see below) |
| `wrkbench-bridge --simulate` | Pretend printers, for trying Wrkbench without hardware. The first time, add `--server` and `--pair` as well (see below) |
| `wrkbench-bridge --list-job-file` | Also print what is inside each print's sliced file: entry names and sizes only. Nothing extra is sent to Wrkbench |
| `--help`, `--version` | |

From source, put `npm run bridge --` in front instead of `wrkbench-bridge`. In Docker, the options go after the image name.

`WRKBENCH_SERVER` and `WRKBENCH_PAIR` can be used in place of `--server` and `--pair`.

## Everyday tasks

**See what it is doing.** Docker: `docker logs -f wrkbench-bridge`. From source: it prints to the terminal.

**Update it.** Docker: `docker pull <image>`, then `docker rm -f wrkbench-bridge` and run the same `docker run` command again without `--pair` (the volume keeps its settings). From source: `git pull`, `npm install`, start it again. If Wrkbench ever needs a newer bridge it says so in **Settings**, **Printers**.

**Move it to another computer.**

1. In **Settings**, **Printers**, press **New set-up code** on the bridge.
2. Run the command on the new computer.
3. The old copy stops being accepted at that moment. Stop and delete it.
4. Each printer now shows **Needs access code**: press **Access code** and enter it. The printers, their machines and everything loaded stay as they were.

**Run it on a second network.** Add a second bridge in Wrkbench and set it up there. Each printer belongs to one bridge.

## When something is wrong

| What you see | Likely cause and what to do |
| --- | --- |
| `denied` when Docker pulls the image | The image has not been published yet, or its package is still private (see the hosting notes below). Meanwhile use the "from source" command |
| Bridge stays **Not set up** | The command has not run successfully. Look at its output. "That set-up code is not valid or has run out": press **New set-up code** and use the new command within 10 minutes |
| Bridge says it cannot reach the server | Check the `--server` address is the one you open Wrkbench at, starting `https://`. Plain `http://` is only accepted for a server on your own network |
| Bridge shows **Offline** | The bridge computer is off, asleep or offline, or the program stopped. Start it again; it reconnects by itself |
| "Another copy of this bridge is connected" | Two copies are running with the same settings. Stop one. To have two bridges, add a second one in Wrkbench |
| "This bridge is no longer known to the server" | It was removed or re-paired in Wrkbench. Make a new set-up code and run with `--pair` |
| No printers in the **Add printer** list | In Docker, discovery needs `--network host`. Some networks block the announcements. Either way, use **Enter address and serial number by hand** |
| "The printer refused that access code" | Read the code again on the printer's screen. It changes if the printer's network settings are reset |
| "The bridge could not reach a printer at that address" | Wrong address, printer off, or the printer and bridge are on different networks (guest Wi-Fi, a separate VLAN) |
| "A printer answered at that address, but with a different serial number" | The address belongs to another printer, or the serial number was mistyped |
| Printer shows **Printer not reachable** later on | Printer off or asleep, or its address changed. If the address changed, set the new one under **Access code**. Giving printers a fixed address in your router avoids this |
| "A different device answers at this address" in the bridge's output | The address now belongs to something else, so the bridge refuses to send the access code. Set the printer's current address under **Access code** |
| The AMS on screen does not match the printer | Please record what the printer reports (below) so the reading can be corrected |

## Recording what a printer reports

The reading of printer status was written without every model to hand. A recording from a real printer turns guesses into facts.

```
wrkbench-bridge record --host 192.168.1.50 --serial <serial> --code <access code> --out tape.jsonl --seconds 120
```

It listens for two minutes and writes each message to `tape.jsonl`, with the serial number, network addresses and account details replaced. It is most useful while something is happening: load or remove a spool, start a print. Look through the file before sharing it.

## Trying it without a printer

With Wrkbench running on your own computer (see the [README](../../README.md#try-it-on-your-computer)), add a bridge under **Settings**, **Printers** to get a set-up code, then run from the repository:

```
npm run bridge -- --server http://localhost:4000 --pair <code> --simulate
```

Four pretend printers (X1 Carbon, P1S, A1, H2D) appear in **Add printer**. Their access code is `12345678`. One of them prints. To change spools, type into the bridge's terminal:

```
swap <serial> <feeder id> <tray 0-3> PLA 00ff00          an untagged green PLA spool
swap <serial> <feeder id> <tray 0-3> PLA 00ff00 ab       the same, with a tag
empty <serial> <feeder id> <tray 0-3>
```

## For people hosting Wrkbench

- The printer settings (`PRINTERS_ENABLED`, `BRIDGE_MAX_PER_WORKSPACE`, `PRINTER_MAX_PER_BRIDGE`, `BRIDGE_IMAGE`) are listed in [Self-hosting](Self-hosting.md#connected-printers).
- The set-up command uses `APP_URL` (or `CLIENT_ORIGIN`) as the server address, so that must be the address bridges can reach.
- Bridges connect on the same port as the app, over WebSocket, so a proxy in front must pass WebSocket connections, as it already does for live updates.
- Publishing your own bridge image, and making it public so bridges can pull it, is covered in [Self-hosting](Self-hosting.md#publishing-the-bridge-image).

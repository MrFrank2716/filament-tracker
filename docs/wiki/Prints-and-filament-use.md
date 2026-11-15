# Prints and filament use

Once a printer is [connected](Connecting-printers.md), Wrkbench follows its prints: each one becomes a job, and when it ends the filament it used is taken from stock.

## What happens

1. **A print starts** (from Bambu Studio, Orca, Bambu Handy or MakerWorld). Within a few seconds a job appears under **Jobs**, in progress, on that printer's machine.
   - If you had just pressed **Start** on a job for that machine, the print joins that job.
   - If a planned job on that machine has exactly the same name as the print, that job is started.
   - Otherwise a new job is made, marked "started at the printer".
2. **Wrkbench reads what the print will use.** The printer announces where the sliced file is and which AMS tray each filament comes from. The bridge reads the slicer's summary from that file: grams per filament. Each filament is matched to the spool linked to its tray, and the job shows those materials while it runs.
3. **The print ends.**
   - Finished: the job is completed with the real run time, and the grams are taken from each spool.
   - Stopped or failed: the job is marked failed with the reason, and the grams are scaled by how far the print got.
   - Either way it is written to **Activity** with the printer's name.

## What you need for the grams to be right

- **Spools linked to their slots.** A tray whose slot is "Not linked to stock" has nothing to take from. See [AMS and spools](AMS-and-spools.md).
- **Spools kept in grams** (or kilograms). An item counted in pieces or metres is skipped.
- **The bridge running when the print starts.** Some printers say which tray each filament uses only once, at the start.
- **Bridge version 0.2.0 or newer.** Older bridges still follow prints, but cannot read the sliced file, so jobs have no materials. Update it: see [Bridge reference](Bridge-reference.md).

## Good to know

- **The figure is the slicer's estimate**, the same number Bambu Studio shows after slicing. The printer does not measure filament. It is usually within a few percent.
- **A stopped multi-colour print is approximate.** Each colour is scaled by the same amount, which is wrong when colours sit in different layers.
- **When Wrkbench cannot tell what a print uses**, the job is still made and finished with the right time, just with no materials. Open the job and add them with **Edit** before it ends if you want them taken.
- **A print that ended while the bridge was off** is not guessed at. Its job stays in progress with a note; finish it by hand.
- **Your own entries win.** If you made the job and entered materials yourself, they are kept. If you finish a job by hand before the printer reports the end, yours stands and nothing is taken twice.
- **Prints started from an SD card or in LAN mode** are followed, but the sliced file is not announced for them, so they have no materials yet.

# Labels and scanning

Wrkbench prints a QR label for any item or location. Scanning one opens that item or location, on any phone, so you can check stock, log what you used or put things away without searching.

![A printed item label: QR code, name, details and where it lives](images/label.png)

## What a label holds

The QR code is a link to the item or location in your Wrkbench, and nothing else. It carries no details of the thing itself:

- Someone who is not signed in gets the sign-in page, and after signing in lands on what was scanned.
- Someone who is not a member of the workspace learns nothing: they are told the label is not for anything of theirs.
- If you belong to several workspaces, scanning switches to the right one.

Beside the code the label shows the name, its code if it has one (an item's SKU, a location's label code), a line of details (an item's material, size and so on; a location's kind) and where it lives. Small labels show less: see [How a label fits its size](#how-a-label-fits-its-size).

## Print labels

Labels are made for a **roll label printer** (Brother, Dymo, and the many thermal printers that take rolls of small labels): each label is its own page.

1. Open what you want a label for:
   - An item: open it and press **Print label**.
   - Several items: in **Inventory**, narrow the list with search or filters, open **Filters**, then **Print labels for these … items** (up to 200 at a time).
   - A location: see [Locations](Locations.md#labels).
2. Choose the **Label size**. Four common sizes are listed; **Another size** takes any width and height from 15 to 150 mm. The size is remembered on that device.
3. Choose the **Printer**: 203 dpi (most thermal label printers) or 300 dpi (Brother QL, Dymo LabelWriter). If you are not sure, leave it at 203. See [Why the printer matters](#why-the-printer-matters).
4. Press **Print**. In the print window that opens, choose your label printer, the same paper size, **no margins** and **100% scale**.

The preview shows the first label at its real size, or smaller (and says so) when the label is larger than the dialog.

### How a label fits its size

Every label is fitted to the size you choose, one by one, so nothing is ever cut off by the edge:

- The QR code takes what it needs to scan and leaves the rest to the text. It sits beside the text, or above it where that leaves the text more room.
- The type is as large as fits, and shrinks until everything fits, down to about 1.5 mm (roughly 4 pt), the smallest worth printing.
- If the smallest type is still too large, whole lines are left off, least important first: the location, then the details, then the code. The name stays. Only a name too long for the label by itself is shortened, and ends in "…".
- Words are not split. The one exception is a single word too long for a line, such as a long part number, at the smallest type.
- On labels of about 20 mm and under there is room for the QR code only.

When anything was left off, the dialog says what and on how many labels before you print. Scanning the code always shows everything.

### Why the printer matters

A label printer prints rows of tiny dots. A QR code prints sharp when each of its squares is a whole number of dots wide; otherwise some squares come out a dot wider than others, and a small code may not scan. Wrkbench sizes the code to the dots of the printer you choose, so the code may be a little smaller than the room it has.

If a label is too small for a code that scans reliably, the dialog says so. A larger label fixes it; so does a shorter address for your Wrkbench, since a shorter link makes a simpler code. On very small labels Wrkbench already uses the simplest code that holds the link.

> **Print from the address everyone uses.** The link on a label starts with the address Wrkbench was open at when it was printed. The dialog shows that address, and warns when it is one only that computer can open (`localhost`).

Anyone in the workspace can print labels, including viewers.

## Scan with any phone

Point the phone's own camera at a label and tap the link it shows. Nothing needs installing.

## Scan inside Wrkbench

**Scan** (in the sidebar, and at the top right on a phone) opens the camera inside Wrkbench. Hold a label inside the square; it is read as soon as it is sharp.

The in-app scanner does a little more than the phone's camera:

- It reads **your own codes** too. If a product's barcode is in an item's **SKU / barcode** field, scanning the product opens the item. A location's **Label code** works the same way. (Reading ordinary barcodes depends on the browser; QR codes are always read.)
- **Or type a code**: type or paste a label code, SKU or barcode and press **Find**. A USB barcode reader works here as well, since it types the code for you.
- On a location, **Scan items here** keeps scanning and moves each item you scan to that location. See [Locations](Locations.md#put-things-away).
- It reads NFC spool tags on phones that can. See [Spool tags](Spool-tags.md).

The camera only works when Wrkbench is opened at a secure address (one starting `https://`). The first time, the browser asks whether Wrkbench may use the camera. If you said no, allow it in the browser's settings for the site; typing codes works in the meantime.

## After a backup is restored

Labels keep working after a workspace is exported and imported into an empty Wrkbench at the same address: items and locations get the same ids back. Importing into a Wrkbench that still holds the originals makes copies with new ids, so the old labels keep pointing at the originals. See [Backups, import and export](Backups-and-data.md).

## Good to know

- A label stops working when its item or location is deleted. An item that was retired because past jobs used it says so when scanned.
- If Wrkbench moves to a new address, labels printed before the move point at the old one. Keep the old address redirecting to the new one, or reprint.
- Label printing was checked by producing the pages for sizes from 15 to 150 mm, measuring that no text is clipped, and reading every code back by program as a 203 and a 300 dpi printer would print it. It has not yet been checked on a physical label printer: if yours cuts off or shrinks the label, check the paper size, margins and scale in the print window first.

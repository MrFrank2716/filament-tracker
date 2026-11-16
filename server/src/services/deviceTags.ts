import type { Db } from '@/db';
import { HttpError } from '@/http';
import { itemSelect } from '@/services/deviceOverview';
import { TAG_PATTERN } from '@/services/tags';

/**
 * Tags tapped on a location display's reader. The reader gives the chip's UID; an item is found by:
 * - "NFC" + UID: a sticker written or scanned in Wrkbench (how the app stores them, see stickerTag in the client),
 * - the bare UID: a tag id someone typed in by hand.
 *
 * A Bambu spool's own tag is not matched: the printer reports the spool's tray_uuid, which is not the chip UID
 * the reader sees, so the two cannot be tied together from here.
 */

/** A UID as the reader gives it: 4, 7 or 10 bytes in hex. Tidied to capitals with no separators. */
export function readUid(raw: string): string {
  const uid = raw.replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (!/^[0-9A-F]{8,20}$/.test(uid)) throw new HttpError(400, 'That is not a tag id the reader could have read');
  return uid;
}

/** The sticker form of a UID, which is what linking stores. */
export const stickerTagFor = (uid: string): string => {
  const tag = `NFC${uid}`;
  if (!TAG_PATTERN.test(tag)) throw new HttpError(400, 'That is not a tag id the reader could have read');
  return tag;
};

/** The one item a tapped tag belongs to, or null when none does (or, should it ever happen, more than one). */
export async function itemForUid(db: Db, workspaceId: string, uid: string) {
  const items = await db.item.findMany({
    where: { workspaceId, archived: false, tagId: { in: [stickerTagFor(uid), uid] } },
    select: itemSelect,
    take: 2,
  });
  return items.length === 1 ? items[0] : null;
}

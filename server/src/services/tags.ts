import type { Db } from '@/db';

/**
 * A tag identifies one physical spool, so within a workspace it belongs to one item at a time.
 * Two kinds share Item.tagId: the id a printer reads from a spool's own RFID tag, and "NFC" followed by the
 * serial of an NFC sticker a member wrote (see isStickerTag in integrations/spoolMatch.ts).
 */

/** What a tag must look like once tidied: capitals and digits only. */
export const TAG_PATTERN = /^[A-Z0-9]{4,64}$/;

/** Give an item a tag (or take it away), taking the tag from whichever other item had it. */
export async function assignTag(db: Db, workspaceId: string, itemId: string, tagId: string | null): Promise<void> {
  if (tagId) await db.item.updateMany({ where: { workspaceId, tagId, NOT: { id: itemId } }, data: { tagId: null } });
  await db.item.update({ where: { id: itemId }, data: { tagId } });
  // A spool read at a display's reader and waiting to be told what it is: now it has been.
  if (tagId) await db.unknownTag.deleteMany({ where: { workspaceId, tagId } });
}

/** Whether a tag is free to give to a new item without taking it from one in stock. */
export async function tagIsFree(db: Db, workspaceId: string, tagId: string): Promise<boolean> {
  return (await db.item.count({ where: { workspaceId, tagId } })) === 0;
}

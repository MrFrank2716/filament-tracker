import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/db';
import { compatible, isStickerTag } from '@/integrations/spoolMatch';
import { exportSnapshot, importSnapshot } from '@/services/snapshot';
import { assignTag } from '@/services/tags';

let workspaceId: string;
let typeId: string;
const spool = (name: string, tagId: string | null = null) =>
  prisma.item.create({ data: { workspaceId, itemTypeId: typeId, name, quantity: 500, fields: { material: 'PLA', colour: '#ffffff' }, tagId } });
const tagOf = async (id: string) => (await prisma.item.findUniqueOrThrow({ where: { id } })).tagId;

beforeAll(async () => {
  const workspace = await prisma.workspace.create({ data: { name: 'Tags' } });
  workspaceId = workspace.id;
  typeId = (await prisma.itemType.create({ data: { workspaceId, name: 'Filament' } })).id;
});
afterAll(() => prisma.$disconnect());

describe('spool tags', () => {
  it('a tag belongs to one item at a time', async () => {
    const first = await spool('First', 'NFC04A1B2C3D4E5F6');
    const second = await spool('Second');
    await assignTag(prisma, workspaceId, second.id, 'NFC04A1B2C3D4E5F6');
    expect(await tagOf(first.id)).toBeNull();
    expect(await tagOf(second.id)).toBe('NFC04A1B2C3D4E5F6');
    await assignTag(prisma, workspaceId, second.id, null);
    expect(await tagOf(second.id)).toBeNull();
  });

  it('leaves the same tag in another workspace alone', async () => {
    const other = await prisma.workspace.create({ data: { name: 'Other' } });
    const otherType = await prisma.itemType.create({ data: { workspaceId: other.id, name: 'Filament' } });
    const theirs = await prisma.item.create({ data: { workspaceId: other.id, itemTypeId: otherType.id, name: 'Theirs', fields: {}, tagId: 'NFC0000AAAA' } });
    const ours = await spool('Ours');
    await assignTag(prisma, workspaceId, ours.id, 'NFC0000AAAA');
    expect(await tagOf(theirs.id)).toBe('NFC0000AAAA');
  });

  it('a sticker does not stop a spool matching a tray the printer cannot identify', () => {
    const tray = { material: 'PLA', colour: '#ffffff', tagId: null };
    expect(isStickerTag('NFC04A1B2C3')).toBe(true);
    expect(isStickerTag('0A1B2C3D4E5F60718293A4B5C6D7E8F9')).toBe(false);
    expect(compatible({ material: 'PLA', colour: '#ffffff', tagId: 'NFC04A1B2C3' }, tray)).toBe(true);
    expect(compatible({ material: 'PETG', colour: '#ffffff', tagId: 'NFC04A1B2C3' }, tray)).toBe(false);
    // A spool the printer knows by its own tag is still never what an untagged tray holds.
    expect(compatible({ material: 'PLA', colour: '#ffffff', tagId: '0A1B2C3D' }, tray)).toBe(false);
  });
});

describe('export and import', () => {
  it('carries tags, and gives items and locations their ids back when those are free', async () => {
    const shelf = await prisma.location.create({ data: { workspaceId, name: 'Shelf A', kind: 'Shelf', code: 'LOC-1' } });
    const tagged = await prisma.item.create({ data: { workspaceId, itemTypeId: typeId, name: 'Labelled', fields: {}, locationId: shelf.id, tagId: 'NFC11223344' } });
    const snapshot = await exportSnapshot(prisma, workspaceId);
    expect(snapshot.items.find((item) => item.ref === tagged.id)?.tagId).toBe('NFC11223344');

    // Restoring beside the original: ids and the tag are taken, so the copies get new ones.
    const copy = await prisma.workspace.create({ data: { name: 'Copy' } });
    await importSnapshot(prisma, copy.id, snapshot, null);
    const copied = await prisma.item.findFirstOrThrow({ where: { workspaceId: copy.id, name: 'Labelled' } });
    expect(copied.id).not.toBe(tagged.id);
    expect(copied.tagId).toBe('NFC11223344');

    // Restoring after the original is gone: the label printed for the old id still points at the item.
    await prisma.workspace.delete({ where: { id: workspaceId } });
    const restored = await prisma.workspace.create({ data: { name: 'Restored' } });
    await importSnapshot(prisma, restored.id, snapshot, null);
    const back = await prisma.item.findUniqueOrThrow({ where: { id: tagged.id } });
    expect(back).toMatchObject({ workspaceId: restored.id, tagId: 'NFC11223344', locationId: shelf.id });
    expect((await prisma.location.findUniqueOrThrow({ where: { id: shelf.id } })).workspaceId).toBe(restored.id);
  });
});

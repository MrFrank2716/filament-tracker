import type { Detected } from '@/integrations/spoolMatch';

/**
 * Reading what a Bambu Lab spool's own RFID tag says, from its data blocks.
 *
 * The tag is a MIFARE Classic chip. A drawer reader unlocks it (the keys follow from the tag's serial) and sends
 * the 16-byte blocks here. The layout is the one the community worked out and documents in the Bambu Lab RFID
 * Tag Guide (github.com/queengooborg/Bambu-Lab-RFID-Tag-Guide); numbers are little-endian:
 *
 *   block 2   filament type, text ("PLA")
 *   block 4   detailed type, text ("PLA Basic")
 *   block 5   bytes 0-3 colour RGBA, 4-5 spool weight in grams, 8-11 filament diameter in mm (float)
 *   block 6   bytes 8-9 hottest nozzle temperature, 10-11 coolest, degrees C
 *   block 9   tray id: what identifies this one spool
 *
 * The tray id is what a printer reports for the spool once it is loaded (as text, 32 hexadecimal digits), which
 * is what Item.tagId holds. The tag stores it either as those digits' 16 bytes or, on some tags, as readable
 * text; both are turned into the same thing.
 */

/** What a tag says about a spool: a slot's `Detected` without the parts only a printer's tray has. */
export type TagFacts = Omit<Detected, 'signature' | 'boundSignature'>;

export type TagBlocks = Record<string, string>;

const BLOCK = /^[0-9a-f]{32}$/i;

function block(blocks: TagBlocks, index: number): Buffer | null {
  const hex = blocks[String(index)];
  return typeof hex === 'string' && BLOCK.test(hex) ? Buffer.from(hex, 'hex') : null;
}

/** Text up to the first zero byte, if it is all printable. */
function textOf(bytes: Buffer | null): string | null {
  if (!bytes) return null;
  const end = bytes.indexOf(0);
  const raw = bytes.subarray(0, end === -1 ? bytes.length : end);
  if (raw.length === 0 || raw.some((byte) => byte < 0x20 || byte > 0x7e)) return null;
  return raw.toString('ascii').trim() || null;
}

const between = (value: number, low: number, high: number): number | null => (Number.isFinite(value) && value >= low && value <= high ? value : null);

/** The spool's id, in the form a printer reports it: capitals and digits, never all zeros. */
function trayId(bytes: Buffer | null): string | null {
  if (!bytes || bytes.every((byte) => byte === 0)) return null;
  const written = textOf(bytes);
  // Some tags hold the id as text already; then it is used as it stands.
  const id = written && /^[0-9a-z]{4,}$/i.test(written) ? written : bytes.toString('hex');
  return /[^0]/.test(id) ? id.toUpperCase() : null;
}

/**
 * What the blocks of a Bambu tag say. Null when they do not hold a spool's id and material: a tag of some other
 * kind, or a read that went wrong.
 */
export function decodeBambuTag(blocks: TagBlocks): TagFacts | null {
  const tagId = trayId(block(blocks, 9));
  const material = textOf(block(blocks, 2));
  if (!tagId || !material) return null;

  const colourBlock = block(blocks, 5);
  const temps = block(blocks, 6);
  const hottest = temps ? between(temps.readUInt16LE(8), 100, 500) : null;
  const coolest = temps ? between(temps.readUInt16LE(10), 100, 500) : null;
  const diameter = colourBlock ? between(colourBlock.readFloatLE(8), 1, 4) : null;

  return {
    state: 'loaded',
    material,
    subType: textOf(block(blocks, 4)),
    colour: colourBlock ? `#${colourBlock.subarray(0, 3).toString('hex')}` : null,
    colours: [],
    brand: 'Bambu Lab',
    tagId,
    // The tag is written at the factory: it knows how much the spool started with, not how much is left.
    remainingPercent: null,
    spoolWeightGrams: colourBlock ? between(colourBlock.readUInt16LE(4), 1, 20_000) : null,
    nozzleTemp: hottest && coolest ? [Math.min(coolest, hottest), Math.max(coolest, hottest)] : null,
    diameter: diameter === null ? null : Math.round(diameter * 100) / 100,
  };
}

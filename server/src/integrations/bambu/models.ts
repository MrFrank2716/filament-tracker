/**
 * Bambu Lab model names, from the code a printer announces on the network or reports about itself,
 * and as a last resort from the first three characters of its serial number.
 */
const BY_CODE: Record<string, string> = {
  'BL-P001': 'X1 Carbon',
  'BL-P002': 'X1',
  C11: 'P1P',
  C12: 'P1S',
  C13: 'X1E',
  N1: 'A1 mini',
  N2S: 'A1',
  N7: 'P2S',
  O1D: 'H2D',
  O1E: 'H2D Pro',
  O1S: 'H2S',
  O1C: 'H2C',
};

const BY_SERIAL_PREFIX: Record<string, string> = {
  '00M': 'X1 Carbon',
  '00W': 'X1',
  '03W': 'X1E',
  '01S': 'P1P',
  '01P': 'P1S',
  '030': 'A1 mini',
  '039': 'A1',
  '094': 'H2D',
};

export function bambuModelName(code: string | null | undefined, serial?: string): string {
  const known = code ? BY_CODE[code.trim().toUpperCase()] : undefined;
  if (known) return known;
  const fromSerial = serial ? BY_SERIAL_PREFIX[serial.slice(0, 3).toUpperCase()] : undefined;
  return fromSerial ?? (code ?? '').trim();
}

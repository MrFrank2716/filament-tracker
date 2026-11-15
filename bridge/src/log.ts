/**
 * Plain timestamped lines. Access codes and tokens are never passed to these functions, so there is nothing to redact;
 * keep it that way.
 */
const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export const log = {
  info: (message: string) => console.log(`${stamp()}  ${message}`),
  warn: (message: string) => console.warn(`${stamp()}  ! ${message}`),
  error: (message: string) => console.error(`${stamp()}  !! ${message}`),
};

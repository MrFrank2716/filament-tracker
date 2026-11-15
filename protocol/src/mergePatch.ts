/**
 * The two ways a printer's status document changes.
 *
 * Printer to bridge: printers send either the whole status or only what changed, so the bridge folds every
 * message into one document (mergeDelta).
 * Bridge to server: the bridge sends the difference between what it last sent and what it holds now as a
 * JSON merge patch (RFC 7396): objects are merged, anything else is replaced, null removes a key.
 */

export type Doc = Record<string, unknown>;

const MAX_DEPTH = 12;

const isObject = (value: unknown): value is Doc => typeof value === 'object' && value !== null && !Array.isArray(value);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => deepEqual(value, b[index]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => key in b && deepEqual(a[key], b[key]));
  }
  return false;
}

/** The patch that turns `from` into `to`, or undefined when they are the same. */
export function diffMergePatch(from: unknown, to: unknown, depth = 0): unknown {
  if (!isObject(from) || !isObject(to) || depth >= MAX_DEPTH) return deepEqual(from, to) ? undefined : to;
  const patch: Doc = {};
  for (const key of Object.keys(to)) {
    const change = diffMergePatch(from[key], to[key], depth + 1);
    if (change !== undefined) patch[key] = change;
  }
  for (const key of Object.keys(from)) if (!(key in to)) patch[key] = null;
  return Object.keys(patch).length ? patch : undefined;
}

export function applyMergePatch(target: unknown, patch: unknown, depth = 0): unknown {
  if (!isObject(patch) || depth >= MAX_DEPTH) return patch;
  const result: Doc = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__' || key === 'constructor') continue;
    if (value === null) delete result[key];
    else result[key] = applyMergePatch(result[key], value, depth + 1);
  }
  return result;
}

/**
 * Fold one printer message into the document.
 *
 * Objects merge key by key. Lists of objects that carry `arrayKey` (the trays and feeders) merge element by
 * element on that key, because some printers only send the element that changed. An element that carries
 * nothing but its key means "this place is now empty", so it replaces what was there.
 * Any other list replaces the old one.
 */
export function mergeDelta(target: unknown, delta: unknown, arrayKey: string | null = 'id', depth = 0): unknown {
  if (delta === null || delta === undefined) return target;
  if (depth >= MAX_DEPTH) return delta;
  if (Array.isArray(delta)) {
    const keyed = (list: unknown[]): list is Doc[] => arrayKey !== null && list.length > 0 && list.every((el) => isObject(el) && arrayKey in el);
    if (!Array.isArray(target) || !keyed(delta) || (target.length > 0 && !keyed(target))) return delta;
    const result = [...(target as Doc[])];
    for (const element of delta) {
      const index = result.findIndex((existing) => String(existing[arrayKey!]) === String(element[arrayKey!]));
      if (index === -1) result.push(element);
      else result[index] = Object.keys(element).length === 1 ? element : (mergeDelta(result[index], element, arrayKey, depth + 1) as Doc);
    }
    return result;
  }
  if (isObject(delta)) {
    const result: Doc = isObject(target) ? { ...target } : {};
    for (const [key, value] of Object.entries(delta)) {
      if (key === '__proto__' || key === 'constructor') continue;
      result[key] = mergeDelta(result[key], value, arrayKey, depth + 1);
    }
    return result;
  }
  return delta;
}

/** A copy without the listed dot paths ("print.sequence_id"), which change constantly and mean nothing. */
export function withoutPaths(doc: Doc, paths: string[]): Doc {
  let result = doc;
  for (const path of paths) {
    const parts = path.split('.');
    const strip = (node: unknown, index: number): unknown => {
      if (!isObject(node) || !(parts[index] in node)) return node;
      const copy = { ...node };
      if (index === parts.length - 1) delete copy[parts[index]];
      else copy[parts[index]] = strip(copy[parts[index]], index + 1);
      return copy;
    };
    result = strip(result, 0) as Doc;
  }
  return result;
}

/** Whether a patch touches any of the listed dot paths (or something beneath them). */
export function touchesPaths(patch: unknown, paths: string[]): boolean {
  return paths.some((path) => {
    let node: unknown = patch;
    for (const part of path.split('.')) {
      if (!isObject(node) || !(part in node)) return false;
      node = node[part];
    }
    return true;
  });
}

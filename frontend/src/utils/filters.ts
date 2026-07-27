/** Toggle an id in/out of a multi-select filter array (immutable). */
export function toggleId(arr: string[], id: string): string[] {
  return arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
}

/** True when the value passes a multi-select filter (empty = show all). */
export function passesMulti(selected: string[], value?: string | null): boolean {
  return selected.length === 0 || (value != null && selected.includes(value));
}

/** True when any of the item's values intersect the selected set (empty = show all). */
export function passesMultiAny(selected: string[], values?: (string | null | undefined)[] | null): boolean {
  if (selected.length === 0) return true;
  return (values || []).some((v) => v != null && selected.includes(v));
}

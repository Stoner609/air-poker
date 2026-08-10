export function seededUnit(seed: number): number {
  let value = (seed + 0x6d2b79f5) >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

export function seededIndex(seed: number, length: number): number {
  if (length < 1) throw new Error("Cannot choose from an empty collection");
  return Math.floor(seededUnit(seed) * length);
}

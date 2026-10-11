// Port of the parts of Go's sort package used by Lute (sort.Strings).
//
// Ported from Go's sort.Strings, which sorts by byte order of the UTF-8 encoding.
// Byte order of UTF-8 equals Unicode code point order, but JS's default sort
// compares UTF-16 code units, which differs for astral characters. Strings
// therefore compares by code point: U+10000 and above sort after U+E000..U+FFFF
// here, while UTF-16 order puts them before.

// compareCodePoints returns a negative, zero or positive number as a sorts
// before, equal to, or after b in code point order.
function compareCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(j)!;
    if (ca !== cb) {
      return ca - cb;
    }
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  // PORT-NOTE: the shorter string sorts first when it is a prefix, like Go.
  return (a.length - i) - (b.length - j);
}

// Strings sorts a slice of strings in place in code point order (sort.Strings).
export function Strings(a: string[]): void {
  // PERF-TODO: codePointAt per comparison; a precomputed key would be faster for large slices.
  a.sort(compareCodePoints);
}

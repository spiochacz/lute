// Switch between the quick default run (`npm test`) and the full run (`npm run test:full`, which loads .env.full).
// In the quick run the tests that cross a large corpus with many option sets run the cross product on a deterministic sample:
// the base option sets still see every document, the other sets see every sixth one (a different residue per set, so together they still reach all documents).

export const FULL: boolean = "1" === process.env.LUTE_TEST_FULL;

// Every EVERY-th item for set number `salt`; everything in the full run.
export const EVERY = 6;

export function sample<T>(items: readonly T[], salt: number, every: number = EVERY): T[] {
  if (FULL) {
    return items.slice();
  }
  return items.filter((_, i) => (i + salt) % every === 0);
}

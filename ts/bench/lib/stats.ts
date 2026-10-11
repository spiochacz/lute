// Statistics and the verdict shared by the macro and the start-up benchmarks.
//
// The verdict compares the fastest process of each side (its own median), as in
// bench/macro.ts. A ratio within 20% of the reference is "same"; the spread is the
// max over min of the per-process medians of one side, flagged UNSTABLE above 1.5.

export const SAME = 0.2;
export const UNSTABLE = 1.5;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

export function spreadOf(xs: number[]): number {
  return Math.max(...xs) / Math.min(...xs);
}

export function verdictFor(port: number, ref: number): { ratio: number; verdict: string } {
  const ratio = port / ref;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return { ratio, verdict: "DEFECT (zero or non-finite time)" };
  }
  if (Math.abs(ratio - 1) < SAME) {
    return { ratio, verdict: `same (${ratio.toFixed(2)}x)` };
  }
  return { ratio, verdict: ratio > 1 ? `port ${ratio.toFixed(2)}x slower` : `port ${(1 / ratio).toFixed(2)}x faster` };
}

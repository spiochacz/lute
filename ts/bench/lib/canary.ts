// Canary and discard rule shared by the benchmark children and the readers of their results
// (bench/macro.ts, bench/runtime-micro.ts, bench/aa.ts, bench/compare.ts, bench/rejudge-macro.ts).
//
// Why: on the benchmark laptop (i7-1360P) every process slows down 2.2 to 2.6 times about 2 to 3
// seconds after it starts sustained CPU work, even a pure arithmetic loop with no allocation
// (tasks/004-incremental-and-fast-paths.md, "Correction: the 2.5x slowdown of repeated 5 MB calls is
// the machine"). So a child that runs for a long time mixes two CPU speeds, and its absolute times
// are inflated. Rules that follow from this:
// - Never compare the first call against later calls inside one process.
// - Absolute times from processes that run longer than 2 s are inflated on this machine.
// - Keep one measurement per short process, and judge each process by a canary.
//
// The canary is a fixed arithmetic loop (no allocation, no Lute code). Each child times it right
// before its warm-up and right after its last timed batch.
//
// The discard rule (judgeRun), applied once to the whole run (every process of every side):
// 1. End/start: a process is discarded when its end/start canary ratio is above CANARY_MAX_RATIO
//    (1.3), i.e. it left the fast window while it ran. Rule "end-start".
// 2. Start: let R be the lower quartile (nearest rank, 25th percentile) of the start canaries of
//    the whole run. A process is discarded when its start canary is above CANARY_START_FACTOR (1.5)
//    times R. Rule "start". R is a low quantile, so one extreme sample cannot move it, and it is
//    taken from the pool of all processes, so it is the fast state even when the run is mostly in
//    the slow state (the median would not be). In the measured data the fast state is a continuum
//    from 1.0 to about 1.5 times the run's minimum, a trough between about 1.55 and 1.95, and a
//    smaller slow mode at about 2.0 to 4.5 times the minimum; 1.5 times R falls in the trough.
// 3. Minimum kept per side: a side (one row on one side) with fewer than CANARY_MIN_KEPT (3)
//    processes left after rules 1 and 2 is WEAK. If some of its processes were discarded, the
//    fastest-start half of the side is restored (ceil of half its processes, at least the kept
//    count): the discarded processes are ranked with those of end/start at most 1.3 first, then by
//    start canary, and the first ones are put back (keptByFallback: true, the reason says so).
//    So a side with at least one canary never ends with zero processes, and a weak side always
//    says so (side.weak, and the row's weak flag in every result file).
// A process without a canary (an old result file) is never discarded, and it does not take part in
// the reference, so old files keep their meaning.
//
// Every number in the discard rule is in CANARY_* below and is written to each result file.
//
// The loop is the one of ts/experiments/dom2md-cache/cold-proto/proc_time.ts. The iteration count is
// not calibrated against this machine yet: check once that a canary takes about 15-25 ms in the fast
// state (it is printed in every child result as startMs), and change CANARY_ITERATIONS if it does not.

import { performance } from "node:perf_hooks";

export const CANARY_ITERATIONS = 6_000_000;
export const CANARY_MAX_RATIO = 1.3; // rule end-start
export const CANARY_START_FACTOR = 1.5; // rule start: start canary above this times the reference
export const CANARY_REFERENCE_QUANTILE = 0.25; // the reference R is this quantile of the start canaries
export const CANARY_MIN_KEPT = 3; // a side with fewer kept processes is weak

export interface Canary {
  startMs: number; // canary before the warm-up of the child
  endMs: number; // canary after the last timed batch
  ratio: number; // endMs / startMs
}

export type DiscardRule = "end-start" | "start";

// Anything that carries a canary and the discard flags: a macro side process, a runtime-micro process.
// discardRule is the rule that discarded the process (null when it is kept); old files lack it.
// keptByFallback is true when the process would have been discarded, but the minimum kept per
// side put it back (see judgeRun). Old files lack it.
export interface Judged {
  canary: Canary | null;
  discarded: boolean;
  discardRule?: DiscardRule | null;
  discardReason: string | null;
  keptByFallback?: boolean;
}

export interface RunJudgement {
  referenceMs: number | null; // R, null when no process of the run has a canary
  weak: boolean[]; // one per side, in the order of the input
}

let sink = 0;

function loop(): number {
  let x = 1;
  for (let i = 0; i < CANARY_ITERATIONS; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
  }
  return x;
}

// Untimed. Run once in the child first, so that the timed canaries run optimised code.
export function canaryWarmUp(): void {
  sink = (sink ^ loop()) | 0;
}

// Times one canary and returns milliseconds.
export function canaryMs(): number {
  const t = performance.now();
  sink = (sink ^ loop()) | 0;
  return performance.now() - t;
}

export function makeCanary(startMs: number, endMs: number): Canary {
  return { startMs, endMs, ratio: endMs / startMs };
}

// Nearest rank: the value at position ceil(q * n) of the ascending list (1-based), no interpolation.
function nearestRank(sorted: number[], q: number): number {
  const i = Math.ceil(q * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, i))];
}

function startOf(p: Judged): number {
  return p.canary === null ? Number.POSITIVE_INFINITY : p.canary.startMs;
}

// Sets discarded, discardRule and discardReason of every process of the run, applies the minimum
// kept per side, and says which sides are weak. Call it once per run, before any statistics.
// sides: one array per side (a macro side, or a runtime-micro row), all sides of the run.
export function judgeRun(sides: Judged[][]): RunJudgement {
  for (const side of sides) {
    for (const p of side) {
      p.discarded = false;
      p.discardRule = null;
      p.discardReason = null;
      p.keptByFallback = false;
    }
  }
  const starts = sides
    .flat()
    .filter((p) => p.canary !== null)
    .map((p) => (p.canary as Canary).startMs)
    .sort((a, b) => a - b);
  const referenceMs = starts.length === 0 ? null : nearestRank(starts, CANARY_REFERENCE_QUANTILE);

  for (const side of sides) {
    for (const p of side) {
      if (p.canary === null) {
        continue;
      }
      if (p.canary.ratio > CANARY_MAX_RATIO) {
        p.discarded = true;
        p.discardRule = "end-start";
        p.discardReason = `canary end/start ${p.canary.ratio.toFixed(2)} above ${CANARY_MAX_RATIO}`;
      } else if (referenceMs !== null && p.canary.startMs > CANARY_START_FACTOR * referenceMs) {
        p.discarded = true;
        p.discardRule = "start";
        p.discardReason = `start canary ${p.canary.startMs.toFixed(1)} ms is ${(p.canary.startMs / referenceMs).toFixed(2)} times the run's reference (${referenceMs.toFixed(1)} ms, lower quartile), above ${CANARY_START_FACTOR}`;
      }
    }
  }

  const weak = sides.map((side) => {
    if (!side.some((p) => p.canary !== null)) {
      return false;
    }
    const kept = side.filter((p) => !p.discarded).length;
    if (kept >= CANARY_MIN_KEPT) {
      return false;
    }
    if (kept < side.length) {
      // Some processes were discarded: restore the fastest-start half of the side. Kept processes are
      // never changed; the ones put back are the first discarded ones in the rank order. A kept
      // process has a canary start below the rule-2 line, so it ranks ahead of the rule-2 discards.
      const keepCount = Math.max(Math.ceil(side.length / 2), kept);
      const ranked = [...side].sort((a, b) => {
        const ra = a.discardRule === "end-start" ? 1 : 0;
        const rb = b.discardRule === "end-start" ? 1 : 0;
        return ra - rb || startOf(a) - startOf(b);
      });
      for (const p of ranked.slice(0, keepCount)) {
        if (p.discarded) {
          p.keptByFallback = true;
          p.discardReason = `kept by the fallback of a side with fewer than ${CANARY_MIN_KEPT} processes left (would be discarded: ${p.discardReason})`;
          p.discarded = false;
          p.discardRule = null;
        }
      }
    }
    return true;
  });
  return { referenceMs, weak };
}

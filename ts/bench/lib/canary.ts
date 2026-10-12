// Canary and discard rule shared by the benchmark children (bench/macro.ts, bench/runtime-micro.ts).
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
// before its warm-up and right after its last timed batch. The row of a process is discarded when
// - the end/start canary ratio is above 1.3 (the process left the fast window while it ran), or
// - its start canary is more than 1.3 times the fastest start canary of the whole run (the
//   process itself started in the slow window).
// Canaries are judged over the whole run, so the parent calls judgeCanaries once for all processes.
// A process without canary fields (an old result file) is never discarded.
//
// The loop is the one of ts/experiments/dom2md-cache/cold-proto/proc_time.ts. The iteration count is
// not calibrated against this machine yet: check once that a canary takes about 15-25 ms in the fast
// state (it is printed in every child result as startMs), and change CANARY_ITERATIONS if it does not.

import { performance } from "node:perf_hooks";

export const CANARY_ITERATIONS = 6_000_000;
export const CANARY_MAX_RATIO = 1.3;

export interface Canary {
  startMs: number; // canary before the warm-up of the child
  endMs: number; // canary after the last timed batch
  ratio: number; // endMs / startMs
}

// Anything that carries a canary and the discard flags: a macro side process, a runtime-micro process.
export interface Judged {
  canary: Canary | null;
  discarded: boolean;
  discardReason: string | null;
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

// Sets discarded and discardReason on every process of the run. Returns the fastest start canary of
// the run, or null when no process has a canary.
export function judgeCanaries(all: Judged[]): number | null {
  let fastest: number | null = null;
  for (const p of all) {
    if (p.canary !== null && (fastest === null || p.canary.startMs < fastest)) {
      fastest = p.canary.startMs;
    }
  }
  for (const p of all) {
    p.discarded = false;
    p.discardReason = null;
    if (p.canary === null) {
      continue;
    }
    if (p.canary.ratio > CANARY_MAX_RATIO) {
      p.discarded = true;
      p.discardReason = `canary end/start ${p.canary.ratio.toFixed(2)} above ${CANARY_MAX_RATIO}`;
    } else if (fastest !== null && p.canary.startMs > CANARY_MAX_RATIO * fastest) {
      p.discarded = true;
      p.discardReason = `start canary ${p.canary.startMs.toFixed(1)} ms is ${(p.canary.startMs / fastest).toFixed(2)} times the run's fastest (${fastest.toFixed(1)} ms)`;
    }
  }
  return fastest;
}

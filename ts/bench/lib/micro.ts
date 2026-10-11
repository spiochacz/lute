// Micro-benchmark helper for the Lute TypeScript runtime.
//
// bench() measures time per operation in the current process. allocBytesPerOp()
// estimates heap bytes allocated per operation. The runner (bench/runtime-micro.ts)
// runs each row in its own child process, so JIT state from one row never leaks
// into another, and aggregates several processes per row.
//
// Checksum: bench() folds the result of exactly ONE operation (run before the
// warm-up), so the checksum depends only on the code and the input, never on how
// many iterations were run.

import { PerformanceObserver } from "node:perf_hooks";

export interface BenchOptions {
  warmupMs?: number; // default 300 ms
  batches?: number; // timed batches kept, default 20
  discardBatches?: number; // leading timed batches thrown away, default 3
  batchMs?: number; // target duration of one batch, default 50 ms
  unit?: string;
  unitsPerOp?: number;
}

export interface BenchResult {
  nsPerOpMedian: number;
  nsPerOpMin: number;
  nsPerOpMax: number;
  unit: string;
  unitsPerOp: number;
  nsPerUnitMedian: number;
  batches: number;
  itersPerBatch: number;
  checksum: number;
}

export interface AllocResult {
  bytesPerOp: number | null; // null when a GC happened even with one op
  opsMeasured: number;
}

let sink = 0;

// fold mixes one operation result into an int32 checksum.
export function fold(acc: number, v: unknown): number {
  switch (typeof v) {
    case "number":
      return (acc + (v | 0)) | 0;
    case "boolean":
      return (acc + (v ? 1 : 0)) | 0;
    case "string":
      return (acc + v.length) | 0;
    case "object": {
      if (v === null) {
        return acc;
      }
      if (ArrayBuffer.isView(v)) {
        const u = v as unknown as Uint8Array;
        return (acc + u.length + (u.length > 0 ? u[0] : 0)) | 0;
      }
      if (Array.isArray(v)) {
        let a = acc;
        for (const x of v) {
          a = fold(a, x);
        }
        return a;
      }
      return acc;
    }
    default:
      return acc;
  }
}

// bench times fn in this process. The iteration count per batch is calibrated
// once, from the warm-up, and then fixed for every batch of this process.
export async function bench(fn: () => unknown, opts: BenchOptions = {}): Promise<BenchResult> {
  const warmupMs = opts.warmupMs ?? 200;
  const batches = opts.batches ?? 15;
  const discard = opts.discardBatches ?? 2;
  const batchMs = opts.batchMs ?? 30;

  // Checksum of exactly one operation, before any other call.
  const checksum = fold(0, fn());

  let acc = 0;
  const w0 = performance.now();
  let warmIters = 0;
  while (performance.now() - w0 < warmupMs || warmIters === 0) {
    acc = fold(acc, fn());
    warmIters++;
  }
  const perOpMs = (performance.now() - w0) / warmIters;
  const iters = Math.max(1, Math.round(batchMs / Math.max(perOpMs, 1e-6)));

  const samples: number[] = [];
  for (let b = 0; b < batches + discard; b++) {
    const s = performance.now();
    for (let i = 0; i < iters; i++) {
      acc = fold(acc, fn());
    }
    const e = performance.now();
    if (b >= discard) {
      samples.push(((e - s) * 1e6) / iters);
    }
  }
  sink = (sink + acc) | 0;

  samples.sort((x, y) => x - y);
  const median = samples[samples.length >> 1];
  const unitsPerOp = opts.unitsPerOp ?? 1;
  return {
    nsPerOpMedian: median,
    nsPerOpMin: samples[0],
    nsPerOpMax: samples[samples.length - 1],
    unit: opts.unit ?? "op",
    unitsPerOp,
    nsPerUnitMedian: median / unitsPerOp,
    batches,
    itersPerBatch: iters,
    checksum,
  };
}

// GC detection. PerformanceObserver delivers gc entries asynchronously, so the
// estimator waits for the event loop to drain before it reads the count.
let gcEntries = 0;
const gcObserver = new PerformanceObserver((list) => {
  gcEntries += list.getEntries().length;
});
gcObserver.observe({ entryTypes: ["gc"] });

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

// quiesce lets the event loop run and gives V8's background sweeper time to
// finish. Without the wait, memory freed by the concurrent sweep after gc() shows
// up as a drop in heapUsed inside the measured window.
function quiesce(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30)).then(settle);
}

function fullGc(): void {
  const g = (globalThis as { gc?: () => void }).gc;
  if (g === undefined) {
    throw new Error("run with --expose-gc (see the bench:runtime npm script)");
  }
  g();
  g();
}

function heapBytes(): number {
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers;
}

const ALLOC_WINDOWS = 5;

// allocBytesPerOp estimates the bytes allocated by one call of fn. Each window
// runs maxOps calls after a warm-up of the same calls and a full GC. Five windows
// are taken and the median per-op value is reported. If a GC happens inside any
// window, the op count is halved and the measurement is repeated. If one op
// already triggers a GC, the result is null.
export async function allocBytesPerOp(fn: () => unknown, maxOps = 256): Promise<AllocResult> {
  let n = maxOps;
  while (n >= 1) {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc = fold(acc, fn());
    }
    sink = (sink + acc) | 0;
    const perOp: number[] = [];
    let gcHit = false;
    for (let w = 0; w < ALLOC_WINDOWS && !gcHit; w++) {
      await settle();
      fullGc();
      await quiesce();
      const before = gcEntries;
      const m0 = heapBytes();
      let a = 0;
      for (let i = 0; i < n; i++) {
        a = fold(a, fn());
      }
      const m1 = heapBytes();
      sink = (sink + a) | 0;
      await settle();
      if (gcEntries !== before) {
        gcHit = true;
        break;
      }
      perOp.push((m1 - m0) / n);
    }
    if (!gcHit) {
      perOp.sort((x, y) => x - y);
      return { bytesPerOp: perOp[perOp.length >> 1], opsMeasured: n };
    }
    n >>= 1;
  }
  return { bytesPerOp: null, opsMeasured: 0 };
}

// gcSeenDuring runs fn and reports whether a GC entry arrived while it ran. It
// exists so that the GC detector can be validated.
export async function gcSeenDuring(fn: () => void): Promise<boolean> {
  await settle();
  fullGc();
  await quiesce();
  const before = gcEntries;
  fn();
  await settle();
  return gcEntries !== before;
}

export function checksumSink(): number {
  return sink;
}

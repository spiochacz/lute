// Macro benchmark: the built port bundle (dist/lute.min.js) against the reference
// bundle (test/oracle/lute.ref.min.cjs), on one or more inputs.
//
// Usage (from ts/):
//   npm run bench:macro -- [tag] [--rounds=N] [--methods=A,B] [--inputs=tiny,small,medium,spec]
//                          [--warmup-ms=N] [--min-ms=N]
//   tag defaults to "latest"; rounds 12; inputs "spec"; warm-up 300 ms; min-ms 700 ms.
//   Writes bench/results/macro.<tag>.json (fresh each run). Builds dist/lute.min.js when it is missing.
//   Quick run: npm run bench:macro -- quick --rounds=1 --methods=MarkdownStr --inputs=tiny,small --warmup-ms=200 --min-ms=300
//   Smoke run: npm run bench:macro -- smoke --rounds=2 --methods=MarkdownStr,VditorDOM2Md --inputs=small,spec
//
// Inputs (bench/lib/inputs.ts): tiny (one paragraph, ~100 bytes), small (~1 KB, the
// constant of bench/startup.ts), medium (the first ~10 KB of benchmark/commonmark-spec.md,
// cut at a line), spec (the whole 212 KB file). Rows are keyed "method|input".
//
// Why the processes are short (read this before changing the defaults):
// on this machine every process slows down 2.2 to 2.6 times about 2 to 3 seconds after it
// starts sustained CPU work, even a pure arithmetic loop (tasks/004-incremental-and-fast-paths.md,
// "Correction: the 2.5x slowdown of repeated 5 MB calls is the machine"). So
// - never compare the first call against later calls inside one process;
// - absolute times from processes that run longer than 2 s are inflated;
// - each child must stay under about 1.5 s of CPU-busy time, and a child whose canary says it
//   ran in the slow window is discarded (bench/lib/canary.ts).
//
// Design:
// - Each measurement is a child process that loads ONE bundle, the same way as
//   test/e2e/bundle_driver.mjs (the bundle sets globalThis.Lute), and times ONE method on
//   one input, on the engine of bench/lib/methods.ts.
// - Canary: the child times a fixed arithmetic loop right before its warm-up and right after
//   its last timed batch (start and end canary, and their ratio, are in the result). The parent
//   judges every process of the run once all rows are known (bench/lib/canary.ts, judgeRun):
//   1. end-start rule: a process whose end/start canary ratio is above 1.3 is discarded;
//   2. start rule: R = the lower quartile (25th percentile, nearest rank) of the start canaries of
//      the whole run; a process whose start canary is above 1.5 x R is discarded;
//   3. minimum kept: a side (one row on one side) left with fewer than 3 processes is WEAK. Then
//      its fastest-start half is restored (keptByFallback), so no side loses all its processes.
//   Discarded processes are kept in the JSON (flag "discarded", "discardRule", "discardReason")
//   and left out of the verdict; a weak side is flagged in the JSON ("weak", per side and per row)
//   and in the table. A process with no canary (an old file) is never discarded.
// - Noise floor of the tool (A/A run, the same bundle on both sides, four methods on small and
//   spec): all 8 rows "same"; the largest deviation from 1.00x is 1.03x (VditorDOM2Md|small, MarkdownStr|spec),
//   so the tool reports differences below about 3% as noise. Measured with the discard rule of
//   bench/lib/canary.ts (tag aa-macro, results/macro.aa-macro.json).
// - Budget: the child's CPU-busy time (load, warm-up, timed batches, and the output checks)
//   should stay under about 1.5 s (CHILD_BUDGET_MS, measured from process start).
// - Timing is in batches, so that the microsecond calls of tiny and small inputs are not
//   drowned by the clock. The warm-up (warmup-ms, 300 ms by default) calibrates the number of
//   calls per batch so that one batch lasts about 20 ms, and one unrecorded batch recalibrates it.
//   The spec input always uses one call per batch.
// - Batch rule: a child times at least 15 batches (PREFERRED_BATCHES) and at least min-ms (700 ms
//   by default). If the estimate (the CPU time used so far plus max(15 batches, min-ms)) would
//   exceed the budget, the child times at least 5 batches (FALLBACK_BATCHES) instead. The chosen
//   number is printed in the JSON per child (minBatches). With the default warm-up, one spec call
//   of 20-60 ms fits 15 batches; the slowest methods (up to 200 ms per call) get 5.
// - The round-trip inputs (HTML2Md, BlockDOM2Md, SpinBlockDOM, VditorDOM2Md, SpinVditorDOM)
//   are produced by the reference, in the parent, once per input. The parent never times
//   anything. Both sides get the same input on stdin.
// - Per method and input: `rounds` rounds (12 by default), each round runs the port child and then the
//   reference child (interleaved, so drift hits both alike).
// - Output hash: sha256 (first 16 hex digits) of the first call's output after the ID and
//   timestamp normalisation of test/e2e/helpers.ts (the same patterns, applied here because
//   importing helpers.ts would load the port into the reference child). Hashes use every process,
//   discarded or not. The output length is checked again after the timed batches.
// - Verdict as in bench/lib/stats.ts, over the processes that were not discarded: the fastest
//   process per side (its median time per call), 20% threshold relative to the reference; spread
//   = max / min over the kept processes of one side, flagged UNSTABLE above 1.5. The table has a
//   "procs" column with the kept/run count per side, and a row whose side is WEAK (fewer than 3
//   kept processes, see bench/lib/canary.ts) is flagged "weak" there and in the JSON. A side with
//   no process at all gives no verdict. The run prints a warning line for every row where more
//   than a third of its processes were discarded.
// - A method where both sides throw (or both lack it) is skipped and says so. If only one
//   side throws or lacks it, the run fails.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeIDs } from "../test/oracle/oracle.ts";
import { machineInfo, type MachineInfo } from "./lib/micro.ts";
import { METHODS, findMethod, makeEngine, type Engine, type InputKind, type LuteGlobal, type MethodSpec } from "./lib/methods.ts";
import {
  INPUT_NAMES,
  PORT_BUNDLE,
  REF_BUNDLE,
  TS_ROOT,
  isInputName,
  loadBundle,
  makeRoundTripInputs,
  markdownInput,
  type InputName,
} from "./lib/inputs.ts";
import { UNSTABLE, median, spreadOf, verdictFor } from "./lib/stats.ts";
import {
  CANARY_ITERATIONS,
  CANARY_MAX_RATIO,
  CANARY_MIN_KEPT,
  CANARY_REFERENCE_QUANTILE,
  CANARY_START_FACTOR,
  canaryMs,
  canaryWarmUp,
  judgeRun,
  makeCanary,
  type Canary,
  type Judged,
} from "./lib/canary.ts";

const BUILD_SCRIPT = fileURLToPath(new URL("../scripts/build.mjs", import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const ROUNDS = 12;
const WARMUP_MS = 300;
const MIN_MS = 700;
const PREFERRED_BATCHES = 15;
const FALLBACK_BATCHES = 5;
const CHILD_BUDGET_MS = 1500;
const BATCH_MS = 20;
const DISCARD_SHARE = 1 / 3;

type Side = "port" | "ref";

// ---------------------------------------------------------------- options

function option(args: string[], name: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 1);
}

function intOption(args: string[], name: string, fallback: number, min: number): number {
  const raw = option(args, name);
  if (raw === undefined) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`${name} must be an integer >= ${min}, got ${raw}`);
  }
  return n;
}

// ---------------------------------------------------------------- child mode

interface ChildOut {
  side: Side;
  method: string;
  input: string;
  missing: boolean;
  threw: boolean;
  error: string;
  itersPerBatch: number;
  batches: number;
  minBatches: number;
  calls: number;
  minUs: number;
  medianUs: number;
  timesUs: number[];
  outputHash: string;
  outputLength: number;
  lengthsStable: boolean;
  canary: Canary | null;
}

let sink = 0;

// Calls of one method in batches. The warm-up calibrates the batch size; the spec input
// always uses one call per batch. The number of timed batches follows the batch rule of the
// header (15 if it fits the CPU budget, else 5).
function timeBatches(
  call: () => string,
  singleCall: boolean,
  warmupMs: number,
  minMs: number,
): { itersPerBatch: number; timesUs: number[]; calls: number; minBatches: number } {
  let n = 0;
  const w0 = performance.now();
  do {
    sink += call().length;
    n++;
  } while (performance.now() - w0 < warmupMs || n === 0);
  const perCallMs = (performance.now() - w0) / n;

  let iters = singleCall ? 1 : Math.max(1, Math.round(BATCH_MS / perCallMs));
  if (!singleCall) {
    // One unrecorded batch recalibrates the batch size from the measured time.
    const s = performance.now();
    for (let i = 0; i < iters; i++) {
      sink += call().length;
    }
    const took = performance.now() - s;
    iters = Math.max(1, Math.round((iters * BATCH_MS) / Math.max(took, 1e-3)));
  }

  // Batch rule: performance.now() counts from process start, so it is the CPU time used so far.
  const batchMs = singleCall ? perCallMs : BATCH_MS;
  const fits = performance.now() + Math.max(PREFERRED_BATCHES * batchMs, minMs) <= CHILD_BUDGET_MS;
  const minBatches = fits ? PREFERRED_BATCHES : FALLBACK_BATCHES;

  const timesUs: number[] = [];
  const t0 = performance.now();
  while (timesUs.length < minBatches || performance.now() - t0 < minMs) {
    const s = performance.now();
    for (let i = 0; i < iters; i++) {
      sink += call().length;
    }
    const e = performance.now();
    timesUs.push(((e - s) * 1000) / iters);
  }
  return { itersPerBatch: iters, timesUs, calls: timesUs.length * iters, minBatches };
}

// Loads one bundle, times one method on one input, prints ROW_RESULT. The input comes on stdin.
function child(side: Side, methodName: string, inputName: string, warmupMs: number, minMs: number): void {
  const input = readFileSync(0, "utf8");
  const spec = findMethod(methodName);
  if (spec === undefined) {
    throw new Error(`unknown method ${methodName}`);
  }
  const out: ChildOut = {
    side,
    method: methodName,
    input: inputName,
    missing: false,
    threw: false,
    error: "",
    itersPerBatch: 0,
    batches: 0,
    minBatches: 0,
    calls: 0,
    minUs: 0,
    medianUs: 0,
    timesUs: [],
    outputHash: "",
    outputLength: 0,
    lengthsStable: true,
    canary: null,
  };
  const lute = loadBundle(side === "port" ? PORT_BUNDLE : REF_BUNDLE) as LuteGlobal;
  const engine: Engine = makeEngine(lute, spec);
  if (typeof engine[methodName] !== "function") {
    out.missing = true;
  } else {
    try {
      const call = (): string => String(spec.call(engine, input));
      canaryWarmUp();
      const first = call();
      const startMs = canaryMs();
      const r = timeBatches(call, inputName === "spec", warmupMs, minMs);
      const endMs = canaryMs();
      out.canary = makeCanary(startMs, endMs);
      out.itersPerBatch = r.itersPerBatch;
      out.batches = r.timesUs.length;
      out.minBatches = r.minBatches;
      out.calls = r.calls;
      out.timesUs = r.timesUs;
      out.minUs = Math.min(...r.timesUs);
      out.medianUs = median(r.timesUs);
      out.outputLength = first.length;
      out.outputHash = hashOf(first);
      out.lengthsStable = call().length === first.length;
    } catch (e) {
      out.threw = true;
      out.error = e instanceof Error ? e.message : String(e);
    }
  }
  process.stdout.write(`ROW_RESULT ${JSON.stringify(out)}\n`);
}

// Same normalisation as test/e2e/helpers.ts (normalizeOutput).
const UPDATED_PATTERN = /updated="\d{14}"/g;
const UPDATED_JSON_PATTERN = /"updated":"\d{14}"/g;

function normaliseOutput(s: string): string {
  return normalizeIDs(s).replace(UPDATED_PATTERN, 'updated="TIMESTAMP"').replace(UPDATED_JSON_PATTERN, '"updated":"TIMESTAMP"');
}

function hashOf(s: string): string {
  return createHash("sha256").update(normaliseOutput(s)).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------- parent mode

// One process of one side. The discard flags are set by judgeCanaries, once the whole run is known.
interface Proc extends Judged {
  medianUs: number;
  minUs: number;
  itersPerBatch: number;
  batches: number;
  minBatches: number;
  calls: number;
  timesUs: number[];
  outputHash: string;
  outputLength: number;
  lengthsStable: boolean;
}

interface Processes {
  run: number;
  used: number; // processes not discarded
  weak: boolean; // fewer than CANARY_MIN_KEPT processes left (bench/lib/canary.ts)
  perProcess: Proc[];
  fastestUs: number; // NaN when no process is used
  medianOfMediansUs: number;
  spread: number;
}

interface MethodResult {
  key: string;
  method: string;
  config: string;
  input: InputName;
  inputKind: InputKind;
  inputBytes: number;
  status: "ok" | "skipped";
  skipReason?: string;
  port?: Processes;
  ref?: Processes;
  weak?: boolean; // either side is weak
  ratio?: number;
  verdict?: string;
  hashesAgree?: boolean;
  portHashes?: string[];
  refHashes?: string[];
}

interface Opts {
  warmupMs: number;
  minMs: number;
}

function spawnChild(side: Side, method: string, inputName: string, input: string, opts: Opts): ChildOut {
  const res = spawnSync(
    process.execPath,
    [SELF, "--child", side, method, `--input=${inputName}`, `--warmup-ms=${opts.warmupMs}`, `--min-ms=${opts.minMs}`],
    { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (res.status !== 0) {
    throw new Error(`child ${side} ${method} ${inputName} failed: ${res.stderr}`);
  }
  const line = res.stdout.split("\n").find((l) => l.startsWith("ROW_RESULT "));
  if (line === undefined) {
    throw new Error(`no result from child ${side} ${method} ${inputName}`);
  }
  return JSON.parse(line.slice("ROW_RESULT ".length)) as ChildOut;
}

function procOf(c: ChildOut): Proc {
  return {
    medianUs: c.medianUs,
    minUs: c.minUs,
    itersPerBatch: c.itersPerBatch,
    batches: c.batches,
    minBatches: c.minBatches,
    calls: c.calls,
    timesUs: c.timesUs,
    outputHash: c.outputHash,
    outputLength: c.outputLength,
    lengthsStable: c.lengthsStable,
    canary: c.canary,
    discarded: false,
    discardRule: null,
    discardReason: null,
  };
}

function sideOf(list: ChildOut[]): Processes {
  return { run: list.length, used: list.length, weak: false, perProcess: list.map(procOf), fastestUs: NaN, medianOfMediansUs: NaN, spread: NaN };
}

// Summary of the processes that were not discarded.
function summariseSide(side: Processes): void {
  const kept = side.perProcess.filter((p) => !p.discarded);
  const medians = kept.map((p) => p.medianUs);
  side.used = kept.length;
  side.fastestUs = kept.length === 0 ? NaN : Math.min(...medians);
  side.medianOfMediansUs = kept.length === 0 ? NaN : median(medians);
  side.spread = kept.length === 0 ? NaN : spreadOf(medians);
}

function measureMethod(spec: MethodSpec, inputName: InputName, input: string, rounds: number, opts: Opts): MethodResult {
  const base = {
    key: `${spec.name}|${inputName}`,
    method: spec.name,
    config: spec.config,
    input: inputName,
    inputKind: spec.input,
    inputBytes: Buffer.byteLength(input, "utf8"),
  };
  const portRuns: ChildOut[] = [];
  const refRuns: ChildOut[] = [];
  for (let r = 0; r < rounds; r++) {
    const p = spawnChild("port", spec.name, inputName, input, opts);
    const q = spawnChild("ref", spec.name, inputName, input, opts);
    if (r === 0) {
      if (p.missing && q.missing) {
        return { ...base, status: "skipped", skipReason: "missing on both sides" };
      }
      if (p.missing !== q.missing) {
        throw new Error(`${spec.name} on ${inputName}: ${p.missing ? "port" : "reference"} has no such method`);
      }
      if (p.threw && q.threw) {
        return { ...base, status: "skipped", skipReason: `threw on both sides: port: ${p.error} | reference: ${q.error}` };
      }
    }
    if (p.missing || q.missing || p.threw !== q.threw || p.threw || q.threw) {
      throw new Error(
        `${spec.name} on ${inputName} round ${r + 1}: port ${p.threw ? "threw (" + p.error + ")" : "returned"}, reference ${q.threw ? "threw (" + q.error + ")" : "returned"}`,
      );
    }
    portRuns.push(p);
    refRuns.push(q);
  }
  const portHashes = [...new Set(portRuns.map((c) => c.outputHash))];
  const refHashes = [...new Set(refRuns.map((c) => c.outputHash))];
  return {
    ...base,
    status: "ok",
    port: sideOf(portRuns),
    ref: sideOf(refRuns),
    hashesAgree: portHashes.length === 1 && refHashes.length === 1 && portHashes[0] === refHashes[0],
    portHashes,
    refHashes,
  };
}

// Judges every process of the run (the reference of the start rule is run-wide), then summarises
// each side over the processes that were not discarded. Called before every save and before the table.
function finalize(results: MethodResult[]): void {
  const ok = results.filter((r): r is MethodResult & { port: Processes; ref: Processes } => r.status === "ok" && r.port !== undefined && r.ref !== undefined);
  const { weak } = judgeRun(ok.flatMap((r) => [r.port.perProcess, r.ref.perProcess]));
  ok.forEach((r, i) => {
    r.port.weak = weak[2 * i];
    r.ref.weak = weak[2 * i + 1];
    r.weak = r.port.weak || r.ref.weak;
    summariseSide(r.port);
    summariseSide(r.ref);
    if (r.port.used === 0 || r.ref.used === 0) {
      r.ratio = undefined;
      r.verdict = "no verdict (all processes of one side discarded)";
    } else {
      const v = verdictFor(r.port.fastestUs, r.ref.fastestUs);
      r.ratio = v.ratio;
      r.verdict = v.verdict;
    }
  });
}

// us per call, as ms from 1 ms up. NaN (no kept process) prints as a dash.
function fmtTime(us: number): string {
  if (!Number.isFinite(us)) {
    return "-";
  }
  if (us >= 1000) {
    return `${(us / 1000).toFixed(us >= 100000 ? 1 : 2)} ms`;
  }
  return `${us.toFixed(us >= 100 ? 1 : 2)} µs`;
}

function fmtSpread(x: number): string {
  return Number.isFinite(x) ? x.toFixed(2) : "-";
}

function printTable(results: MethodResult[]): void {
  console.log(
    `\n${"method|input".padEnd(28)} ${"port fastest".padStart(12)}  ${"ref fastest".padStart(12)}  ${"verdict (port vs reference, same within 20%)".padEnd(46)}  spread port  spread ref  procs port  procs ref  hashes`,
  );
  for (const r of results) {
    if (r.status === "skipped") {
      console.log(`${r.key.padEnd(28)} SKIPPED: ${r.skipReason}`);
      continue;
    }
    const p = r.port as Processes;
    const q = r.ref as Processes;
    const flags = [
      p.weak ? "port WEAK (fewer than 3 kept)" : "",
      q.weak ? "ref WEAK (fewer than 3 kept)" : "",
      p.spread > UNSTABLE ? "port UNSTABLE" : "",
      q.spread > UNSTABLE ? "ref UNSTABLE" : "",
    ]
      .filter((x) => x !== "")
      .join(", ");
    console.log(
      `${r.key.padEnd(28)} ${fmtTime(p.fastestUs).padStart(12)}  ${fmtTime(q.fastestUs).padStart(12)}  ${(r.verdict ?? "").padEnd(46)}  ` +
        `${fmtSpread(p.spread).padStart(11)}  ${fmtSpread(q.spread).padStart(10)}  ${`${p.used}/${p.run}`.padStart(10)}  ${`${q.used}/${q.run}`.padStart(9)}  ` +
        `${r.hashesAgree ? "agree" : "DIFFER"}${flags ? "  " + flags : ""}`,
    );
  }
}

// Rows where more than a third of the processes were discarded.
function discardWarnings(results: MethodResult[]): string[] {
  const out: string[] = [];
  for (const r of results) {
    if (r.status !== "ok" || r.port === undefined || r.ref === undefined) {
      continue;
    }
    const total = r.port.run + r.ref.run;
    const discarded = total - r.port.used - r.ref.used;
    if (discarded > total * DISCARD_SHARE) {
      out.push(
        `WARNING ${r.key}: ${discarded} of ${total} processes discarded (port ${r.port.run - r.port.used}, reference ${r.ref.run - r.ref.used}); more than a third of the run`,
      );
    }
  }
  return out;
}

function parent(): void {
  const args = process.argv.slice(2);
  const tag = args.find((a) => !a.startsWith("--")) ?? "latest";
  const rounds = intOption(args, "--rounds", ROUNDS, 1);
  const opts: Opts = { warmupMs: intOption(args, "--warmup-ms", WARMUP_MS, 0), minMs: intOption(args, "--min-ms", MIN_MS, 0) };

  const methodsArg = option(args, "--methods");
  const wanted = methodsArg === undefined ? null : new Set(methodsArg.split(","));
  if (wanted !== null) {
    for (const w of wanted) {
      if (findMethod(w) === undefined) {
        throw new Error(`unknown method in --methods: ${w}`);
      }
    }
  }
  const selected = METHODS.filter((m) => wanted === null || wanted.has(m.name));

  const inputsArg = option(args, "--inputs");
  const inputNames = inputsArg === undefined ? (["spec"] as InputName[]) : inputsArg.split(",");
  for (const n of inputNames) {
    if (!isInputName(n)) {
      throw new Error(`unknown input in --inputs: ${n} (known: ${INPUT_NAMES.join(", ")})`);
    }
  }

  if (!existsSync(PORT_BUNDLE)) {
    console.log("dist/lute.min.js is missing; building it");
    const b = spawnSync(process.execPath, [BUILD_SCRIPT], { stdio: "inherit", cwd: TS_ROOT });
    if (b.status !== 0) {
      throw new Error("build failed");
    }
  }

  const machine: MachineInfo = machineInfo();
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = `${RESULTS_DIR}macro.${tag}.json`;
  const results: MethodResult[] = [];
  const inputBytes: Record<string, number> = {};
  const save = (): void => {
    finalize(results);
    writeFileSync(
      file,
      JSON.stringify(
        {
          tag,
          rounds,
          machine,
          bundles: { port: "ts/dist/lute.min.js", reference: "ts/test/oracle/lute.ref.min.cjs" },
          inputs: inputBytes,
          timing: {
            warmupMs: opts.warmupMs,
            minMs: opts.minMs,
            batchMs: BATCH_MS,
            preferredBatches: PREFERRED_BATCHES,
            fallbackBatches: FALLBACK_BATCHES,
            childBudgetMs: CHILD_BUDGET_MS,
            unit: "us per call",
          },
          canary: {
            iterations: CANARY_ITERATIONS,
            maxRatio: CANARY_MAX_RATIO,
            startFactor: CANARY_START_FACTOR,
            referenceQuantile: CANARY_REFERENCE_QUANTILE,
            minKept: CANARY_MIN_KEPT,
            discardShare: DISCARD_SHARE,
          },
          methods: results,
        },
        null,
        2,
      ) + "\n",
    );
  };
  const total = selected.length * inputNames.length;
  console.log(`${total} rows (${selected.length} methods x ${inputNames.length} inputs) x ${rounds} rounds x 2 sides (one process each) into ${file}`);
  save();
  let i = 0;
  for (const inputName of inputNames as InputName[]) {
    const markdown = markdownInput(inputName);
    inputBytes[inputName] = Buffer.byteLength(markdown, "utf8");
    const inputs = makeRoundTripInputs(markdown);
    for (const spec of selected) {
      i++;
      console.log(`[${i}/${total}] ${spec.name}|${inputName}`);
      results.push(measureMethod(spec, inputName, inputs[spec.input], rounds, opts));
      save();
    }
  }
  finalize(results);
  printTable(results);
  for (const w of discardWarnings(results)) {
    console.log(w);
  }
  const skipped = results.filter((r) => r.status === "skipped");
  const procs = results.flatMap((r) => (r.status === "ok" && r.port !== undefined && r.ref !== undefined ? [...r.port.perProcess, ...r.ref.perProcess] : []));
  const discarded = procs.filter((p) => p.discarded).length;
  console.log(`\n${results.length - skipped.length} compared, ${skipped.length} skipped (threw or missing on both sides).`);
  const byRule = (rule: string): number => procs.filter((p) => p.discardRule === rule).length;
  const weakRows = results.filter((r) => r.weak === true).length;
  console.log(
    `${discarded} of ${procs.length} processes discarded by the canary rules (excluded from the verdicts; kept in the JSON): ` +
      `end-start ${byRule("end-start")}, start ${byRule("start")}; ` +
      `${procs.filter((p) => p.keptByFallback).length} kept again by the minimum-kept fallback; ${weakRows} weak row(s).`,
  );
  save();
  console.log(`wrote ${file}`);
}

if (process.argv.includes("--child")) {
  const argv = process.argv;
  const at = argv.indexOf("--child");
  const side = argv[at + 1];
  if (side !== "port" && side !== "ref") {
    throw new Error(`--child needs port or ref, got ${side}`);
  }
  const inputName = option(argv, "--input") ?? "spec";
  if (!isInputName(inputName)) {
    throw new Error(`unknown input ${inputName}`);
  }
  child(side, argv[at + 2], inputName, intOption(argv, "--warmup-ms", WARMUP_MS, 0), intOption(argv, "--min-ms", MIN_MS, 0));
} else {
  parent();
}

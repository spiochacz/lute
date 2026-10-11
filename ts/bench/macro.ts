// Macro benchmark: the built port bundle (dist/lute.min.js) against the reference
// bundle (test/oracle/lute.ref.min.cjs), on one or more inputs.
//
// Usage (from ts/):
//   npm run bench:macro -- [tag] [--rounds=N] [--methods=A,B] [--inputs=tiny,small,medium,spec]
//                          [--warmup-ms=N] [--min-ms=N]
//   tag defaults to "latest"; rounds 5; inputs "spec"; warm-up 1000 ms; min-ms 2000.
//   Writes bench/results/macro.<tag>.json (fresh each run). Builds dist/lute.min.js when it is missing.
//   Quick run: npm run bench:macro -- quick --rounds=1 --methods=MarkdownStr --inputs=tiny,small --warmup-ms=200 --min-ms=300
//
// Inputs (bench/lib/inputs.ts): tiny (one paragraph, ~100 bytes), small (~1 KB, the
// constant of bench/startup.ts), medium (the first ~10 KB of benchmark/commonmark-spec.md,
// cut at a line), spec (the whole 212 KB file). Rows are keyed "method|input".
//
// Design:
// - Each measurement is a child process that loads ONE bundle, the same way as
//   test/e2e/bundle_driver.mjs (the bundle sets globalThis.Lute), and times ONE method on
//   one input, on the engine of bench/lib/methods.ts.
// - Timing is in batches, so that the microsecond calls of tiny and small inputs are not
//   drowned by the clock. The warm-up (warmup-ms) calibrates the number of calls per batch
//   so that one batch lasts about 20 ms, and one unrecorded batch recalibrates it. The spec
//   input always uses one call per batch. Timed batches run until there are at least 15
//   batches AND min-ms have passed. Per process: min and median time per call, in
//   microseconds, over the batches.
// - The round-trip inputs (HTML2Md, BlockDOM2Md, SpinBlockDOM, VditorDOM2Md, SpinVditorDOM)
//   are produced by the reference, in the parent, once per input. The parent never times
//   anything. Both sides get the same input on stdin.
// - Per method and input: `rounds` rounds, each round runs the port child and then the
//   reference child (interleaved, so drift hits both alike).
// - Output hash: sha256 (first 16 hex digits) of the first call's output after the ID and
//   timestamp normalisation of test/e2e/helpers.ts (the same patterns, applied here because
//   importing helpers.ts would load the port into the reference child). The output length is
//   checked again after the timed batches.
// - Verdict as in bench/lib/stats.ts: the fastest process per side (its median time per
//   call), 20% threshold relative to the reference; spread = max / min over the processes of
//   one side, flagged UNSTABLE above 1.5.
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

const BUILD_SCRIPT = fileURLToPath(new URL("../scripts/build.mjs", import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const ROUNDS = 5;
const WARMUP_MS = 1000;
const MIN_MS = 2000;
const MIN_BATCHES = 15;
const BATCH_MS = 20;

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
  calls: number;
  minUs: number;
  medianUs: number;
  timesUs: number[];
  outputHash: string;
  outputLength: number;
  lengthsStable: boolean;
}

let sink = 0;

// Calls of one method in batches. The warm-up calibrates the batch size; the spec input
// always uses one call per batch.
function timeBatches(call: () => string, singleCall: boolean, warmupMs: number, minMs: number): { itersPerBatch: number; timesUs: number[]; calls: number } {
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

  const timesUs: number[] = [];
  const t0 = performance.now();
  while (timesUs.length < MIN_BATCHES || performance.now() - t0 < minMs) {
    const s = performance.now();
    for (let i = 0; i < iters; i++) {
      sink += call().length;
    }
    const e = performance.now();
    timesUs.push(((e - s) * 1000) / iters);
  }
  return { itersPerBatch: iters, timesUs, calls: timesUs.length * iters };
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
    calls: 0,
    minUs: 0,
    medianUs: 0,
    timesUs: [],
    outputHash: "",
    outputLength: 0,
    lengthsStable: true,
  };
  const lute = loadBundle(side === "port" ? PORT_BUNDLE : REF_BUNDLE) as LuteGlobal;
  const engine: Engine = makeEngine(lute, spec);
  if (typeof engine[methodName] !== "function") {
    out.missing = true;
  } else {
    try {
      const call = (): string => String(spec.call(engine, input));
      const first = call();
      const r = timeBatches(call, inputName === "spec", warmupMs, minMs);
      out.itersPerBatch = r.itersPerBatch;
      out.batches = r.timesUs.length;
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

interface Processes {
  perProcess: { medianUs: number; minUs: number; itersPerBatch: number; batches: number; calls: number; timesUs: number[]; outputHash: string; outputLength: number; lengthsStable: boolean }[];
  fastestUs: number;
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

function summariseSide(list: ChildOut[]): Processes {
  const medians = list.map((c) => c.medianUs);
  return {
    perProcess: list.map((c) => ({
      medianUs: c.medianUs,
      minUs: c.minUs,
      itersPerBatch: c.itersPerBatch,
      batches: c.batches,
      calls: c.calls,
      timesUs: c.timesUs,
      outputHash: c.outputHash,
      outputLength: c.outputLength,
      lengthsStable: c.lengthsStable,
    })),
    fastestUs: Math.min(...medians),
    medianOfMediansUs: median(medians),
    spread: spreadOf(medians),
  };
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
  const port = summariseSide(portRuns);
  const ref = summariseSide(refRuns);
  const portHashes = [...new Set(portRuns.map((c) => c.outputHash))];
  const refHashes = [...new Set(refRuns.map((c) => c.outputHash))];
  const { ratio, verdict } = verdictFor(port.fastestUs, ref.fastestUs);
  return {
    ...base,
    status: "ok",
    port,
    ref,
    ratio,
    verdict,
    hashesAgree: portHashes.length === 1 && refHashes.length === 1 && portHashes[0] === refHashes[0],
    portHashes,
    refHashes,
  };
}

// us per call, as ms from 1 ms up.
function fmtTime(us: number): string {
  if (us >= 1000) {
    return `${(us / 1000).toFixed(us >= 100000 ? 1 : 2)} ms`;
  }
  return `${us.toFixed(us >= 100 ? 1 : 2)} µs`;
}

function printTable(results: MethodResult[]): void {
  console.log(
    `\n${"method|input".padEnd(28)} ${"port fastest".padStart(12)}  ${"ref fastest".padStart(12)}  ${"verdict (port vs reference, same within 20%)".padEnd(46)}  spread port  spread ref  hashes`,
  );
  for (const r of results) {
    if (r.status === "skipped") {
      console.log(`${r.key.padEnd(28)} SKIPPED: ${r.skipReason}`);
      continue;
    }
    const p = r.port as Processes;
    const q = r.ref as Processes;
    const flags = [p.spread > UNSTABLE ? "port UNSTABLE" : "", q.spread > UNSTABLE ? "ref UNSTABLE" : ""]
      .filter((x) => x !== "")
      .join(", ");
    console.log(
      `${r.key.padEnd(28)} ${fmtTime(p.fastestUs).padStart(12)}  ${fmtTime(q.fastestUs).padStart(12)}  ${(r.verdict ?? "").padEnd(46)}  ` +
        `${p.spread.toFixed(2).padStart(11)}  ${q.spread.toFixed(2).padStart(10)}  ${r.hashesAgree ? "agree" : "DIFFER"}${flags ? "  " + flags : ""}`,
    );
  }
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
    writeFileSync(
      file,
      JSON.stringify(
        {
          tag,
          rounds,
          machine,
          bundles: { port: "ts/dist/lute.min.js", reference: "ts/test/oracle/lute.ref.min.cjs" },
          inputs: inputBytes,
          timing: { warmupMs: opts.warmupMs, minBatches: MIN_BATCHES, batchMs: BATCH_MS, minMs: opts.minMs, unit: "us per call" },
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
  printTable(results);
  const skipped = results.filter((r) => r.status === "skipped");
  console.log(`\n${results.length - skipped.length} compared, ${skipped.length} skipped (threw or missing on both sides).`);
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

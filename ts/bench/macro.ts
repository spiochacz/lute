// Macro benchmark: the built port bundle (dist/lute.min.js) against the reference
// bundle (test/oracle/lute.ref.min.cjs), both on benchmark/commonmark-spec.md.
//
// Usage (from ts/):
//   npm run bench:macro -- [tag] [--rounds=N] [--methods=A,B]
//   tag defaults to "latest"; rounds defaults to 5. Writes bench/results/macro.<tag>.json
//   (fresh each run). Builds dist/lute.min.js first when it is missing.
//
// Design:
// - Each measurement is a child process that loads ONE bundle, the same way as
//   test/e2e/bundle_driver.mjs (createRequire, the bundle sets globalThis.Lute),
//   and times ONE method on a default engine (SpinVditorDOM and VditorDOM2Md on a
//   wysiwyg engine, as in bundle_driver.mjs). Warm-up 1 s. Then timed calls until
//   there are at least 15 AND at least 2 s have passed: whichever gives more calls.
//   Per process: min and median ms per call.
// - The round-trip inputs (HTML2Md, BlockDOM2Md, SpinBlockDOM, VditorDOM2Md,
//   SpinVditorDOM) are produced ONCE by the reference, in the parent, and handed to
//   both sides on stdin. The parent never times anything; it only loads the
//   reference to make the inputs.
// - Per method: `rounds` rounds, each round runs the port child and then the
//   reference child (interleaved, so drift hits both alike).
// - Output hash: sha256 (first 16 hex digits) of the first timed call's output
//   after the ID and timestamp normalisation of test/e2e/helpers.ts (the same
//   patterns, applied here because importing helpers.ts would load the port into
//   the reference child). The output length of every call is checked for stability.
// - Verdict as in compare.ts: the fastest process per side (its median ms per call),
//   20% threshold relative to the reference; spread = max / min over the processes
//   of one side, flagged UNSTABLE above 1.5.
// - A method where both sides throw (or both lack it) is skipped and says so. If
//   only one side throws or lacks it, the run fails.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeIDs } from "../test/oracle/oracle.ts";
import { machineInfo, type MachineInfo } from "./lib/micro.ts";

const TS_ROOT = fileURLToPath(new URL("../", import.meta.url));
const MARKDOWN_PATH = fileURLToPath(new URL("../../benchmark/commonmark-spec.md", import.meta.url));
const PORT_BUNDLE = fileURLToPath(new URL("../dist/lute.min.js", import.meta.url));
const REF_BUNDLE = fileURLToPath(new URL("../test/oracle/lute.ref.min.cjs", import.meta.url));
const BUILD_SCRIPT = fileURLToPath(new URL("../scripts/build.mjs", import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const ROUNDS = 5;
const WARMUP_MS = 1000;
const MIN_CALLS = 15;
const MIN_MS = 2000;
const SAME = 0.2;
const UNSTABLE = 1.5;

type Side = "port" | "ref";
type Engine = Record<string, any>; // loosely typed on purpose, as in test/oracle/oracle.ts
type InputKind = "markdown" | "html" | "vditorDOM" | "blockDOM";

interface MethodSpec {
  name: string;
  config: "default" | "wysiwyg";
  input: InputKind;
  call: (e: Engine, input: string) => unknown;
}

// The methods of bench/oracle-baseline.ts, plus Md2HTML when the bundle has it.
const METHODS: MethodSpec[] = [
  { name: "MarkdownStr", config: "default", input: "markdown", call: (e, i) => e.MarkdownStr("", i) },
  { name: "FormatStr", config: "default", input: "markdown", call: (e, i) => e.FormatStr("", i) },
  { name: "Md2HTML", config: "default", input: "markdown", call: (e, i) => e.Md2HTML(i) },
  { name: "Md2VditorDOM", config: "default", input: "markdown", call: (e, i) => e.Md2VditorDOM(i) },
  { name: "Md2VditorIRDOM", config: "default", input: "markdown", call: (e, i) => e.Md2VditorIRDOM(i) },
  { name: "Md2VditorSVDOM", config: "default", input: "markdown", call: (e, i) => e.Md2VditorSVDOM(i) },
  { name: "Md2BlockDOM", config: "default", input: "markdown", call: (e, i) => e.Md2BlockDOM(i) },
  { name: "SpinVditorDOM", config: "wysiwyg", input: "vditorDOM", call: (e, i) => e.SpinVditorDOM(i) },
  { name: "VditorDOM2Md", config: "wysiwyg", input: "vditorDOM", call: (e, i) => e.VditorDOM2Md(i) },
  { name: "SpinBlockDOM", config: "default", input: "blockDOM", call: (e, i) => e.SpinBlockDOM(i) },
  { name: "BlockDOM2Md", config: "default", input: "blockDOM", call: (e, i) => e.BlockDOM2Md(i) },
  { name: "HTML2Md", config: "default", input: "html", call: (e, i) => e.HTML2Md(i) },
];

// Same normalisation as test/e2e/helpers.ts (normalizeOutput).
const UPDATED_PATTERN = /updated="\d{14}"/g;
const UPDATED_JSON_PATTERN = /"updated":"\d{14}"/g;

function normaliseOutput(s: string): string {
  return normalizeIDs(s).replace(UPDATED_PATTERN, 'updated="TIMESTAMP"').replace(UPDATED_JSON_PATTERN, '"updated":"TIMESTAMP"');
}

function hashOf(s: string): string {
  return createHash("sha256").update(normaliseOutput(s)).digest("hex").slice(0, 16);
}

interface LuteGlobal {
  New(): Engine;
}

function loadBundle(path: string): LuteGlobal {
  createRequire(import.meta.url)(path);
  const lute = (globalThis as unknown as { Lute?: LuteGlobal }).Lute;
  if (lute === undefined) {
    throw new Error(`bundle ${path} did not set globalThis.Lute`);
  }
  return lute;
}

// ---------------------------------------------------------------- child mode

interface ChildOut {
  side: Side;
  method: string;
  missing: boolean;
  threw: boolean;
  error: string;
  calls: number;
  minMs: number;
  medianMs: number;
  timesMs: number[];
  outputHash: string;
  outputLength: number;
  lengthsStable: boolean;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

// Loads one bundle, times one method, prints ROW_RESULT. The input comes on stdin.
function child(side: Side, methodName: string): void {
  const input = readFileSync(0, "utf8");
  const spec = METHODS.find((m) => m.name === methodName);
  if (spec === undefined) {
    throw new Error(`unknown method ${methodName}`);
  }
  const out: ChildOut = {
    side,
    method: methodName,
    missing: false,
    threw: false,
    error: "",
    calls: 0,
    minMs: 0,
    medianMs: 0,
    timesMs: [],
    outputHash: "",
    outputLength: 0,
    lengthsStable: true,
  };
  const lute = loadBundle(side === "port" ? PORT_BUNDLE : REF_BUNDLE);
  const engine = lute.New();
  if (spec.config === "wysiwyg") {
    engine.SetVditorWYSIWYG(true);
  }
  if (typeof engine[methodName] !== "function") {
    out.missing = true;
  } else {
    try {
      const call = (): string => String(spec.call(engine, input));
      const w0 = performance.now();
      do {
        call();
      } while (performance.now() - w0 < WARMUP_MS);

      const times: number[] = [];
      const lengths: number[] = [];
      let first: string | undefined;
      const t0 = performance.now();
      while (times.length < MIN_CALLS || performance.now() - t0 < MIN_MS) {
        const s = performance.now();
        const o = call();
        const e = performance.now();
        times.push(e - s);
        lengths.push(o.length);
        if (first === undefined) {
          first = o;
        }
      }
      // Hashing happens after the timed loop.
      out.calls = times.length;
      out.timesMs = times;
      out.minMs = Math.min(...times);
      out.medianMs = median(times);
      out.outputLength = (first as string).length;
      out.outputHash = hashOf(first as string);
      out.lengthsStable = lengths.every((l) => l === lengths[0]);
    } catch (e) {
      out.threw = true;
      out.error = e instanceof Error ? e.message : String(e);
    }
  }
  process.stdout.write(`ROW_RESULT ${JSON.stringify(out)}\n`);
}

// ---------------------------------------------------------------- parent mode

interface Processes {
  perProcess: { medianMs: number; minMs: number; calls: number; timesMs: number[]; outputHash: string; outputLength: number; lengthsStable: boolean }[];
  fastestMs: number;
  medianOfMediansMs: number;
  spread: number;
}

interface MethodResult {
  method: string;
  config: string;
  input: InputKind;
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

function spawnChild(side: Side, method: string, input: string): ChildOut {
  const res = spawnSync(process.execPath, [SELF, "--child", side, method], {
    input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`child ${side} ${method} failed: ${res.stderr}`);
  }
  const line = res.stdout.split("\n").find((l) => l.startsWith("ROW_RESULT "));
  if (line === undefined) {
    throw new Error(`no result from child ${side} ${method}`);
  }
  return JSON.parse(line.slice("ROW_RESULT ".length)) as ChildOut;
}

function summariseSide(list: ChildOut[]): Processes {
  const medians = list.map((c) => c.medianMs);
  return {
    perProcess: list.map((c) => ({
      medianMs: c.medianMs,
      minMs: c.minMs,
      calls: c.calls,
      timesMs: c.timesMs,
      outputHash: c.outputHash,
      outputLength: c.outputLength,
      lengthsStable: c.lengthsStable,
    })),
    fastestMs: Math.min(...medians),
    medianOfMediansMs: median(medians),
    spread: Math.max(...medians) / Math.min(...medians),
  };
}

function verdictFor(port: number, ref: number): { ratio: number; verdict: string } {
  const ratio = port / ref;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return { ratio, verdict: "DEFECT (zero or non-finite time)" };
  }
  if (Math.abs(ratio - 1) < SAME) {
    return { ratio, verdict: `same (${ratio.toFixed(2)}x)` };
  }
  return { ratio, verdict: ratio > 1 ? `port ${ratio.toFixed(2)}x slower` : `port ${(1 / ratio).toFixed(2)}x faster` };
}

function measureMethod(spec: MethodSpec, input: string, rounds: number): MethodResult {
  const base = { method: spec.name, config: spec.config, input: spec.input, inputBytes: Buffer.byteLength(input, "utf8") };
  const portRuns: ChildOut[] = [];
  const refRuns: ChildOut[] = [];
  for (let r = 0; r < rounds; r++) {
    const p = spawnChild("port", spec.name, input);
    const q = spawnChild("ref", spec.name, input);
    if (r === 0) {
      if (p.missing && q.missing) {
        return { ...base, status: "skipped", skipReason: "missing on both sides" };
      }
      if (p.missing !== q.missing) {
        throw new Error(`${spec.name}: ${p.missing ? "port" : "reference"} has no such method`);
      }
      if (p.threw && q.threw) {
        return { ...base, status: "skipped", skipReason: `threw on both sides: port: ${p.error} | reference: ${q.error}` };
      }
    }
    if (p.missing || q.missing || p.threw !== q.threw || p.threw || q.threw) {
      throw new Error(
        `${spec.name} round ${r + 1}: port ${p.threw ? "threw (" + p.error + ")" : "returned"}, reference ${q.threw ? "threw (" + q.error + ")" : "returned"}`,
      );
    }
    portRuns.push(p);
    refRuns.push(q);
  }
  const port = summariseSide(portRuns);
  const ref = summariseSide(refRuns);
  const portHashes = [...new Set(portRuns.map((c) => c.outputHash))];
  const refHashes = [...new Set(refRuns.map((c) => c.outputHash))];
  const { ratio, verdict } = verdictFor(port.fastestMs, ref.fastestMs);
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

// The inputs of the round trips are made by the reference, once.
function makeInputs(): Record<InputKind, string> {
  const markdown = readFileSync(MARKDOWN_PATH, "utf8");
  const lute = loadBundle(REF_BUNDLE);
  const plain = lute.New();
  const wysiwyg = lute.New();
  wysiwyg.SetVditorWYSIWYG(true);
  return {
    markdown,
    html: plain.MarkdownStr("", markdown),
    vditorDOM: wysiwyg.Md2VditorDOM(markdown),
    blockDOM: plain.Md2BlockDOM(markdown),
  };
}

function fmtMs(x: number): string {
  return x >= 100 ? x.toFixed(1) : x.toFixed(2);
}

function printTable(results: MethodResult[]): void {
  console.log(
    "\nmethod           port fastest ms  ref fastest ms  verdict (port vs reference, same within 20%)  spread port  spread ref  hashes",
  );
  for (const r of results) {
    if (r.status === "skipped") {
      console.log(`${r.method.padEnd(16)} SKIPPED: ${r.skipReason}`);
      continue;
    }
    const p = r.port as Processes;
    const q = r.ref as Processes;
    const flags = [p.spread > UNSTABLE ? "port UNSTABLE" : "", q.spread > UNSTABLE ? "ref UNSTABLE" : ""]
      .filter((x) => x !== "")
      .join(", ");
    console.log(
      `${r.method.padEnd(16)} ${fmtMs(p.fastestMs).padStart(15)}  ${fmtMs(q.fastestMs).padStart(14)}  ${(r.verdict ?? "").padEnd(46)}  ` +
        `${p.spread.toFixed(2).padStart(11)}  ${q.spread.toFixed(2).padStart(10)}  ${r.hashesAgree ? "agree" : "DIFFER"}${flags ? "  " + flags : ""}`,
    );
  }
}

function parent(): void {
  const args = process.argv.slice(2);
  const tag = args.find((a) => !a.startsWith("--")) ?? "latest";
  const roundsArg = args.find((a) => a.startsWith("--rounds="));
  const rounds = roundsArg === undefined ? ROUNDS : Number(roundsArg.slice("--rounds=".length));
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error(`--rounds must be a positive integer, got ${roundsArg}`);
  }
  const methodsArg = args.find((a) => a.startsWith("--methods="));
  const wanted = methodsArg === undefined ? null : new Set(methodsArg.slice("--methods=".length).split(","));
  const selected = METHODS.filter((m) => wanted === null || wanted.has(m.name));
  if (wanted !== null) {
    for (const w of wanted) {
      if (!METHODS.some((m) => m.name === w)) {
        throw new Error(`unknown method in --methods: ${w}`);
      }
    }
  }

  if (!existsSync(PORT_BUNDLE)) {
    console.log("dist/lute.min.js is missing; building it");
    const b = spawnSync(process.execPath, [BUILD_SCRIPT], { stdio: "inherit", cwd: TS_ROOT });
    if (b.status !== 0) {
      throw new Error("build failed");
    }
  }

  const inputs = makeInputs();
  const machine: MachineInfo = machineInfo();
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = `${RESULTS_DIR}macro.${tag}.json`;
  const results: MethodResult[] = [];
  const save = (): void => {
    writeFileSync(
      file,
      JSON.stringify(
        {
          tag,
          rounds,
          machine,
          bundles: { port: "ts/dist/lute.min.js", reference: "ts/test/oracle/lute.ref.min.cjs" },
          input: { file: "benchmark/commonmark-spec.md", bytes: Buffer.byteLength(inputs.markdown, "utf8") },
          timing: { warmupMs: WARMUP_MS, minCalls: MIN_CALLS, minMs: MIN_MS },
          methods: results,
        },
        null,
        2,
      ) + "\n",
    );
  };
  save();
  console.log(`${selected.length} methods x ${rounds} rounds x 2 sides (one process each) into ${file}`);
  let i = 0;
  for (const spec of selected) {
    i++;
    console.log(`[${i}/${selected.length}] ${spec.name}`);
    results.push(measureMethod(spec, inputs[spec.input], rounds));
    save();
  }
  printTable(results);
  const skipped = results.filter((r) => r.status === "skipped");
  console.log(`\n${results.length - skipped.length} compared, ${skipped.length} skipped (threw or missing on both sides).`);
  console.log(`wrote ${file}`);
}

if (process.argv.includes("--child")) {
  const at = process.argv.indexOf("--child");
  const side = process.argv[at + 1];
  if (side !== "port" && side !== "ref") {
    throw new Error(`--child needs port or ref, got ${side}`);
  }
  child(side, process.argv[at + 2]);
} else {
  parent();
}

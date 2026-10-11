// Start-up benchmark: the port bundle (dist/lute.min.js) against the reference bundle
// (test/oracle/lute.ref.min.cjs). Every measurement is a fresh child process.
//
// Usage (from ts/):
//   npm run bench:startup -- [tag] [--rounds=N]
//   tag defaults to "latest"; rounds 15. Writes bench/results/startup.<tag>.json (fresh each run).
//
// Child (one bundle, one process), times with performance.now():
//   readMs        reading the bundle file into a string
//   compileMs     new vm.Script(wrapped source, { filename }): the parse of the source
//   runMs         runInThisContext() and the call of the wrapper, which runs the bundle top level
//   newMs         the first Lute.New()
//   firstCallMs   the first engine.MarkdownStr("", SMALL_MARKDOWN)
//   secondCallMs  the same call again
//   totalMs       from the read to the end of the first call
// V8 compiles inner functions lazily, so part of the compile work can appear in firstCallMs
// rather than compileMs; that is why the two are reported separately and the total is the
// figure to compare. The source is wrapped as "(function (require, module, exports) { ... })"
// and called the way CommonJS calls a module, because the reference needs require and module at
// top level (the port does not use them). Both sides load the same way.
//
// Parent: each round runs, in order, the port child, the reference child, a "bare" child
// (node -e "", only starts Node and exits) and a "script-loaded" child (this file is loaded and
// the process exits before it reads a bundle, so it includes the cost of loading this script).
// Wall time is the parent's measure from spawn to exit. Per metric: fastest and median of each
// side, the ratio port/reference of the fastest, and the verdict of bench/lib/stats.ts (same
// within 20%). Also wall minus each baseline, per side. The length of the first call's output
// must agree across the sides. The bundle sizes are printed in bytes, raw and gzip.

import { gzipSync } from "node:zlib";
import { readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import type { MachineInfo } from "./lib/micro.ts";
import { PORT_BUNDLE, REF_BUNDLE, SMALL_MARKDOWN } from "./lib/inputs.ts";
import { median, spreadOf, verdictFor } from "./lib/stats.ts";

const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const ROUNDS = 15;

type Side = "port" | "ref" | "baseline" | "bare";

const METRICS = ["readMs", "compileMs", "runMs", "newMs", "firstCallMs", "secondCallMs", "totalMs"] as const;
type Metric = (typeof METRICS)[number];

interface ChildOut {
  side: "port" | "ref";
  readMs: number;
  compileMs: number;
  runMs: number;
  newMs: number;
  firstCallMs: number;
  secondCallMs: number;
  totalMs: number;
  outputLength: number;
  secondOutputLength: number;
}

interface RoundRow {
  port: ChildOut & { wallMs: number };
  ref: ChildOut & { wallMs: number };
  baselineWallMs: number; // script-loaded
  bareWallMs: number; // node -e ""
}

// ---------------------------------------------------------------- child mode

function bundlePath(side: "port" | "ref"): string {
  return side === "port" ? PORT_BUNDLE : REF_BUNDLE;
}

function child(side: "port" | "ref"): void {
  const path = bundlePath(side);
  const t0 = performance.now();
  const source = readFileSync(path, "utf8");
  const readMs = performance.now() - t0;

  const wrapped = `(function (require, module, exports) {${source}\n})`;
  const c0 = performance.now();
  const script = new vm.Script(wrapped, { filename: path });
  const compileMs = performance.now() - c0;

  const req = createRequire(import.meta.url);
  const r0 = performance.now();
  const wrapper = script.runInThisContext() as (this: unknown, ...args: unknown[]) => void;
  const mod = { exports: {} as unknown };
  wrapper.call(mod.exports, req, mod, mod.exports);
  const runMs = performance.now() - r0;

  const Lute = (globalThis as unknown as { Lute?: { New(): Record<string, (...a: unknown[]) => unknown> } }).Lute;
  if (Lute === undefined) {
    throw new Error(`bundle ${path} did not set globalThis.Lute`);
  }

  const n0 = performance.now();
  const engine = Lute.New();
  const newMs = performance.now() - n0;

  const f0 = performance.now();
  const first = String(engine.MarkdownStr("", SMALL_MARKDOWN));
  const firstCallMs = performance.now() - f0;
  const totalMs = performance.now() - t0;

  const s0 = performance.now();
  const second = String(engine.MarkdownStr("", SMALL_MARKDOWN));
  const secondCallMs = performance.now() - s0;

  const out: ChildOut = {
    side,
    readMs,
    compileMs,
    runMs,
    newMs,
    firstCallMs,
    secondCallMs,
    totalMs,
    outputLength: first.length,
    secondOutputLength: second.length,
  };
  process.stdout.write(`ROW_RESULT ${JSON.stringify(out)}\n`);
}

// ---------------------------------------------------------------- parent mode

function spawnChild(side: Side): { out: ChildOut | null; wallMs: number } {
  const args = side === "bare" ? ["-e", ""] : [SELF, "--child", side];
  const s = performance.now();
  const res = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const wallMs = performance.now() - s;
  if (res.status !== 0) {
    throw new Error(`child ${side} failed: ${res.stderr}`);
  }
  if (side === "baseline" || side === "bare") {
    return { out: null, wallMs };
  }
  const line = res.stdout.split("\n").find((l) => l.startsWith("ROW_RESULT "));
  if (line === undefined) {
    throw new Error(`no result from child ${side}`);
  }
  return { out: JSON.parse(line.slice("ROW_RESULT ".length)) as ChildOut, wallMs };
}

function sizes(path: string): { bytes: number; gzipBytes: number } {
  const buf = readFileSync(path);
  return { bytes: statSync(path).size, gzipBytes: gzipSync(buf).length };
}

function fmtMs(x: number): string {
  return x >= 100 ? x.toFixed(1) : x.toFixed(2);
}

async function parent(): Promise<void> {
  const args = process.argv.slice(2);
  const tag = args.find((a) => !a.startsWith("--")) ?? "latest";
  const roundsArg = args.find((a) => a.startsWith("--rounds="));
  const rounds = roundsArg === undefined ? ROUNDS : Number(roundsArg.slice("--rounds=".length));
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error(`--rounds must be a positive integer, got ${roundsArg}`);
  }

  // Loaded here, not at the top: micro.ts installs a GC observer when it is imported, and the children must not carry it.
  const { machineInfo } = await import("./lib/micro.ts");
  const machine: MachineInfo = machineInfo();
  const bundleSizes = { port: sizes(PORT_BUNDLE), reference: sizes(REF_BUNDLE) };
  const rows: RoundRow[] = [];
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = `${RESULTS_DIR}startup.${tag}.json`;
  const write = (summary: unknown): void => {
    writeFileSync(
      file,
      JSON.stringify(
        {
          tag,
          rounds,
          machine,
          bundles: {
            port: { path: "ts/dist/lute.min.js", ...bundleSizes.port },
            reference: { path: "ts/test/oracle/lute.ref.min.cjs", ...bundleSizes.reference },
          },
          input: { name: "small (SMALL_MARKDOWN)", bytes: Buffer.byteLength(SMALL_MARKDOWN, "utf8") },
          summary,
          rows,
        },
        null,
        2,
      ) + "\n",
    );
  };

  console.log(`start-up: ${rounds} rounds x (port, reference, bare node, script-loaded) into ${file}`);
  console.log(`bundle port      ${bundleSizes.port.bytes} bytes, gzip ${bundleSizes.port.gzipBytes} (ts/dist/lute.min.js)`);
  console.log(`bundle reference ${bundleSizes.reference.bytes} bytes, gzip ${bundleSizes.reference.gzipBytes} (ts/test/oracle/lute.ref.min.cjs)`);
  for (let r = 0; r < rounds; r++) {
    const p = spawnChild("port");
    const q = spawnChild("ref");
    const bare = spawnChild("bare");
    const scriptLoaded = spawnChild("baseline");
    rows.push({
      port: { ...(p.out as ChildOut), wallMs: p.wallMs },
      ref: { ...(q.out as ChildOut), wallMs: q.wallMs },
      baselineWallMs: scriptLoaded.wallMs,
      bareWallMs: bare.wallMs,
    });
    console.log(
      `round ${r + 1}/${rounds}: port total ${fmtMs(p.out?.totalMs ?? 0)} ms, reference total ${fmtMs(q.out?.totalMs ?? 0)} ms, ` +
        `bare node ${fmtMs(bare.wallMs)} ms, script-loaded ${fmtMs(scriptLoaded.wallMs)} ms`,
    );
    write(null);
  }

  // Output length must agree across the sides, otherwise the timings compare different work.
  const lengthsAgree = rows.every((row) => row.port.outputLength === row.ref.outputLength && row.port.secondOutputLength === row.port.outputLength);

  type Line = { metric: string; portFastest: number; portMedian: number; refFastest: number; refMedian: number; ratio: number; verdict: string; portSpread: number; refSpread: number };
  const summary: { lines: Line[]; bare: { fastest: number; median: number }; scriptLoaded: { fastest: number; median: number }; wallAbove: Record<string, { fastest: number; median: number }> } = {
    lines: [],
    bare: { fastest: 0, median: 0 },
    scriptLoaded: { fastest: 0, median: 0 },
    wallAbove: {},
  };
  const metricsWithWall: (Metric | "wallMs")[] = [...METRICS, "wallMs"];
  for (const m of metricsWithWall) {
    const pv = rows.map((row) => (m === "wallMs" ? row.port.wallMs : row.port[m]));
    const qv = rows.map((row) => (m === "wallMs" ? row.ref.wallMs : row.ref[m]));
    const pf = Math.min(...pv);
    const qf = Math.min(...qv);
    const { ratio, verdict } = verdictFor(pf, qf);
    summary.lines.push({
      metric: m,
      portFastest: pf,
      portMedian: median(pv),
      refFastest: qf,
      refMedian: median(qv),
      ratio,
      verdict,
      portSpread: spreadOf(pv),
      refSpread: spreadOf(qv),
    });
  }
  const bare = rows.map((row) => row.bareWallMs);
  const scriptLoaded = rows.map((row) => row.baselineWallMs);
  summary.bare = { fastest: Math.min(...bare), median: median(bare) };
  summary.scriptLoaded = { fastest: Math.min(...scriptLoaded), median: median(scriptLoaded) };
  for (const [name, base] of [
    ["portWallAboveScriptLoaded", rows.map((row) => row.port.wallMs - row.baselineWallMs)],
    ["refWallAboveScriptLoaded", rows.map((row) => row.ref.wallMs - row.baselineWallMs)],
    ["portWallAboveBare", rows.map((row) => row.port.wallMs - row.bareWallMs)],
    ["refWallAboveBare", rows.map((row) => row.ref.wallMs - row.bareWallMs)],
  ] as const) {
    summary.wallAbove[name] = { fastest: Math.min(...base), median: median(base) };
  }

  console.log(`\nmetric          port fastest  port median  ref fastest  ref median  port/ref fastest  verdict (same within 20%)`);
  for (const l of summary.lines) {
    console.log(
      `${l.metric.padEnd(14)} ${fmtMs(l.portFastest).padStart(12)}  ${fmtMs(l.portMedian).padStart(11)}  ${fmtMs(l.refFastest).padStart(11)}  ${fmtMs(l.refMedian).padStart(10)}  ${l.ratio.toFixed(2).padStart(16)}  ${l.verdict}`,
    );
  }
  console.log(`bare node wall (node -e ""), ms: fastest ${fmtMs(summary.bare.fastest)}, median ${fmtMs(summary.bare.median)}`);
  console.log(`script-loaded wall (loads this file, reads no bundle), ms: fastest ${fmtMs(summary.scriptLoaded.fastest)}, median ${fmtMs(summary.scriptLoaded.median)}`);
  for (const [name, v] of Object.entries(summary.wallAbove)) {
    console.log(`${name} (ms): fastest ${fmtMs(v.fastest)}, median ${fmtMs(v.median)}`);
  }
  console.log(`output lengths agree across sides and calls: ${lengthsAgree ? "yes" : "NO"}`);
  console.log(`spread (max/min of per-process medians, >1.5 is unstable): ${summary.lines.map((l) => `${l.metric} port ${l.portSpread.toFixed(2)} ref ${l.refSpread.toFixed(2)}`).join("; ")}`);
  write({ ...summary, lengthsAgree });
  console.log(`wrote ${file}`);
}

if (process.argv.includes("--child")) {
  const side = process.argv[process.argv.indexOf("--child") + 1];
  if (side === "port" || side === "ref") {
    child(side);
  } else if (side !== "baseline") {
    throw new Error(`--child needs port, ref or baseline, got ${side}`);
  }
} else {
  await parent();
}

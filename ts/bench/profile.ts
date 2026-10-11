// CPU profile summary of one Lute method on one input, from the unminified ESM build.
//
// Usage (from ts/):
//   npm run bench:profile -- <method> [--input=spec] [--seconds=5] [--top=40]
//   input: tiny, small, medium or spec (bench/lib/inputs.ts). Builds nothing: it needs
//   dist/lute.esm.js (run npm run build first).
//
// The parent runs a child with --cpu-prof into a fresh directory under bench/results/profiles/.
// The child imports dist/lute.esm.js, creates the engine as the macro benchmark does, warms up
// for 1 s, then calls the method in a loop for --seconds inside the function measuredLoop.
// The parent keeps the samples from the first to the last sample whose stack contains
// measuredLoop, so module loading and the warm-up are left out. Garbage collection, program and
// idle samples inside that window are counted.
//
// Summary: (a) the top functions by self time (percent of the window's samples, self ms,
// function, file:line); (b) self time per source module and per top-level directory of src/,
// mapped from the esbuild "// src/..." markers of dist/lute.esm.js; (c) the shares of
// (garbage collector), (program) and (idle). Self time of a node is the sum of the timeDeltas
// of its samples. The summary is printed and written to bench/results/profiles/<method>-<input>.txt.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ESM_BUILD, TS_ROOT, isInputName, makeRoundTripInputs, markdownInput, type InputName } from "./lib/inputs.ts";
import { findMethod, makeEngine, type Engine, type LuteGlobal, type MethodSpec } from "./lib/methods.ts";

const PROFILES_DIR = fileURLToPath(new URL("./results/profiles/", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const WARMUP_MS = 1000;

let sink = 0;

// ---------------------------------------------------------------- child mode

// measuredLoop is found by name in the profile: the samples of its window are the measurement.
function measuredLoop(call: () => string, seconds: number): number {
  let n = 0;
  const end = performance.now() + seconds * 1000;
  do {
    sink += call().length;
    n++;
  } while (performance.now() < end);
  return n;
}

async function child(method: MethodSpec, seconds: number): Promise<void> {
  const input = readFileSync(0, "utf8");
  const mod = (await import(pathToFileURL(ESM_BUILD).href)) as { makeGlobal: () => LuteGlobal };
  const engine: Engine = makeEngine(mod.makeGlobal(), method);
  const call = (): string => String(method.call(engine, input));
  const w0 = performance.now();
  do {
    sink += call().length;
  } while (performance.now() - w0 < WARMUP_MS);
  const calls = measuredLoop(call, seconds);
  process.stdout.write(`PROFILE_CALLS ${calls}\n`);
}

// ---------------------------------------------------------------- cpuprofile analysis

interface CpuFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

interface CpuNode {
  id: number;
  callFrame: CpuFrame;
  children?: number[];
}

interface CpuProfile {
  startTime: number;
  endTime: number;
  nodes: CpuNode[];
  samples: number[];
  timeDeltas: number[];
}

interface Entry {
  name: string;
  url: string;
  line: number; // 1-based, 0 when unknown
  selfUs: number;
}

// Source modules of dist/lute.esm.js: the esbuild marker "// src/<path>.ts" before each module.
function moduleMarkers(esmPath: string): { line: number; path: string }[] {
  const markers: { line: number; path: string }[] = [];
  const lines = readFileSync(esmPath, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\/\/ (src\/\S+\.ts)$/.exec(lines[i]);
    if (m !== null) {
      markers.push({ line: i + 1, path: m[1] });
    }
  }
  return markers;
}

// The module whose marker is the nearest one at or before the line (binary search).
function moduleOfLine(markers: { line: number; path: string }[], line: number): string {
  let lo = 0;
  let hi = markers.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (markers[mid].line <= line) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found === -1 ? "(bundle prologue)" : markers[found].path;
}

// The top-level directory of a src/ module: "src/runtime/utf8.ts" is "runtime", "src/index.ts" is "root".
function directoryOf(modulePath: string): string {
  const parts = modulePath.split("/");
  if (parts[0] !== "src") {
    return "(not lute src)";
  }
  return parts.length > 2 ? parts[1] : "root";
}

function summarise(profile: CpuProfile, markers: { line: number; path: string }[], esmSuffix: string, top: number): string {
  const byId = new Map<number, CpuNode>();
  const parent = new Map<number, number>();
  for (const n of profile.nodes) {
    byId.set(n.id, n);
    for (const c of n.children ?? []) {
      parent.set(c, n.id);
    }
  }

  // A node is inside the window when it or an ancestor is a measuredLoop frame of profile.ts.
  const inLoopMemo = new Map<number, boolean>();
  const inLoop = (id: number): boolean => {
    const memo = inLoopMemo.get(id);
    if (memo !== undefined) {
      return memo;
    }
    const n = byId.get(id);
    if (n === undefined) {
      return false;
    }
    const own = n.callFrame.functionName === "measuredLoop" && n.callFrame.url.endsWith("profile.ts");
    const res = own || (parent.has(id) ? inLoop(parent.get(id) as number) : false);
    inLoopMemo.set(id, res);
    return res;
  };

  const times: number[] = new Array<number>(profile.samples.length);
  let t = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    t += profile.timeDeltas[i];
    times[i] = t;
  }
  let first = -1;
  let last = -1;
  for (let i = 0; i < profile.samples.length; i++) {
    if (inLoop(profile.samples[i])) {
      if (first === -1) {
        first = i;
      }
      last = i;
    }
  }
  if (first === -1) {
    throw new Error("no samples inside measuredLoop: the window is empty, raise --seconds");
  }

  const entries = new Map<string, Entry>();
  let total = 0;
  let gc = 0;
  let program = 0;
  let idle = 0;
  let count = 0;
  for (let i = first; i <= last; i++) {
    const w = profile.timeDeltas[i];
    const node = byId.get(profile.samples[i]);
    if (node === undefined) {
      continue;
    }
    count++;
    total += w;
    const f = node.callFrame;
    if (f.functionName === "(garbage collector)") {
      gc += w;
    } else if (f.functionName === "(program)") {
      program += w;
    } else if (f.functionName === "(idle)") {
      idle += w;
    }
    const key = `${f.url}|${f.lineNumber}|${f.functionName}`;
    const e = entries.get(key);
    if (e === undefined) {
      entries.set(key, { name: f.functionName || "(anonymous)", url: f.url, line: f.lineNumber + 1, selfUs: w });
    } else {
      e.selfUs += w;
    }
  }

  const locate = (e: Entry): { where: string; module: string } => {
    if (e.url === "") {
      return { where: "(native)", module: "(native)" };
    }
    if (e.url.endsWith(esmSuffix)) {
      const mod = moduleOfLine(markers, e.line);
      return { where: `dist/lute.esm.js:${e.line}`, module: mod };
    }
    if (e.url.startsWith("node:")) {
      return { where: e.url, module: "(node internals)" };
    }
    if (!e.url.startsWith("file:")) {
      return { where: `${e.url}:${e.line}`, module: "(other)" };
    }
    const rel = relative(TS_ROOT, fileURLToPath(e.url)).split("\\").join("/");
    return { where: `${rel}:${e.line}`, module: rel };
  };

  const pct = (us: number): string => (total === 0 ? "0.00" : ((us / total) * 100).toFixed(2));
  const ms = (us: number): string => (us / 1000).toFixed(1);

  const out: string[] = [];
  out.push(`samples in window ${count}, window ${(total / 1000).toFixed(0)} ms (self time of the samples)`);
  out.push("");
  out.push(`(a) top ${top} functions by self time`);
  out.push(`  ${"%self".padStart(7)} ${"self ms".padStart(10)}  ${"function".padEnd(40)} location`);
  const sorted = [...entries.values()].sort((a, b) => b.selfUs - a.selfUs).slice(0, top);
  for (const e of sorted) {
    const loc = locate(e);
    const tag = loc.module.startsWith("src/") ? ` (${loc.module})` : "";
    out.push(`  ${pct(e.selfUs).padStart(6)}% ${ms(e.selfUs).padStart(10)}  ${e.name.slice(0, 40).padEnd(40)} ${loc.where}${tag}`);
  }

  const perModule = new Map<string, number>();
  const perDir = new Map<string, number>();
  for (const e of entries.values()) {
    const m = locate(e).module;
    perModule.set(m, (perModule.get(m) ?? 0) + e.selfUs);
    const d = m.startsWith("src/") ? directoryOf(m) : m.startsWith("(") ? m : "(other files)";
    perDir.set(d, (perDir.get(d) ?? 0) + e.selfUs);
  }
  out.push("");
  out.push("(b1) self time per source module (dist/lute.esm.js sections; other files by path)");
  out.push(`  ${"%self".padStart(7)} ${"self ms".padStart(10)}  module`);
  for (const [m, us] of [...perModule.entries()].sort((a, b) => b[1] - a[1])) {
    out.push(`  ${pct(us).padStart(6)}% ${ms(us).padStart(10)}  ${m}`);
  }
  out.push("");
  out.push("(b2) self time per top-level directory of src/");
  out.push(`  ${"%self".padStart(7)} ${"self ms".padStart(10)}  directory`);
  for (const [d, us] of [...perDir.entries()].sort((a, b) => b[1] - a[1])) {
    out.push(`  ${pct(us).padStart(6)}% ${ms(us).padStart(10)}  ${d}`);
  }
  out.push("");
  out.push("(c) shares of the window");
  out.push(`  (garbage collector) ${pct(gc)}%  ${ms(gc)} ms`);
  out.push(`  (program)           ${pct(program)}%  ${ms(program)} ms`);
  out.push(`  (idle)              ${pct(idle)}%  ${ms(idle)} ms`);
  return out.join("\n") + "\n";
}

// ---------------------------------------------------------------- parent mode

function parent(): void {
  const args = process.argv.slice(2);
  const methodName = args.find((a) => !a.startsWith("--"));
  const method = methodName === undefined ? undefined : findMethod(methodName);
  if (method === undefined) {
    throw new Error(`usage: profile.ts <method> [--input=spec] [--seconds=5] [--top=40]; methods: ${["MarkdownStr", "FormatStr", "Md2HTML", "Md2VditorDOM", "Md2VditorIRDOM", "Md2VditorSVDOM", "Md2BlockDOM", "SpinVditorDOM", "VditorDOM2Md", "SpinBlockDOM", "BlockDOM2Md", "HTML2Md"].join(", ")}`);
  }
  const inputArg = args.find((a) => a.startsWith("--input=")) ?? "--input=spec";
  const inputName = inputArg.slice("--input=".length);
  if (!isInputName(inputName)) {
    throw new Error(`unknown input ${inputName}`);
  }
  const secondsArg = Number(args.find((a) => a.startsWith("--seconds="))?.slice("--seconds=".length) ?? 5);
  const topArg = Number(args.find((a) => a.startsWith("--top="))?.slice("--top=".length) ?? 40);
  if (!(secondsArg > 0) || !Number.isInteger(topArg) || topArg < 1) {
    throw new Error("--seconds must be positive, --top a positive integer");
  }
  if (!existsSync(ESM_BUILD)) {
    throw new Error("dist/lute.esm.js is missing: run npm run build");
  }

  const markdown = markdownInput(inputName as InputName);
  const stdinText = method.input === "markdown" ? markdown : makeRoundTripInputs(markdown)[method.input];

  mkdirSync(PROFILES_DIR, { recursive: true });
  const dir = mkdtempSync(join(PROFILES_DIR, `${method.name}-${inputName}-`));
  const res = spawnSync(
    process.execPath,
    ["--cpu-prof", `--cpu-prof-dir=${dir}`, SELF, "--child", method.name, `--seconds=${secondsArg}`],
    { input: stdinText, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (res.status !== 0) {
    throw new Error(`profiled child failed: ${res.stderr}`);
  }
  const callsLine = res.stdout.split("\n").find((l) => l.startsWith("PROFILE_CALLS "));
  const file = readdirSync(dir).find((f) => f.endsWith(".cpuprofile"));
  if (file === undefined) {
    throw new Error(`no .cpuprofile written to ${dir}`);
  }
  const profile = JSON.parse(readFileSync(join(dir, file), "utf8")) as CpuProfile;
  const body = summarise(profile, moduleMarkers(ESM_BUILD), "/dist/lute.esm.js", topArg);

  const header =
    `profile of ${method.name} on ${inputName} (${Buffer.byteLength(markdown, "utf8")} bytes of Markdown), ` +
    `${secondsArg} s loop, ${callsLine ?? "PROFILE_CALLS ?"}, ${dir}\n\n`;
  const outFile = `${PROFILES_DIR}${method.name}-${inputName}.txt`;
  writeFileSync(outFile, header + body);
  process.stdout.write(header + body);
  process.stdout.write(`wrote ${outFile}\n`);
}

if (process.argv.includes("--child")) {
  const argv = process.argv;
  const name = argv[argv.indexOf("--child") + 1];
  const method = findMethod(name);
  if (method === undefined) {
    throw new Error(`unknown method ${name}`);
  }
  const seconds = Number(argv.find((a) => a.startsWith("--seconds="))?.slice("--seconds=".length) ?? 5);
  await child(method, seconds);
} else {
  parent();
}

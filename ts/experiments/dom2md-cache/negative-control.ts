// Negative controls of the engine's cache (src/incremental), tasks/004 "Negative controls and context witnesses" (2026-10-11), section 6 step 5.
//
// Each control is ONE statement of a scratch copy changed (an exact string of the source, required to occur once), then the scratch copy is
// tested: the tests that must catch it (context_channels, witnesses, edits, dom2md_incremental_regressions, piece_assembly, dom2md_incremental)
// with node --test, and the fuzzer (fuzz.ts, --impl=engine, two modes, two seeds, --no-precheck) with the frozen corpus. A control is "caught"
// when a test fails or the fuzzer prints a mismatch or an inconsistency. ts/src is never written: each control has its own copy under
// $D2M_SCRATCH (default: <tmp>/d2m-nc/<id>), with the repository root reached through directory junctions so that REPO_ROOT still resolves.
//
//   node experiments/dom2md-cache/negative-control.ts [--only=NC1,NC2] [--jobs=4] [--cmp=2000]
//
// The baseline ("none", no change) runs first and must be green with 0 mismatches; otherwise nothing is run. The corpus is frozen with
// --corpus-snapshot (written by the baseline run when absent; the tasks/004 file grows, so the snapshot keeps the seeds reproducible).
//
// The old prototype controls (the mutants of cached.ts, "--impl=prototype") are not in this table: they belong to the spike (README).

import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TS_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const REPO_ROOT = resolve(TS_ROOT, "..");
const SCRATCH = process.env.D2M_SCRATCH ?? join(tmpdir(), "d2m-nc");
const CORPUS = join(SCRATCH, "corpus.json");

type Expect = "caught" | "silent";

interface Control {
  id: string;
  what: string;
  file: string; // relative to src/incremental/
  from: string; // exact text of the source, must occur exactly once
  to: string;
  append?: string; // text appended to the file (helpers of the replacement)
  expect: Expect;
  note: string;
}

const HOIST = `
// NC12' (negative control): merge equal-flag Appends across the barrier operations, then the barrier operations in order (the hoist of
// tasks/004, analysis section 4).
function coalesceHoist(ops: RootOp[]): RootOp[] {
  const out: RootOp[] = [];
  const barrier: RootOp[] = [];
  for (const op of ops) {
    if (op.kind !== "Append") {
      barrier.push(op);
      continue;
    }
    if (op.bytes.length === 0) {
      continue;
    }
    const last = out.length > 0 ? out[out.length - 1] : null;
    if (last !== null && last.kind === "Append" && last.setsLastOut === op.setsLastOut) {
      const m = new Uint8Array(last.bytes.length + op.bytes.length);
      m.set(last.bytes, 0);
      m.set(op.bytes, last.bytes.length);
      out[out.length - 1] = { kind: "Append", bytes: m, setsLastOut: op.setsLastOut };
    } else {
      out.push(op);
    }
  }
  return out.concat(barrier);
}
`;

// The controls of section 6 step 5 of the analysis (NC1, NC2, NC3, NC4, NC5, NC9, NC11, NC12', NC13', NC14, NC15). NC3 is equivalent (silent).
const CONTROLS: Control[] = [
  // Milestone C (C1): isFirst and isLast are no fields; NC1 is anchored on the root's LastChild link of the render phase (isLast is next < 0).
  {
    id: "NC1",
    what: "isLast forced to true: the root's LastChild is never barriered (sandbox render)",
    file: "sandbox.ts",
    from: "    if (ctx.next >= 0) {\n      tree.Root!.LastChild",
    to: "    if (false) {\n      tree.Root!.LastChild",
    expect: "caught",
    note: "witnesses (isLast, as next), edits (channel child)",
  },
  { id: "NC2", what: "prev forced to -1 (assemble)", file: "assemble.ts", from: "      prev: prevT[i],", to: "      prev: -1,", expect: "caught", note: "witnesses (prev), edits (channel child)" },
  {
    id: "NC3",
    what: "next forced to -1 for the Next stub of the last node only (sandbox render)",
    file: "sandbox.ts",
    from: "last.Next = ctx.next < 0 ? null : astStub(ctx.next);",
    to: "last.Next = null;",
    expect: "silent",
    note: "equivalent: next is read only through withoutKramdownBlockIAL, which short-circuits (analysis 2; not caught by design)",
  },
  { id: "NC4", what: "domNext forced to -1 (assemble)", file: "assemble.ts", from: "      domNext: domN[i],", to: "      domNext: -1,", expect: "caught", note: "witnesses (domNext), edits (channel child)" },
  {
    id: "NC5",
    what: "domNext left out of contextKey (piece.ts; redefined in milestone C, C1: there is no read recording any more)",
    file: "piece.ts",
    from: "${c.domPrev},${c.domNext},${c.domNextAttrs}",
    to: "${c.domPrev},${c.domNextAttrs}",
    expect: "caught",
    note: "context_channels pinned domNext witness and REAL domNext search (the key no longer separates the variants)",
  },
  { id: "NC9", what: "TrimSpaceAll replay does not trim (assemble)", file: "assemble.ts", from: "R.trimWriterTo(bytes.TrimSpace(R.Writer.Bytes()));", to: "R.trimWriterTo(R.Writer.Bytes());", expect: "caught", note: "fuzz and regressions (the repro scripts test the prototype, not run here)" },
  {
    id: "NC11",
    what: "variant match always takes variants[0] (assemble)",
    file: "assemble.ts",
    from: "let v = e.variants.find((x) => x.key === key);",
    to: "let v = e.variants[0];",
    expect: "caught",
    note: "fuzz (variants of one child with different contexts)",
  },
  { id: "NC12'", what: "coalesce hoists the barrier operations and merges across them (sandbox)", file: "sandbox.ts", from: "export function coalesce(ops: RootOp[]): RootOp[] {", to: "export function coalesce(ops: RootOp[]): RootOp[] {\n  return coalesceHoist(ops);", append: HOIST, expect: "caught", note: "piece_assembly, dom2md_incremental, fuzz (replaced NC12: equivalent)" },
  { id: "NC13'", what: "closeDocumentWriter replaced by a trim of LF only (assemble)", file: "assemble.ts", from: "closeDocumentWriter(R);", to: 'R.trimWriterTo(bytes.Trim(R.Writer.Bytes(), "\\n")); R.WriteByte(10);', expect: "caught", note: "piece_assembly, dom2md_incremental (footnotes blocks end in a four-space line)" },
  { id: "NC14", what: "generated-id refusal removed (sandbox)", file: "sandbox.ts", from: "if (text.includes(GENERATED_ID)) {", to: "if (false) {", expect: "caught", note: "context_channels NC14 unit test only (the fuzz normalises IDs)" },
  {
    id: "NC15",
    what: "the render starts at LF whatever lastOut the key has (sandbox render; redefined in milestone C, C1: the accessor is gone)",
    file: "sandbox.ts",
    from: "  r.LastOut = ctx.lastOut;",
    to: "  r.LastOut = 10;",
    expect: "caught",
    note: "context_channels pinned lastOut witness only (no document shows it)",
  },
];

const BASELINE: Control = { id: "none", what: "no change (the copy must be green)", file: "", from: "", to: "", expect: "silent", note: "baseline" };

const TEST_FILES = [
  "test/incremental/context_channels.test.ts",
  "test/incremental/witnesses.test.ts",
  "test/incremental/edits.test.ts",
  "test/e2e/root/dom2md_incremental_regressions.test.ts",
  "test/incremental/piece_assembly.test.ts",
  "test/e2e/root/dom2md_incremental.test.ts",
];

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? "1");
}
const JOBS = Number(args.get("jobs") ?? 4);
const CMP = Number(args.get("cmp") ?? 2000);
const ONLY = args.has("only") ? new Set(args.get("only")!.split(",")) : null;

// keep copies only what the tests and the fuzzer need: src, test, the top-level files of experiments/dom2md-cache, the package files
function wanted(srcPath: string): boolean {
  const rel = relative(TS_ROOT, srcPath);
  if (rel === "") return true;
  const parts = rel.split(sep);
  if (parts.includes("node_modules") || parts.includes("dist") || parts.includes(".mut")) return false;
  if (parts[0] === "src" || parts[0] === "test") return true;
  if (parts.length === 1) return parts[0] === "package.json" || parts[0] === "tsconfig.json" || parts[0] === "experiments";
  if (parts[0] === "experiments") {
    if (parts.length === 1) return true;
    if (parts[1] !== "dom2md-cache") return false;
    if (parts.length === 2) return true;
    return parts.length === 3 && !statSync(srcPath).isDirectory();
  }
  return false;
}

// prepare builds the scratch copy of one control: the ts tree (copied), the repository root (junctions), the change (checked).
function prepare(c: Control): string {
  const root = join(SCRATCH, c.id.replace(/'/g, "p"));
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (const e of readdirSync(REPO_ROOT)) {
    if (e === "ts" || e === ".git") continue;
    const target = join(REPO_ROOT, e);
    // directories are junctions (no privilege needed on Windows); files are copied
    if (statSync(target).isDirectory()) symlinkSync(target, join(root, e), "junction");
    else copyFileSync(target, join(root, e));
  }
  const dst = join(root, "ts");
  cpSync(TS_ROOT, dst, { recursive: true, filter: wanted });
  if (c.file !== "") {
    const f = join(dst, "src", "incremental", c.file);
    const text = readFileSync(f, "utf8");
    const n = text.split(c.from).length - 1;
    if (n !== 1) throw new Error(`${c.id}: the anchor occurs ${n} times in ${c.file}`);
    let out = text.replace(c.from, () => c.to);
    if (c.append !== undefined) out += c.append;
    if (out === text) throw new Error(`${c.id}: the change is empty`);
    writeFileSync(f, out);
  }
  return dst;
}

interface Run {
  code: number | null;
  out: string;
}

function run(cwd: string, argv: string[]): Promise<Run> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, argv, { cwd, env: { ...process.env, LUTE_TEST_FULL: "" } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => ok({ code, out }));
  });
}

interface Evidence {
  id: string;
  testsFailed: string[];
  testsRun: string;
  fuzz: string[]; // one line per mode and seed
  fuzzMismatches: number;
  fuzzInconsistencies: number;
  firstMismatch: string;
  caught: boolean;
  ok: boolean;
}

async function evaluate(c: Control, dst: string): Promise<Evidence> {
  const tests = await run(dst, ["--test", "--test-reporter=tap", ...TEST_FILES]);
  const failed = [...tests.out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
  const summary = /^# tests (\d+)\s*$/m.exec(tests.out);
  const fuzzLines: string[] = [];
  let mism = 0;
  let incons = 0;
  let first = "";
  for (const seed of [1, 2]) {
    for (const mode of ["wysiwyg", "ir"]) {
      const r = await run(dst, ["experiments/dom2md-cache/fuzz.ts", `--mode=${mode}`, `--cmp=${CMP}`, `--seed=${seed}`, "--no-precheck", `--corpus-snapshot=${CORPUS}`]);
      const sum = new RegExp(`^== ${mode} .*mismatches=(\\d+).*inconsistencies=(\\d+)`, "m").exec(r.out);
      if (sum === null) {
        fuzzLines.push(`seed ${seed} ${mode}: no summary (exit ${r.code}): ${r.out.slice(-300)}`);
        mism++;
        continue;
      }
      mism += Number(sum[1]);
      incons += Number(sum[2]);
      fuzzLines.push(`seed ${seed} ${mode}: mismatches ${sum[1]}, inconsistencies ${sum[2]}`);
      const mm = /^MISMATCH .*$/m.exec(r.out);
      if (first === "" && mm !== null) first = mm[0].slice(0, 300);
    }
  }
  const caught = failed.length > 0 || mism > 0 || incons > 0;
  return {
    id: c.id,
    testsFailed: [...new Set(failed)].slice(0, 6),
    testsRun: summary ? summary[1] : `exit ${tests.code}`,
    fuzz: fuzzLines,
    fuzzMismatches: mism,
    fuzzInconsistencies: incons,
    firstMismatch: first,
    caught,
    ok: c.expect === "caught" ? caught : !caught,
  };
}

async function main(): Promise<void> {
  mkdirSync(SCRATCH, { recursive: true });
  // the baseline first: it must be green, and it freezes the corpus
  const base = prepare(BASELINE);
  const b = await evaluate(BASELINE, base);
  console.log(`baseline (no change): tests ${b.testsRun} tests, failed ${b.testsFailed.length}; ${b.fuzz.join("; ")}`);
  if (b.caught) {
    console.log("STOP: the baseline is not green; no control was run");
    console.log(JSON.stringify(b, null, 2));
    process.exit(1);
  }
  const todo = CONTROLS.filter((c) => ONLY === null || ONLY.has(c.id));
  const results: Evidence[] = [];
  const queue = [...todo];
  const workers = Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
    for (let c = queue.shift(); c !== undefined; c = queue.shift()) {
      const dst = prepare(c);
      const ev = await evaluate(c, dst);
      results.push(ev);
      console.log(`${c.id} (${c.what}): expected ${c.expect}, observed ${ev.caught ? "caught" : "silent"} ${ev.ok ? "OK" : "UNEXPECTED"}`);
    }
  });
  await Promise.all(workers);
  results.sort((x, y) => CONTROLS.findIndex((c) => c.id === x.id) - CONTROLS.findIndex((c) => c.id === y.id));
  console.log("\n| control | expected | observed | caught by (tests) | fuzz mismatches / inconsistencies | first mismatch |");
  console.log("|---|---|---|---|---|---|");
  for (const r of results) {
    const c = CONTROLS.find((x) => x.id === r.id)!;
    console.log(`| ${r.id} | ${c.expect} | ${r.caught ? "caught" : "silent"}${r.ok ? "" : " (UNEXPECTED)"} | ${r.testsFailed.join("; ") || "-"} | ${r.fuzzMismatches} / ${r.fuzzInconsistencies} | ${r.firstMismatch.replace(/\|/g, "/") || "-"} |`);
  }
  writeFileSync(join(SCRATCH, "summary.json"), JSON.stringify({ baseline: b, results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  console.log(bad.length === 0 ? "\nall controls as expected" : `\n${bad.length} control(s) not as expected: ${bad.map((r) => r.id).join(", ")}`);
  process.exitCode = bad.length === 0 ? 0 : 1;
}

void main();

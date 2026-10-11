// Baseline benchmark of the oracle (test/oracle/lute.ref.min.cjs, or $LUTE_ORACLE) on benchmark/commonmark-spec.md.
// Each API path runs on a fresh engine with default options: 10 warm-up runs,
// then 30 timed runs. Add another engine later by passing another
// (name, makeEngine) pair to runSuite.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { newOracleEngine, oraclePath, type OracleEngine } from "../test/oracle/oracle.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const INPUT_PATH = `${REPO_ROOT}benchmark/commonmark-spec.md`;
const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));

// Default oracle writes oracle-baseline.json; a LUTE_ORACLE bundle writes
// oracle-baseline.head.json so that the two runs do not overwrite each other.
function resultsPath(): string {
  return process.env.LUTE_ORACLE ? `${RESULTS_DIR}oracle-baseline.head.json` : `${RESULTS_DIR}oracle-baseline.json`;
}

const WARMUP_RUNS = 10;
const TIMED_RUNS = 30;

// Inputs derived from the Markdown document, shared by all paths.
interface Inputs {
  markdown: string;
  html: string; // MarkdownStr output, input for HTML2Md
  blockDOM: string; // Md2BlockDOM output, input for BlockDOM2Md and SpinBlockDOM
}

interface PathSpec {
  name: string;
  run: (engine: OracleEngine, inputs: Inputs) => string;
}

const PATHS: PathSpec[] = [
  { name: "MarkdownStr", run: (e, i) => e.MarkdownStr("", i.markdown) },
  { name: "FormatStr", run: (e, i) => e.FormatStr("", i.markdown) },
  { name: "Md2BlockDOM", run: (e, i) => e.Md2BlockDOM(i.markdown) },
  { name: "Md2VditorDOM", run: (e, i) => e.Md2VditorDOM(i.markdown) },
  { name: "Md2VditorIRDOM", run: (e, i) => e.Md2VditorIRDOM(i.markdown) },
  { name: "Md2VditorSVDOM", run: (e, i) => e.Md2VditorSVDOM(i.markdown) },
  { name: "HTML2Md", run: (e, i) => e.HTML2Md(i.html) },
  { name: "BlockDOM2Md", run: (e, i) => e.BlockDOM2Md(i.blockDOM) },
  { name: "SpinBlockDOM", run: (e, i) => e.SpinBlockDOM(i.blockDOM) },
];

export interface PathResult {
  path: string;
  status: "ok" | "missing" | "error";
  arity?: number;
  medianMs?: number;
  minMs?: number;
  meanMs?: number;
  stddevMs?: number;
  outputLength?: number;
  error?: string;
}

export interface SuiteResult {
  engine: string;
  results: PathResult[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Sample standard deviation (n - 1 in the denominator).
function stddev(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Runs every path against engines produced by makeEngine (one fresh engine per path).
export function runSuite(engineName: string, makeEngine: () => OracleEngine, inputs: Inputs): SuiteResult {
  const results: PathResult[] = [];
  for (const spec of PATHS) {
    const engine = makeEngine();
    const method = engine[spec.name];
    if (typeof method !== "function") {
      results.push({ path: spec.name, status: "missing" });
      continue;
    }
    const arity = method.length;
    let outputLength = 0;
    try {
      for (let i = 0; i < WARMUP_RUNS; i++) {
        spec.run(engine, inputs);
      }
      const times: number[] = [];
      for (let i = 0; i < TIMED_RUNS; i++) {
        const start = performance.now();
        const output = spec.run(engine, inputs);
        times.push(performance.now() - start);
        if (i === 0) {
          outputLength = output.length;
        }
      }
      results.push({
        path: spec.name,
        status: "ok",
        arity,
        medianMs: round(median(times)),
        minMs: round(Math.min(...times)),
        meanMs: round(mean(times)),
        stddevMs: round(stddev(times)),
        outputLength,
      });
    } catch (err) {
      results.push({ path: spec.name, status: "error", arity, error: describeError(err) });
    }
  }
  return { engine: engineName, results };
}

function round(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}

function loadInputs(): Inputs {
  const markdown = readFileSync(INPUT_PATH, "utf8");
  const html: string = newOracleEngine().MarkdownStr("", markdown);
  const blockDOM: string = newOracleEngine().Md2BlockDOM(markdown);
  return { markdown, html, blockDOM };
}

function main(): void {
  const inputs = loadInputs();
  const suites = [runSuite("oracle", newOracleEngine, inputs)];

  for (const suite of suites) {
    console.log(`\nEngine: ${suite.engine}`);
    console.table(
      suite.results.map((r) => ({
        path: r.path,
        status: r.status,
        arity: r.arity,
        "median ms": r.medianMs,
        "min ms": r.minMs,
        "mean ms": r.meanMs,
        "stddev ms": r.stddevMs,
        "output length": r.outputLength,
        error: r.error,
      })),
    );
  }

  const report = {
    date: new Date().toISOString(),
    node: process.version,
    oracle: oraclePath(),
    input: { file: "benchmark/commonmark-spec.md", bytes: Buffer.byteLength(inputs.markdown, "utf8") },
    warmupRuns: WARMUP_RUNS,
    timedRuns: TIMED_RUNS,
    engines: Object.fromEntries(suites.map((s) => [s.engine, s.results])),
  };
  const outPath = resultsPath();
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nOracle: ${oraclePath()}`);
  console.log(`Wrote ${outPath}`);
}

main();

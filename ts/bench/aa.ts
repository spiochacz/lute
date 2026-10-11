// A/A noise test of the runtime micro-benchmarks: every row is measured as two
// identical sides, A and B, in one interleaved run (runtime-micro.ts --aa). Each
// side gets one fresh child process per measurement, and the two sides alternate
// round by round, so the drift of the machine hits both alike. Unchanged code
// must then agree closely; the summary says how closely.
//
// Usage (from ts/):
//   node bench/aa.ts [tag] [--groups=g1,g2] [--rounds=N]     run the A/A test (tag defaults to aa), then summarise
//   node bench/aa.ts [tag] --summary-only                     summarise a saved file only
//
// Output file: bench/results/runtime-micro.<tag>.json (fresh each run).
// Summary: per row the fastest process of side A and of side B. The ratio B/A - 1
// is counted within +-5%, +-10% and +-20%. A row with a zero or non-finite time
// on either side is a DEFECT: it is listed, counted, and left out of the
// percentages. Nothing is dropped silently.

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RESULTS = fileURLToPath(new URL("./results/", import.meta.url));
const RUNNER = fileURLToPath(new URL("./runtime-micro.ts", import.meta.url));

const args = process.argv.slice(2);
const tag = args.find((a) => !a.startsWith("--")) ?? "aa";
const passThrough = args.filter((a) => a.startsWith("--groups=") || a.startsWith("--rounds="));
const summaryOnly = args.includes("--summary-only");

if (!summaryOnly) {
  const cmd = ["--expose-gc", "--max-semi-space-size=256", RUNNER, tag, "--aa", ...passThrough];
  const res = spawnSync(process.execPath, cmd, { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error("A/A run failed");
  }
}

interface Stat {
  fastest: number;
  median: number;
}

interface Row {
  group: string;
  impl: "A" | "B" | string;
  nsPerUnit: Stat;
  bytesPerOp: { median: number } | null;
}

const file = `${RESULTS}runtime-micro.${tag}.json`;
if (!existsSync(file)) {
  throw new Error(`missing ${file}`);
}
const rows = (JSON.parse(readFileSync(file, "utf8")) as { rows: Row[] }).rows;

const sides = new Map<string, { A?: Row; B?: Row }>();
for (const r of rows) {
  const pair = sides.get(r.group) ?? {};
  if (r.impl === "A") pair.A = r;
  else if (r.impl === "B") pair.B = r;
  sides.set(r.group, pair);
}

function badTime(x: number): boolean {
  return !(Number.isFinite(x) && x > 0);
}

const defects: string[] = [];
const ratios: { id: string; r: number }[] = [];
const allocDiff: { id: string; d: number }[] = [];
let nullAlloc = 0;
for (const [id, pair] of sides) {
  if (pair.A === undefined || pair.B === undefined) {
    defects.push(`${id}: side missing`);
    continue;
  }
  const a = pair.A.nsPerUnit.fastest;
  const b = pair.B.nsPerUnit.fastest;
  if (badTime(a) || badTime(b)) {
    defects.push(`${id}: fastest A ${a}, fastest B ${b}`);
    continue;
  }
  ratios.push({ id, r: b / a - 1 });
  const ab = pair.A.bytesPerOp;
  const bb = pair.B.bytesPerOp;
  if (ab !== null && bb !== null) {
    const m = Math.max(ab.median, bb.median);
    if (m > 0) allocDiff.push({ id, d: Math.abs(ab.median - bb.median) / m });
  } else {
    nullAlloc++;
  }
}

const n = ratios.length;
console.log(`A/A rows compared (fastest process per side): ${n}; defects listed below (not in the percentages): ${defects.length}`);
for (const p of [0.05, 0.1, 0.2]) {
  const k = ratios.filter((x) => Math.abs(x.r) <= p).length;
  console.log(`  within +-${(p * 100).toFixed(0)}%: ${k}/${n} (${n === 0 ? "n/a" : ((100 * k) / n).toFixed(1)}%)`);
}
const noisy = ratios.filter((x) => Math.abs(x.r) > 0.1).sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
console.log(`\nrows outside +-10% (${noisy.length}):`);
for (const x of noisy) {
  console.log(`  ${x.id.padEnd(60)} ${(100 * x.r).toFixed(1).padStart(7)}%`);
}
const allocBad = allocDiff.filter((x) => x.d > 0.05);
console.log(
  `\nallocation: ${allocDiff.length} rows with B/op on both sides; ${allocBad.length} differ by more than 5%; ${nullAlloc} rows null on a side`,
);
for (const x of allocBad) {
  console.log(`  ${x.id} differs by ${(100 * x.d).toFixed(1)}%`);
}
if (defects.length > 0) {
  console.log(`\nDEFECTS (${defects.length}):`);
  for (const d of defects) {
    console.log(`  ${d}`);
  }
}

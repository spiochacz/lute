// A/A noise test: runs the runtime suite twice on UNCHANGED code (tags aa1 and
// aa2) and prints, per row, the ratio of the two runs, how many rows are within
// +-5%, +-10% and +-20%, and the allocation agreement.
//
// Usage: node bench/aa.ts [--groups=g1,g2] [--summary-only]
//   --summary-only skips the two runs and only prints the summary from the
//   existing aa1/aa2 files.

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RESULTS = fileURLToPath(new URL("./results/", import.meta.url));
const RUNNER = fileURLToPath(new URL("./runtime-micro.ts", import.meta.url));
const args = process.argv.slice(2);
const groupsArg = args.find((a) => a.startsWith("--groups="));

if (args.includes("--interleaved")) {
  // One run in which the two tags alternate process by process (see runnerInterleavedAA).
  const cmd = ["--expose-gc", "--max-semi-space-size=256", RUNNER, "--aa-interleaved", ...(groupsArg ? [groupsArg] : [])];
  const res = spawnSync(process.execPath, cmd, { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error("interleaved runner failed");
  }
} else if (!args.includes("--summary-only")) {
  for (const tag of ["aa1", "aa2"]) {
    const cmd = ["--expose-gc", "--max-semi-space-size=256", RUNNER, tag, ...(groupsArg ? [groupsArg] : [])];
    const res = spawnSync(process.execPath, cmd, { stdio: "inherit" });
    if (res.status !== 0) {
      throw new Error(`runner failed for ${tag}`);
    }
  }
}

interface Row {
  id: string;
  nsPerUnit: { median: number; min: number; max: number };
  bytesPerOp: { median: number } | null;
}

function load(tag: string): Map<string, Row> {
  const f = `${RESULTS}runtime-micro.${tag}.json`;
  if (!existsSync(f)) throw new Error(`missing ${f}`);
  return new Map((JSON.parse(readFileSync(f, "utf8")) as { rows: Row[] }).rows.map((r) => [r.id, r]));
}

const A = load("aa1");
const B = load("aa2");
const ratios: { id: string; r: number }[] = [];
const allocDiff: { id: string; d: number }[] = [];
let nullAlloc = 0;
for (const [id, a] of A) {
  const b = B.get(id);
  if (b === undefined) continue;
  ratios.push({ id, r: b.nsPerUnit.median / a.nsPerUnit.median - 1 });
  if (a.bytesPerOp && b.bytesPerOp) {
    const m = Math.max(a.bytesPerOp.median, b.bytesPerOp.median);
    if (m > 0) allocDiff.push({ id, d: Math.abs(a.bytesPerOp.median - b.bytesPerOp.median) / m });
  } else {
    nullAlloc++;
  }
}
const n = ratios.length;
console.log(`A/A rows compared: ${n}`);
for (const p of [0.05, 0.1, 0.2]) {
  const k = ratios.filter((x) => Math.abs(x.r) <= p).length;
  console.log(`  within +-${(p * 100).toFixed(0)}%: ${k}/${n} (${((100 * k) / n).toFixed(1)}%)`);
}
const noisy = ratios.filter((x) => Math.abs(x.r) > 0.1).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
console.log(`\nrows outside +-10% (${noisy.length}):`);
for (const x of noisy) console.log(`  ${x.id.padEnd(56)} ${(100 * x.r).toFixed(1).padStart(7)}%`);
const allocBad = allocDiff.filter((x) => x.d > 0.05);
console.log(
  `\nallocation: ${allocDiff.length} rows with B/op in both runs; ${allocBad.length} differ by more than 5%; ${nullAlloc} rows null in one run`,
);
for (const x of allocBad) console.log(`  ${x.id} differs by ${(100 * x.d).toFixed(1)}%`);

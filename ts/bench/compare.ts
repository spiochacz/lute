// Prints the comparison table of ONE runtime-micro run.
//
// Usage (from ts/):
//   node bench/compare.ts <tag>
//   reads bench/results/runtime-micro.<tag>.json (npm run bench:runtime writes it and prints this table at the end)
//
// Two tags are refused. Two separate runs cannot be compared: the machine drifts
// 15-35% over minutes, so the same code measured in two runs can differ by that
// much (tasks/001-analysis.md, Step 0). Only impls of one group measured
// interleaved in the same run are comparable.
//
// One line per group (group.name|input), groups sorted by id. Rules:
// - Baseline: ref if the group has a ref impl, else legacy, else the first listed impl.
// - Time: the fastest process per impl (ns per unit). An impl's ratio to the
//   baseline is its fastest over the baseline's fastest. 'same' when the two differ
//   by less than 20% (relative to the baseline), otherwise 'X.XXx faster' or
//   'X.XXx slower'.
// - Allocation: median bytes/op. 'same' when the two differ by less than 5%
//   (relative to the larger), otherwise 'X.XXx more' or 'X.XXx less'.
// - Spread: max / min over the processes of one impl. Flagged UNSTABLE above 1.5.
// - A zero or non-finite time is printed as DEFECT, never dropped.
// - Processes discarded by the canary rule (bench/lib/canary.ts) are left out: the
//   row statistics are over the kept processes (processesUsed). An impl with no kept
//   process gets NO VERDICT, and so does every impl compared with such a baseline.
//   The line says how many processes were discarded. Old files have no processesUsed
//   and are read as before.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RESULTS = fileURLToPath(new URL("./results/", import.meta.url));
const SAME_TIME = 0.2;
const SAME_ALLOC = 0.05;
const UNSTABLE = 1.5;

interface Stat {
  fastest: number;
  median: number;
  spread: number;
}

interface Row {
  id: string;
  group: string;
  impl: string;
  unit: string;
  processes?: number;
  processesUsed?: number;
  nsPerUnit: Stat;
  bytesPerOp: { median: number } | null;
}

// Processes not discarded by the canary rule. Old files (no processesUsed) count every process.
function usedOf(r: Row): number {
  return r.processesUsed ?? r.processes ?? 0;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const tags = args.filter((a) => !a.startsWith("--"));
if (tags.length > 1) {
  fail(
    `compare.ts takes ONE tag, got ${tags.length} (${tags.join(", ")}).\n` +
      "Two saved runs cannot be compared: the machine drifts 15-35% between runs, so the same code can differ that much.\n" +
      "Measure the variants together in one run (npm run bench:runtime -- <tag>) and pass that run's tag.",
  );
}
if (tags.length === 0) {
  fail("usage: node bench/compare.ts <tag>");
}
const file = `${RESULTS}runtime-micro.${tags[0]}.json`;
if (!existsSync(file)) {
  fail(`missing ${file}`);
}
const rows = (JSON.parse(readFileSync(file, "utf8")) as { rows: Row[] }).rows;

const groups = new Map<string, Row[]>();
for (const r of rows) {
  const list = groups.get(r.group) ?? [];
  list.push(r);
  groups.set(r.group, list);
}
const keys = [...groups.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

function baselineOf(list: Row[]): Row {
  return list.find((r) => r.impl === "ref") ?? list.find((r) => r.impl === "legacy") ?? list[0];
}

function fmtNs(x: number): string {
  if (!Number.isFinite(x) || x <= 0) {
    return String(x);
  }
  if (x >= 1000) {
    return x.toFixed(0);
  }
  if (x >= 10) {
    return x.toFixed(1);
  }
  return x.toFixed(3);
}

function isDefect(r: Row): boolean {
  return !(Number.isFinite(r.nsPerUnit.fastest) && r.nsPerUnit.fastest > 0);
}

function timeVerdict(r: Row, base: Row): string {
  const ratio = r.nsPerUnit.fastest / base.nsPerUnit.fastest;
  if (Math.abs(ratio - 1) < SAME_TIME) {
    return `same (${ratio.toFixed(2)}x)`;
  }
  return ratio > 1 ? `${ratio.toFixed(2)}x slower` : `${(1 / ratio).toFixed(2)}x faster`;
}

function allocVerdict(r: Row, base: Row): string {
  if (r.bytesPerOp === null || base.bytesPerOp === null) {
    return "n/a (null)";
  }
  const a = r.bytesPerOp.median;
  const b = base.bytesPerOp.median;
  const m = Math.max(a, b);
  if (m === 0 || Math.abs(a - b) / m < SAME_ALLOC) {
    return "same";
  }
  if (Math.min(a, b) === 0) {
    return a > b ? "more (base 0)" : "less (impl 0)";
  }
  return a > b ? `${(a / b).toFixed(2)}x more` : `${(b / a).toFixed(2)}x less`;
}

const defects: string[] = [];
const unstable: string[] = [];
console.log(
  `runtime-micro ${tags[0]} (${rows.length} rows). Baseline per group: ref if present, else legacy, else first listed. ` +
    `Time: fastest process; same = within ${SAME_TIME * 100}%. Alloc: median; same = within ${SAME_ALLOC * 100}%. ` +
    `Spread = max/min over processes; UNSTABLE above ${UNSTABLE}.\n`,
);
for (const key of keys) {
  const list = groups.get(key) as Row[];
  const base = baselineOf(list);
  const parts = list.map((r) => {
    const isBase = r === base;
    const run = r.processes ?? 0;
    const used = usedOf(r);
    if (used === 0) {
      return `${r.impl} NO VERDICT (all ${run} processes discarded)`;
    }
    const discardNote = used < run ? `, ${run - used} of ${run} processes discarded` : "";
    const fmtd = isDefect(r) ? "DEFECT" : `${fmtNs(r.nsPerUnit.fastest)} ${r.unit}`;
    const bytes = r.bytesPerOp === null ? "null" : String(Math.round(r.bytesPerOp.median));
    const spread = r.nsPerUnit.spread;
    const flag = spread > UNSTABLE ? " UNSTABLE" : "";
    if (isDefect(r)) {
      defects.push(`${r.id}: fastest ${r.nsPerUnit.fastest}`);
    }
    if (spread > UNSTABLE) {
      unstable.push(`${r.id} (spread ${spread.toFixed(2)})`);
    }
    let text = `${r.impl} ${fmtd}, ${bytes} B/op, spread ${spread.toFixed(2)}${flag}${discardNote}`;
    if (list.length === 1) {
      text += " [single impl, no comparison]";
    } else if (isBase) {
      text += " [baseline]";
    } else if (usedOf(base) === 0) {
      text += " -> no verdict (baseline: all processes discarded)";
    } else if (isDefect(r) || isDefect(base)) {
      text += " -> no verdict (zero or non-finite time)";
    } else {
      text += ` -> time ${timeVerdict(r, base)}; B/op ${allocVerdict(r, base)}`;
    }
    return text;
  });
  console.log(`${key}  ${parts.join("  |  ")}`);
}
console.log(`\n${keys.length} groups; ${defects.length} defect row(s); ${unstable.length} unstable row(s).`);
for (const d of defects) {
  console.log(`  DEFECT ${d}`);
}
for (const u of unstable) {
  console.log(`  UNSTABLE ${u}`);
}

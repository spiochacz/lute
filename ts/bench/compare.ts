// Compares two runtime-micro result files row by row.
//
// Usage:
//   node bench/compare.ts <a.json> <b.json> [--ignore-checksums]
//   node bench/compare.ts <file.json> --slowest
//
// Time: a row is flagged only when the [min, max] ranges of the two files (the
// spread across the three processes) do not overlap. B/op: flagged when the
// median changed by more than 5% (both values must be non-null). Checksums must
// match for a row present in both files; a mismatch exits with status 1 unless
// --ignore-checksums is given (use it only for rows whose code changed on purpose).
//
// --slowest: for each runtime row with a ref row of the same group.name|input,
// prints the ten largest ratios runtime / ref, with the ratio range from the
// spreads.

import { readFileSync } from "node:fs";

interface Stat {
  median: number;
  min: number;
  max: number;
}

interface Row {
  id: string;
  group: string;
  name: string;
  input: string;
  impl: string;
  unit: string;
  nsPerUnit: Stat;
  bytesPerOp: Stat | null;
  checksum: number;
}

function load(file: string): Map<string, Row> {
  const data = JSON.parse(readFileSync(file, "utf8")) as { rows: Row[] };
  return new Map(data.rows.map((r) => [r.id, r]));
}

function fmt(x: number): string {
  return x >= 1000 ? x.toFixed(0) : x.toFixed(2);
}

const args = process.argv.slice(2);
const ignoreChecksums = args.includes("--ignore-checksums");
const files = args.filter((a) => !a.startsWith("--"));

if (args.includes("--slowest")) {
  const rows = load(files[0]);
  const out: { id: string; ratio: number; lo: number; hi: number; allocRuntime: number | null; allocRef: number | null }[] =
    [];
  for (const r of rows.values()) {
    if (r.impl !== "runtime") continue;
    const ref = rows.get(`${r.group}.${r.name}|${r.input}|ref`);
    if (ref === undefined) continue;
    out.push({
      id: `${r.group}.${r.name}|${r.input}`,
      ratio: r.nsPerUnit.median / ref.nsPerUnit.median,
      lo: r.nsPerUnit.min / ref.nsPerUnit.max,
      hi: r.nsPerUnit.max / ref.nsPerUnit.min,
      allocRuntime: r.bytesPerOp ? r.bytesPerOp.median : null,
      allocRef: ref.bytesPerOp ? ref.bytesPerOp.median : null,
    });
  }
  out.sort((a, b) => b.ratio - a.ratio);
  console.log("runtime / ref, ten slowest (ratio, range from spreads, B/op runtime and ref):");
  for (const o of out.slice(0, 10)) {
    console.log(
      `${o.id.padEnd(48)} ${o.ratio.toFixed(2).padStart(8)}x  [${o.lo.toFixed(2)} .. ${o.hi.toFixed(2)}]  ` +
        `B/op ${o.allocRuntime ?? "null"} vs ${o.allocRef ?? "null"}`,
    );
  }
  process.exit(0);
}

const [fa, fb] = files;
const A = load(fa);
const B = load(fb);
const timeFlags: string[] = [];
const allocFlags: string[] = [];
const checksumBad: string[] = [];
let inBoth = 0;
let withinNoise = 0;
for (const [id, a] of A) {
  const b = B.get(id);
  if (b === undefined) continue;
  inBoth++;
  if (a.checksum !== b.checksum) {
    checksumBad.push(`${id}: ${a.checksum} -> ${b.checksum}`);
  }
  const overlap = !(a.nsPerUnit.max < b.nsPerUnit.min || b.nsPerUnit.max < a.nsPerUnit.min);
  const ratio = b.nsPerUnit.median / a.nsPerUnit.median;
  if (overlap) {
    withinNoise++;
  } else {
    timeFlags.push(
      `${id.padEnd(52)} ${fmt(a.nsPerUnit.median)} -> ${fmt(b.nsPerUnit.median)} ${a.unit}  x${ratio.toFixed(2)}  ` +
        `[${fmt(a.nsPerUnit.min)}..${fmt(a.nsPerUnit.max)}] vs [${fmt(b.nsPerUnit.min)}..${fmt(b.nsPerUnit.max)}]`,
    );
  }
  if (a.bytesPerOp && b.bytesPerOp) {
    const br = b.bytesPerOp.median / Math.max(a.bytesPerOp.median, 1e-9);
    if (Math.abs(br - 1) > 0.05) {
      allocFlags.push(`${id.padEnd(52)} B/op ${a.bytesPerOp.median} -> ${b.bytesPerOp.median}`);
    }
  } else if ((a.bytesPerOp === null) !== (b.bytesPerOp === null)) {
    allocFlags.push(
      `${id.padEnd(52)} B/op ${a.bytesPerOp ? a.bytesPerOp.median : "null"} -> ${b.bytesPerOp ? b.bytesPerOp.median : "null"}`,
    );
  }
}
const onlyA = [...A.keys()].filter((k) => !B.has(k));
const onlyB = [...B.keys()].filter((k) => !A.has(k));

console.log(`rows in both: ${inBoth}; time ranges overlap (within noise): ${withinNoise}`);
console.log(`\ntime changed (ranges do not overlap): ${timeFlags.length}`);
for (const l of timeFlags) console.log("  " + l);
console.log(`\nB/op changed by more than 5%: ${allocFlags.length}`);
for (const l of allocFlags) console.log("  " + l);
if (onlyA.length || onlyB.length) {
  console.log(`\nonly in A: ${onlyA.length}; only in B: ${onlyB.length}`);
}
if (checksumBad.length) {
  console.log(`\nCHECKSUM MISMATCH in ${checksumBad.length} row(s):`);
  for (const l of checksumBad) console.log("  " + l);
  if (!ignoreChecksums) {
    console.error("compare: checksums differ; failing (use --ignore-checksums only for rows changed on purpose)");
    process.exit(1);
  }
}

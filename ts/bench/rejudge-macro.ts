// Re-judges saved macro result files under the current discard rule (bench/lib/canary.ts), without
// measuring anything. Used to check a rule change against the data of an earlier run.
//
// Usage (from ts/):
//   node bench/rejudge-macro.ts [--final=macro.final2] [--rerun-glob=macro.rerun-] [--w5=macro.w5]
// Defaults are the files named above. Each file is judged as ONE run, as the macro run judges
// its own rows. The re-run files replace the rows of the same key in the final file (as the
// table was put together); the w5 file is a separate run and is judged alone.
//
// Prints per file: the processes, the discards under the stored rule and under the current rule,
// the weak sides and rows, and the rows with no verdict. Then one line per row of the merged table:
// the stored (old) port/reference ratio, the re-judged (new) ratio, and the change. Rows whose ratio
// moved by more than 5 percent are listed with their process counts.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { judgeRun, type Judged } from "./lib/canary.ts";
import { verdictFor } from "./lib/stats.ts";

const RESULTS = fileURLToPath(new URL("./results/", import.meta.url));
const MOVE_SHARE = 0.05;

interface SavedProc extends Judged {
  medianUs: number;
}

interface SavedSide {
  run: number;
  perProcess: SavedProc[];
}

interface SavedRow {
  key: string;
  status: "ok" | "skipped";
  port?: SavedSide;
  ref?: SavedSide;
  ratio?: number;
  verdict?: string;
}

interface SavedFile {
  methods: SavedRow[];
}

function option(name: string, fallback: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const finalTag = option("final", "macro.final2");
const rerunPrefix = option("rerun-glob", "macro.rerun-");
const w5Tag = option("w5", "macro.w5");

// Discards as stored in the file, that is under the rule of the run that wrote it (the old rule).
function storedDiscards(rows: SavedRow[]): number {
  return rows.flatMap((r) => [...(r.port?.perProcess ?? []), ...(r.ref?.perProcess ?? [])]).filter((p) => p.discarded).length;
}

function load(file: string): SavedFile {
  return JSON.parse(readFileSync(`${RESULTS}${file}.json`, "utf8")) as SavedFile;
}

interface NewRow {
  key: string;
  oldRatio: number | undefined;
  newRatio: number | undefined;
  newVerdict: string;
  portKept: number;
  portRun: number;
  refKept: number;
  refRun: number;
  weak: boolean;
  portFastestOld: number;
  refFastestOld: number;
  portFastestNew: number;
  refFastestNew: number;
}

// Judges one file as one run and returns its rows with the new verdict.
function rejudgeFile(label: string, rows: SavedRow[]): NewRow[] {
  const ok = rows.filter((r): r is SavedRow & { port: SavedSide; ref: SavedSide } => r.status === "ok" && r.port !== undefined && r.ref !== undefined);
  const before = storedDiscards(ok);
  const { weak } = judgeRun(ok.flatMap((r) => [r.port.perProcess, r.ref.perProcess]));
  let r1 = 0;
  let r2 = 0;
  let fb = 0;
  let total = 0;
  let discarded = 0;
  for (const r of ok) {
    for (const p of [...r.port.perProcess, ...r.ref.perProcess]) {
      total++;
      if (p.discarded) discarded++;
      if (p.discardRule === "end-start") r1++;
      if (p.discardRule === "start") r2++;
      if (p.keptByFallback) fb++;
    }
  }
  const weakRows = ok.filter((_, i) => weak[2 * i] || weak[2 * i + 1]).map((r) => r.key);
  const out: NewRow[] = ok.map((r, i) => {
    const pk = r.port.perProcess.filter((p) => !p.discarded);
    const rk = r.ref.perProcess.filter((p) => !p.discarded);
    const portFastestNew = pk.length === 0 ? NaN : Math.min(...pk.map((p) => p.medianUs));
    const refFastestNew = rk.length === 0 ? NaN : Math.min(...rk.map((p) => p.medianUs));
    const portOld = r.port.perProcess.filter((p) => !p.discarded).map((p) => p.medianUs);
    const refOld = r.ref.perProcess.filter((p) => !p.discarded).map((p) => p.medianUs);
    let newRatio: number | undefined;
    let newVerdict: string;
    if (pk.length === 0 || rk.length === 0) {
      newVerdict = "no verdict (all processes of one side discarded)";
    } else {
      const v = verdictFor(portFastestNew, refFastestNew);
      newRatio = v.ratio;
      newVerdict = v.verdict;
    }
    return {
      key: r.key,
      oldRatio: r.ratio,
      newRatio,
      newVerdict,
      portKept: pk.length,
      portRun: r.port.run,
      refKept: rk.length,
      refRun: r.ref.run,
      weak: weak[2 * i] || weak[2 * i + 1],
      portFastestOld: portOld.length === 0 ? NaN : Math.min(...portOld),
      refFastestOld: refOld.length === 0 ? NaN : Math.min(...refOld),
      portFastestNew,
      refFastestNew,
    };
  });
  const noVerdict = out.filter((x) => x.newRatio === undefined).length;
  console.log(
    `${label.padEnd(30)} rows ${ok.length}; processes ${total}; discarded stored ${before} (${((100 * before) / total).toFixed(1)}%) -> now ${discarded} (${((100 * discarded) / total).toFixed(1)}%) ` +
      `[end-start ${r1}, start ${r2}, kept by fallback ${fb}]; weak rows ${weakRows.length}; no verdict ${noVerdict}`,
  );
  if (weakRows.length > 0) {
    console.log(`  weak: ${weakRows.join(", ")}`);
  }
  return out;
}

// The merged table: the final file, with every re-run row replacing the row of the same key.
const finalRows = load(finalTag).methods;
const rerunFiles = readdirSync(RESULTS)
  .filter((f) => f.startsWith(rerunPrefix) && f.endsWith(".json"))
  .map((f) => f.slice(0, -".json".length))
  .sort();

const merged = new Map<string, NewRow>();
for (const x of rejudgeFile(finalTag, finalRows)) merged.set(x.key, x);
for (const f of rerunFiles) {
  for (const x of rejudgeFile(f, load(f).methods)) merged.set(x.key, x);
}
// The stored ratio of the row, from the file it came from, is the old value.
const oldByKey = new Map<string, number | undefined>();
for (const r of finalRows) oldByKey.set(r.key, r.ratio);
for (const f of rerunFiles) for (const r of load(f).methods) oldByKey.set(r.key, r.ratio);

const w5Rows = rejudgeFile(w5Tag, load(w5Tag).methods);

console.log(`\nmerged table: ${merged.size} rows`);
console.log("key".padEnd(28) + "old ratio".padStart(11) + "new ratio".padStart(11) + "change".padStart(10) + "  procs port (old/new)  procs ref (old/new)  note");
let moved = 0;
let weakCount = 0;
let noVerdictCount = 0;
for (const x of [...merged.values()]) {
  const oldR = oldByKey.get(x.key);
  const change = oldR !== undefined && x.newRatio !== undefined ? x.newRatio / oldR - 1 : NaN;
  const isMoved = Number.isFinite(change) && Math.abs(change) > MOVE_SHARE;
  if (isMoved) moved++;
  if (x.weak) weakCount++;
  if (x.newRatio === undefined) noVerdictCount++;
  const fmt = (v: number | undefined): string => (v === undefined ? "none" : v.toFixed(3));
  const ch = Number.isFinite(change) ? `${(100 * change).toFixed(1)}%` : "-";
  const note = [x.weak ? "weak" : "", isMoved ? "MOVED >5%" : ""].filter((s) => s !== "").join(", ");
  const oldProcs = oldProcsOf(x.key);
  console.log(
    x.key.padEnd(28) + fmt(oldR).padStart(11) + fmt(x.newRatio).padStart(11) + ch.padStart(10) +
      `  ${oldProcs.port} -> ${x.portKept}/${x.portRun}`.padEnd(24) + `  ${oldProcs.ref} -> ${x.refKept}/${x.refRun}`.padEnd(21) + `  ${note}`,
  );
}

// Old kept counts of the row, from the file it came from (used for the table only).
function oldProcsOf(key: string): { port: string; ref: string } {
  const src = rerunFiles.map((f) => load(f).methods.find((m) => m.key === key)).find((m) => m !== undefined) ?? finalRows.find((m) => m.key === key);
  if (src === undefined || src.port === undefined || src.ref === undefined) {
    return { port: "-", ref: "-" };
  }
  const k = (s: SavedSide): number => s.perProcess.filter((p) => !p.discarded).length;
  return { port: `${k(src.port)}/${src.port.run}`, ref: `${k(src.ref)}/${src.ref.run}` };
}

console.log(`\nmerged rows: moved by more than 5%: ${moved}; weak rows: ${weakCount}; no verdict: ${noVerdictCount}`);
console.log(`w5 (separate run): weak rows ${w5Rows.filter((x) => x.weak).length}; no verdict ${w5Rows.filter((x) => x.newRatio === undefined).length}`);
for (const x of w5Rows) {
  const oldR = x.oldRatio;
  const change = oldR !== undefined && x.newRatio !== undefined ? x.newRatio / oldR - 1 : NaN;
  console.log(`  ${x.key.padEnd(24)} old ${oldR === undefined ? "none" : oldR.toFixed(3)} new ${x.newRatio === undefined ? "none" : x.newRatio.toFixed(3)} change ${Number.isFinite(change) ? (100 * change).toFixed(1) + "%" : "-"}${Number.isFinite(change) && Math.abs(change) > MOVE_SHARE ? "  MOVED >5%" : ""}`);
}

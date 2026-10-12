// Interleaved runner: for each round, each variant is run in its own short process (time.ts), variants alternating, so that the
// machine's drift hits every variant alike. Prints per row the fastest and median call of every variant, the ratio against the first
// variant, and fails when the output hashes differ between variants or a canary is above 1.3 (row discarded).
// Usage: node run.ts --variants=<dir1>,<dir2>,... --methods=VditorDOM2Md,... --fixtures=<file1>,<file2>,... [--rounds=3] [--budget=600]
import { spawnSync } from "node:child_process";

interface Row {
  variant: string;
  method: string;
  file: string;
  n: number;
  min: number;
  med: number;
  canary: number;
  canaryMs: number;
  hash: string;
  up: number;
}

const args = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a === undefined ? def : a.slice(name.length + 3);
};
const variants = opt("variants", "").split(",").filter(Boolean);
const methods = opt("methods", "VditorDOM2Md").split(",");
const fixtures = opt("fixtures", "").split(",").filter(Boolean);
const rounds = Number(opt("rounds", "3"));
const budget = opt("budget", "600");
if (variants.length < 1 || fixtures.length < 1) {
  throw new Error("--variants and --fixtures are required");
}
const timeScript = new URL("./time.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const rows: Row[] = [];
for (let r = 0; r < rounds; r++) {
  for (const method of methods) {
    for (const file of fixtures) {
      // alternate the order of the variants every round
      const order = r % 2 === 0 ? variants : [...variants].reverse();
      for (const v of order) {
        const res = spawnSync(process.execPath, [timeScript, method, file, budget], { env: { ...process.env, VARIANT: v }, encoding: "utf8" });
        if (res.status !== 0) {
          console.error(res.stderr);
          throw new Error(`time.ts failed for ${v} ${method} ${file}`);
        }
        const line = res.stdout.trim().split("\n").pop() as string;
        const row = JSON.parse(line) as Row;
        rows.push(row);
        console.error(line);
      }
    }
  }
}

// Report
const names = variants.map((v) => v.replace(/\\/g, "/").split("/").pop() as string);
let failed = false;
for (const method of methods) {
  for (const file of fixtures) {
    const f = file.split(/[\\/]/).pop();
    const per = names.map((name) => rows.filter((x) => x.variant === name && x.method === method && x.file === f));
    const hashes = new Set(per.flat().map((x) => x.hash));
    if (hashes.size !== 1) {
      failed = true;
      console.log(`HASH MISMATCH ${method} ${f}: ${[...hashes].join(" ")}`);
    }
    const kept = per.map((xs) => xs.filter((x) => x.canary <= 1.3));
    const discarded = per.reduce((a, xs) => a + xs.filter((x) => x.canary > 1.3).length, 0);
    const base = kept[0];
    const baseMin = base.length ? Math.min(...base.map((x) => x.min)) : NaN;
    const baseMed = base.length ? median(base.map((x) => x.med)) : NaN;
    const cells = names.map((name, i) => {
      const xs = kept[i];
      if (xs.length === 0) {
        return `${name}: (all discarded)`;
      }
      const mn = Math.min(...xs.map((x) => x.min));
      const md = median(xs.map((x) => x.med));
      return `${name}: min ${fmt(mn)} (${(mn / baseMin).toFixed(3)}x) med ${fmt(md)} (${(md / baseMed).toFixed(3)}x) [${xs.length} proc]`;
    });
    console.log(`${method} ${f}${discarded ? ` (${discarded} discarded)` : ""}\n  ${cells.join("\n  ")}`);
  }
}
if (failed) {
  process.exitCode = 1;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}
function fmt(ms: number): string {
  return ms >= 1 ? `${ms.toFixed(2)} ms` : `${(ms * 1000).toFixed(0)} us`;
}

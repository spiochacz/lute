// Why is a repeated VditorDOM2Md call on a 5 MB document slower than the first one? CPU profile, GC entries and heap spaces per call.
// Usage: node --max-old-space-size=8192 call_profile.mjs [copies=24] [calls=5]   (needs dist/lute.esm.js: npm run build)
import { readFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { PerformanceObserver, performance } from "node:perf_hooks";
import v8 from "node:v8";
const m = await import(new URL("../../../dist/lute.esm.js", import.meta.url).href);
const Lute = m.default ?? m.Lute ?? m;
const copies = Number(process.argv[2] ?? 24), calls = Number(process.argv[3] ?? 5);
const base = readFileSync(new URL("../../../../benchmark/commonmark-spec.md", import.meta.url), "utf8");
let md = ""; for (let i = 0; i < copies; i++) md += base.replace(/^(#+ .*)$/gm, `$1 ${i}`) + "\n\n";
const L = (Lute.New ?? m.New)(); L.SetVditorWYSIWYG(true);
const h = L.Md2VditorDOM(md); md = "";
const gcs = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) gcs.push({ start: e.startTime, dur: e.duration, kind: e.detail?.kind }); }).observe({ entryTypes: ["gc"] });
const session = new Session(); session.connect();
await session.post("Profiler.enable"); await session.post("Profiler.setSamplingInterval", { interval: 500 });
const tick = () => new Promise((r) => setTimeout(r, 50));
function summarize(profile) {
  const self = new Map(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) { const n = byId.get(profile.samples[i]); const k = n.callFrame.functionName || "(anonymous:" + n.callFrame.lineNumber + ")"; self.set(k, (self.get(k) ?? 0) + dt[i] / 1000); total += dt[i] / 1000; }
  return { total, self };
}
const profs = [];
for (let c = 0; c < calls; c++) {
  await tick(); gcs.length = 0;
  await session.post("Profiler.start");
  const t0 = performance.now(); L.VditorDOM2Md(h); const t1 = performance.now();
  const { profile } = await session.post("Profiler.stop");
  await tick();
  const inside = gcs.filter((g) => g.start >= t0 && g.start <= t1);
  const kinds = {}; for (const g of inside) { const k = g.kind === 1 ? "scavenge" : g.kind === 2 || g.kind === 4 ? "major" : "other" + g.kind; kinds[k] ??= { n: 0, ms: 0 }; kinds[k].n++; kinds[k].ms += g.dur; }
  const sp = Object.fromEntries(v8.getHeapSpaceStatistics().filter((s) => /new_space|old_space|large_object_space/.test(s.space_name) && !/code|shared|trusted/.test(s.space_name)).map((s) => [s.space_name, `${(s.space_used_size / 1e6).toFixed(0)}/${(s.space_size / 1e6).toFixed(0)}MB`]));
  console.log(`call ${c + 1}: ${(t1 - t0).toFixed(0)} ms | gc ${Object.entries(kinds).map(([k, v]) => `${k} x${v.n} ${v.ms.toFixed(0)}ms`).join(", ")} | spaces used/size ${JSON.stringify(sp)}`);
  profs.push(summarize(profile));
}
const a = profs[0], b = profs[profs.length - 1];
const names = new Set([...a.self.keys(), ...b.self.keys()]);
const rows = [...names].map((k) => [k, a.self.get(k) ?? 0, b.self.get(k) ?? 0]).sort((x, y) => (y[2] - y[1]) - (x[2] - x[1]));
console.log(`\nself time, call 1 (${a.total.toFixed(0)} ms sampled) against call ${profs.length} (${b.total.toFixed(0)} ms sampled); largest increases first`);
for (const [k, x, y] of rows.slice(0, 22)) console.log(`  ${x.toFixed(0).padStart(6)} -> ${y.toFixed(0).padStart(6)} ms  x${(y / Math.max(x, 1)).toFixed(1).padStart(5)}  ${k}`);
console.log("largest decreases:"); for (const [k, x, y] of rows.slice(-4)) console.log(`  ${x.toFixed(0).padStart(6)} -> ${y.toFixed(0).padStart(6)} ms  ${k}`);

import { readFileSync } from "node:fs";
const prof = JSON.parse(readFileSync(process.argv[2], "utf8"));
const pat = new RegExp(process.argv[3] ?? "searchEmptyNodes");
const nodes: any[] = prof.nodes; const total = (prof.samples as number[]).length;
const byId = new Map(nodes.map((n) => [n.id, n]));
const selfTicks = new Map<number, number>(); for (const s of prof.samples) selfTicks.set(s, (selfTicks.get(s) ?? 0) + 1);
// total self by function
const fnSelf = new Map<string, number>();
for (const n of nodes) { const k = n.callFrame.functionName + ":" + n.callFrame.url.split("/").pop() + ":" + n.callFrame.lineNumber; fnSelf.set(k, (fnSelf.get(k) ?? 0) + (selfTicks.get(n.id) ?? 0)); }
console.log("samples", total); console.log([...fnSelf].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => (100 * v / total).toFixed(1) + "% " + k).join("\n"));
const lines = new Map<number, number>(); let selfSum = 0;
for (const n of nodes) if (pat.test(n.callFrame.functionName)) { selfSum += selfTicks.get(n.id) ?? 0; for (const pt of n.positionTicks ?? []) lines.set(pt.line, (lines.get(pt.line) ?? 0) + pt.ticks); }
console.log("target self ticks", selfSum, (100 * selfSum / total).toFixed(2) + "% of all");
const srcLines = readFileSync(process.argv[4] ?? "variants.ts", "utf8").split("\n");
for (const [l, t] of [...lines].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log((100 * t / selfSum).toFixed(1).padStart(5) + "%  L" + l + "  " + (srcLines[l - 1] ?? "").trim().slice(0, 110));

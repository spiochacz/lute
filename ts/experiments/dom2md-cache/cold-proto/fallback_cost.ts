// Cost of a call that falls back (IR spec document: tip-open), one-character edit of a paragraph each time.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
import { EnableIncrementalDom2Md } from "../../../src/incremental/index.ts";
import { IR_ADAPTER } from "../../../src/incremental/sandbox.ts";
import { vditorIRDOM2MdPreprocess } from "../../../src/vditor_ir.ts";
import { scanTopLevel } from "../../../src/incremental/scanner.ts";
import { Cache, compose } from "./fast.ts";
const raw = readFileSync(`${process.env.FIX}/spec.ir.html`, "utf8").split(editor.Zwsp).join("");
const { port } = engines(CONFIGS[0], "ir");
const cur = port; 
const { port: p2 } = engines(CONFIGS[0], "ir"); EnableIncrementalDom2Md(p2);
const h = vditorIRDOM2MdPreprocess(raw);
const sc = scanTopLevel(h); if (!sc.ok) throw new Error();
const kids = sc.children.map((c) => h.substring(c.start, c.end));
const paragraphs = kids.map((k, i) => (k.startsWith("<p") ? i : -1)).filter((i) => i >= 0);
const withMemo = new Cache(), noMemo = new Cache(); noMemo.useMemo = false;
void cur;
const best: Record<string, number> = {};
const m = (k: string, f: () => void) => { const t = performance.now(); f(); best[k] = Math.min(best[k] ?? Infinity, performance.now() - t); };
for (let r = 0; r < 14; r++) {
  const i = paragraphs[(r * 7919) % paragraphs.length];
  const ed = kids.slice(); ed[i] = ed[i].replace(/<\/p>$/, "é" + String.fromCharCode(0x4e00 + r) + "</p>");
  const doc = ed.join("");
  m("normal (VditorIRDOM2Md without cache)", () => { port.VditorIRDOM2Md(doc); });
  m("current src cache, falls back", () => { p2.VditorIRDOM2Md(doc); });
  m("fast, A/B/early exit, no memo", () => { compose(port, IR_ADAPTER, noMemo, doc); });
  m("fast + negative memo (compose only, then null)", () => { compose(port, IR_ADAPTER, withMemo, doc); });
  m("fast + negative memo + normal path (what a caller pays)", () => { if (compose(port, IR_ADAPTER, withMemo, doc) === null) port.VditorIRDOM2Md(doc); });
}
for (const [k, v] of Object.entries(best)) console.log(k.padEnd(60), v.toFixed(2), "ms");
console.log(JSON.stringify(withMemo.stats));

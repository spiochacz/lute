// Does running the sandbox slow the NORMAL path afterwards? Fresh process per variant. CPU time (user+system) instead of wall time, so that a busy machine matters less.
import { readFileSync } from "node:fs";
import { CONFIGS, engines } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
import { EnableIncrementalDom2Md } from "../../../src/incremental/index.ts";
import { WYSIWYG_ADAPTER } from "../../../src/incremental/sandbox.ts";
import { vditorDOM2MdPreprocess } from "../../../src/vditor_wysiwyg.ts";
import { Cache, compose } from "./fast.ts";
const which = process.argv[2];
const raw = readFileSync(`${process.env.FIX}/spec.wysiwyg.html`, "utf8").split(editor.Zwsp).join("");
const { port } = engines(CONFIGS[0], "wysiwyg");
const cpu = (): number => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const bestN = () => { let b = Infinity; for (let i = 0; i < 15; i++) { const t = cpu(); port.vditorDOM2Md(raw); b = Math.min(b, cpu() - t); } return b; };
const before = bestN();
const h = vditorDOM2MdPreprocess(raw);
for (let i = 0; i < 10; i++) {
  if (which === "src") { const { port: p } = engines(CONFIGS[0], "wysiwyg"); EnableIncrementalDom2Md(p); p.VditorDOM2Md(raw); }
  else if (which === "fast") compose(port, WYSIWYG_ADAPTER, new Cache(), h);
  else port.vditorDOM2Md(raw); // ctl: more normal calls, no sandbox
}
const after = bestN();
console.log(which.padEnd(5), "cpu ms normal before", before.toFixed(1), "after", after.toFixed(1), "ratio", (after / before).toFixed(2));

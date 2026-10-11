import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { editor } from "../../../src/index.ts";
import * as util from "../../../src/util/index.ts";
import { scanTopLevel } from "../../../src/incremental/scanner.ts";
import { parseWithBoundary, certify } from "../../../src/incremental/parser_certificate.ts";
import { vditorDOM2MdPreprocess } from "../../../src/vditor_wysiwyg.ts";
const FIX = process.env.FIX!;
const h = vditorDOM2MdPreprocess(readFileSync(`${FIX}/spec.wysiwyg.html`, "utf8").split(editor.Zwsp).join(""));
const sc = scanTopLevel(h); if (!sc.ok) throw new Error();
const kids = sc.children.map((c) => h.substring(c.start, c.end));
const best: Record<string, number> = {};
const m = (k: string, f: () => void) => { const t = performance.now(); f(); best[k] = Math.min(best[k] ?? Infinity, performance.now() - t); };
for (let i = 0; i < 15; i++) {
  m("whole ParseHTML", () => util.ParseHTML(h));
  m("children ParseHTML", () => { for (const k of kids) util.ParseHTML(k); });
  m("children parseWithBoundary", () => { for (const k of kids) parseWithBoundary(k); });
  m("children parseWithBoundary+certify", () => { for (const k of kids) { const p = parseWithBoundary(k); certify(k, p.doc, p.boundary); } });
}
console.log(kids.length, "children;", Object.entries(best).map(([k, v]) => `${k}=${v.toFixed(1)}ms`).join("  "));

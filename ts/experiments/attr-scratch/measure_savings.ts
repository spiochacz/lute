// Scratch: live heap of the spec DOM after ParseHTML, and the saving of two replacements done after parse:
// (1) attributeless nodes get one shared frozen empty array (the A1 design), (2) every Attr is trimmed to an exact-size copy.
import { readFileSync } from "node:fs";
import { CONFIGS, engines } from "../dom2md-cache/corpus.ts";
import { editor, util } from "../../src/index.ts";
import { vditorDOM2MdPreprocess } from "../../src/vditor_wysiwyg.ts";
const md = readFileSync(new URL("../../../benchmark/commonmark-spec.md", import.meta.url), "utf8");
const { port } = engines(CONFIGS[0], "wysiwyg");
const h = port.Md2VditorDOM(md).split(editor.Zwsp).join("");
const used = (): number => { (globalThis as any).gc(); (globalThis as any).gc(); return process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers; };
const mode = process.argv[2];
const p = vditorDOM2MdPreprocess(h);
const a = used();
const root: any = util.ParseHTML(p)!;
const b = used();
const nodes: any[] = []; const st: any[] = [root];
while (st.length) { const x = st.pop(); nodes.push(x); for (let k = x.FirstChild; k; k = k.NextSibling) st.push(k); }
const EMPTY: any = Object.freeze([]);
if (mode === "empty") for (const x of nodes) if (x.Attr.length === 0) x.Attr = EMPTY;
if (mode === "exact") for (const x of nodes) x.Attr = x.Attr.slice();
const c = used();
console.log(`${mode}: parse ${((b - a) / 1e6).toFixed(3)} MB, after ${mode} ${((c - a) / 1e6).toFixed(3)} MB, delta ${((b - c) / 1e6).toFixed(3)} MB (${(100 * (b - c) / (b - a)).toFixed(1)} %), nodes ${nodes.length}`);
void root;

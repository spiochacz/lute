// Live heap held by the DOM tree and by the AST of the normal VditorDOM2Md path on the CommonMark spec (run with --expose-gc).
import { readFileSync } from "node:fs";
import { CONFIGS, engines } from "../corpus.ts";
import { editor, util } from "../../../src/index.ts";
import { vditorDOM2MdPreprocess, vditorDOM2MdBuildTree } from "../../../src/vditor_wysiwyg.ts";
const md = readFileSync(new URL("../../../../benchmark/commonmark-spec.md", import.meta.url), "utf8");
const { port } = engines(CONFIGS[0], "wysiwyg");
const h = port.Md2VditorDOM(md).split(editor.Zwsp).join("");
const used = (): number => { (globalThis as any).gc(); (globalThis as any).gc(); return process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers; };
const count = (n: any, next: string, first: string): number => { let c = 0; const st = [n]; while (st.length) { const x = st.pop(); c++; for (let k = x[first]; k; k = k[next]) st.push(k); } return c; };
const p = vditorDOM2MdPreprocess(h);
const a = used(); const root = util.ParseHTML(p)!; const b = used();
(port as any).adjustVditorDOM(root); const c = used();
const dn = count(root, "NextSibling", "FirstChild");
const tree = vditorDOM2MdBuildTree(port, root); const d = used();
const an = count(tree.Root, "Next", "FirstChild");
console.log(`html ${(h.length / 1e3).toFixed(0)} KB | DOM after parse ${((b - a) / 1e6).toFixed(2)} MB, ${dn} nodes, ${((b - a) / dn).toFixed(0)} B/node | after adjust ${((c - a) / 1e6).toFixed(2)} MB | AST ${((d - c) / 1e6).toFixed(2)} MB, ${an} nodes, ${((d - c) / an).toFixed(0)} B/node`);

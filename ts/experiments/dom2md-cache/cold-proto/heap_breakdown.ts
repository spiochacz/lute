// What the DOM tree and the AST of the normal VditorDOM2Md path are made of, from heap snapshots (self sizes by object kind).
// Usage: node --expose-gc heap_breakdown.ts <output directory for the snapshots>
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import v8 from "node:v8";
import { CONFIGS, engines } from "../corpus.ts";
import { editor, util } from "../../../src/index.ts";
import { vditorDOM2MdPreprocess, vditorDOM2MdBuildTree } from "../../../src/vditor_wysiwyg.ts";
const dir = process.argv[2];
const md = readFileSync(new URL("../../../../benchmark/commonmark-spec.md", import.meta.url), "utf8");
const { port } = engines(CONFIGS[0], "wysiwyg");
const h = port.Md2VditorDOM(md).split(editor.Zwsp).join("");
// warm up so that lazily created engine state is not counted
port.VditorDOM2Md(h);
function snap(name: string): Map<string, { n: number; b: number }> {
  (globalThis as any).gc(); (globalThis as any).gc();
  const f = v8.writeHeapSnapshot(join(dir, name + ".heapsnapshot"));
  const s = JSON.parse(readFileSync(f, "utf8")); rmSync(f);
  const nf: string[] = s.snapshot.meta.node_fields; const types: string[] = s.snapshot.meta.node_types[0];
  const iT = nf.indexOf("type"), iN = nf.indexOf("name"), iS = nf.indexOf("self_size"), w = nf.length;
  const out = new Map<string, { n: number; b: number }>();
  for (let i = 0; i < s.nodes.length; i += w) {
    const t = types[s.nodes[i + iT]]; let name: string = s.strings[s.nodes[i + iN]];
    if (t === "string" || t === "concatenated string" || t === "sliced string") name = "(" + t + ")";
    else if (t === "hidden" || t === "array" || t === "code" || t === "object shape" || t === "number") name = `(${t}) ${name}`.slice(0, 60);
    else name = `${t} ${name}`.slice(0, 60);
    const e = out.get(name) ?? { n: 0, b: 0 }; e.n++; e.b += s.nodes[i + iS]; out.set(name, e);
  }
  return out;
}
function diff(label: string, a: Map<string, { n: number; b: number }>, b: Map<string, { n: number; b: number }>, nodes: number): void {
  const rows: Array<[string, number, number]> = [];
  let total = 0;
  for (const [k, v] of b) { const o = a.get(k) ?? { n: 0, b: 0 }; const db = v.b - o.b; if (db !== 0) rows.push([k, v.n - o.n, db]); total += db; }
  rows.sort((x, y) => y[2] - x[2]);
  console.log(`\n${label}: +${(total / 1e6).toFixed(2)} MB, ${nodes} tree nodes, ${(total / nodes).toFixed(0)} B per tree node`);
  for (const [k, n, by] of rows.slice(0, 14)) console.log(`  ${(by / 1e3).toFixed(0).padStart(7)} KB  ${String(n).padStart(7)} objects  ${(by / nodes).toFixed(0).padStart(4)} B/node  ${k}`);
}
const count = (n: any, next: string, first: string): number => { let c = 0; const st = [n]; while (st.length) { const x = st.pop(); c++; for (let k = x[first]; k; k = k[next]) st.push(k); } return c; };
const p = vditorDOM2MdPreprocess(h);
const s0 = snap("s0");
let root: any = util.ParseHTML(p)!;
const s1 = snap("s1");
diff("DOM after ParseHTML", s0, s1, count(root, "NextSibling", "FirstChild"));
(port as any).adjustVditorDOM(root);
const s2 = snap("s2");
const tree = vditorDOM2MdBuildTree(port, root);
const s3 = snap("s3");
diff("AST after genAST and adjustTree (DOM still held)", s2, s3, count(tree.Root, "Next", "FirstChild"));
root = null;
const s4 = snap("s4");
diff("released when the DOM root is dropped (negative = freed)", s3, s4, 1);
console.log(tree.Root !== null);

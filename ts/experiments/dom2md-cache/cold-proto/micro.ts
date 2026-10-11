import { performance } from "node:perf_hooks";
import * as parse from "../../../src/parse/index.ts";
import { FormatRenderer } from "../../../src/render/types.ts";
import { registerFormatRendererFuncs } from "../../../src/render/format_renderer.ts";
import { vditorDOM2MdRenderOptions } from "../../../src/vditor_wysiwyg.ts";
import { newSandboxRenderer } from "../../../src/incremental/sandbox.ts";
import * as ast from "../../../src/ast/index.ts";
import { guardAst } from "../../../src/incremental/barrier.ts";
const N = 3000;
const opts = vditorDOM2MdRenderOptions();
const po = new parse.Context(undefined as any) ? undefined : undefined;
import { New } from "../../../src/index.ts";
const lute = New();
function time(name: string, f: () => void) {
  let best = Infinity;
  for (let r = 0; r < 12; r++) { const t = performance.now(); for (let i = 0; i < N; i++) f(); best = Math.min(best, (performance.now() - t) / N * 1000); }
  console.log(name.padEnd(40), best.toFixed(2), "us");
}
const tree = new parse.Tree();
time("new FormatRenderer", () => { new FormatRenderer(tree, opts, lute.ParseOptions); });
time("new FR + registerFormatRendererFuncs", () => { registerFormatRendererFuncs(new FormatRenderer(tree, opts, lute.ParseOptions)); });
time("newSandboxRenderer", () => { newSandboxRenderer(tree, opts, lute.ParseOptions); });
time("new vditorDOM2MdRenderOptions()", () => { vditorDOM2MdRenderOptions(); });
time("new parse.Context", () => { new parse.Context(lute.ParseOptions); });
time("new ast.Node doc", () => { new ast.Node(ast.NodeDocument); });
time("defineProperty accessor x1 on Node", () => { const n = new ast.Node(ast.NodeParagraph); guardAst(n, "Previous", () => null); });
time("defineProperty accessor x4 on Nodes", () => { const n = new ast.Node(ast.NodeParagraph); guardAst(n, "Previous", () => null);guardAst(n, "Next", () => null);guardAst(n, "FirstChild", () => null);guardAst(n, "LastChild", () => null); });
time("plain node", () => { new ast.Node(ast.NodeParagraph); });

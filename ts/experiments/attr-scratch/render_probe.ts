// Scratch (A2): live heap inside the render stage of VditorDOM2Md on the spec DOM, in a fresh process.
// Variant "local": the caller keeps the DOM root in a local while rendering (the shape of Lute.prototype.vditorDOM2Md).
// Variant "helper": the caller only gets the Markdown tree from a helper, so the DOM root is in a frame that has returned.
// Usage: node --expose-gc render_probe.ts local|helper
import { readFileSync } from "node:fs";
import { CONFIGS, engines } from "../dom2md-cache/corpus.ts";
import { ast, editor, render, util, html, parse } from "../../src/index.ts";
import { vditorDOM2MdPrepare, vditorDOM2MdBuildTree, vditorDOM2MdRenderOptions } from "../../src/vditor_wysiwyg.ts";
const variant = process.argv[2];
const md = readFileSync(new URL("../../../benchmark/commonmark-spec.md", import.meta.url), "utf8");
const { port } = engines(CONFIGS[0], "wysiwyg");
const h = port.Md2VditorDOM(md).split(editor.Zwsp).join("");
const used = (): number => { (globalThis as any).gc(); (globalThis as any).gc(); return process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers; };
let heapAtRender = 0;
function startRender(renderer: any): Uint8Array {
  const orig = renderer.RendererFuncs.get(ast.NodeText);
  let probed = false;
  renderer.RendererFuncs.set(ast.NodeText, (...args: any[]) => {
    if (!probed) { probed = true; heapAtRender = used(); }
    return orig(...args);
  });
  return renderer.Render();
}
function localVariant(lute: any, htmlStr: string): Uint8Array {
  let htmlRoot: html.Node | null = vditorDOM2MdPrepare(lute, htmlStr);
  const tree = vditorDOM2MdBuildTree(lute, htmlRoot!);
  const renderer = render.NewFormatRenderer(tree, vditorDOM2MdRenderOptions(), lute.ParseOptions);
  return startRender(renderer);
}
function treeOf(lute: any, htmlStr: string): parse.Tree {
  const htmlRoot = vditorDOM2MdPrepare(lute, htmlStr);
  return vditorDOM2MdBuildTree(lute, htmlRoot!);
}
function helperVariant(lute: any, htmlStr: string): Uint8Array {
  const tree = treeOf(lute, htmlStr);
  const renderer = render.NewFormatRenderer(tree, vditorDOM2MdRenderOptions(), lute.ParseOptions);
  return startRender(renderer);
}
const before = used();
const out = variant === "local" ? localVariant(port, h) : helperVariant(port, h);
console.log(`${variant}: heap in render stage ${((heapAtRender - before) / 1e6).toFixed(3)} MB above the pre-run heap (output ${out.length} bytes)`);
void ast; void util;

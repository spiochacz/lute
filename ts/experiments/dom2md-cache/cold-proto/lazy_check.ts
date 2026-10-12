// Scratch: the lazy RendererFuncs of a sandbox renderer against the eager registration (registerFormatRendererFuncs) of a FormatRenderer.
// Same key order, same size, same has, same bound method per type (bound function names), get idempotent, writes refused.
// Usage: node experiments/dom2md-cache/cold-proto/lazy_check.ts

import * as parse from "../../../src/parse/index.ts";
import { CONFIGS, engines } from "../corpus.ts";
import { vditorDOM2MdRenderOptions } from "../../../src/vditor_wysiwyg.ts";
import * as ast from "../../../src/ast/index.ts";
import { FormatRenderer } from "../../../src/render/types.ts";
import { registerFormatRendererFuncs } from "../../../src/render/format_renderer.ts";
import { newSandboxRenderer } from "../../../src/incremental/sandbox.ts";

const tree = new parse.Tree();
tree.Root = new ast.Node(ast.NodeDocument);
const { port } = engines(CONFIGS[0], "wysiwyg");
const opts = vditorDOM2MdRenderOptions();
const PO = port.ParseOptions;
const eager = new FormatRenderer(tree, opts, PO);
registerFormatRendererFuncs(eager);
const lazy = newSandboxRenderer(tree, opts, PO);

const eKeys = [...eager.RendererFuncs.keys()];
const lKeys = [...lazy.RendererFuncs.keys()];
let bad = 0;
const check = (ok: boolean, what: string): void => {
  if (!ok) {
    bad++;
    console.log("MISMATCH", what);
  }
};
check(eKeys.length === lKeys.length, `size ${eKeys.length} vs ${lKeys.length}`);
check(lazy.RendererFuncs.size === eager.RendererFuncs.size, "size getter");
check(eKeys.every((k, i) => k === lKeys[i]), "key order");
for (const k of eKeys) {
  check(lazy.RendererFuncs.has(k), `has ${k}`);
  const ef = eager.RendererFuncs.get(k)!;
  const lf = lazy.RendererFuncs.get(k)!;
  check(typeof lf === "function", `get ${k} is a function`);
  check(ef.name === lf.name, `bound name ${k}: ${ef.name} vs ${lf.name}`);
  check(lazy.RendererFuncs.get(k) === lf, `get ${k} idempotent`);
}
check(!lazy.RendererFuncs.has(123456 as ast.NodeType), "has of an unregistered type");
check(lazy.RendererFuncs.get(123456 as ast.NodeType) === undefined, "get of an unregistered type");
let n = 0;
lazy.RendererFuncs.forEach((f, k) => {
  n++;
  check(eager.RendererFuncs.get(k)!.name === f.name, `forEach ${k}`);
});
check(n === eKeys.length, "forEach count");
for (const write of [() => lazy.RendererFuncs.set(ast.NodeDocument, () => undefined), () => lazy.RendererFuncs.delete(ast.NodeDocument), () => lazy.RendererFuncs.clear()]) {
  let threw = false;
  try {
    write();
  } catch {
    threw = true;
  }
  check(threw, "write refused");
}
// two instances: distinct functions, the same method
const second = newSandboxRenderer(tree, opts, PO);
check(second.RendererFuncs.get(ast.NodeParagraph) !== lazy.RendererFuncs.get(ast.NodeParagraph), "instances have their own bound functions");
console.log(`types ${eKeys.length}, mismatches ${bad}`);

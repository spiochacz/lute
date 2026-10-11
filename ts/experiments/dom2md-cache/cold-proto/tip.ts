import { readFileSync } from "node:fs";
import { CONFIGS, engines } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
import * as ast from "../../../src/ast/index.ts";
import * as parse from "../../../src/parse/index.ts";
import { vditorIRDOM2MdPrepare } from "../../../src/vditor_ir.ts";
const raw = readFileSync(`${process.env.FIX}/spec.ir.html`, "utf8").split(editor.Zwsp).join("");
const { port } = engines(CONFIGS[0], "ir");
const root = vditorIRDOM2MdPrepare(port, raw)!;
const tree = new parse.Tree(); tree.Name = ""; tree.Root = new ast.Node(ast.NodeDocument);
tree.Context = new parse.Context(port.ParseOptions); tree.Context.Tip = tree.Root;
let idx = 0, firstOpen = -1, closedAfter = 0, open = 0;
for (let c = root.FirstChild; c !== null; c = c.NextSibling, idx++) {
  port.genASTByVditorIRDOM(c, tree);
  const tipOpen = tree.Context.Tip !== tree.Root;
  if (tipOpen) { open++; if (firstOpen < 0) { firstOpen = idx; console.log("first open at child", idx, "of", "Tip type", tree.Context.Tip!.Type, "parent type", tree.Context.Tip!.Parent!.Type, "child html:", (c.Data), c.Attr.map((a) => a.Key + "=" + a.Val).join(" ")); } }
  else if (firstOpen >= 0) closedAfter++;
}
console.log("children", idx, "tip open after", open, "closed again after first open:", closedAfter, "root children (AST top nodes):", (() => { let n = 0; for (let x = tree.Root!.FirstChild; x; x = x.Next) n++; return n; })());

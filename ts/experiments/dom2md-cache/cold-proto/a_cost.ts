import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
import * as util from "../../../src/util/index.ts";
import { parseWithBoundary } from "../../../src/incremental/parser_certificate.ts";
import { vditorDOM2MdPreprocess, vditorDOM2MdBuildTree, vditorDOM2MdRender, vditorDOM2MdRenderOptions } from "../../../src/vditor_wysiwyg.ts";
import { NewRecordingFormatRenderer } from "../../../src/render/recording_format_renderer.ts";
const FIX = process.env.FIX!;
const h = vditorDOM2MdPreprocess(readFileSync(`${FIX}/spec.wysiwyg.html`, "utf8").split(editor.Zwsp).join(""));
const { port } = engines(CONFIGS[0], "wysiwyg");
const best: Record<string, number> = {};
const m = (k: string, f: () => void) => { const t = performance.now(); f(); best[k] = Math.min(best[k] ?? Infinity, performance.now() - t); };
for (let i = 0; i < 15; i++) {
  let root: any, tree: any;
  m("parse plain", () => { root = util.ParseHTML(h); });
  m("parse + boundary hook", () => { parseWithBoundary(h); });
  port.adjustVditorDOM(root);
  m("buildTree", () => { tree = vditorDOM2MdBuildTree(port, root); });
  m("render normal", () => { vditorDOM2MdRender(port, tree); });
  m("render recording (RenderWithLogs)", () => { NewRecordingFormatRenderer(tree, vditorDOM2MdRenderOptions(), port.ParseOptions).RenderWithLogs(); });
}
console.log(Object.entries(best).map(([k, v]) => `${k}=${v.toFixed(1)}`).join("  "));

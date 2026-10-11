// The normal path without its preprocess stage (the callers pass the already preprocessed string, and the preprocess is not idempotent).
import * as util from "../../../src/util/index.ts";
import * as conv from "../../../src/runtime/conv.ts";
import { vditorDOM2MdBuildTree, vditorDOM2MdRender } from "../../../src/vditor_wysiwyg.ts";
import { vditorIRDOM2MdBuildTree, vditorIRDOM2MdRender } from "../../../src/vditor_ir.ts";
export function refNoPre(lute: any, mode: "wysiwyg" | "ir", h: string): string {
  const root = util.ParseHTML(h);
  if (root === null) return "";
  if (mode === "wysiwyg") { lute.adjustVditorDOM(root); return conv.StringFromBytes(vditorDOM2MdRender(lute, vditorDOM2MdBuildTree(lute, root))); }
  lute.adjustVditorDOM(root); return conv.StringFromBytes(vditorIRDOM2MdRender(lute, vditorIRDOM2MdBuildTree(lute, root)));
}

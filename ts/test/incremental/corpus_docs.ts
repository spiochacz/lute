// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// The audit population of the scanner and parser certificate tests: the oracle-produced DOM of the corpus documents (WYSIWYG and IR), the
// repository files and the hand-written DOMs, each with the preprocessing of the engine (ZWSP and caret stripped as the public method does).

import { vditorDOM2MdPreprocess, vditorIRDOM2MdPreprocess, editor } from "../../src/index.ts";
import { newEngines } from "../e2e/helpers.ts";
import { oracleRaw } from "../e2e/root/vditor_flow_helpers.ts";
import { fileDocs, markdownCorpus, RAW_DOMS, WYSIWYG } from "../e2e/dom_corpus.ts";

export interface AuditDoc {
  name: string;
  html: string; // the stripped and preprocessed string the scanner receives
  mode: "wysiwyg" | "ir";
}

// Documents whose scanner cut differs from the engine's top-level children. Every one has an opaque child (a data-render preview).
// Coordinator decision (tasks/004, Milestone B implementation, deviation 4): these are not failures of the audit; step 4 checks that
// the parser certificate refuses the mis-cut children of each of them, and the regression list of 8.6 names them.
export const OPAQUE_DISAGREEMENTS_EXPECTED = [
  "markdown#402 wysiwyg",
  "markdown#402 ir",
  "markdown#405 wysiwyg",
  "markdown#405 ir",
  "markdown#444 wysiwyg",
  "markdown#444 ir",
  "markdown#445 wysiwyg",
  "markdown#445 ir",
];

export function auditDocuments(): AuditDoc[] {
  const wysiwygEngines = newEngines([WYSIWYG]);
  const irEngines = newEngines([]);
  const raw: Array<{ name: string; html: string; mode: "wysiwyg" | "ir" }> = [];
  for (const [i, md] of markdownCorpus().entries()) {
    const wdom = oracleRaw(wysiwygEngines, "Md2VditorDOM", md);
    if (wdom !== null) {
      raw.push({ name: `markdown#${i} wysiwyg`, html: wdom, mode: "wysiwyg" });
    }
    const idom = oracleRaw(irEngines, "Md2VditorIRDOM", md);
    if (idom !== null) {
      raw.push({ name: `markdown#${i} ir`, html: idom, mode: "ir" });
    }
  }
  for (const [i, doc] of fileDocs().entries()) {
    const wdom = oracleRaw(wysiwygEngines, "Md2VditorDOM", doc);
    if (wdom !== null) {
      raw.push({ name: `file#${i} wysiwyg`, html: wdom, mode: "wysiwyg" });
    }
  }
  for (const [i, dom] of RAW_DOMS.entries()) {
    raw.push({ name: `raw#${i} wysiwyg`, html: dom, mode: "wysiwyg" });
    raw.push({ name: `raw#${i} ir`, html: dom, mode: "ir" });
  }
  return raw.map((d) => {
    const pre = d.mode === "wysiwyg" ? vditorDOM2MdPreprocess(d.html) : vditorIRDOM2MdPreprocess(d.html);
    return { name: d.name, html: pre.split(editor.Zwsp).join(""), mode: d.mode };
  });
}

// Port against the reference bundle: Lute.SpinVditorIRDOM, VditorIRDOM2Md, VditorIRDOM2HTML, Md2VditorIRDOM, HTML2VditorIRDOM
// (vditor_ir.go). DOM inputs come from the oracle's own Md2VditorIRDOM and are edited the way the editor does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readRepoFile } from "../helpers.ts";
import { sample, FULL } from "../full.ts";
import { IR_SETS } from "../renderers/vditor_helpers.ts";
import { bothThrew, bothThrewExamples, caretVariants, CARET_SPECIAL, compareCall, domEdits, newEngines, oracleRaw, snippets, TYPED, typedParagraphs } from "./vditor_flow_helpers.ts";
import type { Engines } from "./vditor_flow_helpers.ts";

interface SpecCase {
  markdown: string;
}

function setNamed(name: string) {
  const s = IR_SETS.find((x) => x.name === name);
  assert.ok(s, name);
  return s;
}

// One editor flow: Markdown -> DOM (both engines) -> edited DOM -> Spin / DOM2Md / DOM2HTML -> Markdown -> DOM again.
function flow(engines: Engines, failures: string[], where: string, markdown: string, positions: number, salt: number, withHTML: boolean): void {
  compareCall(engines, failures, where, "Md2VditorIRDOM", markdown);
  const dom = oracleRaw(engines, "Md2VditorIRDOM", markdown);
  if (dom === null) {
    return;
  }
  for (const v of domEdits(dom, positions, salt)) {
    const spun = compareCall(engines, failures, where, "SpinVditorIRDOM", v);
    const md = compareCall(engines, failures, where, "VditorIRDOM2Md", v);
    if (withHTML) {
      compareCall(engines, failures, where, "VditorIRDOM2HTML", v);
    }
    if (!spun.threw) {
      // the output of the spin is the next input of the spin and of the other conversions
      const spunRaw = oracleRaw(engines, "SpinVditorIRDOM", v);
      if (spunRaw !== null) {
        compareCall(engines, failures, where + " (respin)", "SpinVditorIRDOM", spunRaw);
        compareCall(engines, failures, where + " (of spin)", "VditorIRDOM2Md", spunRaw);
      }
    }
    if (!md.threw) {
      const mdRaw = oracleRaw(engines, "VditorIRDOM2Md", v);
      if (mdRaw !== null) {
        compareCall(engines, failures, where + " (round trip)", "Md2VditorIRDOM", mdRaw);
      }
    }
  }
}

test("IR: CommonMark spec cases, flows under two option sets", () => {
  const cases = JSON.parse(readRepoFile("test/commonmark-spec.json")) as SpecCase[];
  const failures: string[] = [];
  for (const [i, name] of (FULL ? ["mode on", "vditor typical"] : ["mode on"]).entries()) {
    const engines = newEngines(setNamed(name).setters);
    for (const c of sample(cases, i, FULL ? 1 : 64)) {
      flow(engines, failures, `[spec / ${name}]`, c.markdown, FULL ? 3 : 2, i, false);
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("IR: hand-written documents, flows under every option set", () => {
  const docs = snippets();
  const failures: string[] = [];
  for (const [setIndex, set] of IR_SETS.entries()) {
    const engines = newEngines(set.setters);
    const main = ["mode on", "vditor typical"].includes(set.name);
    for (const d of main ? sample(docs, 0, FULL ? 1 : 48) : sample(docs, setIndex, FULL ? 4 : 96)) {
      flow(engines, failures, `[${set.name}]`, d, main ? (FULL ? 5 : 2) : 1, setIndex, main);
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("IR: documents with the caret in the Markdown", () => {
  const docs: string[] = [...CARET_SPECIAL];
  for (const s of sample(snippets(), 1, FULL ? 1 : 64)) {
    docs.push(...caretVariants(s).slice(0, 4));
  }
  const failures: string[] = [];
  for (const name of FULL ? ["mode on", "vditor typical"] : ["mode on"]) {
    const engines = newEngines(setNamed(name).setters);
    for (const d of docs) {
      flow(engines, failures, `[caret / ${name}]`, d, FULL ? 2 : 1, 0, false);
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("IR: half-typed Markdown in a paragraph", () => {
  const failures: string[] = [];
  for (const name of ["mode on", "vditor typical", "default"]) {
    const engines = newEngines(setNamed(name).setters);
    for (const t of TYPED) {
      for (const dom of typedParagraphs(t, FULL ? 40 : 14)) {
        compareCall(engines, failures, `[typed / ${name}]`, "SpinVditorIRDOM", dom);
        compareCall(engines, failures, `[typed / ${name}]`, "VditorIRDOM2Md", dom);
      }
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("IR: half-typed Markdown under every option set (caret at the end)", () => {
  const failures: string[] = [];
  for (const [i, set] of IR_SETS.entries()) {
    const engines = newEngines(set.setters);
    for (const t of sample(TYPED, i, 3)) {
      const dom = typedParagraphs(t, 1_000_000).pop()!;
      compareCall(engines, failures, `[typed end / ${set.name}]`, "SpinVditorIRDOM", dom);
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("IR: typing inside existing blocks", () => {
  const failures: string[] = [];
  const blocks = ["- a", "1. a", "> a", "- a\n  - b", "# a", "| a | b |\n| - | - |\n| 1 | 2 |", "```js\nx\n```", "$$\nx\n$$", "- [ ] a", "a *b* c", "[a](b)", "a `b` c", "a\nb", "[^1]: n\n\nt[^1]"];
  for (const name of ["mode on", "vditor typical"]) {
    const engines = newEngines(setNamed(name).setters);
    for (const b of blocks) {
      flow(engines, failures, `[block / ${name}]`, b, FULL ? 8 : 3, 3, true);
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

const HTMLS: string[] = [
  "<p>plain</p>", "<h1>t</h1><p>x</p>", "<ul><li>a</li><li>b</li></ul>", "<ol><li>a</li></ol>", "<p><b>b</b> <i>i</i> <code>c</code></p>",
  "<a href=\"http://a.b\">l</a>", "<img src=\"a.png\" alt=\"x\">", "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>",
  "<pre><code class=\"language-js\">x</code></pre>", "<blockquote><p>q</p></blockquote>", "<p>a<br>b</p>", "<hr>", "<div>d</div>", "text only",
];

test("IR: HTML2VditorIRDOM", () => {
  const engines = newEngines([["SetVditorIR", true]]);
  const failures: string[] = [];
  for (const h of HTMLS) {
    compareCall(engines, failures, "[html2ir]", "HTML2VditorIRDOM", h);
  }
  // Pasting the editor's own DOM (from the oracle), under three option sets
  for (const name of ["mode on", "vditor typical", "default"]) {
    const e2 = newEngines(IR_SETS.find((x) => x.name === name)!.setters);
    for (const d of sample(snippets(), 0, FULL ? 1 : 20)) {
      const dom = oracleRaw(e2, "Md2VditorIRDOM", d);
      if (dom !== null) {
        compareCall(e2, failures, `[html2ir paste / ${name}]`, "HTML2VditorIRDOM", dom);
      }
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("IR: report", () => {
  if (bothThrew.size > 0) {
    console.log("IR: both engines threw: " + [...bothThrew].map(([k, v]) => `${k} x${v} (first ${bothThrewExamples.get(k)})`).join("; "));
  }
});

test("IR: known upstream bugs in the DOM converter, the oracle throws and so must the port", () => {
  const failures: string[] = [];
  const engines = newEngines([["SetVditorIR", true]]);
  for (const d of ["<div data-type=\"code-block\"><span data-type=\"code-block-open-marker\">```</span></div>", "<pre></pre>", "<p><pre></pre></p>"]) {
    for (const m of ["VditorIRDOM2Md", "SpinVditorIRDOM", "VditorIRDOM2HTML"]) {
      assert.ok(compareCall(engines, failures, "[known DOM]", m, d).threw, `the oracle is expected to throw: ${m} ${d}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("IR: known upstream bugs, the oracle throws and so must the port", () => {
  const failures: string[] = [];
  const known: [string, [string, ...unknown[]][], string][] = [
    ["empty fenced block, caret after the closing fence", [["SetVditorIR", true]], "```\n```‸"],
    ["empty tilde fence, caret after the closing fence", [["SetVditorIR", true]], "~~~\n~~~‸"],
    ["custom block, caret after the closing marker", [["SetVditorIR", true], ["SetCustomBlock", true]], ";;;x\n;;;‸"],
    ["heading ID with the caret inside, WYSIWYG parse mode", [["SetVditorIR", true], ["SetVditorWYSIWYG", true]], "# a {#i‸d}"],
  ];
  for (const [name, setters, input] of known) {
    const engines = newEngines(setters);
    const o = compareCall(engines, failures, `[known: ${name}]`, "Md2VditorIRDOM", input);
    assert.ok(o.threw, `the oracle is expected to throw: ${name} / Md2VditorIRDOM`);
    // the spin of the same text typed into a paragraph
    compareCall(engines, failures, `[known: ${name}]`, "SpinVditorIRDOM", "<p data-block=\"0\">" + input.replace("‸", "<wbr>").replace(/\n/g, "<br>") + "</p>");
    compareCall(engines, failures, `[known: ${name}]`, "SpinVditorIRDOM", "<p data-block=\"0\">" + input.replace("‸", "<wbr>") + "</p>");
  }
  assert.deepEqual(failures, []);
});

// Port against the reference bundle: Lute.SpinVditorSVDOM, Md2VditorSVDOM, HTML2VditorSVDOM (vditor_sv.go).
// The split-view editor edits Markdown text: the text content of the DOM (with the caret) goes into SpinVditorSVDOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readRepoFile } from "../helpers.ts";
import { sample, FULL } from "../full.ts";
import { SV_SETS } from "../renderers/vditor_helpers.ts";
import { bothThrew, bothThrewExamples, CARET, caretVariants, CARET_SPECIAL, compareCall, newEngines, oracleRaw, snippets, TYPED } from "./vditor_flow_helpers.ts";
import type { Engines } from "./vditor_flow_helpers.ts";

interface SpecCase {
  markdown: string;
}

function setNamed(name: string) {
  const s = SV_SETS.find((x) => x.name === name);
  assert.ok(s, name);
  return s;
}

// What the editor reads back from the split-view DOM: its text content, with the caret.
function svText(dom: string): string {
  return dom
    .split("<wbr>").join(CARET)
    .replace(/<span data-type="newline"[^>]*><br ?\/?><span style="display: none">\n<\/span><\/span>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&");
}

const EDITS = ["*", "`", "_", "#", " ", "\n", "[", "(", "|", "$", "~", "<", "-", "1.", "\t"];

// Small edits of Markdown text at n spread positions: the caret alone, a typed character before it, a deleted character, a split line.
function textEdits(md: string, n: number, salt: number): string[] {
  const clean = md.split(CARET).join("");
  const out: string[] = [md];
  for (let k = 0; k < n; k++) {
    let p = Math.floor(((k + 0.5) * (clean.length + 1)) / n);
    if (p > 0 && p < clean.length && /[\udc00-\udfff]/.test(clean[p])) {
      p--;
    }
    const ch = EDITS[(k + salt) % EDITS.length];
    out.push(clean.slice(0, p) + CARET + clean.slice(p));
    out.push(clean.slice(0, p) + ch + CARET + clean.slice(p));
    if (p > 0 && !/[\ud800-\udfff]/.test(clean[p - 1])) {
      out.push(clean.slice(0, p - 1) + CARET + clean.slice(p));
    }
    out.push(clean.slice(0, p) + "\n" + CARET + clean.slice(p));
  }
  return out;
}

// Markdown -> DOM (both) -> text -> edits -> Spin (both) -> text -> Spin again.
function flow(engines: Engines, failures: string[], where: string, markdown: string, positions: number, salt: number): void {
  compareCall(engines, failures, where, "Md2VditorSVDOM", markdown);
  const dom = oracleRaw(engines, "Md2VditorSVDOM", markdown);
  if (dom === null) {
    return;
  }
  for (const v of textEdits(svText(dom), positions, salt)) {
    const spun = compareCall(engines, failures, where, "SpinVditorSVDOM", v);
    if (!spun.threw) {
      const spunRaw = oracleRaw(engines, "SpinVditorSVDOM", v);
      if (spunRaw !== null) {
        compareCall(engines, failures, where + " (respin)", "SpinVditorSVDOM", svText(spunRaw));
        compareCall(engines, failures, where + " (of spin)", "Md2VditorSVDOM", svText(spunRaw));
      }
    }
  }
}

test("SV: CommonMark spec cases", () => {
  const cases = JSON.parse(readRepoFile("test/commonmark-spec.json")) as SpecCase[];
  const failures: string[] = [];
  for (const [i, name] of (FULL ? ["mode on", "vditor typical"] : ["mode on"]).entries()) {
    const engines = newEngines(setNamed(name).setters);
    for (const c of sample(cases, i, FULL ? 1 : 64)) {
      flow(engines, failures, `[spec / ${name}]`, c.markdown, FULL ? 3 : 2, i);
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("SV: whole files", () => {
  const failures: string[] = [];
  const engines = newEngines(setNamed("mode on").setters);
  for (const file of ["test/case1.md", "README.md", "test/format-case0.md", "test/format-case3.md"]) {
    flow(engines, failures, `[${file}]`, readRepoFile(file), 1, 0);
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("SV: hand-written documents, flows under every option set", () => {
  const docs = snippets();
  const failures: string[] = [];
  for (const [setIndex, set] of SV_SETS.entries()) {
    const engines = newEngines(set.setters);
    const main = ["mode on", "vditor typical"].includes(set.name);
    for (const d of main ? sample(docs, 0, FULL ? 1 : 48) : sample(docs, setIndex, FULL ? 4 : 96)) {
      flow(engines, failures, `[${set.name}]`, d, main ? (FULL ? 5 : 2) : 1, setIndex);
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("SV: documents with the caret in the Markdown", () => {
  const docs: string[] = [...CARET_SPECIAL];
  for (const s of sample(snippets(), 1, FULL ? 1 : 64)) {
    docs.push(...caretVariants(s).slice(0, 4));
  }
  const failures: string[] = [];
  for (const name of FULL ? ["mode on", "vditor typical"] : ["mode on"]) {
    const engines = newEngines(setNamed(name).setters);
    for (const d of docs) {
      compareCall(engines, failures, `[caret / ${name}]`, "SpinVditorSVDOM", d);
      compareCall(engines, failures, `[caret / ${name}]`, "Md2VditorSVDOM", d);
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("SV: half-typed Markdown with the caret at spread positions", () => {
  const failures: string[] = [];
  for (const name of ["mode on", "vditor typical", "default"]) {
    const engines = newEngines(setNamed(name).setters);
    for (const t of TYPED) {
      const stride = Math.max(1, Math.ceil((t.length + 1) / (FULL ? 40 : 14)));
      for (let i = 0; i <= t.length; i += stride) {
        compareCall(engines, failures, `[typed / ${name}]`, "SpinVditorSVDOM", t.slice(0, i) + CARET + t.slice(i));
      }
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("SV: half-typed Markdown under every option set (caret at the end)", () => {
  const failures: string[] = [];
  for (const [i, set] of SV_SETS.entries()) {
    const engines = newEngines(set.setters);
    for (const t of sample(TYPED, i, 3)) {
      compareCall(engines, failures, `[typed end / ${set.name}]`, "SpinVditorSVDOM", t + CARET);
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("SV: empty document special case", () => {
  const failures: string[] = [];
  const engines = newEngines(setNamed("mode on").setters);
  for (const d of [CARET, " " + CARET, CARET + "\n", "\n\n" + CARET + "  ", "", " ", CARET + CARET]) {
    compareCall(engines, failures, "[empty]", "SpinVditorSVDOM", d);
  }
  assert.deepEqual(failures, []);
});

const HTMLS: string[] = [
  "<p>plain</p>", "<h1>t</h1><p>x</p>", "<ul><li>a</li><li>b</li></ul>", "<ol><li>a</li></ol>", "<p><b>b</b> <i>i</i> <code>c</code></p>",
  "<a href=\"http://a.b\">l</a>", "<img src=\"a.png\" alt=\"x\">", "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>",
  "<pre><code class=\"language-js\">x</code></pre>", "<blockquote><p>q</p></blockquote>", "<p>a<br>b</p>", "<hr>", "<div>d</div>", "text only",
];

test("SV: HTML2VditorSVDOM", () => {
  const engines = newEngines([["SetVditorSV", true]]);
  const failures: string[] = [];
  for (const h of HTMLS) {
    compareCall(engines, failures, "[html2sv]", "HTML2VditorSVDOM", h);
  }
  // Pasting the editor's own DOM (from the oracle), under three option sets
  for (const name of ["mode on", "vditor typical", "default"]) {
    const e2 = newEngines(SV_SETS.find((x) => x.name === name)!.setters);
    for (const d of sample(snippets(), 0, FULL ? 1 : 20)) {
      const dom = oracleRaw(e2, "Md2VditorSVDOM", d);
      if (dom !== null) {
        compareCall(e2, failures, `[html2sv paste / ${name}]`, "HTML2VditorSVDOM", dom);
      }
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("SV: known upstream bugs, the oracle throws and so must the port", () => {
  const failures: string[] = [];
  const known: [string, [string, ...unknown[]][], string][] = [
    ["empty fenced block, caret after the closing fence", [["SetVditorSV", true]], "```\n```‸"],
    ["empty tilde fence, caret after the closing fence", [["SetVditorSV", true]], "~~~\n~~~‸"],
    ["custom block, caret after the closing marker", [["SetVditorSV", true], ["SetCustomBlock", true]], ";;;x\n;;;‸"],
    ["heading ID with the caret inside, WYSIWYG parse mode", [["SetVditorSV", true], ["SetVditorWYSIWYG", true]], "# a {#i‸d}"],
  ];
  for (const [name, setters, input] of known) {
    const engines = newEngines(setters);
    for (const m of ["SpinVditorSVDOM", "Md2VditorSVDOM"]) {
      const o = compareCall(engines, failures, `[known: ${name}]`, m, input);
      assert.ok(o.threw, `the oracle is expected to throw: ${name} / ${m}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("SV: report", () => {
  if (bothThrew.size > 0) {
    console.log("SV: both engines threw: " + [...bothThrew].map(([k, v]) => `${k} x${v} (first ${bothThrewExamples.get(k)})`).join("; "));
  }
});

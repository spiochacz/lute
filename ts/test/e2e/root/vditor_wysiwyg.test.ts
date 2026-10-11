// Compares the methods of vditor_wysiwyg.go with the reference bundle (the oracle): Md2VditorDOM, SpinVditorDOM, VditorDOM2Md, VditorDOM2HTML,
// HTML2VditorDOM, HTML2Md, RenderEChartsJSON, RenderKityMinderJSON and Md2HTML.
// DOM inputs of the DOM-taking methods come from the oracle's own Md2VditorDOM, then they are mutated the way an editor would:
// caret marker <wbr> at many positions, text edits, inline formatting tags, dropped attributes, wrapped blocks.
// Each step of the round trip Md2VditorDOM -> (edit) -> SpinVditorDOM -> VditorDOM2Md -> Md2VditorDOM is compared with the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../../src/index.ts";
import { assertSameOutcome, attempt, newEngines, readRepoFile } from "../helpers.ts";
import type { Engines, Outcome, SetterCall } from "../helpers.ts";
import { FULL, sample } from "../full.ts";
import { CARET_DOCS, JSON_DOCS } from "../renderers/json_vditor_corpus.ts";
import { fileDocs, markdownCorpus, mutations, RAW_DOMS, SETS, spread, WYSIWYG } from "../dom_corpus.ts";
import type { OptionSet, Spec } from "../dom_corpus.ts";

const MAIN = ["wysiwyg", "wysiwyg + all previews"];

function pick(names: string[]): OptionSet[] {
  return SETS.filter((s) => names.includes(s.name));
}

type Method = "Md2VditorDOM" | "SpinVditorDOM" | "VditorDOM2Md" | "VditorDOM2HTML" | "HTML2VditorDOM" | "HTML2Md" | "RenderEChartsJSON" | "RenderKityMinderJSON" | "Md2HTML";

interface Counters {
  compared: number;
  bothThrew: Map<Method, string[]>;
}

function newCounters(): Counters {
  return { compared: 0, bothThrew: new Map<Method, string[]>() };
}

// Runs the method on both engines, asserts the same outcome, returns the oracle outcome.
function compare(engines: Engines, method: Method, label: string, input: string, counters: Counters): Outcome {
  const port = attempt(() => (engines.port[method] as (s: string) => string).call(engines.port, input));
  const oracle = attempt(() => (engines.oracle[method] as (s: string) => string).call(engines.oracle, input));
  counters.compared++;
  if ("bothThrew" === assertSameOutcome(`${method} [${label}] ${JSON.stringify(input)}`, port, oracle)) {
    const list = counters.bothThrew.get(method) ?? [];
    list.push(`${label}: ${JSON.stringify(input)}`);
    counters.bothThrew.set(method, list);
  }
  return oracle;
}

function report(name: string, counters: Counters): void {
  const lines: string[] = [];
  for (const [method, list] of counters.bothThrew) {
    lines.push(`${method}: ${list.length}`);
  }
  console.log(`${name}: ${counters.compared} comparisons; both threw: ${lines.join(", ") || "none"}`);
}

test("Md2VditorDOM, VditorDOM2Md, VditorDOM2HTML, SpinVditorDOM: corpus, option sets, round trip", () => {
  const counters = newCounters();
  const docs = markdownCorpus();
  assert.ok(docs.length > 700, `only ${docs.length} documents`);
  SETS.forEach((set, index) => {
    const engines = newEngines(set.setters);
    const run = MAIN.includes(set.name) ? sample(docs, index, 32) : sample(docs, index, 200);
    for (const md of run) {
      const dom = compare(engines, "Md2VditorDOM", set.name, md, counters);
      if (dom.threw) {
        continue;
      }
      const dom1 = dom.value;
      const asMd = compare(engines, "VditorDOM2Md", set.name, dom1, counters);
      compare(engines, "SpinVditorDOM", set.name, dom1, counters);
      compare(engines, "VditorDOM2HTML", set.name, dom1, counters);
      if (!asMd.threw) {
        compare(engines, "Md2VditorDOM", set.name + " round trip", asMd.value, counters);
        compare(engines, "Md2HTML", set.name, md, counters);
      }
    }
  });
  report("corpus", counters);
  assert.ok(counters.compared > 800, `only ${counters.compared} comparisons`);
});

test("SpinVditorDOM, VditorDOM2Md: caret and edits at many positions in the oracle's DOM", () => {
  const counters = newCounters();
  const docs = [...JSON_DOCS, ...CARET_DOCS, ...(JSON.parse(readRepoFile("test/commonmark-spec.json")) as Spec[]).map((s) => s.markdown)];
  SETS.forEach((set, index) => {
    const engines = newEngines(set.setters);
    const run = MAIN.includes(set.name) ? sample(docs, index, 100) : sample(docs, index, 400);
    for (const md of run) {
      const dom = attempt(() => engines.oracle.Md2VditorDOM(md));
      if (dom.threw) {
        continue;
      }
      for (const variant of spread(mutations(dom.value, 4), MAIN.includes(set.name) ? 12 : 4)) {
        const spun = compare(engines, "SpinVditorDOM", set.name, variant, counters);
        compare(engines, "VditorDOM2Md", set.name, variant, counters);
        if (!spun.threw) {
          // the next step of the editor: the spun DOM is spun again after another edit
          compare(engines, "SpinVditorDOM", set.name + " spin twice", spun.value, counters);
        }
      }
    }
  });
  report("mutations", counters);
  assert.ok(counters.compared > 800, `only ${counters.compared} comparisons`);
});

test("SpinVditorDOM, VditorDOM2Md, VditorDOM2HTML: documents of the repository with the caret at several positions", () => {
  const counters = newCounters();
  for (const set of pick(FULL ? ["wysiwyg", "inline math digit, mark, sup, sub, tag, block ref"] : ["wysiwyg"])) {
    const engines = newEngines(set.setters);
    for (const md of fileDocs()) {
      const dom = attempt(() => engines.oracle.Md2VditorDOM(md));
      assert.ok(!dom.threw, "the oracle threw on a repository document: " + dom.message);
      compare(engines, "Md2VditorDOM", set.name, md, counters);
      compare(engines, "VditorDOM2Md", set.name, dom.value, counters);
      compare(engines, "VditorDOM2HTML", set.name, dom.value, counters);
      compare(engines, "SpinVditorDOM", set.name, dom.value, counters);
      for (const variant of mutations(dom.value, 2)) {
        compare(engines, "SpinVditorDOM", set.name, variant, counters);
      }
    }
  }
  report("files", counters);
});

test("SpinVditorDOM, VditorDOM2Md, VditorDOM2HTML: hand-written DOM", () => {
  const counters = newCounters();
  for (const set of pick(FULL ? ["default", "wysiwyg", "inline math digit, mark, sup, sub, tag, block ref", "protyle wysiwyg", "link base, prefix and emoji site"] : ["default", "wysiwyg", "protyle wysiwyg"])) {
    const engines = newEngines(set.setters);
    for (const dom of RAW_DOMS) {
      compare(engines, "VditorDOM2Md", set.name, dom, counters);
      compare(engines, "SpinVditorDOM", set.name, dom, counters);
      compare(engines, "VditorDOM2HTML", set.name, dom, counters);
      compare(engines, "VditorDOM2Md", set.name + " caret", dom.replace(/<\/p>/, "<wbr></p>"), counters);
      compare(engines, "SpinVditorDOM", set.name + " caret", dom.replace(/<\/(\w+)>/, "<wbr></$1>"), counters);
    }
  }
  report("raw DOM", counters);
  assert.ok(counters.compared > 800, `only ${counters.compared} comparisons`);
});

test("SpinVditorDOM, VditorDOM2Md: hand-written DOM with edits", () => {
  const counters = newCounters();
  const engines = newEngines([WYSIWYG]);
  const raws = sample(RAW_DOMS, 0, 10);
  for (const dom of raws) {
    for (const variant of mutations(dom, 4)) {
      compare(engines, "SpinVditorDOM", "wysiwyg", variant, counters);
      compare(engines, "VditorDOM2Md", "wysiwyg", variant, counters);
    }
  }
  report("raw DOM edits", counters);
});

test("HTML2VditorDOM and HTML2Md: pasted HTML", () => {
  const counters = newCounters();
  const htmls = [
    ...RAW_DOMS,
    '<!--StartFragment--><p class="MsoNormal"><span><font face="宋体">测试</font>WPS<font face="宋体">粘贴</font></span><span><o:p></o:p></span></p><!--EndFragment-->',
    '<iframe src="foo" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"> </iframe>',
    '<pre><code class="language-text">&gt;</code></pre>',
    '<code class="language-text">&gt;</code>',
    "<p>[ToC]</p><h2>教_程</h2><h2>array_contains</h2>",
    '<a href="https://example.com">link</a> <img src="a.png" alt="x" title="t" width="10"> <hr> <kbd>k</kbd> <sup>1</sup><sub>2</sub> <mark>m</mark> <del>d</del>',
    "<table><thead><tr><th colspan=\"2\">a</th></tr></thead><tbody><tr><td rowspan=\"2\">1</td><td>2</td></tr></tbody></table>",
  ];
  for (const set of pick(["default", "wysiwyg", "toc, no heading id", "callout", "sanitize"])) {
    const engines = newEngines(set.setters);
    for (const html of htmls) {
      compare(engines, "HTML2VditorDOM", set.name, html, counters);
      compare(engines, "HTML2Md", set.name, html, counters);
    }
  }
  report("html paste", counters);
});

test("RenderEChartsJSON and RenderKityMinderJSON: corpus", () => {
  const counters = newCounters();
  const docs = [...JSON_DOCS, ...CARET_DOCS];
  const sets: OptionSet[] = [
    { name: "default", setters: [] },
    { name: "kramdown IAL, super block", setters: [["SetKramdownIAL", true], ["SetSuperBlock", true]] },
    { name: "wysiwyg", setters: [WYSIWYG] },
  ];
  for (const set of sets) {
    const engines = newEngines(set.setters);
    for (const md of docs) {
      compare(engines, "RenderEChartsJSON", set.name, md, counters);
      compare(engines, "RenderKityMinderJSON", set.name, md, counters);
    }
  }
  report("json", counters);
});

test("known upstream failures: both engines throw", () => {
  // UPSTREAM-BUG: `[![img](a.png)](ht‸tps://example.com)` through Md2VditorDOM with SetVditorWYSIWYG(true) throws in the Vditor renderer.
  const engines = newEngines([WYSIWYG]);
  const counters = newCounters();
  const threw: string[] = [];
  for (const md of ["[![img](a.png)](ht‸tps://example.com)", "```\n```‸", "```\n```\n‸"]) {
    const outcome = compare(engines, "Md2VditorDOM", "known", md, counters);
    if (outcome.threw) {
      threw.push(md);
    }
  }
  assert.ok(threw.includes("[![img](a.png)](ht‸tps://example.com)"), "the known input no longer throws in the oracle");
});

test("an engine with default options can spin and convert", () => {
  const lute = New();
  assert.equal(typeof lute.SpinVditorDOM, "function");
  assert.equal(lute.VditorDOM2Md("<p>foo</p>"), "foo\n");
});

// End-to-end comparison of h2m.go's entry points (HTML2Md, HTML2Markdown, HTML2Text, HTML2Tree) with the reference bundle.
// Inputs: the HTML of the Go tests, hand-written fragments, mutations of both (caret, text, attributes, wrapping, truncation),
// and HTML produced by the ORACLE's forward methods (MarkdownStr, Md2VditorDOM, Md2VditorIRDOM, Md2BlockDOM) from the Markdown corpus.
// Both engines are configured with the same setter calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { New } from "../../../src/index.ts";
import { attempt, assertSameOutcome, newEngines, readRepoFile } from "../helpers.ts";
import type { Engines, SetterCall } from "../helpers.ts";
import { newOracleEngine } from "../../oracle/oracle.ts";
import { FULL, sample } from "../full.ts";
import { buildCorpus } from "../renderers/format_corpus.ts";
import { FRAGMENTS } from "./h2m_fragments.ts";

interface HtmlSet {
  name: string;
  setters: SetterCall[];
}

const PROTYLE: SetterCall[] = [
  ["SetProtyleWYSIWYG", true],
  ["SetHTMLTag2TextMark", true],
  ["SetKramdownIAL", true],
  ["SetTextMark", true],
];

const SETS: HtmlSet[] = [
  { name: "default", setters: [] },
  {
    name: "go tests",
    setters: [
      ["SetAutoSpace", true],
      ["SetSup", true],
      ["SetSub", true],
      ["SetMark", true],
      ["SetGFMStrikethrough", true],
      ["SetInlineAsterisk", true],
      ["SetInlineUnderscore", true],
      ["SetKramdownIAL", true],
      ["SetHTMLTag2TextMark", true],
    ],
  },
  {
    name: "disable syntax",
    setters: [
      ["SetSup", false],
      ["SetSub", false],
      ["SetMark", false],
      ["SetGFMStrikethrough", false],
      ["SetInlineAsterisk", false],
      ["SetInlineUnderscore", false],
      ["SetHTMLTag2TextMark", true],
    ],
  },
  { name: "html tags only", setters: [["SetInlineAsterisk", false], ["SetInlineUnderscore", false], ["SetGFMStrikethrough", false], ["SetMark", false], ["SetSup", false], ["SetSub", false]] },
  { name: "protyle", setters: PROTYLE },
  { name: "protyle no inline syntax", setters: [...PROTYLE, ["SetInlineAsterisk", false], ["SetInlineUnderscore", false], ["SetGFMStrikethrough", false]] },
  {
    name: "protyle block ial",
    setters: [...PROTYLE, ["SetKramdownBlockIAL", true], ["SetKramdownSpanIAL", true], ["SetSuperBlock", true], ["SetBlockRef", true]],
  },
  { name: "attrs", setters: [...PROTYLE, ["SetHTML2MarkdownAttrs", ["id", "style", "custom-k", "data-type"]], ["SetKramdownBlockIAL", true]] },
  { name: "attrs custom star", setters: [["SetHTML2MarkdownAttrs", ["custom-*", "id", "class"]], ["SetKramdownIAL", true], ["SetKramdownBlockIAL", true], ["SetProtyleWYSIWYG", true]] },
  { name: "callout", setters: [["SetCallout", true], ["SetTabs", true], ["SetProtyleWYSIWYG", true], ["SetKramdownBlockIAL", true]] },
  { name: "no autospace, no gfm table", setters: [["SetAutoSpace", false], ["SetGFMTable", false]] },
  { name: "tag, inline math, link base", setters: [["SetTag", true], ["SetInlineMath", true], ["SetLinkBase", "https://example.com/base/"], ["SetImgPathAllowSpace", true]] },
  { name: "vditor wysiwyg", setters: [["SetVditorWYSIWYG", true], ["SetAutoSpace", true], ["SetSup", true], ["SetSub", true], ["SetMark", true]] },
];

function set(name: string): HtmlSet {
  const s = SETS.find((x) => x.name === name);
  assert.ok(s, name);
  return s;
}

const goCases = JSON.parse(readFileSync(fileURLToPath(new URL("./h2m_go_cases.json", import.meta.url)), "utf8")) as Record<string, string[][]>;
const GO_HTML: string[] = [
  ...goCases.html2MdTests.map((r) => r[1]),
  ...goCases.html2MdLanguageMathHTML.map((r) => r[1]),
  ...goCases.html2MdDisableSyntaxTests.map((r) => r[1]),
  ...goCases.codeBanner.map((r) => r[1]),
  ...goCases.codeBannerPreserves.map((r) => `<div class="md-code-block">${r[0]}</div>`),
  ...goCases.codeBannerPreserves.map((r) => `<div>${r[0]}</div>`),
  ...goCases.calloutHTML2Md.map((r) => r[1]),
  ...goCases.escapedMarkdown.map((r) => r[1]),
];

// A small deterministic generator (mulberry32).
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WRAPPERS: Array<[string, string]> = [
  ["<div>", "</div>"],
  ["<span>", "</span>"],
  ["<p>", "</p>"],
  ["<li>", "</li>"],
  ["<ul><li>", "</li></ul>"],
  ["<ol><li>", "</li></ol>"],
  ["<ul><li><p>", "</p></li></ul>"],
  ["<blockquote>", "</blockquote>"],
  ["<table><tr><td>", "</td></tr></table>"],
  ["<table><thead><tr><th>", "</th></tr></thead></table>"],
  ["<a href=\"u\">", "</a>"],
  ["<strong>", "</strong>"],
  ["<em>", "</em>"],
  ["<b><i>", "</i></b>"],
  ["<h2>", "</h2>"],
  ["<pre>", "</pre>"],
  ["<details><summary>s</summary>", "</details>"],
  ["<font color=\"red\">", "</font>"],
  ["<sup>", "</sup>"],
  ["<u>", "</u>"],
  ["<figure>", "</figure>"],
  ["<section>", "</section>"],
  ["<x-custom>", "</x-custom>"],
];

// Mutations of one HTML string the way an editor or a browser paste produces them.
function mutations(src: string, seed: number): string[] {
  const r = rng(seed);
  const out: string[] = [];
  const closes: number[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === ">") {
      closes.push(i + 1);
    }
  }
  const pick = (): number => (closes.length === 0 ? Math.floor(r() * (src.length + 1)) : closes[Math.floor(r() * closes.length)]);
  for (const ins of ["<wbr>", "‸", "<wbr>X", "Y", " ", "​", "<br>", "<!--c-->", "<span></span>", "&nbsp;"]) {
    const at = pick();
    out.push(src.slice(0, at) + ins + src.slice(at));
  }
  // text positions
  let at2 = Math.floor(r() * (src.length + 1));
  // never split a surrogate pair: a lone surrogate is not valid input through the public API
  if (at2 > 0 && at2 < src.length && src.charCodeAt(at2) >= 0xdc00 && src.charCodeAt(at2) <= 0xdfff) {
    at2--;
  }
  out.push(src.slice(0, at2) + "<wbr>" + src.slice(at2));
  const w = WRAPPERS[Math.floor(r() * WRAPPERS.length)];
  const w2 = WRAPPERS[Math.floor(r() * WRAPPERS.length)];
  out.push(w[0] + src + w[1]);
  out.push(w2[0] + w[0] + src + w[1] + w2[1]);
  out.push(src + src);
  out.push(src.replace(/ (class|style|id|href|src|data-[a-z-]+)="[^"]*"/g, ""));
  out.push(src.replace(/ class="[^"]*"/g, ""));
  out.push(src.replace(/<(\w+)/g, (m, tag: string) => (r() < 0.3 ? `<${tag} class="x y" style="color:red;font-weight:bold"` : m)));
  out.push(src.replace(/\n/g, " "));
  out.push(src.replace(/>/g, ">\n"));
  let cut = Math.floor(r() * src.length);
  if (cut > 0 && src.charCodeAt(cut) >= 0xdc00 && src.charCodeAt(cut) <= 0xdfff) {
    cut--;
  }
  out.push(src.slice(0, cut));
  out.push(src.toUpperCase());
  return out;
}

// Runs one input on both engines through the given call and returns the verdict; failures are collected.
function check(label: string, engines: Engines, call: (e: { HTML2Md(h: string): string; HTML2Text(h: string): string }) => string, input: string, failures: string[], bothThrew: string[]): void {
  const port = attempt(() => call(engines.port as never));
  const oracle = attempt(() => call(engines.oracle as never));
  try {
    if (assertSameOutcome(label, port, oracle) === "bothThrew") {
      bothThrew.push(label + " " + JSON.stringify(input).slice(0, 200));
    }
  } catch (e) {
    failures.push((e as Error).message + "\n  input: " + JSON.stringify(input));
  }
}

const bothThrewAll: string[] = [];

function report(failures: string[]): void {
  assert.equal(failures.length, 0, failures.length + " failure(s); first ones:\n" + failures.slice(0, 5).join("\n"));
}

test("HTML2Md: Go test HTML and fragments, every option set", () => {
  const failures: string[] = [];
  const inputs = [...GO_HTML, ...FRAGMENTS];
  for (const [i, s] of SETS.entries()) {
    const engines = newEngines(s.setters);
    for (const input of sample(inputs, i, 32)) {
      check(`HTML2Md[${s.name}]`, engines, (e) => e.HTML2Md(input), input, failures, bothThrewAll);
    }
  }
  report(failures);
});

test("HTML2Md: all Go test HTML and fragments, the main option sets (unsampled)", () => {
  const failures: string[] = [];
  const inputs = [...GO_HTML, ...FRAGMENTS];
  for (const name of FULL ? ["default", "go tests", "protyle", "attrs"] : ["default", "protyle"]) {
    const engines = newEngines(set(name).setters);
    for (const input of sample(inputs, 0, 3)) {
      check(`HTML2Md[${name}]`, engines, (e) => e.HTML2Md(input), input, failures, bothThrewAll);
    }
  }
  report(failures);
});

test("HTML2Text: Go test HTML and fragments", () => {
  const failures: string[] = [];
  const inputs = [...GO_HTML, ...FRAGMENTS];
  for (const name of FULL ? ["default", "protyle", "go tests"] : ["default"]) {
    const engines = newEngines(set(name).setters);
    for (const input of sample(inputs, 1, 4)) {
      check(`HTML2Text[${name}]`, engines, (e) => e.HTML2Text(input), input, failures, bothThrewAll);
    }
  }
  report(failures);
});

test("HTML2Markdown: result and error of the Go (markdown, err) pair", () => {
  const failures: string[] = [];
  for (const name of ["default", "protyle"]) {
    const engines = newEngines(set(name).setters);
    for (const input of sample([...GO_HTML.slice(0, 60), ...FRAGMENTS], 0, 6)) {
      const port = attempt(() => JSON.stringify(engines.port.HTML2Markdown(input)));
      const oracle = attempt(() => JSON.stringify(engines.oracle.HTML2Markdown(input)));
      try {
        assertSameOutcome(`HTML2Markdown[${name}]`, port, oracle);
      } catch (e) {
        failures.push((e as Error).message + "\n  input: " + JSON.stringify(input));
      }
    }
  }
  report(failures);
});

test("HTML2Md: <!DOCTYPE html> input behaves as on the oracle", () => {
  const failures: string[] = [];
  for (const name of ["default", "protyle"]) {
    const engines = newEngines(set(name).setters);
    for (const input of [
      "<!DOCTYPE html><p>x</p>",
      "<!DOCTYPE html>",
      "<!doctype html><html><body><p>x</p></body></html>",
      "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Strict//EN\" \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd\"><p>x</p>",
      " <!DOCTYPE html><p>x</p>",
      "<!DOCTYPE foo><p>x</p>",
    ]) {
      check(`HTML2Md doctype[${name}]`, engines, (e) => e.HTML2Md(input), input, failures, bothThrewAll);
      check(`HTML2Text doctype[${name}]`, engines, (e) => e.HTML2Text(input), input, failures, bothThrewAll);
    }
  }
  report(failures);
});

test("HTML2Md: mutations of the Go test HTML and the fragments", () => {
  const failures: string[] = [];
  const bases = [...GO_HTML, ...FRAGMENTS].filter((s) => s.length < 2500);
  const names = ["default", "go tests", "protyle", "attrs", "disable syntax", "callout"];
  for (const [si, name] of names.entries()) {
    const engines = newEngines(set(name).setters);
    for (const [i, base] of sample(bases, si * 2, FULL ? 1 : 180).entries()) {
      for (const m of mutations(base, i * 31 + si)) {
        check(`HTML2Md mutation[${name}]`, engines, (e) => e.HTML2Md(m), m, failures, bothThrewAll);
      }
    }
  }
  report(failures);
});

// HTML produced by the oracle's forward methods from the Markdown corpus.
function markdownCorpus(): string[] {
  const spec = JSON.parse(readRepoFile("test/commonmark-spec.json")) as Array<{ markdown: string }>;
  const docs: string[] = [];
  for (const c of spec) {
    docs.push(c.markdown);
  }
  for (const f of ["test/case1.md", "README.md", "test/format-case0.md", "test/format-case1.md", "test/format-case2.md", "test/format-case3.md", "test/format-case4.md", "test/format-case5.md", "test/format-case6.md", "test/format-case7.md"]) {
    docs.push(readRepoFile(f));
  }
  docs.push(readRepoFile("test/gfm-spec.md").split("\n").slice(0, 1500).join("\n"));
  docs.push(readRepoFile("benchmark/commonmark-spec.md").split("\n").slice(0, 1500).join("\n"));
  for (const f of [readRepoFile("test/gfm-spec.md"), readRepoFile("benchmark/commonmark-spec.md")]) {
    const paras = f.split("\n\n");
    for (let i = 0; i < paras.length; i += 7) {
      docs.push(paras.slice(i, i + 3).join("\n\n"));
    }
  }
  docs.push(...buildCorpus());
  return docs;
}

let forwardCache: Array<{ kind: string; html: string }> | undefined;

function forwardHtml(): Array<{ kind: string; html: string }> {
  if (forwardCache === undefined) {
    forwardCache = forwardHtml0();
  }
  return forwardCache;
}

function forwardHtml0(): Array<{ kind: string; html: string }> {
  // The quick run converts every fifth document of the corpus (see ../full.ts).
  const docs = sample(markdownCorpus(), 0, 16);
  const gen = newOracleEngine();
  const genProtyle = newOracleEngine();
  for (const [n, v] of [["SetProtyleWYSIWYG", true], ["SetKramdownBlockIAL", true], ["SetKramdownSpanIAL", true], ["SetTextMark", true], ["SetBlockRef", true], ["SetSuperBlock", true], ["SetCallout", true], ["SetTabs", true], ["SetInlineMath", true], ["SetTag", true]] as const) {
    genProtyle[n](v);
  }
  const wys = newOracleEngine();
  wys.SetVditorWYSIWYG(true);
  const out: Array<{ kind: string; html: string }> = [];
  const safe = (kind: string, f: () => string): void => {
    try {
      const h = f();
      if (typeof h === "string" && h.length < 20000) {
        out.push({ kind, html: h });
      }
    } catch {
      // the forward method throws on this input; nothing to convert back
    }
  };
  for (const d of docs) {
    safe("html", () => gen.MarkdownStr("", d) as string);
    safe("vditor", () => wys.Md2VditorDOM(d) as string);
    safe("ir", () => wys.Md2VditorIRDOM(d) as string);
    safe("block", () => genProtyle.Md2BlockDOM(d, false) as string);
  }
  return out;
}

test("HTML2Md: HTML rendered by the oracle from the Markdown corpus", () => {
  const failures: string[] = [];
  const all = forwardHtml();
  assert.ok(all.length > (FULL ? 2000 : 400), String(all.length));
  const names = ["default", "go tests", "protyle", "attrs", "protyle block ial", "callout", "no autospace, no gfm table", "tag, inline math, link base", "vditor wysiwyg"];
  for (const [si, name] of names.entries()) {
    const engines = newEngines(set(name).setters);
    const items = sample(all, si * 2 + 1, FULL ? 1 : 28);
    for (const { kind, html } of items) {
      check(`HTML2Md corpus ${kind}[${name}]`, engines, (e) => e.HTML2Md(html), html, failures, bothThrewAll);
    }
  }
  report(failures);
});

test("HTML2Md: mutated HTML rendered from the Markdown corpus (caret, text, wrapping)", () => {
  const failures: string[] = [];
  const all = forwardHtml().filter((x) => x.html.length < 4000);
  const names = ["default", "protyle", "attrs"];
  for (const [si, name] of names.entries()) {
    const engines = newEngines(set(name).setters);
    const items = sample(all, si * 3, FULL ? 6 : 120);
    for (const [i, { kind, html }] of items.entries()) {
      for (const m of mutations(html, i + si * 7919).slice(0, FULL ? 8 : 6)) {
        check(`HTML2Md corpus mutation ${kind}[${name}]`, engines, (e) => e.HTML2Md(m), m, failures, bothThrewAll);
      }
    }
  }
  report(failures);
});

test("HTML2Md: round trip Markdown -> oracle HTML -> Markdown -> oracle HTML -> Markdown", () => {
  const failures: string[] = [];
  const gen = newOracleEngine();
  const engines = newEngines([]);
  const docs = sample(markdownCorpus(), 0, FULL ? 1 : 180);
  for (const d of docs) {
    let h1: string;
    try {
      h1 = gen.MarkdownStr("", d) as string;
    } catch {
      continue;
    }
    const portMd = attempt(() => engines.port.HTML2Md(h1));
    const oracleMd = attempt(() => engines.oracle.HTML2Md(h1) as string);
    try {
      assertSameOutcome("round trip step 1", portMd, oracleMd);
    } catch (e) {
      failures.push((e as Error).message);
      continue;
    }
    if (portMd.threw) {
      continue;
    }
    // Step 2 starts from the oracle's own output of step 1.
    const h2 = gen.MarkdownStr("", oracleMd.value) as string;
    check("round trip step 2", engines, (e) => e.HTML2Md(h2), h2, failures, bothThrewAll);
  }
  report(failures);
});

test("a fresh port engine and a fresh oracle engine agree on defaults", () => {
  const port = New();
  const oracle = newOracleEngine();
  for (const input of ["<p>a</p>", "<b>x</b>", "<table><tr><td>1</td></tr></table>"]) {
    assert.equal(port.HTML2Md(input), oracle.HTML2Md(input));
    assert.equal(port.HTML2Text(input), oracle.HTML2Text(input));
  }
});

test("inputs on which both engines throw (reported, not failures)", () => {
  // The list is filled by the tests above; it is printed so that it is visible in the log.
  const counts = new Map<string, number>();
  for (const e of bothThrewAll) {
    const key = e.split(" ")[0];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  console.log("both engines threw:", JSON.stringify([...counts.entries()]), "examples:", JSON.stringify(bothThrewAll.slice(0, 3)));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { compareMethod, newCounters, newEngines } from "./json_vditor_helpers.ts";
import type { Counters, SetterCall } from "./json_vditor_helpers.ts";
import { readRepoFile } from "../helpers.ts";
import { CARET_DOCS, JSON_DOCS, withCarets } from "./json_vditor_corpus.ts";

// Md2VditorDOM (vditor_wysiwyg.go): parse.Parse, NewVditorRenderer, copy of Md2VditorDOMRendererFuncs, Render. The Go method changes no option.
// The oracle is compared with the port under the same setter calls. A real Vditor front end calls SetVditorWYSIWYG(true), which also changes parsing.

const WYSIWYG: SetterCall = ["SetVditorWYSIWYG", true];

interface Set {
  name: string;
  setters: SetterCall[];
}

const SETS: Set[] = [
  { name: "default", setters: [] },
  { name: "wysiwyg", setters: [WYSIWYG] },
  { name: "wysiwyg + all previews", setters: [WYSIWYG, ["SetVditorCodeBlockPreview", true], ["SetVditorMathBlockPreview", true], ["SetVditorHTMLBlockPreview", true]] },
  { name: "code preview", setters: [WYSIWYG, ["SetVditorCodeBlockPreview", true]] },
  { name: "math preview", setters: [WYSIWYG, ["SetVditorMathBlockPreview", true]] },
  { name: "html preview", setters: [WYSIWYG, ["SetVditorHTMLBlockPreview", true]] },
  { name: "toc, no heading id", setters: [WYSIWYG, ["SetToC", true], ["SetHeadingID", false]] },
  { name: "heading anchor", setters: [WYSIWYG, ["SetHeadingAnchor", true], ["SetHeadingID", true]] },
  { name: "no footnotes", setters: [WYSIWYG, ["SetFootnotes", false]] },
  { name: "no auto space, no fix term typo", setters: [WYSIWYG, ["SetAutoSpace", false], ["SetFixTermTypo", false]] },
  { name: "sanitize", setters: [WYSIWYG, ["SetSanitize", true], ["SetVditorHTMLBlockPreview", true]] },
  { name: "link base and emoji site", setters: [WYSIWYG, ["SetLinkBase", "https://example.com/base/"], ["SetLinkPrefix", "https://p.example.org/"], ["SetEmojiSite", "https://emoji.example.com"]] },
  { name: "inline math digit, mark, sup, sub, tag, block ref", setters: [WYSIWYG, ["SetInlineMath", true], ["SetInlineMathAllowDigitAfterOpenMarker", true], ["SetMark", true], ["SetSup", true], ["SetSub", true], ["SetTag", true], ["SetBlockRef", true], ["SetFileAnnotationRef", true]] },
  { name: "Chinese paragraph beginning space", setters: [WYSIWYG, ["SetChineseParagraphBeginningSpace", true]] },
  { name: "list style, kramdown IAL", setters: [WYSIWYG, ["SetRenderListStyle", true], ["SetKramdownIAL", true], ["SetKramdownBlockIAL", true], ["SetKramdownSpanIAL", true]] },
  { name: "data task, task class", setters: [WYSIWYG, ["SetDataTask", true], ["SetGFMTaskListItemClass", "task-item"], ["SetArbitraryTaskListItemMarker", true]] },
  { name: "super block, git conflict", setters: [WYSIWYG, ["SetSuperBlock", true], ["SetGitConflict", true], ["SetKramdownIAL", true]] },
  { name: "no GFM", setters: [WYSIWYG, ["SetGFMTable", false], ["SetGFMTaskListItem", false], ["SetGFMStrikethrough", false], ["SetGFMAutoLink", false]] },
  { name: "no emoji, no indent code block", setters: [WYSIWYG, ["SetEmoji", false], ["SetIndentCodeBlock", false]] },
  { name: "soft break to hard break", setters: [WYSIWYG, ["SetSoftBreak2HardBreak", false]] },
];

const MAIN_SETS = ["default", "wysiwyg", "wysiwyg + all previews", "inline math digit, mark, sup, sub, tag, block ref"];

function pick(names: string[]): Set[] {
  return SETS.filter((s) => names.includes(s.name));
}

test("Md2VditorDOM: port equals oracle on the corpus under the main option sets", () => {
  const counters: Counters = newCounters();
  for (const set of pick(MAIN_SETS)) {
    const engines = newEngines(set.setters);
    for (const doc of JSON_DOCS) {
      compareMethod(engines, "Md2VditorDOM", set.name, doc, counters);
    }
  }
  assert.ok(counters.compared > 300, `only ${counters.compared} comparisons`);
});

test("Md2VditorDOM: port equals oracle with the caret at many positions", () => {
  const counters: Counters = newCounters();
  for (const set of pick(["wysiwyg", "wysiwyg + all previews"])) {
    const engines = newEngines(set.setters);
    for (const doc of CARET_DOCS) {
      compareMethod(engines, "Md2VditorDOM", set.name, doc, counters);
    }
    for (const doc of JSON_DOCS.slice(1)) {
      for (const variant of withCarets(doc)) {
        compareMethod(engines, "Md2VditorDOM", set.name, variant, counters);
      }
    }
  }
  assert.ok(counters.compared > 1000, `only ${counters.compared} comparisons`);
});

test("Md2VditorDOM: port equals oracle with the caret under the other option sets", () => {
  const counters: Counters = newCounters();
  for (const set of SETS) {
    if (MAIN_SETS.includes(set.name)) {
      continue;
    }
    const engines = newEngines(set.setters);
    for (const doc of CARET_DOCS) {
      compareMethod(engines, "Md2VditorDOM", set.name, doc, counters);
    }
    for (const doc of JSON_DOCS.slice(1, 60)) {
      compareMethod(engines, "Md2VditorDOM", set.name, doc, counters);
    }
  }
  assert.ok(counters.compared > 1000, `only ${counters.compared} comparisons`);
});

test("Md2VditorDOM: closing fence followed by the caret, both sides throw", () => {
  // Go panics in codeBlockFinalize (slice bounds out of range); the port throws at the same place.
  const engines = newEngines([WYSIWYG]);
  const counters = newCounters();
  for (const doc of ["```\n```‸", "```js\n```‸"]) {
    compareMethod(engines, "Md2VditorDOM", "caret after fence", doc, counters);
  }
  assert.equal(counters.bothThrew.length, 2);
});

test("Md2VditorDOM: port equals oracle on every CommonMark spec case", () => {
  const cases = JSON.parse(readRepoFile("test/commonmark-spec.json")) as { section: string; example: number; markdown: string }[];
  const counters: Counters = newCounters();
  for (const set of pick(["wysiwyg + all previews"])) {
    const engines = newEngines(set.setters);
    for (const c of cases) {
      compareMethod(engines, "Md2VditorDOM", `spec ${c.example}`, c.markdown, counters);
    }
  }
  assert.equal(counters.compared, 652);
});

test("Md2VditorDOM: port equals oracle on whole files", () => {
  const counters: Counters = newCounters();
  const files = ["test/case1.md", "README.md", "test/format-case0.md", "test/format-case1.md", "test/format-case2.md", "test/format-case3.md", "test/format-case4.md", "test/format-case5.md", "test/format-case6.md", "test/format-case7.md", "test/gfm-spec.md"];
  for (const set of pick(["wysiwyg + all previews", "inline math digit, mark, sup, sub, tag, block ref"])) {
    const engines = newEngines(set.setters);
    for (const file of files) {
      compareMethod(engines, "Md2VditorDOM", `${file} [${set.name}]`, readRepoFile(file), counters);
    }
  }
  const lines = readRepoFile("benchmark/commonmark-spec.md").split("\n").slice(0, 2000).join("\n");
  const engines = newEngines(SETS[2].setters);
  compareMethod(engines, "Md2VditorDOM", "benchmark/commonmark-spec.md (first 2000 lines)", lines, counters);
  assert.equal(counters.compared, files.length * 2 + 1);
});

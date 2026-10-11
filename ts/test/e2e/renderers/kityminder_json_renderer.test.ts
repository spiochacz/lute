import { test } from "node:test";
import assert from "node:assert/strict";
import { SetTesting } from "../../../src/ast/index.ts";
import { New } from "../../../src/index.ts";
import { compareMethod, newCounters, newEngines } from "./json_vditor_helpers.ts";
import type { Counters, SetterCall } from "./json_vditor_helpers.ts";
import { readRepoFile } from "../helpers.ts";
import { JSON_DOCS } from "./json_vditor_corpus.ts";
import { OPTION_SETS } from "../option_sets.ts";

// Port of test/kityminder_json_renderer_test.go: the same cases and expected values.
const kitymindJSONRendererTests: [name: string, from: string, to: string][] = [
  ["0", "{{{\nfoo\n{: id=\"20210110174236-xe4fzwr\"}\n\nbar\n{: id=\"20210110174236-xe4fzwr\"}\n\n}}}\n{: id=\"20210110174239-afmuohb\"}\n\nbaz\n{: id=\"20210110174252-qte4wlu\"}\n\n\n{: id=\"20210110005118-gqrx3wm\" type=\"doc\"}\n", "{\"root\":{\"data\":{\"layout\":\"right\",\"text\":\"\",\"id\":\"20210110005118-gqrx3wm\",\"type\":\"NodeDocument\",\"isContainer\":true},\"children\":[{\"data\":{\"priority\": \"iconSuper\",\"text\":\"\",\"id\":\"20210110174239-afmuohb\",\"type\":\"NodeSuperBlock\",\"isContainer\":true},\"children\":[{\"data\":{\"text\":\"foo\",\"id\":\"20210110174236-xe4fzwr\",\"type\":\"NodeParagraph\",\"isContainer\":false},\"children\":[]},{\"data\":{\"text\":\"bar\",\"id\":\"20210110174236-xe4fzwr\",\"type\":\"NodeParagraph\",\"isContainer\":false},\"children\":[]}]},{\"data\":{\"text\":\"baz\",\"id\":\"20210110174252-qte4wlu\",\"type\":\"NodeParagraph\",\"isContainer\":false},\"children\":[]}]}}"],
];

test("KityMinderJSONRenderer: the Go test cases (test/kityminder_json_renderer_test.go)", () => {
  const luteEngine = New();
  luteEngine.SetKramdownIAL(true);
  luteEngine.SetSuperBlock(true);

  SetTesting(true);
  try {
    for (const [name, from, to] of kitymindJSONRendererTests) {
      assert.equal(luteEngine.RenderKityMinderJSON(from), to, `test case [${name}]`);
    }
  } finally {
    SetTesting(false);
  }
});

const SETS: { name: string; setters: SetterCall[] }[] = [
  { name: "go test options", setters: [["SetKramdownIAL", true], ["SetSuperBlock", true]] },
  { name: "default", setters: [] },
  { name: "all inline extensions", setters: [["SetSup", true], ["SetSub", true], ["SetMark", true], ["SetTag", true], ["SetBlockRef", true], ["SetFileAnnotationRef", true], ["SetInlineMath", true], ["SetSuperBlock", true], ["SetKramdownIAL", true], ["SetKramdownSpanIAL", true]] },
];

// Documents with the structures of a mind map: nested headings, lists, quotes and super blocks.
const KITY_DOCS: string[] = [
  "# a\n\n## b\n\n### c\n\n## d\n\n# e",
  "# a\n{: id=\"20210110174236-xe4fzwr\"}\n\n## b\n{: id=\"20210110174237-xe4fzwr\"}\n\ntext\n{: id=\"20210110174238-xe4fzwr\"}\n\n# c\n{: id=\"20210110174239-xe4fzwr\"}\n\n{: id=\"20210110005118-gqrx3wm\" type=\"doc\"}",
  "- a\n  - b\n    - c\n- d",
  "1. a\n2. b",
  "- [ ] a\n- [x] b",
  "> quote\n> > nested",
  "{{{\na\n\nb\n}}}",
  "{{{row\n# h\n\n- l\n}}}",
  "# #tag# and `code` and [l](u)",
  "# a very long heading that exceeds sixteen runes for sure 中文中文中文",
  "# " + "\u{1F600}".repeat(17),
  "a\\b\"c'd\ne",
  "| a | b |\n| - | - |\n| 1 | 2 |",
  "$$\nx\n$$\n\n---\n\n<div>h</div>\n\n```js\ncode\n```",
  "[TOC]\n\n# a",
  "---\ny: 1\n---\n\n# a",
  "{{ select * from blocks }}\n\n# a",
  "- a\n\n  b\n- c",
  "# a\n\ntext\n\n## b\n\n- l\n\n### c\n\n> q\n\n# d",
  "# a\n## b\n### c\n#### d\n##### e\n###### f\n# g",
  "# a\n\n# a\n\n# a",
];

test("KityMinderJSONRenderer: port equals oracle on the Go cases, the corpus and whole files", () => {
  const counters: Counters = newCounters();
  for (const set of SETS) {
    const engines = newEngines(set.setters);
    for (const [name, from] of kitymindJSONRendererTests) {
      compareMethod(engines, "RenderKityMinderJSON", `${set.name} / ${name}`, from, counters);
    }
    for (const doc of [...KITY_DOCS, ...JSON_DOCS]) {
      compareMethod(engines, "RenderKityMinderJSON", set.name, doc, counters);
    }
  }
  const engines = newEngines(SETS[2].setters);
  for (const file of ["test/case1.md", "README.md", "test/format-case0.md", "test/format-case3.md", "test/gfm-spec.md"]) {
    compareMethod(engines, "RenderKityMinderJSON", file, readRepoFile(file), counters);
  }
  assert.ok(counters.compared > 300, `only ${counters.compared} comparisons`);
});

test("KityMinderJSONRenderer: port equals oracle on every CommonMark spec case", () => {
  const cases = JSON.parse(readRepoFile("test/commonmark-spec.json")) as { section: string; example: number; markdown: string }[];
  const engines = newEngines(SETS[2].setters);
  const counters: Counters = newCounters();
  for (const c of cases) {
    compareMethod(engines, "RenderKityMinderJSON", `spec ${c.example}`, c.markdown, counters);
  }
  assert.equal(counters.compared, 652);
});

test("KityMinderJSONRenderer: option sets", () => {
  const counters: Counters = newCounters();
  for (const set of OPTION_SETS) {
    const engines = newEngines(set.setters);
    for (const doc of KITY_DOCS.slice(0, 8)) {
      compareMethod(engines, "RenderKityMinderJSON", set.name, doc, counters);
    }
  }
  assert.ok(counters.compared > 300);
});

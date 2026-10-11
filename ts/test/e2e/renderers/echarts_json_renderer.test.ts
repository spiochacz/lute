import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../../src/index.ts";
import { compareMethod, newCounters, newEngines } from "./json_vditor_helpers.ts";
import type { Counters, SetterCall } from "./json_vditor_helpers.ts";
import { readRepoFile } from "../helpers.ts";
import { JSON_DOCS } from "./json_vditor_corpus.ts";
import { OPTION_SETS } from "../option_sets.ts";

// Port of test/echarts_json_renderer_test.go: the same cases and expected values.
const echartsJSONRendererTests: [name: string, from: string, to: string][] = [
  ["7", "| foo |\n| - |\n|   |\n{: id=\"20201122125005-kc4sl0l\"}\n\n{: id=\"20201122125319-t74imwc\" type=\"doc\"}", "[{\"name\":\"Document\",\"children\":[{\"name\":\"Table\\ntable\",\"children\":[{\"name\":\"Table Head\\nthead\"},{\"name\":\"Table Row\\ntr\"}]},{\"name\":\"Block IAL\\n{: 20201122125005-kc4sl0l}\"},{\"name\":\"Block IAL\\n{: 20201122125319-t74imwc}\"}]}]"],
  ["6", "foo\n{: id=\"20201122125005-kc4sl0l\"}\n\n{: id=\"20201122125319-t74imwc\" type=\"doc\"}", "[{\"name\":\"Document\",\"children\":[{\"name\":\"Paragraph\\np\",\"children\":[{\"name\":\"Text\\nfoo\"}]},{\"name\":\"Block IAL\\n{: 20201122125005-kc4sl0l}\"},{\"name\":\"Block IAL\\n{: 20201122125319-t74imwc}\"}]}]"],
  ["5", "foo\n{: id=\"fooid\"}\n\n{: id=\"20201122125319-t74imwc\" type=\"doc\"}", "[{\"name\":\"Document\",\"children\":[{\"name\":\"Paragraph\\np\",\"children\":[{\"name\":\"Text\\nfoo\"}]},{\"name\":\"Block IAL\\n{: fooid}\"},{\"name\":\"Block IAL\\n{: 20201122125319-t74imwc}\"}]}]"],
  ["4", "&hearts;\n\n{: id=\"20201122125319-t74imwc\" type=\"doc\"}", "[{\"name\":\"Document\",\"children\":[{\"name\":\"Paragraph\\np\",\"children\":[{\"name\":\"HTML Entity\\nspan\"}]},{\"name\":\"Block IAL\\n{: 20201122125319-t74imwc}\"}]}]"],
  ["3", ":smile:\n\n{: id=\"20201122125319-t74imwc\" type=\"doc\"}", "[{\"name\":\"Document\",\"children\":[{\"name\":\"Paragraph\\np\",\"children\":[{\"name\":\"Emoji Unicode\\n\"}]},{\"name\":\"Block IAL\\n{: 20201122125319-t74imwc}\"}]}]"],
  ["2", "~foo~\n\n{: id=\"20201122125319-t74imwc\" type=\"doc\"}", "[{\"name\":\"Document\",\"children\":[{\"name\":\"Paragraph\\np\",\"children\":[{\"name\":\"Strikethrough\\ndel\"}]},{\"name\":\"Block IAL\\n{: 20201122125319-t74imwc}\"}]}]"],
  ["1", "# foo\n*bar*\n\n{: id=\"20201122125319-t74imwc\" type=\"doc\"}", "[{\"name\":\"Document\",\"children\":[{\"name\":\"Heading\\nh1\",\"children\":[{\"name\":\"Text\\nfoo\"}]},{\"name\":\"Paragraph\\np\",\"children\":[{\"name\":\"Emphasis\\nem\",\"children\":[{\"name\":\"Text\\nbar\"}]}]},{\"name\":\"Block IAL\\n{: 20201122125319-t74imwc}\"}]}]"],
  ["0", "", "[{\"name\":\"Document\",\"children\":[]}]"],
];

test("EChartsJSONRenderer: the Go test cases (test/echarts_json_renderer_test.go)", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.KramdownBlockIAL = true;
  for (const [name, from, to] of echartsJSONRendererTests) {
    assert.equal(luteEngine.RenderEChartsJSON(from), to, `test case [${name}]`);
  }
});

const SETS: { name: string; setters: SetterCall[] }[] = [
  { name: "kramdown block IAL", setters: [["SetKramdownBlockIAL", true]] },
  { name: "default", setters: [] },
  { name: "all inline extensions", setters: [["SetSup", true], ["SetSub", true], ["SetMark", true], ["SetTag", true], ["SetBlockRef", true], ["SetFileAnnotationRef", true], ["SetInlineMath", true], ["SetSuperBlock", true], ["SetKramdownIAL", true], ["SetKramdownSpanIAL", true]] },
  { name: "no GFM", setters: [["SetGFMTable", false], ["SetGFMTaskListItem", false], ["SetGFMStrikethrough", false], ["SetGFMAutoLink", false]] },
];

test("EChartsJSONRenderer: port equals oracle on the Go cases, the corpus and whole files", () => {
  const counters: Counters = newCounters();
  for (const set of SETS) {
    const engines = newEngines(set.setters);
    for (const [name, from] of echartsJSONRendererTests) {
      compareMethod(engines, "RenderEChartsJSON", `${set.name} / ${name}`, from, counters);
    }
    for (const doc of JSON_DOCS) {
      compareMethod(engines, "RenderEChartsJSON", set.name, doc, counters);
    }
  }
  const engines = newEngines(SETS[2].setters);
  for (const file of ["test/case1.md", "README.md", "test/format-case0.md", "test/format-case3.md", "test/gfm-spec.md"]) {
    compareMethod(engines, "RenderEChartsJSON", file, readRepoFile(file), counters);
  }
  assert.ok(counters.compared > 300, `only ${counters.compared} comparisons`);
});

test("EChartsJSONRenderer: port equals oracle on every CommonMark spec case", () => {
  const cases = JSON.parse(readRepoFile("test/commonmark-spec.json")) as { section: string; example: number; markdown: string }[];
  const engines = newEngines(SETS[2].setters);
  const counters: Counters = newCounters();
  for (const c of cases) {
    compareMethod(engines, "RenderEChartsJSON", `spec ${c.example}`, c.markdown, counters);
  }
  assert.equal(counters.compared, 652);
});

test("EChartsJSONRenderer: text summaries and escaping", () => {
  const engines = newEngines([["SetKramdownBlockIAL", true]]);
  const counters: Counters = newCounters();
  const docs = [
    "12345",
    "123456",
    "中文字符串测试内容",
    "\u{1F600}\u{1F600}\u{1F600}\u{1F600}\u{1F600}\u{1F600}x",
    "a\\b\"c'd\ne",
    "'quoted' \"text\" back\\slash",
    "# h\\1\n\n- [x] \\ \"t\"\n- 1",
  ];
  for (const doc of docs) {
    compareMethod(engines, "RenderEChartsJSON", "text", doc, counters);
  }
  assert.equal(counters.compared, docs.length);
});

test("EChartsJSONRenderer: option sets", () => {
  const counters: Counters = newCounters();
  for (const set of OPTION_SETS) {
    const engines = newEngines(set.setters);
    for (const doc of JSON_DOCS.slice(0, 12)) {
      compareMethod(engines, "RenderEChartsJSON", set.name, doc, counters);
    }
  }
  assert.ok(counters.compared > 300);
});

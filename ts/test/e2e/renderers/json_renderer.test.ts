import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../../src/index.ts";
import { sample } from "../full.ts";
import { compareMethod, newCounters, newEngines } from "./json_vditor_helpers.ts";
import type { Counters, SetterCall } from "./json_vditor_helpers.ts";
import { readRepoFile } from "../helpers.ts";
import { JSON_DOCS } from "./json_vditor_corpus.ts";
import { OPTION_SETS } from "../option_sets.ts";

// Port of test/json_renderer_test.go: the same cases and expected values.
const JSONRendererTests: [name: string, from: string, to: string][] = [
  ["测试普通文本", "普通文本测试", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeText\",\"Data\":\"普通文本测试\"}]}]}"],
  ["测试行内代码", "`console.log(\"Hello World\")`", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeCodeSpan\",\"CodeMarkerLen\":1,\"Children\":[{\"Type\":\"NodeCodeSpanOpenMarker\",\"Data\":\"`\"},{\"Type\":\"NodeCodeSpanContent\",\"Data\":\"console.log(\\\"Hello World\\\")\"},{\"Type\":\"NodeCodeSpanCloseMarker\",\"Data\":\"`\"}]}]}]}"],
  ["测试代码块", "```js\nconsole.log(\"Hello World\")\n```\n", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeCodeBlock\",\"IsFencedCodeBlock\":true,\"CodeBlockFenceChar\":96,\"CodeBlockFenceLen\":3,\"CodeBlockOpenFence\":\"YGBg\",\"CodeBlockInfo\":\"anM=\",\"CodeBlockCloseFence\":\"YGBg\",\"Children\":[{\"Type\":\"NodeCodeBlockFenceOpenMarker\",\"Data\":\"```\",\"CodeBlockFenceLen\":3},{\"Type\":\"NodeCodeBlockFenceInfoMarker\",\"CodeBlockInfo\":\"anM=\"},{\"Type\":\"NodeCodeBlockCode\",\"Data\":\"console.log(\\\"Hello World\\\")\\n\"},{\"Type\":\"NodeCodeBlockFenceCloseMarker\",\"Data\":\"```\",\"CodeBlockFenceLen\":3}]}]}"],
  ["测试数学块", "$$\na + b = c\n$$\n", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeMathBlock\",\"Children\":[{\"Type\":\"NodeMathBlockOpenMarker\"},{\"Type\":\"NodeMathBlockContent\",\"Data\":\"a + b = c\"},{\"Type\":\"NodeMathBlockCloseMarker\"}]}]}"],
  ["测试行内数学公式", "$a + b = c$", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeInlineMath\",\"Children\":[{\"Type\":\"NodeInlineMathOpenMarker\"},{\"Type\":\"NodeInlineMathContent\",\"Data\":\"a + b = c\"},{\"Type\":\"NodeInlineMathCloseMarker\"}]}]}]}"],
  ["测试斜体", "*测试斜体*", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeEmphasis\",\"Children\":[{\"Type\":\"NodeEmA6kOpenMarker\",\"Data\":\"*\"},{\"Type\":\"NodeText\",\"Data\":\"测试斜体\"},{\"Type\":\"NodeEmA6kCloseMarker\",\"Data\":\"*\"}]}]}]}"],
  ["测试加粗", "**测试粗体**", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeStrong\",\"Children\":[{\"Type\":\"NodeStrongA6kOpenMarker\",\"Data\":\"**\"},{\"Type\":\"NodeText\",\"Data\":\"测试粗体\"},{\"Type\":\"NodeStrongA6kCloseMarker\",\"Data\":\"**\"}]}]}]}"],
  ["测试引述块", "> 测试引述块", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeBlockquote\",\"Children\":[{\"Type\":\"NodeBlockquoteMarker\",\"Data\":\"\\u003e \"},{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeText\",\"Data\":\"测试引述块\"}]}]}]}"],
  ["测试标题", "# 一级标题", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeHeading\",\"HeadingLevel\":1,\"Children\":[{\"Type\":\"NodeHeadingC8hMarker\",\"Data\":\"# \"},{\"Type\":\"NodeText\",\"Data\":\"一级标题\"}]}]}"],
  ["测试无序列表", "- item1\n- item2\n- item3\n", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeList\",\"ListData\":{\"Tight\":true,\"BulletChar\":45,\"Padding\":2,\"Marker\":\"LQ==\",\"Num\":-1},\"Children\":[{\"Type\":\"NodeListItem\",\"Data\":\"-\",\"ListData\":{\"Tight\":true,\"BulletChar\":45,\"Padding\":2,\"Marker\":\"LQ==\",\"Num\":-1},\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeText\",\"Data\":\"item1\"}]}]},{\"Type\":\"NodeListItem\",\"Data\":\"-\",\"ListData\":{\"Tight\":true,\"BulletChar\":45,\"Padding\":2,\"Marker\":\"LQ==\",\"Num\":-1},\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeText\",\"Data\":\"item2\"}]}]},{\"Type\":\"NodeListItem\",\"Data\":\"-\",\"ListData\":{\"Tight\":true,\"BulletChar\":45,\"Padding\":2,\"Marker\":\"LQ==\",\"Num\":-1},\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeText\",\"Data\":\"item3\"}]}]}]}]}"],
  ["测试有序列表", "1. item1\n2. item2\n3. item3\n", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeList\",\"ListData\":{\"Typ\":1,\"Tight\":true,\"Start\":1,\"Delimiter\":46,\"Padding\":3,\"Marker\":\"MS4=\",\"Num\":1},\"Children\":[{\"Type\":\"NodeListItem\",\"Data\":\"1.\",\"ListData\":{\"Typ\":1,\"Tight\":true,\"Start\":1,\"Delimiter\":46,\"Padding\":3,\"Marker\":\"MS4=\",\"Num\":1},\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeText\",\"Data\":\"item1\"}]}]},{\"Type\":\"NodeListItem\",\"Data\":\"2.\",\"ListData\":{\"Typ\":1,\"Tight\":true,\"Start\":2,\"Delimiter\":46,\"Padding\":3,\"Marker\":\"Mi4=\",\"Num\":2},\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeText\",\"Data\":\"item2\"}]}]},{\"Type\":\"NodeListItem\",\"Data\":\"3.\",\"ListData\":{\"Typ\":1,\"Tight\":true,\"Start\":3,\"Delimiter\":46,\"Padding\":3,\"Marker\":\"My4=\",\"Num\":3},\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeText\",\"Data\":\"item3\"}]}]}]}]}"],
  ["测试分割线", "***", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeThematicBreak\"}]}"],
  ["测试软换行", "测试换行\\n", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeText\",\"Data\":\"测试换行\\\\n\"}]}]}"],
  ["测试HTML块", "<div>\nHTML块\n</div>\n", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeHTMLBlock\",\"Data\":\"\\u003cdiv\\u003e\\nHTML块\\n\\u003c/div\\u003e\",\"HtmlBlockType\":6}]}"],
  ["测试行内HTML", "<a>行内HTML</a>", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeInlineHTML\",\"Data\":\"\\u003ca\\u003e\"},{\"Type\":\"NodeText\",\"Data\":\"行内HTML\"},{\"Type\":\"NodeInlineHTML\",\"Data\":\"\\u003c/a\\u003e\"}]}]}"],
  ["测试链接", "[链接文本](链接)", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeLink\",\"Children\":[{\"Type\":\"NodeOpenBracket\",\"Data\":\"[\"},{\"Type\":\"NodeLinkText\",\"Data\":\"链接文本\"},{\"Type\":\"NodeCloseBracket\",\"Data\":\"]\"},{\"Type\":\"NodeOpenParen\",\"Data\":\"(\"},{\"Type\":\"NodeLinkDest\",\"Data\":\"%E9%93%BE%E6%8E%A5\"},{\"Type\":\"NodeCloseParen\",\"Data\":\")\"}]}]}]}"],
  ["测试图片", "![图片文本](图片链接)", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeImage\",\"Children\":[{\"Type\":\"NodeBang\",\"Data\":\"!\"},{\"Type\":\"NodeOpenBracket\",\"Data\":\"[\"},{\"Type\":\"NodeLinkText\",\"Data\":\"图片文本\"},{\"Type\":\"NodeCloseBracket\",\"Data\":\"]\"},{\"Type\":\"NodeOpenParen\",\"Data\":\"(\"},{\"Type\":\"NodeLinkDest\",\"Data\":\"%E5%9B%BE%E7%89%87%E9%93%BE%E6%8E%A5\"},{\"Type\":\"NodeCloseParen\",\"Data\":\")\"}]}]}]}"],
  ["测试删除线", "~~删除线~~", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeStrikethrough\",\"Children\":[{\"Type\":\"NodeStrikethrough2OpenMarker\",\"Data\":\"~~\"},{\"Type\":\"NodeText\",\"Data\":\"删除线\"},{\"Type\":\"NodeStrikethrough2CloseMarker\",\"Data\":\"~~\"}]}]}]}"],
  ["测试TaskList", "- [X] item1\n- [ ] item2\n- [X] item3\n", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeList\",\"ListData\":{\"Typ\":3,\"Tight\":true,\"BulletChar\":45,\"Padding\":2,\"Checked\":true,\"Marker\":\"LQ==\",\"Num\":-1},\"Children\":[{\"Type\":\"NodeListItem\",\"Data\":\"-\",\"ListData\":{\"Typ\":3,\"Tight\":true,\"BulletChar\":45,\"Padding\":2,\"Checked\":true,\"Marker\":\"LQ==\",\"Num\":-1},\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeTaskListItemMarker\",\"Data\":\"[X]\",\"TaskListItemChecked\":true,\"TaskListItemMarker\":88},{\"Type\":\"NodeText\",\"Data\":\" item1\"}]}]},{\"Type\":\"NodeListItem\",\"Data\":\"-\",\"ListData\":{\"Typ\":3,\"Tight\":true,\"BulletChar\":45,\"Padding\":2,\"Marker\":\"LQ==\",\"Num\":-1},\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeTaskListItemMarker\",\"Data\":\"[ ]\",\"TaskListItemMarker\":32},{\"Type\":\"NodeText\",\"Data\":\" item2\"}]}]},{\"Type\":\"NodeListItem\",\"Data\":\"-\",\"ListData\":{\"Typ\":3,\"Tight\":true,\"BulletChar\":45,\"Padding\":2,\"Checked\":true,\"Marker\":\"LQ==\",\"Num\":-1},\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeTaskListItemMarker\",\"Data\":\"[X]\",\"TaskListItemChecked\":true,\"TaskListItemMarker\":88},{\"Type\":\"NodeText\",\"Data\":\" item3\"}]}]}]}]}"],
  ["测试表格", "| 表头 | 标题 |\n| --- | --- |\n| item1 | item2 |\n| item3 | item4 |\n", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeTable\",\"Data\":\"| 表头 | 标题 |\\n| --- | --- |\\n| item1 | item2 |\\n| item3 | item4 |\",\"TableAligns\":[0,0],\"Children\":[{\"Type\":\"NodeTableHead\",\"Children\":[{\"Type\":\"NodeTableRow\",\"Children\":[{\"Type\":\"NodeTableCell\",\"Children\":[{\"Type\":\"NodeText\",\"Data\":\"表头\"}]},{\"Type\":\"NodeTableCell\",\"Children\":[{\"Type\":\"NodeText\",\"Data\":\"标题\"}]}]}]},{\"Type\":\"NodeTableRow\",\"TableAligns\":[0,0],\"Children\":[{\"Type\":\"NodeTableCell\",\"Children\":[{\"Type\":\"NodeText\",\"Data\":\"item1\"}]},{\"Type\":\"NodeTableCell\",\"Children\":[{\"Type\":\"NodeText\",\"Data\":\"item2\"}]}]},{\"Type\":\"NodeTableRow\",\"TableAligns\":[0,0],\"Children\":[{\"Type\":\"NodeTableCell\",\"Children\":[{\"Type\":\"NodeText\",\"Data\":\"item3\"}]},{\"Type\":\"NodeTableCell\",\"Children\":[{\"Type\":\"NodeText\",\"Data\":\"item4\"}]}]}]}]}"],
  ["测试emoji", ":cn:", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeEmoji\",\"Children\":[{\"Type\":\"NodeEmojiUnicode\",\"Data\":\"🇨🇳\",\"Children\":[{\"Type\":\"NodeEmojiAlias\",\"Data\":\":cn:\"}]}]}]}]}"],
  ["测试HTML实体符号", "&copy;", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeHTMLEntity\",\"Data\":\"©\",\"HtmlEntityTokens\":\"JmNvcHk7\"}]}]}"],
  ["测试yaml", "---\nyaml测试\n---\n", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeYamlFrontMatter\",\"Data\":\"yaml测试\",\"Children\":[{\"Type\":\"NodeYamlFrontMatterOpenMarker\"},{\"Type\":\"NodeYamlFrontMatterContent\",\"Data\":\"yaml测试\"},{\"Type\":\"NodeYamlFrontMatterCloseMarker\"}]}]}"],
  ["测试块引用", "((20200817123136-in6y5m1 \"内容块引用\"))", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeBlockRef\",\"Children\":[{\"Type\":\"NodeOpenParen\"},{\"Type\":\"NodeOpenParen\"},{\"Type\":\"NodeBlockRefID\",\"Data\":\"20200817123136-in6y5m1\"},{\"Type\":\"NodeBlockRefSpace\"},{\"Type\":\"NodeBlockRefText\",\"Data\":\"内容块引用\"},{\"Type\":\"NodeCloseParen\"},{\"Type\":\"NodeCloseParen\"}]}]}]}"],
  ["测试高亮", "==高亮==", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeMark\",\"Children\":[{\"Type\":\"NodeMark2OpenMarker\",\"Data\":\"==\"},{\"Type\":\"NodeText\",\"Data\":\"高亮\"},{\"Type\":\"NodeMark2CloseMarker\",\"Data\":\"==\"}]}]}]}"],
  ["测试上标", "^上标^", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeSup\",\"Children\":[{\"Type\":\"NodeSupOpenMarker\",\"Data\":\"^\"},{\"Type\":\"NodeText\",\"Data\":\"上标\"},{\"Type\":\"NodeSupCloseMarker\",\"Data\":\"^\"}]}]}]}"],
  ["测试下标", "~下标~", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeSub\",\"Children\":[{\"Type\":\"NodeSubOpenMarker\",\"Data\":\"~\"},{\"Type\":\"NodeText\",\"Data\":\"下标\"},{\"Type\":\"NodeSubCloseMarker\",\"Data\":\"~\"}]}]}]}"],
  ["测试内容块查询嵌入", "{{ SELECT * FROM blocks WHERE content LIKE '%待办%' }}", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeBlockQueryEmbed\",\"Data\":\"{{ SELECT * FROM blocks WHERE content LIKE '%待办%' }}\\n\",\"Children\":[{\"Type\":\"NodeOpenBrace\"},{\"Type\":\"NodeOpenBrace\"},{\"Type\":\"NodeBlockQueryEmbedScript\",\"Data\":\"SELECT * FROM blocks WHERE content LIKE '%待办%'\"},{\"Type\":\"NodeCloseBrace\"},{\"Type\":\"NodeCloseBrace\"}]}]}"],
  ["测试标签", "#标签测试#", "{\"Type\":\"NodeDocument\",\"Children\":[{\"Type\":\"NodeParagraph\",\"Children\":[{\"Type\":\"NodeTag\",\"Children\":[{\"Type\":\"NodeTagOpenMarker\",\"Data\":\"#\"},{\"Type\":\"NodeText\",\"Data\":\"标签测试\"},{\"Type\":\"NodeTagCloseMarker\",\"Data\":\"#\"}]}]}]}"],
];

const GO_TEST_SETTERS: SetterCall[] = [
  ["SetSup", true],
  ["SetSub", true],
  ["SetMark", true],
  ["SetKramdownIAL", false],
  ["SetFootnotes", true],
  ["SetBlockRef", true],
  ["SetTag", true],
  ["SetSoftBreak2HardBreak", true],
  ["SetFileAnnotationRef", true],
];

test("JSONRenderer: the Go test cases (test/json_renderer_test.go)", () => {
  const luteEngine = New();
  for (const [setter, ...args] of GO_TEST_SETTERS) {
    (luteEngine as unknown as Record<string, (...a: unknown[]) => void>)[setter](...args);
  }
  for (const [name, from, to] of JSONRendererTests) {
    assert.equal(luteEngine.RenderJSON(from), to, `test case [${name}]`);
  }
});

test("JSONRenderer: port equals oracle on the Go cases, the corpus and whole files", () => {
  const counters: Counters = newCounters();
  const sets: { name: string; setters: SetterCall[] }[] = [
    { name: "go test options", setters: GO_TEST_SETTERS },
    { name: "kramdown IAL", setters: [["SetKramdownIAL", true], ["SetKramdownBlockIAL", true], ["SetKramdownSpanIAL", true]] },
    { name: "all inline extensions", setters: [["SetSup", true], ["SetSub", true], ["SetMark", true], ["SetTag", true], ["SetBlockRef", true], ["SetFileAnnotationRef", true], ["SetInlineMath", true], ["SetSuperBlock", true], ["SetKramdownIAL", true]] },
  ];
  for (const [setIndex, set] of sets.entries()) {
    const engines = newEngines(set.setters);
    for (const [name, from] of JSONRendererTests) {
      compareMethod(engines, "RenderJSON", `${set.name} / ${name}`, from, counters);
    }
    // Quick run: the first set sees every document, the others a sample (see ../full.ts).
    for (const doc of 0 === setIndex ? JSON_DOCS : sample(JSON_DOCS, setIndex, 6)) {
      compareMethod(engines, "RenderJSON", set.name, doc, counters);
    }
  }
  const engines = newEngines(sets[2].setters);
  for (const file of ["test/case1.md", "README.md", "test/format-case0.md"]) {
    compareMethod(engines, "RenderJSON", file, readRepoFile(file), counters);
  }
  assert.ok(counters.compared > 300, `only ${counters.compared} comparisons`);
});

test("JSONRenderer: port equals oracle on every CommonMark spec case", () => {
  const cases = JSON.parse(readRepoFile("test/commonmark-spec.json")) as { section: string; example: number; markdown: string }[];
  const engines = newEngines([["SetSup", true], ["SetSub", true], ["SetMark", true], ["SetKramdownIAL", true], ["SetFootnotes", true], ["SetBlockRef", true], ["SetTag", true]]);
  const counters: Counters = newCounters();
  for (const c of cases) {
    compareMethod(engines, "RenderJSON", `spec ${c.example}`, c.markdown, counters);
  }
  assert.equal(counters.compared, 652);
});

test("JSONRenderer: unusual characters and properties", () => {
  const engines = newEngines([["SetKramdownIAL", true], ["SetKramdownBlockIAL", true]]);
  const counters: Counters = newCounters();
  const docs = [
    "a < b & c > d     \"q\" \ \t \u0001 \u007f",
    "para\n{: id=\"20201122125005-kc4sl0l\" custom-attr=\"va<lue\" refcount=\"3\" av-names=\"x\" \u{1F600}=\"emoji\" ￮=\"bmp\" a=\"b\" Z=\"cap\"}",
    "\u{1F600} emoji and 中文",
    "```\n\u0000\n```",
    "| a |\n| - |\n| b |",
    "[^1]: def\n\ntext[^1]",
  ];
  for (const doc of docs) {
    compareMethod(engines, "RenderJSON", "unusual", doc, counters);
  }
  assert.equal(counters.compared, docs.length);
});

test("JSONRenderer: option sets", () => {
  const counters: Counters = newCounters();
  for (const set of OPTION_SETS) {
    const engines = newEngines(set.setters);
    for (const doc of JSON_DOCS.slice(0, 6)) {
      compareMethod(engines, "RenderJSON", set.name, doc, counters);
    }
  }
  assert.ok(counters.compared > 300);
});

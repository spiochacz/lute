import { test } from "node:test";
import assert from "node:assert/strict";
import * as conv from "../../../src/runtime/conv.ts";
import * as ast from "../../../src/ast/index.ts";
import * as parse from "../../../src/parse/index.ts";
import { NewFormatRenderer } from "../../../src/render/format_renderer.ts";
import { FormatNodeSync } from "../../../src/index.ts";
import { assertSameOutcome, newEngines, readRepoFile } from "../helpers.ts";
import type { SetterCall } from "../helpers.ts";
import { formatBoth } from "./format_helpers.ts";

// Port of test/format_test.go. The Go tables are read from the Go source, so the cases and expected values are the same.
// Each case is checked against the expected value from Go and against the reference bundle.

const GO_STRING = String.raw`"(?:[^"\\]|\\.)*"`;
const GO_CASE_LINE = new RegExp(String.raw`^\t\{(${GO_STRING}), (${GO_STRING}), (${GO_STRING})\},`);

interface FormatTest {
  name: string;
  original: string;
  formatted: string;
}

// Reads the entries of `var <varName> = []formatTest{ ... }`.
function readTable(source: string[], varName: string): FormatTest[] {
  const start = source.findIndex((l) => l.startsWith(`var ${varName} = []formatTest{`));
  assert.ok(start >= 0, varName);
  const ret: FormatTest[] = [];
  for (let i = start + 1; i < source.length && source[i].trimEnd() !== "}"; i++) {
    const m = GO_CASE_LINE.exec(source[i]);
    if (m !== null) {
      ret.push({ name: JSON.parse(m[1]) as string, original: JSON.parse(m[2]) as string, formatted: JSON.parse(m[3]) as string });
    }
  }
  return ret;
}

const source = readRepoFile("test/format_test.go").split("\n");

function runTable(label: string, tests: FormatTest[], setters: SetterCall[]): void {
  const engines = newEngines(setters);
  const failures: string[] = [];
  for (const t of tests) {
    const { port, oracle } = formatBoth(engines, t.name, t.original);
    assert.equal(assertSameOutcome(`${label} [${t.name}]`, port, oracle), "ok");
    // The port is checked against Go's expected value, as TestFormat* do.
    if (port.value !== t.formatted) {
      failures.push(`test case [${t.name}] failed\nexpected\n\t${JSON.stringify(t.formatted)}\ngot\n\t${JSON.stringify(port.value)}`);
    }
  }
  assert.deepEqual(failures, [], label);
}

test("TestFormat", () => {
  const tests = readTable(source, "formatTests");
  assert.equal(tests.length, 54);
  runTable("formatTests", tests, [["SetAutoSpace", true]]);
});

test("TestFormatArbitraryTaskListItemMarker", () => {
  const tests = readTable(source, "formatArbitraryTaskListItemMarkerTests");
  assert.equal(tests.length, 3);
  runTable("formatArbitraryTaskListItemMarkerTests", tests, [["SetAutoSpace", true], ["SetArbitraryTaskListItemMarker", true]]);
});

test("TestFormatUnorderedListMarker", () => {
  const tests = readTable(source, "formatUnorderedListMarkerTests");
  assert.equal(tests.length, 1);
  runTable("formatUnorderedListMarkerTests", tests, [["SetUnorderedListMarker", "-"]]);
});

test("TestFormatCases", () => {
  const engines = newEngines([["SetAutoSpace", true]]);
  for (let i = 0; i < 8; i++) {
    const caseName = `test/format-case${i}`;
    // The working tree may have CRLF line terminators (core.autocrlf); the Go repository stores LF.
    const original = readRepoFile(caseName + ".md").replaceAll("\r\n", "\n");
    const expected = readRepoFile(caseName + "-formatted.md").replaceAll("\r\n", "\n");
    const { port, oracle } = formatBoth(engines, caseName + ".md", original);
    assert.equal(assertSameOutcome(caseName, port, oracle), "ok");
    assert.equal(port.value, expected, `test case [${caseName}] failed`);
    // Idempotence: formatting the formatted output again gives the same result on both sides.
    const again = formatBoth(engines, caseName + ".md", expected);
    assert.equal(assertSameOutcome(caseName + " again", again.port, again.oracle), "ok");
  }
});

// TestFormatNodeSync (test/format_test.go)
test("TestFormatNodeSync", () => {
  const md = "foo中文bar";
  const engines = newEngines([["SetAutoSpace", true]]);
  const lute = engines.port;
  const tree = parse.Parse("", conv.BytesFromString(md), lute.ParseOptions);
  const output = conv.StringFromBytes(NewFormatRenderer(tree, lute.RenderOptions, lute.ParseOptions).Render());
  assert.equal(output, "foo 中文 bar\n");
  assert.equal(engines.oracle.FormatStr("", md), "foo 中文 bar\n");
});

// TestFormatTaskListHTMLBlock: no empty paragraph before an HTML block in a task list item after auto space https://github.com/siyuan-note/siyuan/issues/19182
test("TestFormatTaskListHTMLBlock", () => {
  const engines = newEngines([["SetProtyleWYSIWYG", true], ["SetKramdownIAL", true], ["SetEnsureListItemParagraph", true]]);
  const lute = engines.port;
  let tree = parse.Parse("", conv.BytesFromString("> - [ ] <div>\n>   Hello\n>   </div>\n"), lute.ParseOptions);
  for (let i = 0; i < 2; i++) {
    if (1 === i) {
      lute.SetAutoSpace(true);
    }
    const formatted = NewFormatRenderer(tree, lute.RenderOptions, lute.ParseOptions).Render();
    tree = parse.Parse("", formatted, lute.ParseOptions);

    const blockquote = tree.Root!.ChildByType(ast.NodeBlockquote);
    assert.ok(blockquote !== null, `format pass ${i + 1}: blockquote not found`);
    const list = blockquote.ChildByType(ast.NodeList);
    assert.ok(list !== null, `format pass ${i + 1}: list not found`);
    const listItem = list.ChildByType(ast.NodeListItem);
    assert.ok(listItem !== null && listItem.FirstChild !== null, `format pass ${i + 1}: list item content not found`);
    assert.equal(listItem.FirstChild.Type, ast.NodeTaskListItemMarker, `format pass ${i + 1}: first list item child`);
    assert.ok(listItem.FirstChild.Next !== null && listItem.FirstChild.Next.Type === ast.NodeHTMLBlock, `format pass ${i + 1}: HTML block does not immediately follow the task marker`);
  }
});

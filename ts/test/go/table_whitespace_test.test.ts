// Port of test/table_whitespace_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";

test("TestVditorTableInlineWhitespaceRoundTrip", () => {
  const luteEngine = New();
  const markdown = "| a *em* b **strong** c `code` d [link](https://example.com) e ~~del~~ f |\n| --- |\n| x |\n";
  const expected = "| a *em* b **strong** c `code` d [link](https://example.com) e ~~del~~ f |";
  const tests: { name: string; roundTrip: (markdown: string) => string }[] = [
    { name: "wysiwyg", roundTrip: (md) => luteEngine.VditorDOM2Md(luteEngine.Md2VditorDOM(md)) },
    { name: "ir", roundTrip: (md) => luteEngine.VditorIRDOM2Md(luteEngine.Md2VditorIRDOM(md)) },
  ];
  for (const t of tests) {
    // strings.SplitN(s, "\n", 2)[0]
    const actual = t.roundTrip(markdown).split("\n")[0];
    assert.equal(actual, expected, `test case [${t.name}] failed`);
  }
});

test("TestHTML2MdTableInlineWhitespace", () => {
  const luteEngine = New();
  const html = "<table>\n<thead><tr><th>\n a <em>em</em> b <strong>strong</strong> c <code>code</code> d " +
    "<a href=\"https://example.com\">link</a> e <del>del</del> f \n</th></tr></thead>\n" +
    "<tbody><tr><td>x</td></tr></tbody>\n</table>";
  const expected = "| a *em* b **strong** c `code` d [link](https://example.com) e ~~del~~ f |";
  const actual = luteEngine.HTML2Md(html).split("\n")[0];
  assert.equal(actual, expected);
});

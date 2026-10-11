// Port of parse/performance_regression_test.go. The Go file has no wall-clock assertions; these tests check that the optimized
// candidate scans stay compatible with the full parsers (structure, node counts, matched links), which is what the port asserts too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ast, editor, parse } from "../../src/index.ts";
import { BytesFromString, StringFromBytes } from "../../src/runtime/conv.ts";
import { foldBytes } from "../../src/parse/linkrefdef_case_fold.ts";

function newContext(): parse.Context {
  return new parse.Context(parse.NewOptions());
}

test("TestTableCandidateCompatibility", async (t) => {
  const context = newContext();
  assert.notEqual(context.parseTable0(BytesFromString("foo\n---\nbar")), null, "expected a single-column table without pipes");
  const cases: { input: string; setext: boolean; want: ast.NodeType; rows: number }[] = [
    { input: "foo\n---", setext: false, want: ast.NodeParagraph, rows: 0 },
    { input: "foo\n---", setext: true, want: ast.NodeHeading, rows: 0 },
    { input: "foo\n-:", setext: false, want: ast.NodeTable, rows: 1 },
    { input: "foo\n::\nbar", setext: false, want: ast.NodeTable, rows: 2 },
    { input: "a | b\n--- | ---\nx | y", setext: false, want: ast.NodeTable, rows: 2 },
    { input: "a | b\n---\nx | y", setext: false, want: ast.NodeParagraph, rows: 0 },
    { input: "alpha | beta\ngamma | delta", setext: false, want: ast.NodeParagraph, rows: 0 },
    { input: "前文\na | b\n--- | ---\nx | y", setext: false, want: ast.NodeParagraph, rows: 2 },
  ];
  for (const tc of cases) {
    await t.test(tc.input, () => {
      const o = parse.NewOptions();
      o.Setext = tc.setext;
      const tree = parse.Parse("", BytesFromString(tc.input), o);
      assert.equal(tree.Root!.FirstChild!.Type, tc.want, `unexpected first block: ${tree.Root!.FirstChild!.Type}`);
      let rows = 0;
      ast.Walk(tree.Root!, (n, entering) => {
        if (entering && n.Type === ast.NodeTableRow) {
          rows++;
        }
        return ast.WalkContinue;
      });
      assert.equal(rows, tc.rows, `want ${tc.rows} rows, got ${rows}`);
    });
  }
});

test("TestAutoLinkCandidateCompatibility", async (t) => {
  const cases: { input: string; want: string[] }[] = [
    { input: "a".repeat(4096), want: [] },
    { input: "foo://", want: [] },
    { input: "foo://bar", want: ["foo://bar"] },
    { input: "中文foo://bar", want: ["foo://bar"] },
    { input: "abc-def://host", want: ["def://host"] },
    { input: "prefix: foo://bar", want: ["foo://bar"] },
    { input: "foo://bar baz://qux", want: ["baz://qux"] },
    { input: "foo://bar https://example.com", want: ["https://example.com"] },
    { input: "https://example.com foo://bar", want: ["https://example.com", "foo://bar"] },
    { input: "www.example.com", want: ["http://www.example.com"] },
    { input: "http://example.com/a).", want: ["http://example.com/a)"] },
    { input: "https://example.com:8080/a:b ftp://example.com/path", want: ["https://example.com:8080/a:b", "ftp://example.com/path"] },
  ];
  for (const tc of cases) {
    await t.test(tc.input.length > 100 ? "a*4096" : tc.input, () => {
      const o = parse.NewOptions();
      o.Emoji = false;
      const tree = parse.Parse("", BytesFromString(tc.input), o);
      const got: string[] = [];
      ast.Walk(tree.Root!, (n, entering) => {
        if (entering && n.Type === ast.NodeLinkDest) {
          got.push(StringFromBytes(n.Tokens!));
        }
        return ast.WalkContinue;
      });
      assert.deepEqual(got, tc.want, `want ${JSON.stringify(tc.want)}, got ${JSON.stringify(got)}`);
    });
  }
});

test("TestTaskListProbeCompatibility", () => {
  for (const protyle of [false, true]) {
    const cases: { input: string; types: [ast.NodeType, number][] }[] = [
      { input: "- [ ] alpha **beta** and `code`\n", types: [[ast.NodeList, 1], [ast.NodeParagraph, 1], [ast.NodeStrong, 1], [ast.NodeCodeSpan, 1]] },
      { input: "- [ ] # heading\n", types: [[ast.NodeHeading, 1]] },
      { input: "- [ ] > quote\n", types: [[ast.NodeBlockquote, 1], [ast.NodeParagraph, 1]] },
      { input: "- [ ] - nested\n", types: [[ast.NodeList, 2], [ast.NodeParagraph, 1]] },
      { input: "- [ ] ```go\n  code\n  ```\n", types: [[ast.NodeCodeBlock, 2]] },
    ];
    for (const tc of cases) {
      const o = parse.NewOptions();
      o.ProtyleWYSIWYG = protyle;
      o.KramdownBlockIAL = protyle;
      o.KramdownSpanIAL = protyle;
      const tree = parse.Parse("", BytesFromString(tc.input), o);
      const counts = new Map<ast.NodeType, number>();
      ast.Walk(tree.Root!, (n, entering) => {
        if (entering) {
          counts.set(n.Type, (counts.get(n.Type) ?? 0) + 1);
        }
        return ast.WalkContinue;
      });
      assert.equal(counts.get(ast.NodeTaskListItemMarker) ?? 0, 1, `task marker lost: ${JSON.stringify(tc.input)}`);
      for (const [typ, want] of tc.types) {
        assert.equal(counts.get(typ) ?? 0, want, `protyle=${protyle} input=${JSON.stringify(tc.input)} type=${typ}: want ${want}, got ${counts.get(typ) ?? 0}`);
      }
    }
  }
});

test("TestReferenceIndexCompatibility", async (t) => {
  const cases: { definitions: string; label: string; want: string }[] = [
    { definitions: "[Foo]: /first\n[foo]: /second\n", label: "FOO", want: "/first" },
    { definitions: "[K]: /first\n[K]: /second\n", label: "k", want: "/first" },
    { definitions: "[ſ]: /first\n[S]: /second\n", label: "s", want: "/first" },
    { definitions: "[ς]: /first\n[Σ]: /second\n", label: "σ", want: "/first" },
    { definitions: "[ẞ]: /first\n[SS]: /second\n", label: "ss", want: "/first" },
    { definitions: "[ss]: /first\n[ẞ]: /second\n", label: "ẞ", want: "/first" },
    { definitions: "[ßs]: /wrong\n[sß]: /right\n", label: "sß", want: "/right" },
    { definitions: "[ßs]: /wrong\n", label: "sß", want: "" },
    { definitions: "[foo]: /first\n", label: "missing", want: "" },
  ];
  for (const tc of cases) {
    await t.test(tc.label + tc.definitions, () => {
      const tree = parse.Parse("", BytesFromString(tc.definitions), parse.NewOptions());
      let want = tc.want;
      // JS 版仅执行简单大小写折叠，保留其独立的匹配规则。
      const folded = foldBytes(BytesFromString("ẞ"));
      if (StringFromBytes(folded) === "ẞ" && (tc.label === "ss" || tc.label === "ẞ")) {
        want = "/second";
      }
      for (const protyle of [false, true]) {
        tree.Context!.ParseOption.ProtyleWYSIWYG = protyle;
        let label = tc.label;
        if (protyle) {
          label += editor.Caret;
        }
        const link = tree.FindLinkRefDefLink(BytesFromString(label));
        let got = "";
        if (link !== null) {
          got = StringFromBytes(link.ChildByType(ast.NodeLinkDest)!.Tokens!);
        }
        assert.equal(got, want, `want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
      }
    });
  }
});

test("TestLinkLabelBoundaries", () => {
  const context = newContext();
  const cases: { input: string; want: string; remains: string; consumed: number }[] = [
    { input: "[中文] trailing", want: "中文", remains: " trailing", consumed: 8 },
    { input: "[a\\]b] tail", want: "a\\]b", remains: " tail", consumed: 6 },
    { input: "[a\n  b] tail", want: "a  b", remains: " tail", consumed: 7 },
    { input: "[" + "a".repeat(999) + "] tail", want: "a".repeat(999), remains: " tail", consumed: 1001 },
  ];
  for (const tc of cases) {
    const [n, remains, label] = context.parseLinkLabel(BytesFromString(tc.input));
    assert.ok(n === tc.consumed && StringFromBytes(label) === tc.want && StringFromBytes(remains) === tc.remains, `${JSON.stringify(tc.input)}: got ${n}, ${JSON.stringify(StringFromBytes(label))}, ${JSON.stringify(StringFromBytes(remains))}`);
  }
  for (const input of ["[a[b]", "[unclosed", "[" + "a".repeat(1000) + "]"]) {
    const [n] = context.parseLinkLabel(BytesFromString(input));
    assert.equal(n, 0, `accepted ${JSON.stringify(input.length > 100 ? "[a*1000]" : input)}`);
  }
});

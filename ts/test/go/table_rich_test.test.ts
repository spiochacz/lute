// Port of test/table_rich_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, ast, parse, render } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import { BytesFromString, StringFromBytes } from "../../src/runtime/conv.ts";

function newTableRichLute(): Lute {
  const ret = New();
  ret.ParseOptions = parse.TableCellRichOptions();
  ret.ParseOptions.DisableTableCellRich = false;
  ret.RenderOptions.ProtyleWYSIWYG = true;
  ret.SetKramdownIAL(true);
  ret.SetTextMark(true);
  return ret;
}

function firstRichCell(tree: parse.Tree): ast.Node | null {
  let ret: ast.Node | null = null;
  ast.Walk(tree.Root!, (n, entering) => {
    if (entering && n.TableCellRich != null) {
      ret = n;
      return ast.WalkStop;
    }
    return ast.WalkContinue;
  });
  return ret;
}

function newRich(spec: number, format: string, content: string): ast.TableCellRich {
  const r = new ast.TableCellRich();
  r.Spec = spec;
  r.Format = format;
  r.Content = content;
  return r;
}

test("TestTableRichRoundTrip", async (t) => {
  const engine = newTableRichLute();
  const sources = [
    "- first\n- **second**",
    "# title\n\n> quote\n\n```go\nfmt.Println(\"a|b\")\n```\n\n$$\nx^2\n$$",
    "- [ ] task\n  - nested\n\n![image](assets/picture.png)\n\n((20260101000000-abcdefg 'reference'))",
    "literal \\*marker\\* and `a|b`\n\nnext paragraph",
    `<span data-type="text">font</span>{: style="font-family: var(--b3-font-family-emoji-reset), 'A&#92;&#92;B &gt; C', var(--b3-font-family-editor), var(--b3-font-family);"}`,
    `<span data-type="code">&lt;span data-type="text"&gt;font&lt;/span&gt;{: style="color: var(--b3-font-color1);"}</span>`,
    "",
  ];
  for (const source of sources) {
    await t.test(source === "" ? "(empty)" : source, () => {
      const tree = parse.Parse("", BytesFromString("| title |\n| --- |\n| old |"), engine.ParseOptions);
      const cell = tree.Root!.FirstChild!.LastChild!.FirstChild!;
      cell.TableCellRich = newRich(1, "kramdown", source);
      cell.SetIALAttr("style", "color: red;");
      const err = parse.ApplyTableCellRichProjection(cell);
      assert.equal(err, null);
      let dom = engine.Tree2BlockDOM(tree, engine.RenderOptions, engine.ParseOptions);
      for (let iteration = 0; iteration < 3; iteration++) {
        dom = engine.SpinBlockDOM(dom);
        const read = firstRichCell(engine.BlockDOM2Tree(dom)!);
        assert.ok(!(read === null || read.TableCellRich!.Content !== source || read.IALAttr("style") !== "color: red;"), `round trip lost source or cell style: ${dom}`);
        ast.Walk(read, (n, entering) => {
          if (entering && n.IsBlock()) {
            assert.fail(`cell projection contains a block: ${n.Type}`);
          }
          return ast.WalkContinue;
        });
      }
      const md = engine.BlockDOM2StdMd(dom);
      assert.ok(!(md.includes(ast.TableCellRichIAL) || md.includes(ast.TableCellRichAttribute)), `standard Markdown leaked internal metadata: ${md}`);
      const jsonData = StringFromBytes(render.NewJSONRenderer(engine.BlockDOM2Tree(dom)!, engine.RenderOptions, engine.ParseOptions).Render());
      assert.ok(jsonData.includes('"TableCellRich"'), `JSON dropped rich source: ${jsonData}`);
    });
  }
});

test("TestTableRichClipboardAndMergedExport", () => {
  const engine = newTableRichLute();
  const tree = parse.Parse("", BytesFromString("| first | second |\n| --- | --- |\n| old | hidden |"), engine.ParseOptions);
  const cell = tree.Root!.FirstChild!.LastChild!.FirstChild!;
  cell.TableCellRich = newRich(1, "kramdown", "- first\n- second\n\n```text\na | b\nc\n```");
  cell.SetIALAttr("colspan", "2");
  cell.Next!.SetIALAttr("class", "fn__none");
  const err = parse.ApplyTableCellRichProjection(cell);
  assert.equal(err, null);
  const dom = engine.Tree2BlockDOM(tree, engine.RenderOptions, engine.ParseOptions);
  const clipboard = engine.HTML2BlockDOM(dom);
  const restored = firstRichCell(engine.BlockDOM2Tree(clipboard)!);
  assert.ok(!(restored === null || restored.TableCellRich!.Content !== cell.TableCellRich.Content || restored.IALAttr("colspan") !== "2"), `HTML clipboard lost merged rich cell: ${clipboard}`);
  const markdown = engine.BlockDOM2StdMd(dom);
  assert.ok(!(!markdown.includes("first") || !markdown.includes("<code>a &#124; b<br />c</code>") || markdown.includes("table-cell-rich") || markdown.includes("<ul>")), `merged Markdown export did not use its readable inline projection: ${markdown}`);
  const html = engine.BlockDOM2RichHTML(dom);
  assert.ok(!(!html.includes("<ul>") || !html.includes("<code") || html.includes("data-sy-table-cell-rich")), `HTML export lost the fragment structure: ${html}`);
});

test("TestTableRichPreservesInvalidEmptyMetadata", () => {
  const engine = newTableRichLute();
  let dom = `<div data-type="NodeTable"><div contenteditable="true"><table><thead><tr><th data-sy-table-cell-rich="">preserve</th></tr></thead></table></div></div>`;
  for (let iteration = 0; iteration < 3; iteration++) {
    dom = engine.SpinBlockDOM(dom);
    const cell = firstRichCell(engine.BlockDOM2Tree(dom)!);
    assert.ok(!(cell === null || cell.TableCellRich!.Validate() === null), `corrupt metadata was silently discarded: ${dom}`);
  }
});

test("TestTableRichCodeProjectionEscapesMarkup", () => {
  const engine = newTableRichLute();
  const tree = parse.Parse("", BytesFromString("| title |\n| --- |\n| value |"), engine.ParseOptions);
  const cell = tree.Root!.FirstChild!.LastChild!.FirstChild!;
  cell.TableCellRich = newRich(1, "kramdown", "```html\n<script>alert(1)</script>\na | b & c\n```");
  const err = parse.ApplyTableCellRichProjection(cell);
  assert.equal(err, null);
  const dom = engine.Tree2BlockDOM(tree, engine.RenderOptions, engine.ParseOptions);
  const inline = engine.BlockDOM2InlineBlockDOM(dom);
  const markdown = engine.BlockDOM2StdMd(dom);
  const outputs: Record<string, string> = { preview: dom, "inline conversion": inline, Markdown: markdown };
  for (const [name, output] of Object.entries(outputs)) {
    assert.ok(!(output.includes("<script>") || !output.includes("&lt;script&gt;")), `${name} interpreted literal code as markup: ${output}`);
  }
  assert.ok(!(!markdown.includes("a &#124; b &amp; c</code>") || markdown.includes("\na |")), `code content broke its Markdown table cell: ${markdown}`);
});

test("TestTableRichDoesNotReinterpretLegacyCells", () => {
  const engine = newTableRichLute();
  const dom = engine.Md2BlockDOM("| title |\n| --- |\n| - literal<br />1. literal |", false);
  assert.equal(firstRichCell(engine.BlockDOM2Tree(engine.SpinBlockDOM(dom))!), null, "legacy cell was implicitly converted");
  assert.ok(!(dom.includes("<ul>") || dom.includes("<ol>")), "legacy text became a list");
});

test("TestTableRichRejectsUnsupportedPayloads", () => {
  // Go's "invalid\xfftext" holds an invalid UTF-8 byte; the port's strings are UTF-16, where the equivalent invalid text is an unpaired surrogate.
  const riches = [
    newRich(2, "kramdown", "preserve"),
    newRich(1, "future", "preserve"),
    newRich(1, "kramdown", "| nested |\n| --- |\n| table |"),
    newRich(1, "kramdown", "```mermaid\ngraph LR\n```"),
    ast.DecodeTableCellRich("invalid%payload"),
    newRich(1, "kramdown", "invalid\ud800text"),
  ];
  for (const rich of riches) {
    const before = rich.Encode();
    const [, err] = parse.ParseTableCellRich(rich);
    assert.ok(err !== null, `accepted unsupported source: ${JSON.stringify(rich)}`);
    assert.equal(rich.Encode(), before, "validation changed the original payload");
  }
});

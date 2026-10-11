import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as conv from "../runtime/conv.ts";
import * as bytes from "../runtime/bytes.ts";
import * as ast from "../ast/index.ts";
import * as parse from "../parse/index.ts";
import * as render from "./index.ts";
import { New } from "../index.ts";
import { NewProtyleExportRenderer } from "./protyle_export_renderer.ts";

// Ported from test/protyle_export_html_table_footnotes_test.go.
test("TestProtyleExportHTMLTableInFootnotes", () => {
  const luteEngine = New();
  luteEngine.SetFootnotes(true);
  luteEngine.SetKramdownIAL(true);
  luteEngine.SetProtyleWYSIWYG(true);

  const tree = parse.Parse("", conv.BytesFromString("foo[^1]\n\n[^1]: bar\n\n[^2]: baz\n"), luteEngine.ParseOptions);
  const defBlock = tree.Root!.ChildByType(ast.NodeFootnotesDefBlock);
  if (null === defBlock || null === defBlock.FirstChild || null === defBlock.FirstChild.Next) {
    assert.fail("expected two footnotes definitions");
  }
  const firstDef = defBlock.FirstChild;
  const secondDef = defBlock.FirstChild.Next;

  const table = new ast.Node(ast.NodeTable);
  table.SetIALAttr("id", "20260724130222-z0ruwey");
  const head = new ast.Node(ast.NodeTableHead);
  const row = new ast.Node(ast.NodeTableRow);
  const cell = new ast.Node(ast.NodeTableCell);
  cell.SetIALAttr("colspan", "2");
  cell.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString("merged ")));
  const ref = new ast.Node(ast.NodeFootnotesRef, conv.BytesFromString("^2"));
  ref.FootnotesRefId = "2";
  ref.FootnotesRefLabel = conv.BytesFromString("^2");
  cell.AppendChild(ref);
  row.AppendChild(cell);
  head.AppendChild(row);
  table.AppendChild(head);
  firstDef.AppendChild(table);

  const renderer = NewProtyleExportRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions);
  const output = renderer.Render();
  const expectedRef = conv.BytesFromString('<sup class="footnotes-ref" id="footnotes-ref-2"><a href="#footnotes-def-2">2</a></sup>');
  assert.ok(bytes.Contains(output, expectedRef), "expected rendered footnotes reference in " + conv.StringFromBytes(output));
  assert.ok(defBlock === tree.Root!.ChildByType(ast.NodeFootnotesDefBlock) && tree.Root === defBlock.Parent, "footnotes definition block should remain on the document root");
  assert.ok(firstDef === defBlock.FirstChild && secondDef === firstDef.Next && secondDef === defBlock.LastChild && null === secondDef.Next, "footnotes definitions should retain their order");
  assert.ok(firstDef === table.Parent && null === table.ChildByType(ast.NodeFootnotesDefBlock), "table should not retain a temporary footnotes definition block");
});

// Ported from test/p2h_test.go. TestBlockDOM2HTML is the table of the Go test (read from the cases file of test/e2e/root/protyle_go.test.ts);
// both Go tests exercise HtmlRenderer through Lute.BlockDOM2Tree, not the export renderers of this file.
test("TestBlockDOM2HTML", () => {
  const data: { tests: { test: string; cases: [name: string, from: string, to: string][] }[] } = JSON.parse(
    readFileSync(new URL("../../test/e2e/root/protyle_go_cases.json", import.meta.url), "utf8"),
  );
  const table = data.tests.find((t) => t.test === "TestBlockDOM2HTML")!.cases;
  assert.equal(table.length, 4);

  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetToC(true);
  luteEngine.ParseOptions.BlockRef = true;
  luteEngine.ParseOptions.KramdownBlockIAL = true;
  luteEngine.RenderOptions.KramdownBlockIAL = true;
  luteEngine.ParseOptions.Tag = true;
  luteEngine.ParseOptions.SuperBlock = true;
  luteEngine.ParseOptions.GitConflict = true;
  luteEngine.ParseOptions.LinkRef = false;
  luteEngine.SetAutoSpace(true);
  luteEngine.SetParagraphBeginningSpace(true);
  luteEngine.SetFileAnnotationRef(true);
  luteEngine.SetImgPathAllowSpace(true);
  luteEngine.SetSanitize(true);
  luteEngine.SetTextMark(true);
  luteEngine.SetTag(true);
  luteEngine.SetTextMark(true);
  luteEngine.SetHTMLTag2TextMark(true);
  luteEngine.SetSub(true);
  luteEngine.SetSup(true);
  luteEngine.SetMark(true);

  ast.SetTesting(true);
  try {
    for (const [name, from, to] of table) {
      assert.equal(luteEngine.BlockDOM2HTML(from), to, `test case [${name}] failed, original ${JSON.stringify(from)}`);
    }
  } finally {
    ast.SetTesting(false);
  }
});

test("TestBlockDOM2RichHTML", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetKramdownIAL(true);
  luteEngine.SetTextMark(true);

  const blockDOM =
    '<div data-node-id="20240101000000-abcdefg" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="false">foo <span data-type="strong em">bar</span> <span data-type="a strong" data-href="https://b3log.org" data-title="B3log">baz</span></div><div class="protyle-attr" contenteditable="false">​</div></div>';
  const expected = '<p id="20240101000000-abcdefg">foo <strong><em>bar</em></strong> <a href="https://b3log.org" title="B3log"><strong>baz</strong></a></p>\n';
  assert.equal(luteEngine.BlockDOM2RichHTML(blockDOM), expected);

  // The same through the tree that BlockDOM2Tree builds, rendered with HtmlRenderer as BlockDOM2RichHTML does.
  const tree = luteEngine.BlockDOM2Tree(blockDOM)!;
  const renderer = render.NewHtmlRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions);
  renderer.SetTextMarkStandardTag();
  assert.equal(conv.StringFromBytes(renderer.Render()), expected);
});

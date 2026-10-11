// Port of test/table_alignment_style_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, parse, render } from "../../src/index.ts";
import { BytesFromString, StringFromBytes } from "../../src/runtime/conv.ts";

test("TestTableCellAlignmentUsesInlineStyle", () => {
  const engine = New();
  engine.SetProtyleWYSIWYG(true);
  engine.SetKramdownIAL(true);
  const legacy = `| Header | Other |` + "\n" + `| :---: | ---: |` + "\n" + `| value | next |`;
  const dom = engine.Md2BlockDOM(legacy, false);
  assert.ok(!(dom.includes(` align="`) || !dom.includes(`text-align: center`) || !dom.includes(`text-align: right`)), `legacy Markdown alignment was not rendered as inline style: ${dom}`);
  const outputs: Record<string, string> = {
    HTML: engine.BlockDOM2RichHTML(dom),
    Word: StringFromBytes(render.NewProtyleExportDocxRenderer(engine.BlockDOM2Tree(dom)!, engine.RenderOptions, engine.ParseOptions).Render()),
  };
  for (const [name, output] of Object.entries(outputs)) {
    assert.ok(!(output.includes(` align="`) || !output.includes(`text-align: center`) || !output.includes(`text-align: right`)), `${name} lost inline alignment: ${output}`);
  }
});

test("TestStandardMarkdownTableOmitsCellAttributes", () => {
  const engine = New();
  engine.SetProtyleWYSIWYG(true);
  engine.SetKramdownIAL(true);
  const dom = `<div data-type="NodeTable"><div contenteditable="true"><table><thead><tr>` +
    `<th style="text-align: left;">Header</th><th style="text-align: right;">Other</th>` +
    `</tr></thead><tbody><tr><td style="text-align: center; background-color: red;"><strong>value</strong></td>` +
    `<td style="text-align: right;">next</td></tr></tbody></table></div></div>`;
  const markdown = engine.BlockDOM2StdMd(dom);
  for (const unwanted of ["{: ", "style=", "text-align", "background-color"]) {
    assert.ok(!markdown.includes(unwanted), `standard Markdown contains cell attributes ${JSON.stringify(unwanted)}: ${markdown}`);
  }
  for (const expected of ["Header", "Other", "**value**", "next", "| :", ": |"]) {
    assert.ok(markdown.includes(expected), `standard Markdown lost content or column alignment ${JSON.stringify(expected)}: ${markdown}`);
  }
  const saved = engine.BlockDOM2Md(dom);
  assert.ok(saved.includes("background-color: red;"), `internal Markdown lost cell styles: ${saved}`);
});

test("TestTableCellInlineStyleOverridesLegacyAlign", () => {
  const engine = New();
  engine.SetProtyleWYSIWYG(true);
  engine.SetKramdownIAL(true);
  const dom = `<div data-type="NodeTable"><div contenteditable="true"><table><thead><tr>` +
    `<th align="left" style="background-color: red; text-align: right;">Header</th>` +
    `</tr></thead><tbody><tr><td align="center" style="vertical-align: middle;">value</td></tr>` +
    `</tbody></table></div></div>`;
  const tree = engine.BlockDOM2Tree(dom)!;
  const head = tree.Root!.FirstChild!.FirstChild!.FirstChild!.FirstChild!;
  assert.equal(head.TableCellAlign, 3, `inline style did not override legacy align: ${head.TableCellAlign}`);
  const output = StringFromBytes(render.NewProtyleExportDocxRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render());
  const body = head.Parent!.Parent!.Next!.FirstChild!;
  assert.equal(body.IALAttr("style"), "vertical-align: middle;", "rendering changed the source cell style");
  for (const expected of [`background-color: red`, `text-align: right`, `vertical-align: middle`, `text-align: center`]) {
    assert.ok(output.includes(expected), `Word output omitted ${JSON.stringify(expected)}: ${output}`);
  }
  assert.ok(!output.includes(` align="`), `Word output retained a legacy align attribute: ${output}`);
  const markdown = engine.BlockDOM2Md(dom);
  const roundTrip = engine.Md2BlockDOM(markdown, false);
  assert.ok(roundTrip.includes(`text-align: right`) && roundTrip.includes(`vertical-align: middle`), `cell styles were lost during Markdown round trip: ${markdown}`);
});

test("TestHTMLTableCellAlignmentDifferencesSurviveMarkdown", () => {
  const engine = New();
  const input = `<table><thead><tr><th style="text-align: center">Header</th><th>Other</th></tr></thead>` +
    `<tbody><tr><td style="text-align: right">different</td><td>same</td></tr></tbody></table>`;
  const [markdown, err] = engine.HTML2Markdown(input);
  assert.equal(err, null);
  assert.ok(markdown.includes(`text-align: right;`) && markdown.includes(`| :-`), `per-cell alignment or column delimiter was lost: ${markdown}`);
  const dom = engine.Md2BlockDOM(markdown, false);
  assert.ok(dom.includes(`text-align: right;`) && dom.includes(`text-align: center;`), `per-cell alignment was lost after Markdown parsing: ${dom}`);
});

test("TestLegacyTableCellAlignmentSurvivesMarkdownExport", () => {
  const engine = New();
  engine.SetProtyleWYSIWYG(true);
  engine.SetKramdownIAL(true);
  const tree = parse.Parse("", BytesFromString("| Header |\n| :---: |\n| value |\n"), engine.ParseOptions);
  const table = tree.Root!.FirstChild!;
  const cell = table.FirstChild!.Next!.FirstChild!;
  cell.TableCellAlign = 3;
  const markdown = StringFromBytes(render.NewProtyleExportMdRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render());
  assert.ok(markdown.includes("text-align: right;"), `legacy per-cell alignment was lost: ${markdown}`);
  const roundTrip = parse.Parse("", BytesFromString(markdown), engine.ParseOptions);
  const got = roundTrip.Root!.FirstChild!.FirstChild!.Next!.FirstChild!.TableCellAlign;
  assert.equal(got, 3, `legacy per-cell alignment changed after export: ${got}`);
});

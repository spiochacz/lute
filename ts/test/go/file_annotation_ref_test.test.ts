// Port of test/file_annotation_ref_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, ast, html, parse } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("file_annotation_ref_test");
const enc = new TextEncoder();

test("TestFileAnnotationRefPaths", () => {
  const l = New();
  l.SetFileAnnotationRef(true);
  l.SetTextMark(true);
  l.SetProtyleWYSIWYG(true);
  for (const reference of [
    "assets/a.pdf/20210911230820-lhiaysx",
    "assets/document.pdf/20210911230820-lhiaysx",
    "assets/文档 空格.PDF/20210911230820-lhiaysx",
    "assets/folder/a%20b.pdf/20210911230820-lhiaysx",
    "assets/document-20210911230735-pzlpdtf.pdf/20210911230820-lhiaysx",
    "assets/document.pdf/20210911230820-lhiaysx?box=20210911230735-pzlpdtf&dataPath=/docs/a.sy",
    "assets/document.pdf/20210911230820-lhiaysx?dataPath=%2Fdocs%2Fa%20b.sy#view",
    "assets/a&copy;.pdf/20210911230820-lhiaysx?dataPath=/a.sy&copy;=yes",
  ]) {
    for (const anchor of ["", ` ""`, ` "a"`, ` "<anchor>"`, ` "a \\"quote\\""`]) {
      const markdown = "<<" + reference + anchor + ">>";
      const tree = parse.Parse("", enc.encode(markdown), l.ParseOptions);
      const node = tree.Root!.FirstChild!.FirstChild!;
      assert.ok(
        node.Type === ast.NodeFileAnnotationRef && node.ChildByType(ast.NodeFileAnnotationRefID)!.TokensStr() === reference,
        `${reference}: reference was not parsed intact: ${JSON.stringify(markdown)}`,
      );
      if (anchor === ` "a"`) {
        const dom = l.Md2BlockDOM(markdown, false);
        assert.ok(dom.includes(`data-id="` + html.EscapeHTMLStr(reference) + `"`), `reference missing from DOM: ${dom}`);
        const got = l.BlockDOM2StdMd(dom).trim();
        assert.equal(got, markdown, "round trip");
      }
    }
  }
});

test("TestFileAnnotationRefInvalid", () => {
  const l = New();
  l.SetFileAnnotationRef(true);
  for (const reference of [
    "a.pdf/20210911230820-lhiaysx",
    "https://example.com/a.pdf/20210911230820-lhiaysx",
    "assets/a.txt/20210911230820-lhiaysx",
    "assets/a.pdf/20210911230820-lhiays",
    "assets/a.pdf/20210911230820-lhiays_",
    "assets/a.pdf/20210911230820-LHIAYSX",
    "assets/a.pdf/20210911230820-lhiaysx/extra",
    "assets/../a.pdf/20210911230820-lhiaysx",
    "assets//a.pdf/20210911230820-lhiaysx",
    "assets/<a>.pdf/20210911230820-lhiaysx",
  ]) {
    const markdown = "<<" + reference + ` "anchor">>`;
    const tree = parse.Parse("", enc.encode(markdown), l.ParseOptions);
    ast.Walk(tree.Root!, (n, entering) => {
      assert.ok(!(entering && n.Type === ast.NodeFileAnnotationRef), `invalid reference parsed: ${JSON.stringify(markdown)}`);
      return ast.WalkContinue;
    });
  }
  for (const markdown of ["<<", `<<assets/a.pdf/20210911230820-lhiaysx "unterminated`, `<<assets/a.pdf/20210911230820-lhiaysx "a">`]) {
    const got = l.MarkdownStr("", markdown);
    assert.ok(got.includes("&lt;&lt;"), `incomplete reference lost its prefix: ${JSON.stringify(markdown)} => ${JSON.stringify(got)}`);
  }
});

test("TestFileAnnotationRef", () => {
  const luteEngine = New();
  luteEngine.SetFileAnnotationRef(true);
  markdownTable(luteEngine, rows(cases, "fileAnnotationRefTests", 9));
});

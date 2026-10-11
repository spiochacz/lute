// Ports of test/spin_ir_test.go, test/spin_sv_test.go and test/vditor_table_br_test.go (the Go test files whose engine calls are only
// Md2VditorIRDOM, SpinVditorIRDOM, VditorIRDOM2Md and SpinVditorSVDOM plus setters). The tables are read from vditor_go_cases.json,
// generated mechanically from the Go files by tools/extract-vditor-go-tests.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { New } from "../../../src/index.ts";
import * as strings from "../../../src/runtime/strings.ts";

interface Cases {
  spinVditorIRDOMTests: [string, string, string][];
  spinVditorSVDOMTests: [string, string, string][];
  tableCellBrRoundTripTests: [string, string, string, number, number][];
  spinTableCellBrTests: [string, string, string, number, number][];
}
const cases: Cases = JSON.parse(readFileSync(new URL("./vditor_go_cases.json", import.meta.url), "utf8"));

test("TestSpinVditorIRDOM", () => {
  const luteEngine = New();
  luteEngine.SetVditorIR(true);
  luteEngine.ParseOptions.ToC = true;
  luteEngine.RenderOptions.Sanitize = true;
  luteEngine.SetMark(true);
  luteEngine.SetSup(true);
  luteEngine.SetSub(true);

  assert.equal(cases.spinVditorIRDOMTests.length, 57);
  for (const [name, from, to] of cases.spinVditorIRDOMTests) {
    const html = luteEngine.SpinVditorIRDOM(from);
    assert.equal(html, to, `test case [${name}] failed, original html ${JSON.stringify(from)}`);
  }
});

test("TestSpinVditorSVDOM", () => {
  const luteEngine = New();
  luteEngine.SetVditorSV(true);
  luteEngine.ParseOptions.ToC = true;
  luteEngine.ParseOptions.Mark = true;

  assert.equal(cases.spinVditorSVDOMTests.length, 66);
  for (const [name, from, to] of cases.spinVditorSVDOMTests) {
    const html = luteEngine.SpinVditorSVDOM(from);
    assert.equal(html, to, `test case [${name}] failed, original html ${JSON.stringify(from)}`);
  }
});

test("TestVditorTableCellBrRoundTrip", () => {
  const luteEngine = New();
  assert.equal(cases.tableCellBrRoundTripTests.length, 5);
  for (const [name, markdown, markdownContent, domBrCount, markdownBrCount] of cases.tableCellBrRoundTripTests) {
    const dom = luteEngine.Md2VditorIRDOM(markdown);
    assert.equal(strings.Count(dom, "<br />"), domBrCount, `test case [${name}] DOM failed ${JSON.stringify(dom)}`);
    assert.ok(!strings.Contains(dom, "data-type=\"html-inline\""), `test case [${name}] should render table br directly ${JSON.stringify(dom)}`);

    const md = luteEngine.VditorIRDOM2Md(dom);
    assert.equal(strings.Count(md, "<br />"), markdownBrCount, `test case [${name}] Markdown failed ${JSON.stringify(md)}`);
    assert.ok(strings.Contains(md, markdownContent), `test case [${name}] Markdown content ${JSON.stringify(markdownContent)} not in ${JSON.stringify(md)}`);
  }

  const dom = luteEngine.Md2VditorIRDOM("1<br />2");
  assert.ok(strings.Contains(dom, "data-type=\"html-inline\""), `br outside a table should remain inline HTML ${JSON.stringify(dom)}`);
});

test("TestSpinVditorTableCellBr", () => {
  const luteEngine = New();
  assert.equal(cases.spinTableCellBrTests.length, 3);
  for (const [name, cell, domContent, domBrCount, markdownBrCount] of cases.spinTableCellBrTests) {
    const input = "<table data-block=\"0\"><thead><tr><th>c</th></tr></thead><tbody><tr><td>" + cell + "</td></tr></tbody></table>";
    const dom = luteEngine.SpinVditorIRDOM(input);
    assert.ok(strings.Contains(dom, domContent), `test case [${name}] DOM expected ${JSON.stringify(domContent)} got ${JSON.stringify(dom)}`);
    assert.equal(strings.Count(dom, "<br />"), domBrCount, `test case [${name}] DOM br count ${JSON.stringify(dom)}`);
    assert.ok(!strings.Contains(dom, "data-type=\"html-inline\""), `test case [${name}] should render table br directly ${JSON.stringify(dom)}`);

    const markdown = luteEngine.VditorIRDOM2Md(dom);
    assert.equal(strings.Count(markdown, "<br />"), markdownBrCount, `test case [${name}] Markdown br count ${JSON.stringify(markdown)}`);

    const respun = luteEngine.SpinVditorIRDOM(dom);
    assert.equal(respun, dom, `test case [${name}] should be stable after another spin`);
  }
});

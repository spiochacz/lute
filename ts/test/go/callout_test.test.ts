// Port of test/callout_test.go. The HTML2Md half of TestHTML2MdCallout is also in e2e/root/h2m_go.test.ts; here both halves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("callout_test");

test("TestCallout", () => {
  const luteEngine = New();
  luteEngine.SetCallout(true);
  luteEngine.SetDataTask(true);
  markdownTable(luteEngine, rows(cases, "calloutTests", 16));
});

test("TestHTML2MdCallout", () => {
  const luteEngine = New();
  luteEngine.SetCallout(true);
  for (const [name, from, to] of rows(cases, "html2MdCalloutTests", 3)) {
    assert.equal(luteEngine.HTML2Md(from!), to, `test case [${name}] failed`);
    const dom = luteEngine.HTML2VditorDOM(from!);
    assert.ok(dom.includes('data-type="callout"'), `test case [${name}] did not generate a Vditor Callout DOM: ${JSON.stringify(dom)}`);
  }
});

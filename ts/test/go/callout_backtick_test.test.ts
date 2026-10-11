// Port of test/callout_backtick_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goCases, rows } from "./wave_a_helpers.ts";

const cases = goCases("callout_backtick_test");

test("TestCalloutBacktickInput", () => {
  const l = New();
  l.SetTextMark(true);
  l.SetCallout(true);
  l.SetKramdownIAL(true);
  l.SetSpin(true);
  l.SetProtyleWYSIWYG(true);
  for (const [title, want] of rows(cases, "backtick", 5)) {
    const dom =
      '<div data-type="NodeCallout" data-subtype="NOTE" class="callout"><div class="callout-info"><span class="callout-icon">✏️</span><span class="callout-title" contenteditable="true">' +
      title +
      '</span></div><div class="callout-content"><div data-type="NodeParagraph"><div contenteditable="true">body</div></div></div></div>';
    let got = l.SpinBlockDOM(dom);
    got = got.replaceAll("​", "").replaceAll("⁠", "");
    assert.ok(got.includes(want!), `${title}: ${got}\nMD: ${l.BlockDOM2Md(dom)}`);
  }
});

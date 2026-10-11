// Port of test/wps_text_style_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";

// WPS 使用 background 简写，并在下划线标签内部重复声明文本修饰。
const wpsTextStyleHTML = `<p class=MsoNormal style="mso-pagination:widow-orphan;text-align:left;"><span style="mso-spacerun:'yes';font-family:宋体;font-size:12.0000pt;">222</span><span style="font-family:宋体;color:rgb(216,57,49);font-size:12.0000pt;background:rgb(255,165,61);mso-shading:rgb(255,165,61);">333</span><s><span style="font-family:宋体;color:rgb(216,57,49);text-decoration:line-through;font-size:12.0000pt;background:rgb(255,165,61);">33</span></s><span style="font-family:宋体;color:rgb(216,57,49);font-size:12.0000pt;background:rgb(255,165,61);">3</span><b style="mso-bidi-font-weight:normal"><span style="font-family:宋体;color:rgb(216,57,49);mso-ansi-font-weight:bold;font-size:12.0000pt;background:rgb(255,165,61);">3</span></b><b><span style="font-family:宋体;font-size:12.0000pt;">33444</span></b><span style="font-family:宋体;font-size:12.0000pt;">444</span><u><span style="font-family:宋体;text-decoration:underline;text-underline:single;font-size:12.0000pt;">4444</span></u><span style="font-family:宋体;font-size:12.0000pt;">4 4123123123</span></p>`;

test("TestWPSTextStyle", () => {
  const engine = New();
  engine.SetProtyleWYSIWYG(true);
  engine.SetHTMLTag2TextMark(true);
  engine.SetKramdownIAL(true);
  let dom = engine.HTML2BlockDOM(wpsTextStyleHTML);
  for (let i = 0; i < 3; i++) {
    // t.Errorf continues after a failure; the first failure is enough here
    for (const expected of [`background-color: rgb(255,165,61);`, `color: rgb(216,57,49);`, `font-family: 宋体;`, `font-size: 16.000000px;`, `data-type="u" style="font-family: 宋体;font-size: 16.000000px;">4444</span>`]) {
      assert.ok(dom.includes(expected), `missing ${JSON.stringify(expected)} in ${dom}`);
    }
    assert.ok(!dom.includes("{: style="), `style syntax leaked into content: ${dom}`);
    dom = engine.SpinBlockDOM(dom);
  }
});

// Port of test/h2m_code_banner_test.go. The HTML2Md halves are also in e2e/root/h2m_go.test.ts; this file adds the BlockDOM halves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goCases, rows } from "./wave_a_helpers.ts";

const cases = goCases("h2m_code_banner_test");

test("TestHTMLCodeBlockBanner", () => {
  for (const [name, html, markdown] of rows(cases, "banner", 9)) {
    const engine = New();
    assert.equal(engine.HTML2Md(html!), markdown, `${name}: HTML2Md`);
    // 同时验证编辑器使用的转换入口，确保语言和正文在往返转换后保留。
    const want = markdown!.replaceAll("```\n\n\n", "```\n\n");
    assert.equal(engine.BlockDOM2StdMd(engine.HTML2BlockDOM(html!)), want, `${name}: BlockDOM round trip`);
  }
});

test("TestHTMLCodeBlockBannerPreservesUnrecognizedContent", () => {
  for (const [body] of rows(cases, "preserves", 9)) {
    const engine = New();
    const want = engine.HTML2Md("<div>" + body + "</div>");
    const got = engine.HTML2Md('<div class="md-code-block">' + body + "</div>");
    assert.equal(got, want, `content changed for ${body}`);
  }
  const engine = New();
  const html = '<div class="md-code-block-other"><div class="md-code-block-banner"><span>bash</span></div><pre>echo x</pre></div>';
  const got = engine.HTML2Md(html);
  assert.ok(got.startsWith("bash\n\n```\n"), `unrelated container changed: ${JSON.stringify(got)}`);
});

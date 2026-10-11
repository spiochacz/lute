// Port of test/tabs_whitespace_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { html, parse, render } from "../../src/index.ts";
import { BytesFromString, StringFromBytes } from "../../src/runtime/conv.ts";
import { tabNodes, tabsEngine } from "./tabs_helpers_s.ts";

test("TestTabsTitleWhitespace", () => {
  const l = tabsEngine();
  for (const title of [" leading", "trailing ", "two  spaces", "   ", " <span data-type=\"strong\">bold</span> "]) {
    let dom = `<div data-node-id="20260909000000-tabs001" data-type="NodeTabs" class="tabs"><div data-node-id="20260909000000-item001" data-type="NodeTabItem" class="tab-item"><div class="tab-item-info"><span class="tab-item-title">` + title + `</span></div><div class="tab-item-content"><div data-node-id="20260909000000-para001" data-type="NodeParagraph" class="p"><div contenteditable="true">Body</div></div></div></div></div>`;
    for (let round = 0; round < 3; round++) {
      const tree = l.BlockDOM2Tree(dom)!;
      const { items } = tabNodes(tree.Root!);
      assert.equal(items.length, 1, dom);
      const inline = parse.Inline("", BytesFromString(items[0].TabItemTitle), l.ParseOptions);
      const expected = title.split(`<span data-type="strong">`).join("").split("</span>").join("");
      let got = html.UnescapeString(StringFromBytes(render.NewHtmlRenderer(inline, l.RenderOptions, l.ParseOptions).Render()));
      // strings.TrimSuffix(strings.TrimPrefix(got, "<p>"), "</p>\n")
      if (got.startsWith("<p>")) {
        got = got.slice(3);
      }
      if (got.endsWith("</p>\n")) {
        got = got.slice(0, got.length - 5);
      }
      got = got.split("<strong>").join("").split("</strong>").join("");
      got = got.split(`<span data-type="strong">`).join("").split("</span>").join("");
      assert.equal(got, expected, `round ${round}: title ${JSON.stringify(title)} became ${JSON.stringify(got)} (${JSON.stringify(items[0].TabItemTitle)})`);
      dom = StringFromBytes(render.NewProtyleRenderer(tree, l.RenderOptions, l.ParseOptions).Render());
      dom = l.SpinBlockDOM(dom);
    }
  }
});

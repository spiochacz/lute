// Port of test/tabs_export_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ast, parse, render } from "../../src/index.ts";
import { BytesFromString, StringFromBytes } from "../../src/runtime/conv.ts";
import { count, tabNodes, tabsEngine } from "./tabs_helpers_s.ts";

test("TestTabsExportNestedTitleBlocks", () => {
  const l = tabsEngine();
  const tree = parse.Parse("", BytesFromString(":::: tabs\n@tab Outer\n\n::: tabs\n@tab Inner\n\n- Inner\n\n:::\n@tab StringTitle\n\nBody\n\n::::\n"), l.ParseOptions);
  const { items } = tabNodes(tree.Root!);
  assert.equal(items.length, 3, `expected three tab items, got ${items.length}`);
  for (const item of items.slice(0, 2)) {
    const title = parse.Parse("", BytesFromString(item.TabItemTitle), l.ParseOptions).Root!.FirstChild!;
    title.SetIALAttr("tabs-title", "true");
    item.PrependChild(title);
    item.TabItemTitle = "";
  }
  const exported = StringFromBytes(render.NewProtyleExportRenderer(tree, render.NewOptions(), l.ParseOptions).Render());
  const expectedCounts: [string, number][] = [["Outer", 1], ["Inner", 2], ["StringTitle", 1], ["Body", 1]];
  for (const [content, n] of expectedCounts) {
    assert.equal(count(exported, content), n, `expected ${JSON.stringify(content)} ${n} times\n${exported}`);
  }
  assert.ok(exported.includes(`data-type="NodeList"`) && exported.includes(`data-type="NodeListItem"`), `export lost nested list\n${exported}`);
  for (const item of items.slice(0, 2)) {
    const title = item.TabTitleBlock();
    assert.ok(!(title === null || title.Type !== ast.NodeParagraph), "export changed title blocks");
  }
});

test("TestTabsStandardExportLiteralFences", async (t) => {
  const markdowns: Record<string, string> = {
    body: "::: tabs\n@tab First\n\\::: tabs\nLiteral body\n\\:::\n@tab Second\nMore body\n:::\n",
    title: "::: tabs\n@tab \\::: tabs\nLiteral body\n@tab Second\nMore body\n:::\n",
  };
  for (const [name, markdown] of Object.entries(markdowns)) {
    for (const plainDOM of [false, true]) {
      const suffix = plainDOM ? "/plain" : "/escaped";
      await t.test(name + suffix, () => {
        const l = tabsEngine();
        let dom = l.Md2BlockDOM(markdown, false);
        if (plainDOM) {
          // 模拟编辑器中没有转义标记节点的普通文字。
          dom = dom.split(`<span data-type="backslash">:</span>`).join(":");
        }
        const exported = StringFromBytes(render.NewProtyleExportMdRenderer(l.BlockDOM2Tree(dom)!, render.NewOptions(), l.ParseOptions).Render());
        assert.ok(exported.includes("\\::: tabs") && !exported.includes("\\\\::: tabs"), `literal fence must be escaped exactly once\n${exported}`);
        const { tabs } = tabNodes(parse.Parse("", BytesFromString(exported), l.ParseOptions).Root!);
        assert.equal(tabs.length, 0, `flattened export created ${tabs.length} tabs containers\n${exported}`);
        const html = l.MarkdownStr("", exported);
        for (const content of ["::: tabs", "Literal body", "Second", "More body"]) {
          assert.ok(html.includes(content), `export lost ${JSON.stringify(content)}\n${exported}`);
        }
      });
    }
  }
});

test("TestTabsLiteralMarkerCaretSpin", async (t) => {
  for (const marker of ["@tab Literal body", "@tab:active Literal body", "::: tabs", ":::"]) {
    await t.test(marker, () => {
      const l = tabsEngine();
      const markdown = "::: tabs\n@tab First\n\\" + marker + "\n@tab Second\nMore body\n:::\n";
      let dom = l.Md2BlockDOM(markdown, false);
      dom = dom.split(`<span data-type="backslash">` + marker.slice(0, 1) + `</span>`).join("<wbr>" + marker.slice(0, 1));
      for (let round = 0; round < 3; round++) {
        dom = l.SpinBlockDOM(dom);
        const { tabs, items } = tabNodes(l.BlockDOM2Tree(dom)!.Root!);
        assert.ok(!(tabs.length !== 1 || items.length !== 2 || items[1].TabItemTitle !== "Second"), `round ${round} caret changed structure\n${dom}`);
        assert.ok(!(count(dom, "<wbr>") !== 1 || dom.includes("\\")), `round ${round} caret lost or escape became visible\n${dom}`);
      }
    });
  }
});

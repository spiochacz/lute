// Port of test/tabs_title_block_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ast, parse, render } from "../../src/index.ts";
import { BytesFromString, StringFromBytes } from "../../src/runtime/conv.ts";
import { count, tabNodes, tabsEngine } from "./tabs_helpers_s.ts";

test("TestTabsOriginalTitleBlock", () => {
  const l = tabsEngine();
  let dom = `<div data-node-id="20260905120000-tabs001" data-type="NodeTabs" class="tabs" tabs-active-id="20260905120000-item001"><div data-node-id="20260905120000-item001" data-type="NodeTabItem" class="tab-item"><div class="tab-item-info callout-info"><div data-node-id="20260905120000-title01" data-type="NodeParagraph" class="p" tabs-title="true" custom-test="kept"><div class="tab-item-title callout-title" contenteditable="true"><span data-type="strong">abcdefghijklmnop</span> <span data-type="block-ref" data-id="20260905120000-ref0001" data-subtype="d">Reference</span></div></div></div><div class="tab-item-content"><div data-node-id="20260905120000-para001" data-type="NodeParagraph" class="p"><div contenteditable="true">Body</div></div></div></div></div>`;
  for (let round = 0; round < 4; round++) {
    const tree = l.BlockDOM2Tree(dom)!;
    const { items } = tabNodes(tree.Root!);
    assert.equal(items.length, 1, dom);
    const title = items[0].TabTitleBlock();
    if (title === null || title.ID !== "20260905120000-title01" || title.IALAttr("custom-test") !== "kept") {
      assert.fail(`round ${round} title identity lost\n${dom}`);
    }
    let n = 0;
    ast.Walk(tree.Root!, (node, entering) => {
      if (entering && node.ID === title.ID) {
        n++;
      }
      return ast.WalkContinue;
    });
    assert.equal(n, 1, `duplicate title block: ${n}`);
    const md = l.BlockDOM2StdMd(dom);
    assert.ok(
      !(count(md, "abcdefghijklmnop") !== 1 || !md.includes("@tab:active **abcdefghijklmnop**") || md.includes("custom-test") || md.includes("tabs-title") || md.includes("{: ")),
      `clipboard lost structure or duplicated title\n${md}`,
    );
    const copied = tabNodes(parse.Parse("", BytesFromString(md), l.ParseOptions).Root!);
    assert.ok(!(copied.tabs.length !== 1 || copied.items.length !== 1 || !copied.items[0].TabItemTitle.includes("abcdefghijklmnop")), md);
    const options = render.NewOptions();
    const flat = StringFromBytes(render.NewProtyleExportMdRenderer(tree, options, l.ParseOptions).Render());
    assert.ok(!(count(flat, "abcdefghijklmnop") !== 1 || flat.includes("@tab")), `flat export\n${flat}`);
    const html = l.BlockDOM2HTML(dom);
    assert.ok(!(count(html, "abcdefghijklmnop") !== 1 || !html.includes("Body")), `HTML duplicated or lost title\n${html}`);
    const exported = StringFromBytes(render.NewProtyleExportRenderer(tree, options, l.ParseOptions).Render());
    assert.ok(!(count(exported, "abcdefghijklmnop") !== 1 || count(exported, "Body") !== 1), `PDF/HTML export duplicated or lost content\n${exported}`);
    // Go: &parse.Tree{Root: title}
    const standaloneTree = new parse.Tree();
    standaloneTree.Root = title;
    const standalone = StringFromBytes(render.NewProtyleExportRenderer(standaloneTree, options, l.ParseOptions).Render());
    assert.equal(count(standalone, "abcdefghijklmnop"), 1, `standalone title export lost content\n${standalone}`);
    const back = l.HTML2Md(html);
    const htmlItems = tabNodes(parse.Parse("", BytesFromString(back), l.ParseOptions).Root!).items;
    assert.ok(
      !(htmlItems.length !== 1 || (!htmlItems[0].TabItemTitle.includes("abcdefghijklmnop") && htmlItems[0].TabTitleBlock() === null)),
      `HTML round trip lost title\n${back}`,
    );
    assert.ok(!(htmlItems[0].TabItemTitle.includes("{: ") || count(back, "abcdefghijklmnop") !== 1), `HTML title leaked block attributes or duplicated content\n${back}`);
    dom = l.SpinBlockDOM(dom);
    assert.ok(!(count(dom, `data-node-id="20260905120000-title01"`) !== 1 || !dom.includes(`class="tab-item-title callout-title"`)), dom);
  }
});

test("TestTabsClipboardNestingAndLiteralIAL", () => {
  const l = tabsEngine();
  const md = ":::: tabs\n@tab First\n\n::: tabs\n@tab Inner\nA\n@tab:active Selected\nB\n:::\n@tab:active Second\n\n```\n{: id=\"literal\"}\n@tab literal\n::: tabs\n```\n::::\n";
  const copied = l.BlockDOM2StdMd(l.Md2BlockDOM(md, false));
  const { tabs, items } = tabNodes(parse.Parse("", BytesFromString(copied), l.ParseOptions).Root!);
  assert.ok(!(tabs.length !== 2 || items.length !== 4 || !copied.includes(":::: tabs") || count(copied, "@tab:active") !== 2), copied);
  for (const group of tabs) {
    let last: ast.Node | null = null;
    for (let n = group.FirstChild; n !== null; n = n.Next) {
      if (n.Type === ast.NodeTabItem) {
        last = n;
      }
    }
    assert.ok(!(last === null || group.IALAttr("tabs-active-id") !== last.ID), "clipboard lost nested selection");
  }
  assert.ok(
    copied.includes("{: id=\"literal\"}\n@tab literal\n::: tabs") && count(copied, "{: ") === 1,
    "clipboard must preserve literal IAL in code without leaking block attributes " + copied,
  );
});

test("TestTabsEmptyAndMultilineTitleIdentity", () => {
  const l = tabsEngine();
  for (const content of ["", "First<br />Second", "😀😀😀😀😀😀😀😀😀😀😀😀😀", "<span data-type=\"code\">@tab literal</span>"]) {
    let dom = `<div data-node-id="20260905120000-item001" data-type="NodeTabItem" class="tab-item"><div class="tab-item-info"><div data-node-id="20260905120000-title01" data-type="NodeParagraph" class="p" tabs-title="true"><div class="tab-item-title callout-title" contenteditable="true">` + content + `</div></div></div><div class="tab-item-content"><div data-node-id="20260905120000-empty01" data-type="NodeParagraph" class="p" tabs-placeholder="true"><div contenteditable="true"></div></div></div></div>`;
    for (let round = 0; round < 3; round++) {
      dom = l.SpinBlockDOM(dom);
      const { items } = tabNodes(l.BlockDOM2Tree(dom)!.Root!);
      assert.ok(
        !(items.length !== 1 || items[0].TabTitleBlock() === null || items[0].TabTitleBlock()!.ID !== "20260905120000-title01" || !dom.includes(`tabs-placeholder="true"`)),
        `title or empty body lost in round ${round}\n${dom}`,
      );
    }
  }
});

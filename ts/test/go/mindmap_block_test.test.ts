// Port of test/mindmap_block_test.go (TestMindmapBlockDOMRoundTrip, TestMindmapContainment).
// tabsEngine() is defined in test/tabs_test.go and is reproduced here with the same setters in the same order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ast, New } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";

function tabsEngine(): Lute {
  const l = New();
  l.SetTabs(true);
  l.SetKramdownBlockIAL(true);
  l.SetBlockRef(true);
  l.SetSuperBlock(true);
  l.SetTextMark(true);
  l.SetProtyleWYSIWYG(true);
  return l;
}

test("TestMindmapBlockDOMRoundTrip", () => {
  const l = tabsEngine();
  const dom = `<div data-node-id="20260923120000-map0001" data-type="NodeMindmap" data-subtype="u" class="mindmap"><div data-node-id="20260923120000-item001" data-type="NodeMindmapItem" data-subtype="u" data-marker="*" class="mindmap-item"><div class="protyle-action"></div><div data-node-id="20260923120000-para001" data-type="NodeParagraph" class="p"><div contenteditable="true">Root</div></div><div data-node-id="20260923120000-map0002" data-type="NodeMindmap" data-subtype="u" class="mindmap"><div data-node-id="20260923120000-item002" data-type="NodeMindmapItem" data-subtype="u" data-marker="*" class="mindmap-item"><div class="protyle-action"></div><div data-node-id="20260923120000-para002" data-type="NodeParagraph" class="p"><div contenteditable="true">Child</div></div></div></div></div></div>`;
  let source = dom;
  for (let round = 0; round < 3; round++) {
    const tree = l.BlockDOM2Tree(source)!;
    const mapNode = tree.Root!.FirstChild!;
    assert.ok(
      mapNode.Type === ast.NodeMindmap &&
        mapNode.FirstChild!.Type === ast.NodeMindmapItem &&
        mapNode.FirstChild!.ChildByType(ast.NodeMindmap)!.FirstChild!.Type === ast.NodeMindmapItem,
      `round ${round}: mind map types were lost`,
    );
    const rendered = l.RenderNodeBlockDOM(mapNode);
    assert.ok(
      rendered.includes(`data-type="NodeMindmap"`) && rendered.includes(`data-type="NodeMindmapItem"`) && rendered.includes(`class="mindmap"`),
      `round ${round}: ${rendered}`,
    );
    assert.ok(mapNode.ID === "20260923120000-map0001" && mapNode.FirstChild!.ID === "20260923120000-item001", `round ${round}: IDs changed`);
    source = rendered;
  }
  const spun = l.SpinBlockDOM(source);
  const count = (s: string, sub: string): number => s.split(sub).length - 1;
  assert.ok(
    count(spun, `data-type="NodeMindmap"`) === 2 && count(spun, `data-type="NodeMindmapItem"`) === 2,
    `spin lost mind map types: markdown=${JSON.stringify(l.BlockDOM2Md(source))} DOM=${spun}`,
  );
  const standard = l.BlockDOM2StdMd(source);
  assert.ok(standard.includes("Root") && standard.includes("Child"), `standard Markdown lost mind map content: ${standard}`);
  const html = l.BlockDOM2HTML(source);
  assert.ok(html.includes("Root") && html.includes("Child"), `HTML lost mind map content: ${html}`);
});

test("TestMindmapContainment", () => {
  const container = new ast.Node(ast.NodeMindmap);
  const item = new ast.Node(ast.NodeMindmapItem);
  assert.ok(
    container.CanContain(ast.NodeMindmapItem) &&
      !container.CanContain(ast.NodeListItem) &&
      item.CanContain(ast.NodeMindmap) &&
      item.CanContain(ast.NodeParagraph) &&
      !item.CanContain(ast.NodeList) &&
      !item.CanContain(ast.NodeListItem) &&
      !item.CanContain(ast.NodeMindmapItem),
    "invalid mind map content boundaries",
  );
});

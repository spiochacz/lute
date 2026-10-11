import { test } from "node:test";
import assert from "node:assert/strict";
import * as ast from "./index.ts";
import { Node } from "./node.ts";

// Tab item: first child is the title paragraph (marked tabs-title="true"), after an optional IAL block.
function tabItem(): { item: Node; title: Node; body: Node } {
  const item = new Node(ast.NodeTabItem);
  const ial = new Node(ast.NodeKramdownBlockIAL);
  const title = new Node(ast.NodeParagraph);
  title.SetIALAttr("tabs-title", "true");
  const body = new Node(ast.NodeParagraph);
  item.AppendChild(ial);
  item.AppendChild(title);
  item.AppendChild(body);
  return { item, title, body };
}

test("TabTitleBlock returns the title paragraph after the IAL block", () => {
  const { item, title } = tabItem();
  assert.equal(item.TabTitleBlock(), title);
  assert.equal(title.IsTabTitleBlock(), true);
});

test("TabTitleBlock returns null when the first non-IAL child is not marked as the title", () => {
  const item = new Node(ast.NodeTabItem);
  const plain = new Node(ast.NodeParagraph);
  const marked = new Node(ast.NodeParagraph);
  marked.SetIALAttr("tabs-title", "true");
  item.AppendChild(plain);
  item.AppendChild(marked);
  assert.equal(item.TabTitleBlock(), null);
  assert.equal(marked.IsTabTitleBlock(), false);
});

test("TabTitleBlock returns null for a node that is not a tab item", () => {
  const p = new Node(ast.NodeParagraph);
  assert.equal(p.TabTitleBlock(), null);
  assert.equal(p.IsTabTitleBlock(), false);
});

// Port of test/list_item_nested_test.go (TestEnsureListItemParagraph, TestDefaultNestedList,
// TestIssue17890EmptyListItemNoDuplicateParagraph). The tables are read from the Go source.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ast, New } from "../../src/index.ts";
import { assertRows, readCases, table } from "./wave3_support.ts";

test("TestEnsureListItemParagraph", () => {
  const luteEngine = New();
  luteEngine.SetEnsureListItemParagraph(true);
  luteEngine.SetHeadingID(false);
  luteEngine.SetKramdownIAL(false);
  assertRows(table("list_item_nested", "disableNestedListTests", 6), (name, from) => luteEngine.MarkdownStr(name, from));
});

test("TestDefaultNestedList", () => {
  const luteEngine = New();
  luteEngine.SetHeadingID(false);
  luteEngine.SetKramdownIAL(false);
  assertRows(table("list_item_nested", "defaultNestedListTests", 1), (name, from) => luteEngine.MarkdownStr(name, from));
});

// containsText reports whether the subtree has a NodeText node with text.
function containsText(n: ast.Node): boolean {
  if (n.Type === ast.NodeText && n.Tokens !== null && n.Tokens.length > 0) {
    return true;
  }
  for (let c = n.FirstChild; c !== null; c = c.Next) {
    if (containsText(c)) {
      return true;
    }
  }
  return false;
}

// emptyParagraphCount counts the paragraphs of the list item that contain no text.
function emptyParagraphCount(listItem: ast.Node): number {
  let count = 0;
  for (let c = listItem.FirstChild; c !== null; c = c.Next) {
    if (ast.NodeParagraph === c.Type && !containsText(c)) {
      count++;
    }
  }
  return count;
}

// https://github.com/siyuan-note/siyuan/issues/17890
test("TestIssue17890EmptyListItemNoDuplicateParagraph", () => {
  const issue17890Tests = readCases("list_item_nested")["issue17890Tests"] as string[];
  assert.equal(issue17890Tests.length, 3);
  for (const markdown of issue17890Tests) {
    const luteEngine = New();
    luteEngine.SetProtyleWYSIWYG(true);
    luteEngine.SetKramdownIAL(true);
    luteEngine.SetSpin(true);
    luteEngine.SetEnsureListItemParagraph(true);
    const [, tree] = luteEngine.Md2BlockDOMTree(markdown, false);
    const offenders: string[] = [];
    ast.Walk(tree.Root!, (n, entering) => {
      if (!entering || ast.NodeListItem !== n.Type) {
        return ast.WalkContinue;
      }
      if (1 < emptyParagraphCount(n)) {
        offenders.push(n.ID);
      }
      return ast.WalkContinue;
    });
    assert.equal(offenders.length, 0, `markdown ${JSON.stringify(markdown)}: list items ${JSON.stringify(offenders)} have duplicate empty paragraphs`);
  }
});

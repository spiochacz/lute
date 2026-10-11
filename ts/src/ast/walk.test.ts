import { test } from "node:test";
import assert from "node:assert/strict";
import * as ast from "./index.ts";
import { Node } from "./node.ts";

// Builds: doc > [para > [text "a", text "b"], quote > [para > [text "c"]]]
function sample(): Node {
  const doc = new Node(ast.NodeDocument);
  const p1 = new Node(ast.NodeParagraph);
  p1.AppendChild(new Node(ast.NodeText, new TextEncoder().encode("a")));
  p1.AppendChild(new Node(ast.NodeText, new TextEncoder().encode("b")));
  const q = new Node(ast.NodeBlockquote);
  const p2 = new Node(ast.NodeParagraph);
  p2.AppendChild(new Node(ast.NodeText, new TextEncoder().encode("c")));
  q.AppendChild(p2);
  doc.AppendChild(p1);
  doc.AppendChild(q);
  return doc;
}

test("Walk visits enter and leave events depth-first", () => {
  const events: string[] = [];
  ast.Walk(sample(), (n, entering) => {
    events.push((entering ? "+" : "-") + ast.NodeTypeString(n.Type));
    return ast.WalkContinue;
  });
  assert.deepEqual(events, [
    "+NodeDocument",
    "+NodeParagraph",
    "+NodeText",
    "-NodeText",
    "+NodeText",
    "-NodeText",
    "-NodeParagraph",
    "+NodeBlockquote",
    "+NodeParagraph",
    "+NodeText",
    "-NodeText",
    "-NodeParagraph",
    "-NodeBlockquote",
    "-NodeDocument",
  ]);
});

test("Walk with WalkSkipChildren skips the children but still leaves the node", () => {
  const events: string[] = [];
  ast.Walk(sample(), (n, entering) => {
    events.push((entering ? "+" : "-") + ast.NodeTypeString(n.Type));
    return n.Type === ast.NodeParagraph && entering ? ast.WalkSkipChildren : ast.WalkContinue;
  });
  assert.deepEqual(events, ["+NodeDocument", "+NodeParagraph", "-NodeParagraph", "+NodeBlockquote", "+NodeParagraph", "-NodeParagraph", "-NodeBlockquote", "-NodeDocument"]);
});

test("Walk with WalkStop ends the whole walk", () => {
  let count = 0;
  ast.Walk(sample(), () => {
    count++;
    return count === 3 ? ast.WalkStop : ast.WalkContinue;
  });
  assert.equal(count, 3);
});

test("WalkStatus constants keep Go's values (WalkStop 0, WalkSkipChildren 1, WalkContinue 2)", () => {
  assert.equal(ast.WalkStop, 0);
  assert.equal(ast.WalkSkipChildren, 1);
  assert.equal(ast.WalkContinue, 2);
});

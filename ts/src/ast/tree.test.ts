import { test } from "node:test";
import assert from "node:assert/strict";
import * as ast from "./index.ts";
import { Node } from "./node.ts";
import { dumpForest, expectResult, hexToBytes, loadVectors } from "./testhelpers.ts";

// Tree vectors (ts/tools/gen-ast-vectors, Go 1.27): scripted scenarios of tree operations. Each scenario replays its ops,
// compares after every op the forest dump and Go's recorded link fields (Parent, Previous, Next, FirstChild, LastChild)
// of every node, and then compares the query results of every node. No other invariant is asserted: the recorded Go
// values are the reference, including where they are not what a tidy tree would have.

interface Op {
  op: string;
  type?: number;
  tokens?: string;
  id?: string;
  a?: number;
  b?: number;
}

interface Query {
  text: string;
  textLen: number;
  tokensStr: string;
  content: string;
  tokenLen: number;
  stat: number[];
  docChild: number | null;
  lastDeepest: number | null;
  firstDeepest: number | null;
  list: number[];
  blockIDs: string[];
  nextNodeText: string;
  prevNodeText: string;
  isEmptyBlockIAL: boolean;
  ialID: string;
  isTabTitleBlock: boolean;
  tabTitleBlock: number | null;
  childByType: Record<string, number | null | "PANIC">;
  childrenByType: Record<string, number[] | "PANIC">;
  parentIs: Record<string, boolean | "PANIC">;
  parentIsMulti: boolean | "PANIC";
  isChildBlockOf: Record<string, boolean | "PANIC">;
}

interface Scenario {
  name: string;
  ops: Op[];
  dumps: string[];
  links: (number | null)[][][];
  final: { count: number; queries: Query[] };
}

const scenarios = loadVectors<{ scenarios: Scenario[] }>("tree_vectors.json").scenarios;

// linksOf returns the link fields of every node as Go records them: [Parent, Previous, Next, FirstChild, LastChild]
// as node indexes or null.
function linksOf(nodes: Node[]): (number | null)[][] {
  const idx = (x: Node | null): number | null => (null === x ? null : nodes.indexOf(x));
  return nodes.map((n) => [idx(n.Parent), idx(n.Previous), idx(n.Next), idx(n.FirstChild), idx(n.LastChild)]);
}

// applyOp performs one recorded operation on the replayed nodes.
function applyOp(nodes: Node[], op: Op): void {
  if (op.op === "new") {
    const n = new Node(op.type ?? 0, hexToBytes(op.tokens ?? ""));
    if (op.id !== undefined) {
      n.ID = op.id;
    }
    nodes.push(n);
    return;
  }
  const a = nodes[op.a ?? -1];
  switch (op.op) {
    case "AppendChild":
      a.AppendChild(nodes[op.b ?? -1]);
      return;
    case "PrependChild":
      a.PrependChild(nodes[op.b ?? -1]);
      return;
    case "InsertBefore":
      a.InsertBefore(nodes[op.b ?? -1]);
      return;
    case "InsertAfter":
      a.InsertAfter(nodes[op.b ?? -1]);
      return;
    case "Unlink":
      a.Unlink();
      return;
    case "AppendTokens":
      a.AppendTokens(hexToBytes(op.tokens ?? ""));
      return;
    case "PrependTokens":
      a.PrependTokens(hexToBytes(op.tokens ?? ""));
      return;
  }
  throw new Error("unknown op " + op.op);
}

// checkQueries compares the final query results of every node with the vector.
function checkQueries(nodes: Node[], queries: Query[]): void {
  const idx = (x: Node | null): number | null => (null === x ? null : nodes.indexOf(x));
  const idxs = (xs: Node[]): number[] => xs.map((x) => nodes.indexOf(x));
  const constants = ast as unknown as Record<string, unknown>;
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    const q = queries[k];
    const where = "node " + k;
    assert.equal(n.Text(), q.text, where + " text");
    assert.equal(n.TextLen(), q.textLen, where + " textLen");
    assert.equal(n.TokensStr(), q.tokensStr, where + " tokensStr");
    assert.equal(n.Content(), q.content, where + " content");
    assert.equal(n.TokenLen(), q.tokenLen, where + " tokenLen");
    assert.deepEqual([...n.Stat()], q.stat, where + " stat");
    assert.equal(idx(n.DocChild()), q.docChild, where + " docChild");
    assert.equal(idx(n.LastDeepestChild()), q.lastDeepest, where + " lastDeepest");
    assert.equal(idx(n.FirstDeepestChild()), q.firstDeepest, where + " firstDeepest");
    assert.deepEqual(idxs(n.List()), q.list, where + " list");
    assert.deepEqual(n.BlockIDs(), q.blockIDs, where + " blockIDs");
    assert.equal(n.NextNodeText(), q.nextNodeText, where + " nextNodeText");
    assert.equal(n.PreviousNodeText(), q.prevNodeText, where + " prevNodeText");
    assert.equal(n.IsEmptyBlockIAL(), q.isEmptyBlockIAL, where + " isEmptyBlockIAL");
    assert.equal(n.IALAttr("id"), q.ialID, where + " ialID");
    assert.equal(n.IsTabTitleBlock(), q.isTabTitleBlock, where + " isTabTitleBlock");
    assert.equal(idx(n.TabTitleBlock()), q.tabTitleBlock, where + " tabTitleBlock");
    for (const [name, want] of Object.entries(q.childByType)) {
      const t = constants[name] as number;
      expectResult(assert, where + " childByType " + name, want, () => idx(n.ChildByType(t)));
    }
    for (const [name, want] of Object.entries(q.childrenByType)) {
      const t = constants[name] as number;
      expectResult(assert, where + " childrenByType " + name, want, () => idxs(n.ChildrenByType(t)));
    }
    for (const [name, want] of Object.entries(q.parentIs)) {
      const t = constants[name] as number;
      expectResult(assert, where + " parentIs " + name, want, () => n.ParentIs(t));
    }
    expectResult(assert, where + " parentIsMulti", q.parentIsMulti, () => n.ParentIs(ast.NodeListItem, ast.NodeBlockquote, ast.NodeDocument));
    for (const [key, want] of Object.entries(q.isChildBlockOf)) {
      const [j, d] = key.split("/").map(Number);
      expectResult(assert, where + " isChildBlockOf " + key, want, () => n.IsChildBlockOf(nodes[j], d));
    }
  }
}

for (let i = 0; i < scenarios.length; i++) {
  const sc = scenarios[i];
  test(`Tree scenario ${i} ${sc.name}: operations, dumps and links`, () => {
    assert.equal(sc.dumps.length, sc.ops.length);
    assert.equal(sc.links.length, sc.ops.length);
    const nodes: Node[] = [];
    for (let k = 0; k < sc.ops.length; k++) {
      applyOp(nodes, sc.ops[k]);
      assert.equal(dumpForest(nodes), sc.dumps[k], "dump after op " + k);
      assert.deepEqual(linksOf(nodes), sc.links[k], "links after op " + k);
    }
    assert.equal(nodes.length, sc.final.count);
    assert.equal(sc.final.queries.length, sc.final.count);
  });

  test(`Tree scenario ${i} ${sc.name}: final queries`, () => {
    const nodes: Node[] = [];
    for (const op of sc.ops) {
      applyOp(nodes, op);
    }
    checkQueries(nodes, sc.final.queries);
  });
}

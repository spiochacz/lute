import { test } from "node:test";
import assert from "node:assert/strict";
import { ListData, Node } from "./node.ts";
import { TableCellRich } from "./table_rich.ts";
import { expectResult, hexToBytes, loadVectors } from "./testhelpers.ts";

// Real-tree vectors: Markdown parsed by Go's parse package (ast.Testing = true), stored as a graph of nodes.
// nodes[0] is the root. "fields" holds every Go field of Node (the nil-ness of a field is kept where the TypeScript
// field is nullable). A nil value of a non-nullable TypeScript field is an empty value, so null maps to empty there.
// "methods" holds the results of the read-only methods; "PANIC" means the Go call panicked.

type JSONValue = unknown;

interface RealNode {
  fields: Record<string, JSONValue>;
  methods: Record<string, JSONValue>;
}

interface RealTree {
  name: string;
  markdown: string;
  options: string;
  nodes: RealNode[];
}

const trees = loadVectors<{ trees: RealTree[] }>("realtree_vectors.json").trees;

// Fields whose TypeScript type is Node or Node[] (indexes into the node list).
const pointerFields = new Set(["Parent", "Previous", "Next", "FirstChild", "LastChild"]);
const nodeListFields = new Set(["Children", "FootnotesRefs"]);
// Byte fields that are nullable in TypeScript (compared with nil in Go).
const nullableBytes = new Set(["Tokens", "CodeBlockCloseFence"]);
const byteFields = new Set(["Tokens", "CodeBlockCloseFence", "CodeBlockInfo", "CodeBlockOpenFence", "LinkRefLabel", "FootnotesRefLabel", "HtmlEntityTokens"]);

// setFields assigns the vector fields of one node. Node indexes are resolved against nodes.
function setFields(n: Node, fields: Record<string, JSONValue>, nodes: Node[]): void {
  const target = n as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    if (pointerFields.has(key)) {
      target[key] = value === null ? null : nodes[value as number];
    } else if (nodeListFields.has(key)) {
      target[key] = value === null ? [] : (value as number[]).map((i) => nodes[i]);
    } else if (byteFields.has(key)) {
      if (value === null) {
        target[key] = nullableBytes.has(key) ? null : new Uint8Array(0);
      } else {
        target[key] = hexToBytes(value as string);
      }
    } else if (key === "TableAligns") {
      target[key] = value === null ? [] : value;
    } else if (key === "Properties") {
      target[key] = value === null ? new Map<string, string>() : new Map(Object.entries(value as Record<string, string>));
    } else if (key === "ListData") {
      if (value === null) {
        target[key] = null;
      } else {
        const ld = new ListData();
        const f = value as Record<string, JSONValue>;
        const ldt = ld as unknown as Record<string, unknown>;
        for (const [k, v] of Object.entries(f)) {
          ldt[k] = k === "Marker" ? (v === null ? new Uint8Array(0) : hexToBytes(v as string)) : v;
        }
        target[key] = ld;
      }
    } else if (key === "TableCellRich") {
      if (value === null) {
        target[key] = null;
      } else {
        const rich = new TableCellRich();
        const rt = rich as unknown as Record<string, unknown>;
        for (const [k, v] of Object.entries(value as Record<string, JSONValue>)) {
          rt[k] = v;
        }
        target[key] = rich;
      }
    } else {
      target[key] = value;
    }
  }
}

// methodCalls maps every method key of the vectors to its call. Node results are converted to indexes by the caller.
const methodCalls: Record<string, (n: Node) => unknown> = {
  Text: (n) => n.Text(),
  TextLen: (n) => n.TextLen(),
  TokensStr: (n) => n.TokensStr(),
  Content: (n) => n.Content(),
  EscapeMarkerContent: (n) => n.EscapeMarkerContent(),
  Stat: (n) => [...n.Stat()],
  TokenLen: (n) => n.TokenLen(),
  DocChild: (n) => n.DocChild(),
  NextNodeText: (n) => n.NextNodeText(),
  PreviousNodeText: (n) => n.PreviousNodeText(),
  List: (n) => n.List(),
  BlockIDs: (n) => n.BlockIDs(),
  IsBlock: (n) => n.IsBlock(),
  IsContainerBlock: (n) => n.IsContainerBlock(),
  IsMarker: (n) => n.IsMarker(),
  IsCloseMarker: (n) => n.IsCloseMarker(),
  AcceptLines: (n) => n.AcceptLines(),
  IsEmptyBlockIAL: (n) => n.IsEmptyBlockIAL(),
  LastDeepestChild: (n) => n.LastDeepestChild(),
  FirstDeepestChild: (n) => n.FirstDeepestChild(),
  EffectiveTaskListItemMarker: (n) => n.EffectiveTaskListItemMarker(),
  TabTitleBlock: (n) => n.TabTitleBlock(),
  IsTabTitleBlock: (n) => n.IsTabTitleBlock(),
  IsNextSameInlineMemo: (n) => n.IsNextSameInlineMemo(),
  "Marker(true)": (n) => n.Marker(true),
  "Marker(false)": (n) => n.Marker(false),
  "IALAttr(id)": (n) => n.IALAttr("id"),
  "IALAttr(style)": (n) => n.IALAttr("style"),
};

// nodeResultMethods return a Node or a list of Nodes; their results are converted to indexes.
const nodeResultMethods = new Set(["DocChild", "LastDeepestChild", "FirstDeepestChild", "TabTitleBlock"]);
const nodeListResultMethods = new Set(["List"]);

for (let t = 0; t < trees.length; t++) {
  const tree = trees[t];
  test(`Real tree ${t} ${tree.name}: fields and methods rebuilt from the Go dump`, () => {
    const nodes: Node[] = tree.nodes.map(() => new Node());
    for (let i = 0; i < tree.nodes.length; i++) {
      setFields(nodes[i], tree.nodes[i].fields, nodes);
    }
    const indexOf = (x: Node | null): number | null => (null === x ? null : nodes.indexOf(x));
    for (let i = 0; i < tree.nodes.length; i++) {
      const n = nodes[i];
      for (const [key, want] of Object.entries(tree.nodes[i].methods)) {
        const call = methodCalls[key];
        assert.ok(call, "no TypeScript call for method " + key);
        const actual = (): unknown => {
          const r = call(n);
          if (nodeResultMethods.has(key)) {
            return indexOf(r as Node | null);
          }
          if (nodeListResultMethods.has(key)) {
            return (r as Node[]).map((x) => nodes.indexOf(x));
          }
          return r;
        };
        expectResult(assert, "node " + i + " " + key, want, actual);
      }
    }
  });
}

test("Real tree vectors cover at least 60 snippets", () => {
  assert.ok(trees.length >= 60, "tree count " + trees.length);
});

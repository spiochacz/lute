import { test } from "node:test";
import assert from "node:assert/strict";
import { Node } from "./node.ts";
import { loadVectors } from "./testhelpers.ts";

// IAL vectors: SetIALAttr, IALAttr, RemoveIALAttr, RemoveIALAttrsByPrefix and IsEmptyBlockIAL on a node. After each op the
// KramdownIAL list is compared (null for a nil list), and the returned value is compared when the op returns one.
interface IALOp {
  op: string;
  name?: string;
  value?: string;
  prefix?: string;
}

interface IALCase {
  type: number;
  initial: [string, string][] | null;
  ops: IALOp[];
  steps: { ial: [string, string][] | null; result: string | boolean | null }[];
}

const cases = loadVectors<{ cases: IALCase[] }>("ial_vectors.json").cases;

function encodeIAL(ial: string[][] | null): [string, string][] | null {
  if (ial === null) {
    return null;
  }
  return ial.map((kv) => [kv[0], kv[1]] as [string, string]);
}

for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  test(`IAL case ${i}: set, get, remove and empty checks match Go`, () => {
    assert.equal(c.steps.length, c.ops.length);
    const n = new Node(c.type);
    n.KramdownIAL = c.initial === null ? null : c.initial.map((kv) => [kv[0], kv[1]]);
    for (let k = 0; k < c.ops.length; k++) {
      const op = c.ops[k];
      let result: string | boolean | null = null;
      switch (op.op) {
        case "SetIALAttr":
          n.SetIALAttr(op.name ?? "", op.value ?? "");
          break;
        case "IALAttr":
          result = n.IALAttr(op.name ?? "");
          break;
        case "RemoveIALAttr":
          n.RemoveIALAttr(op.name ?? "");
          break;
        case "RemoveIALAttrsByPrefix":
          n.RemoveIALAttrsByPrefix(op.prefix ?? "");
          break;
        case "IsEmptyBlockIAL":
          result = n.IsEmptyBlockIAL();
          break;
        default:
          throw new Error("unknown IAL op " + op.op);
      }
      const step = c.steps[k];
      assert.deepEqual(encodeIAL(n.KramdownIAL), step.ial, "IAL after op " + k + " " + op.op);
      if (step.result !== null) {
        assert.deepEqual(result, step.result, "result of op " + k + " " + op.op);
      }
    }
  });
}

test("IAL value with quotes, newlines, braces, ampersand and CJK round-trips through SetIALAttr and IALAttr", () => {
  const n = new Node();
  const value = "a \"quoted\" {x}\nline & 中文 <b>";
  n.SetIALAttr("data-v", value);
  assert.equal(n.IALAttr("data-v"), value);
  n.SetIALAttr("data-v", "second");
  assert.equal(n.IALAttr("data-v"), "second");
  assert.equal(n.KramdownIAL?.length, 1);
  n.RemoveIALAttr("data-v");
  assert.equal(n.KramdownIAL?.length, 0);
});

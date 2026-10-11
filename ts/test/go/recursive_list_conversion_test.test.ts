// Port of test/recursive_list_conversion_test.go (TestConvertListType, TestConvertListTypePairs, TestConvertTaskListType,
// TestCancelListRecursively, TestCancelListKeepsExistingMultipleRootOrder and the helpers of the Go file).

import { test } from "node:test";
import assert from "node:assert/strict";
import { ast, New } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";

function newRecursiveListLute(): Lute {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetDataTask(true);
  luteEngine.SetKramdownIAL(true);
  return luteEngine;
}

function listTypes(luteEngine: Lute, html: string): number[] {
  const ret: number[] = [];
  const tree = luteEngine.BlockDOM2Tree(html)!;
  ast.Walk(tree.Root!, (n, entering) => {
    if (entering && ast.NodeList === n.Type) {
      ret.push(n.ListData!.Typ);
    }
    return ast.WalkContinue;
  });
  return ret;
}

function taskMarkerCount(luteEngine: Lute, html: string): number {
  let ret = 0;
  const tree = luteEngine.BlockDOM2Tree(html)!;
  ast.Walk(tree.Root!, (n, entering) => {
    if (entering && ast.NodeTaskListItemMarker === n.Type) {
      ret++;
    }
    return ast.WalkContinue;
  });
  return ret;
}

function assertOrderedListNumbers(luteEngine: Lute, html: string): void {
  const tree = luteEngine.BlockDOM2Tree(html)!;
  ast.Walk(tree.Root!, (n, entering) => {
    if (!entering || ast.NodeList !== n.Type || 1 !== n.ListData!.Typ) {
      return ast.WalkContinue;
    }
    let num = 1;
    for (let li = n.FirstChild; li !== null; li = li.Next) {
      if (ast.NodeListItem !== li.Type) {
        continue;
      }
      assert.equal(li.ListData!.Num, num, `unexpected ordered list number: got ${li.ListData!.Num}, want ${num}`);
      num++;
    }
    return ast.WalkContinue;
  });
}

function paragraphTexts(luteEngine: Lute, html: string): string[] {
  const ret: string[] = [];
  const tree = luteEngine.BlockDOM2Tree(html)!;
  ast.Walk(tree.Root!, (n, entering) => {
    if (entering && ast.NodeParagraph === n.Type) {
      ret.push(n.Text());
    }
    return ast.WalkContinue;
  });
  return ret;
}

test("TestConvertListType", () => {
  const luteEngine = newRecursiveListLute();
  const input = luteEngine.Md2BlockDOM("1. outer\n   1. nested\n      1. deep\n   - [ ] task\n     1. ordered in task", false);
  const converted = luteEngine.ConvertListType(input, "u");
  assert.deepEqual(listTypes(luteEngine, converted), [0, 0, 0, 0, 0], "unexpected list types");
  assert.equal(taskMarkerCount(luteEngine, converted), 0, "unexpected task marker count");
  assert.equal(luteEngine.ConvertListType(input, "invalid"), input, "invalid target type should keep the original HTML");

  const sameRootTypeInput = luteEngine.Md2BlockDOM("- outer\n  1. nested", false);
  const sameRootTypeConverted = luteEngine.ConvertListType(sameRootTypeInput, "u");
  assert.deepEqual(listTypes(luteEngine, sameRootTypeConverted), [0, 0], "unexpected same-root list types");
});

test("TestConvertListTypePairs", async (t) => {
  const tests = [
    { name: "unordered to ordered", markdown: "- outer\n  - nested", targetType: "o", targetTyp: 1 },
    { name: "unordered to task", markdown: "- outer\n  - nested", targetType: "t", targetTyp: 3 },
    { name: "ordered to unordered", markdown: "1. outer\n   1. nested", targetType: "u", targetTyp: 0 },
    { name: "ordered to task", markdown: "1. outer\n   1. nested", targetType: "t", targetTyp: 3 },
    { name: "task to unordered", markdown: "- [ ] outer\n  - [x] nested", targetType: "u", targetTyp: 0 },
    { name: "task to ordered", markdown: "- [ ] outer\n  - [x] nested", targetType: "o", targetTyp: 1 },
  ];
  const luteEngine = newRecursiveListLute();
  for (const tc of tests) {
    await t.test(tc.name, () => {
      const input = luteEngine.Md2BlockDOM(tc.markdown, false);
      const converted = luteEngine.ConvertListType(input, tc.targetType);
      assert.deepEqual(listTypes(luteEngine, converted), [tc.targetTyp, tc.targetTyp], "unexpected list types");
      if (3 === tc.targetTyp) {
        assert.equal(taskMarkerCount(luteEngine, converted), 2, "unexpected task marker count");
      } else {
        assert.equal(taskMarkerCount(luteEngine, converted), 0, "unexpected task marker count");
      }
      if (1 === tc.targetTyp) {
        assertOrderedListNumbers(luteEngine, converted);
      }
    });
  }
});

test("TestConvertTaskListType", () => {
  const luteEngine = newRecursiveListLute();
  const input = luteEngine.Md2BlockDOM("- [x] outer\n  - [ ] nested\n    1. ordered\n       - [ ] deep task", false);
  const converted = luteEngine.ConvertListType(input, "o");
  assert.deepEqual(listTypes(luteEngine, converted), [1, 1, 1, 1], "unexpected list types");
  assert.equal(taskMarkerCount(luteEngine, converted), 0, "unexpected task marker count");
  assertOrderedListNumbers(luteEngine, converted);
});

test("TestCancelListRecursively", () => {
  const luteEngine = newRecursiveListLute();
  const input = luteEngine.Md2BlockDOM("- outer\n  - nested\n    1. ordered\n       - deep unordered\n- tail", false);
  const shallow = luteEngine.CancelList(input);
  assert.deepEqual(listTypes(luteEngine, shallow), [0, 1, 0], "unexpected shallow list types");
  const converted = luteEngine.CancelListRecursively(input);
  assert.deepEqual(listTypes(luteEngine, converted), [1], "unexpected recursive list types");
  assert.deepEqual(paragraphTexts(luteEngine, converted), ["outer", "nested", "ordered", "deep unordered", "tail"], "unexpected paragraph order");
});

test("TestCancelListKeepsExistingMultipleRootOrder", () => {
  const luteEngine = newRecursiveListLute();
  const input = luteEngine.Md2BlockDOM("- list item\n\ntrailing paragraph", false);
  const converted = luteEngine.CancelList(input);
  assert.deepEqual(paragraphTexts(luteEngine, converted), ["trailing paragraph", "list item"], "unexpected paragraph order");
  const recursivelyConverted = luteEngine.CancelListRecursively(input);
  assert.deepEqual(paragraphTexts(luteEngine, recursivelyConverted), ["list item", "trailing paragraph"], "unexpected recursive paragraph order");
});

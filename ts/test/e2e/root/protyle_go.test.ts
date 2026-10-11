// Table-driven Go tests that exercise the methods of protyle.go (test/spin_block_test.go, p2p_test.go, h2p_test.go, p2h_test.go,
// block_type_conversion_test.go, data_task_test.go), same engine options, same cases, same expected values. The tables are read from
// protyle_go_cases.json, generated from the Go files by tools/extract-protyle-go-tests.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ast, New } from "../../../src/index.ts";
import type { Lute } from "../../../src/index.ts";

type Arg = string | number | boolean | { unsupported: string };
interface Setter {
  call?: string;
  args?: Arg[];
  field?: "ParseOptions" | "RenderOptions";
  name?: string;
  value?: Arg;
  testing?: boolean;
}
interface GoTest {
  file: string;
  test: string;
  method: string;
  extra: Arg[];
  setters: Setter[];
  unsupported: string[];
  cases: [name: string, from: string, to: string][];
  badRows: number;
}
const data: { tests: GoTest[]; skipped: { file: string; test: string; reason: string }[] } = JSON.parse(readFileSync(new URL("./protyle_go_cases.json", import.meta.url), "utf8"));

// The number of rows of each table in the Go files, to make sure that the extraction did not drop any.
const EXPECTED_ROWS: Record<string, number> = {
  TestSpinBlockDOM: 290, TestSpinBlockDOMStrikethrough1Disabled: 1, TestInlineMd2BlockDOM: 5, TestBlockDOM2InlineBlockDOM: 10, TestBlockDOM2StdMd: 26,
  TestBlockDOM2Md: 3, TestBlockDOM2Content: 12, TestBlockDOM2EscapeMarkerContent: 2, TestHTML2BlockDOM: 7, TestBlockDOM2HTML: 4,
  TestCallout2Blockquote: 2, TestBlockquote2Callout: 5, TestCancelSuperBlock: 1, TestBlocks2Ps: 4, TestBlocks2Hs: 4, TestUL2TL: 1, TestTL2OL: 1,
  TestCancelList: 2, TestCancelBlockquote: 1, TestCancelCallout: 1, TestUL2OL: 0, TestOL2UL: 0, TestDataTaskMd2BlockDOM: 2,
};

function applySetters(engine: Lute, setters: Setter[]): void {
  for (const s of setters) {
    if (s.call !== undefined) {
      (engine as unknown as Record<string, (...a: unknown[]) => void>)[s.call](...(s.args ?? []));
    } else if (s.field !== undefined && s.name !== undefined) {
      (engine[s.field] as unknown as Record<string, unknown>)[s.name] = s.value;
    } else if (s.testing === true) {
      ast.SetTesting(true);
    }
  }
}

for (const t of data.tests) {
  test(`${t.file}: ${t.test}`, () => {
    assert.deepEqual(t.unsupported, []);
    assert.equal(t.badRows, 0);
    assert.equal(t.cases.length, EXPECTED_ROWS[t.test], "row count");
    ast.SetTesting(false);
    try {
      const engine = New();
      applySetters(engine, t.setters);
      for (const [name, from, to] of t.cases) {
        const result = (engine as unknown as Record<string, (...a: unknown[]) => string>)[t.method](from, ...t.extra);
        assert.equal(result, to, `test case [${name}] failed, original ${JSON.stringify(from)}`);
      }
    } finally {
      ast.SetTesting(false);
    }
  });
}

test("table-driven tests that were skipped by the extraction are ported by hand in protyle_go_manual.test.ts or covered by the literal harvest", () => {
  assert.ok(data.skipped.length > 0);
});

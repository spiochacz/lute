// The global BlockDOM2Content of javascript/main.go (src/global.ts) against the oracle's global.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGlobal } from "../../../src/index.ts";
import { loadOracle } from "../../oracle/oracle.ts";
import { PROTYLE_BASE, CORPUS } from "../renderers/protyle_corpus.ts";
import { newEngines, oracleRaw } from "./protyle_flow_helpers.ts";

test("global BlockDOM2Content", () => {
  const port = makeGlobal();
  const oracle = loadOracle() as unknown as { BlockDOM2Content: (s: string) => string };
  const engines = newEngines(PROTYLE_BASE);
  let n = 0;
  for (const md of CORPUS.filter((_, i) => i % 5 === 0)) {
    const dom = oracleRaw(engines, "Md2BlockDOM", md, false);
    if (dom === null) {
      continue;
    }
    assert.equal(port.BlockDOM2Content(dom), oracle.BlockDOM2Content(dom), JSON.stringify(md));
    n++;
  }
  assert.ok(n > 30);
});

// protyle.go flow 2 (the editing loop): Md2BlockDOM(md) from the oracle, small edits of the kind the editor makes, SpinBlockDOM and the other
// DOM methods on the edited DOM; the oracle's spin output is fed back for two more rounds, every round compared with the port.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CORPUS, PROTYLE_BASE } from "../renderers/protyle_corpus.ts";
import { FULL, sample } from "../full.ts";
import { DOM_METHODS, bothThrew, compareCall, mutate, newEngines, oracleRaw, rng } from "./protyle_flow_helpers.ts";

const SETS: Record<string, [string, ...unknown[]][]> = {
  "siyuan": [["SetTextMark", true], ["SetHTMLTag2TextMark", true], ["SetSpin", true], ["SetCallout", true], ["SetTabs", true], ["SetCustomBlock", true], ["SetDataTask", true]],
  "base": [],
  "no text mark, autospace": [["SetAutoSpace", true], ["SetSpin", true]],
};

for (const [setName, setters] of Object.entries(SETS)) {
  test(`edit loop [${setName}]`, () => {
    const engines = newEngines([...PROTYLE_BASE, ...setters]);
    const failures: string[] = [];
    const r = rng(1234 + setName.length);
    const docs = sample(CORPUS, 0, FULL ? 1 : 24);
    for (const [i, md] of docs.entries()) {
      const dom = oracleRaw(engines, "Md2BlockDOM", md, false);
      if (dom === null) {
        continue;
      }
      for (let k = 0; k < (FULL ? 12 : 3); k++) {
        let edited = mutate(dom, r);
        if (edited !== null && r() < 0.3) {
          edited = mutate(edited, r) ?? edited;
        }
        if (edited === null) {
          continue;
        }
        const where = `doc ${i} edit ${k} [${setName}]`;
        let cur: string | null = edited;
        for (let round = 0; round < 3 && cur !== null; round++) {
          const next = compareCall(engines, failures, `${where} round ${round}`, "SpinBlockDOM", cur);
          if (round === 0) {
            for (const m of DOM_METHODS.filter((x) => x !== "SpinBlockDOM")) {
              compareCall(engines, failures, where, m, cur);
            }
          }
          cur = next;
        }
      }
    }
    assert.deepEqual(failures.slice(0, 5), []);
  });
}

test("both threw", () => {
  console.log("edit loop both threw:", JSON.stringify([...bothThrew.entries()]));
});

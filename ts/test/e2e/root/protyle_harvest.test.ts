// Literal harvest: every string literal of the Go test files that exercise protyle.go (including the tests that are not table-driven) is used as an
// input of every method, as Markdown (through the oracle's Md2BlockDOM), as a block DOM, and as HTML, and port and oracle are compared.
// The Go expected values of the non-table tests are NOT asserted here; see protyle_go.test.ts and the report.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROTYLE_BASE } from "../renderers/protyle_corpus.ts";
import { FULL, sample } from "../full.ts";
import { CONVERSION_METHODS, DOM_METHODS, bothThrew, compareCall, newEngines, oracleRaw } from "./protyle_flow_helpers.ts";

const LITERALS: string[] = JSON.parse(readFileSync(new URL("./protyle_go_literals.json", import.meta.url), "utf8"));
const DOMS = LITERALS.filter((s) => s.includes("<div"));
const MDS = LITERALS.filter((s) => !s.includes("<div") && !s.startsWith("<"));
const HTMLS = LITERALS.filter((s) => s.startsWith("<") || s.includes("</"));

const SETS: [string, [string, ...unknown[]][]][] = [
  ["siyuan", [["SetTextMark", true], ["SetHTMLTag2TextMark", true], ["SetSpin", true], ["SetCallout", true], ["SetTabs", true], ["SetCustomBlock", true], ["SetDataTask", true], ["SetKramdownBlockIAL", true]]],
  ["base", []],
  ["arbitrary task, ensure paragraph, unordered marker", [["SetArbitraryTaskListItemMarker", true], ["SetEnsureListItemParagraph", true], ["SetUnorderedListMarker", "-"], ["SetTabs", true], ["SetTextMark", true]]],
];

test("literals were extracted", () => {
  assert.ok(LITERALS.length > 1500, String(LITERALS.length));
});

for (const [name, setters] of SETS) {
  test(`block DOM literals [${name}]`, () => {
    const engines = newEngines([...PROTYLE_BASE, ...setters]);
    const failures: string[] = [];
    for (const [i, dom] of sample(DOMS, 0, FULL ? 1 : 60).entries()) {
      for (const m of [...DOM_METHODS, ...CONVERSION_METHODS]) {
        compareCall(engines, failures, `dom ${i} [${name}]`, m, dom);
      }
      for (const t of ["u", "o", "t", "x"]) {
        compareCall(engines, failures, `dom ${i} [${name}]`, "ConvertListType", dom, t);
      }
      compareCall(engines, failures, `dom ${i} [${name}]`, "Blocks2Hs", dom, "3");
    }
    assert.deepEqual(failures.slice(0, 5), []);
  });
  test(`Markdown literals [${name}]`, () => {
    const engines = newEngines([...PROTYLE_BASE, ...setters]);
    const failures: string[] = [];
    for (const [i, md] of sample(MDS, 0, FULL ? 1 : 80).entries()) {
      compareCall(engines, failures, `md ${i} [${name}]`, "Md2BlockDOM", md, true);
      compareCall(engines, failures, `md ${i} [${name}]`, "Md2BlockDOMWithAutoLink", md, false);
      compareCall(engines, failures, `md ${i} [${name}]`, "InlineMd2BlockDOM", md);
      const dom = oracleRaw(engines, "Md2BlockDOM", md, false);
      if (dom !== null) {
        for (const m of DOM_METHODS) {
          compareCall(engines, failures, `md ${i} [${name}]`, m, dom);
        }
      }
    }
    assert.deepEqual(failures.slice(0, 5), []);
  });
  test(`HTML literals [${name}]`, () => {
    const engines = newEngines([...PROTYLE_BASE, ...setters]);
    const failures: string[] = [];
    for (const [i, h] of sample(HTMLS, 0, FULL ? 1 : 32).entries()) {
      compareCall(engines, failures, `html ${i} [${name}]`, "HTML2BlockDOM", h);
    }
    assert.deepEqual(failures.slice(0, 5), []);
  });
}

test("both threw", () => {
  console.log("harvest both threw:", JSON.stringify([...bothThrew.entries()]));
});

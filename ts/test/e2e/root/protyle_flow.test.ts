// protyle.go against the reference bundle, flow 1: Md2BlockDOM(md) -> BlockDOM2Md / BlockDOM2StdMd / BlockDOM2HTML / BlockDOM2Content / text methods /
// BlockDOM2RichHTML / BlockDOM2InlineBlockDOM / SpinBlockDOM, plus the conversion methods (flow 4), on the Markdown corpus. The DOM comes from the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readRepoFile } from "../helpers.ts";
import { CORPUS, PROTYLE_BASE, VARIATIONS } from "../renderers/protyle_corpus.ts";
import { FULL, sample } from "../full.ts";

const QUICK_FILES = (all: string[]): string[] => (FULL ? all : all.slice(0, 2));
import { CONVERSION_METHODS, DOM_METHODS, bothThrew, bothThrewExamples, compareCall, newEngines, oracleRaw } from "./protyle_flow_helpers.ts";

interface SpecCase {
  example: number;
  markdown: string;
}

const SPEC = (JSON.parse(readRepoFile("test/commonmark-spec.json")) as SpecCase[]).map((c) => c.markdown);
const FILES = ["test/case1.md", "README.md", "test/format-case0.md", "test/format-case1.md", "test/format-case2.md", "test/format-case3.md", "test/format-case4.md", "test/format-case5.md", "test/format-case6.md", "test/format-case7.md", "test/gfm-spec.md"].map(readRepoFile);
const BIG = readRepoFile("benchmark/commonmark-spec.md").split("\n").slice(0, 1500).join("\n");

const SETS: Record<string, [string, ...unknown[]][]> = {
  base: [],
  "siyuan (text mark, spin)": [["SetTextMark", true], ["SetHTMLTag2TextMark", true], ["SetSpin", true], ["SetCallout", true], ["SetTabs", true], ["SetCustomBlock", true], ["SetDataTask", true]],
};

function run(setName: string, docs: readonly string[], methods: readonly string[], label: string): string[] {
  const engines = newEngines([...PROTYLE_BASE, ...SETS[setName]]);
  const failures: string[] = [];
  for (const [i, md] of docs.entries()) {
    const dom = oracleRaw(engines, "Md2BlockDOM", md, false);
    if (dom === null) {
      continue;
    }
    for (const m of methods) {
      compareCall(engines, failures, `${label} ${i} [${setName}]`, m, dom);
    }
  }
  return failures;
}

for (const setName of Object.keys(SETS)) {
  test(`spec cases: DOM methods [${setName}]`, () => {
    assert.deepEqual(run(setName, sample(SPEC, 0, FULL ? 1 : 40), DOM_METHODS, "spec").slice(0, 5), []);
  });
  test(`spec cases: conversion methods [${setName}]`, () => {
    assert.deepEqual(run(setName, sample(SPEC, 1, FULL ? 2 : 60), CONVERSION_METHODS, "spec").slice(0, 5), []);
  });
  test(`short documents: DOM and conversion methods [${setName}]`, () => {
    assert.deepEqual(run(setName, sample(CORPUS, 0, FULL ? 2 : 50), [...DOM_METHODS, ...CONVERSION_METHODS], "corpus").slice(0, 5), []);
  });
  test(`whole files [${setName}]`, () => {
    assert.deepEqual(run(setName, QUICK_FILES(FILES.slice(0, 2).concat(FULL ? [...FILES.slice(2), BIG] : [])), [...DOM_METHODS, ...CONVERSION_METHODS], "file").slice(0, 5), []);
  });
}

test("short documents under the single option variations", () => {
  const failures: string[] = [];
  for (const [vi, v] of VARIATIONS.entries()) {
    const engines = newEngines([...PROTYLE_BASE, ...v.setters]);
    for (const [i, md] of sample(CORPUS, vi, FULL ? 1 : 600).entries()) {
      const dom = oracleRaw(engines, "Md2BlockDOM", md, false);
      if (dom === null) {
        continue;
      }
      for (const m of [...DOM_METHODS, ...CONVERSION_METHODS]) {
        compareCall(engines, failures, `corpus ${i} [${v.name}]`, m, dom);
      }
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("Md2BlockDOM* and InlineMd2BlockDOM on the corpus", () => {
  const failures: string[] = [];
  const engines = newEngines([...PROTYLE_BASE, ["SetTextMark", true], ["SetHTMLTag2TextMark", true]]);
  for (const [i, md] of sample(CORPUS, 0, FULL ? 2 : 24).entries()) {
    compareCall(engines, failures, `corpus ${i}`, "Md2BlockDOM", md, true);
    compareCall(engines, failures, `corpus ${i}`, "Md2BlockDOMWithAutoLink", md, false);
    compareCall(engines, failures, `corpus ${i}`, "InlineMd2BlockDOM", md);
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("inputs on which both engines threw", () => {
  console.log("both threw:", JSON.stringify([...bothThrew.entries()]), JSON.stringify([...bothThrewExamples.entries()]).slice(0, 600));
});

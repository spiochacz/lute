// Shared body of the VditorIRRenderer and VditorSVRenderer end-to-end tests: the port against the reference bundle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSameOutcome, newEngines, readRepoFile } from "../helpers.ts";
import type { Engines, Outcome } from "../helpers.ts";
import { CARET_SPECIAL, caretVariants, snippets } from "./vditor_helpers.ts";
import type { VditorSet } from "./vditor_helpers.ts";
import { FULL, sample } from "../full.ts";

interface SpecCase {
  section: string;
  example: number;
  markdown: string;
}

type Both = (engines: Engines, markdown: string) => { port: Outcome; oracle: Outcome };

const FILES = [
  "test/case1.md",
  "README.md",
  "test/format-case0.md",
  "test/format-case1.md",
  "test/format-case2.md",
  "test/format-case3.md",
  "test/format-case4.md",
  "test/format-case5.md",
  "test/format-case6.md",
  "test/format-case7.md",
];
const BIG_FILES = ["test/gfm-spec.md"];

export function registerSuite(label: string, both: Both, sets: VditorSet[]): void {
  // Inputs on which the oracle and the port both throw; they count as equal and are reported.
  const bothThrew: string[] = [];

  function compare(engines: Engines, where: string, markdown: string, failures: string[]): void {
    const r = both(engines, markdown);
    try {
      if (assertSameOutcome(where, r.port, r.oracle) === "bothThrew") {
        bothThrew.push(where + " " + JSON.stringify(markdown));
      }
    } catch (e) {
      failures.push((e as Error).message + "\n  input: " + JSON.stringify(markdown));
    }
  }

  function setNamed(name: string): VditorSet {
    const s = sets.find((x) => x.name === name);
    assert.ok(s, name);
    return s;
  }

  test(`${label}: CommonMark spec cases, default and mode-on option sets`, () => {
    const cases = JSON.parse(readRepoFile("test/commonmark-spec.json")) as SpecCase[];
    assert.equal(cases.length, 652);
    const failures: string[] = [];
    // Quick run (see ../full.ts): without the "default" set.
    for (const name of FULL ? ["default", "mode on", "vditor typical"] : ["mode on", "vditor typical"]) {
      const engines = newEngines(setNamed(name).setters);
      for (const c of cases) {
        compare(engines, `[spec ${c.example} / ${name}]`, c.markdown, failures);
      }
    }
    assert.deepEqual(failures.slice(0, 5), []);
  });

  test(`${label}: whole files`, () => {
    const failures: string[] = [];
    // Quick run: without "ToC" and "inline math".
    for (const name of FULL ? ["default", "mode on", "vditor typical", "ToC", "kramdown IAL", "inline math"] : ["default", "mode on", "vditor typical", "kramdown IAL"]) {
      const engines = newEngines(setNamed(name).setters);
      for (const file of FILES) {
        compare(engines, `[${file} / ${name}]`, readRepoFile(file), failures);
      }
    }
    // Quick run: the big files under "mode on" only.
    for (const name of FULL ? ["mode on", "vditor typical"] : ["mode on"]) {
      const engines = newEngines(setNamed(name).setters);
      for (const file of BIG_FILES) {
        compare(engines, `[${file} / ${name}]`, readRepoFile(file), failures);
      }
      const lines = readRepoFile("benchmark/commonmark-spec.md").split("\n").slice(0, 2000).join("\n");
      compare(engines, `[benchmark/commonmark-spec.md first 2000 lines / ${name}]`, lines, failures);
    }
    assert.deepEqual(failures.slice(0, 5), []);
  });

  test(`${label}: hand-written documents under every option set`, () => {
    const docs = snippets();
    assert.ok(docs.length >= 100, String(docs.length));
    const failures: string[] = [];
    for (const [setIndex, set] of sets.entries()) {
      const engines = newEngines(set.setters);
      // Quick run: the main sets see every document, the others a sample.
      for (const d of ["default", "mode on", "vditor typical"].includes(set.name) ? docs : sample(docs, setIndex, 6)) {
        compare(engines, `[${set.name}]`, d, failures);
      }
    }
    assert.deepEqual(failures.slice(0, 5), []);
  });

  test(`${label}: documents with the caret at many positions`, () => {
    const docs: string[] = [];
    for (const s of snippets()) {
      docs.push(...caretVariants(s));
    }
    assert.ok(docs.length >= 300, String(docs.length));
    const failures: string[] = [];
    // Quick run (see ../full.ts): without the "default" set.
    for (const name of FULL ? ["mode on", "vditor typical", "default"] : ["mode on", "vditor typical"]) {
      const engines = newEngines(setNamed(name).setters);
      // Quick run: the second set sees every third document.
      for (const d of "mode on" === name ? docs : sample(docs, 0, 3)) {
        compare(engines, `[caret / ${name}]`, d, failures);
      }
    }
    assert.deepEqual(failures.slice(0, 5), []);
  });

  test(`${label}: special caret positions under every option set`, () => {
    assert.ok(CARET_SPECIAL.length >= 90, String(CARET_SPECIAL.length));
    const failures: string[] = [];
    for (const set of sets) {
      const engines = newEngines(set.setters);
      for (const d of CARET_SPECIAL) {
        compare(engines, `[special caret / ${set.name}]`, d, failures);
      }
    }
    assert.deepEqual(failures.slice(0, 5), []);
  });

  test(`${label}: report`, () => {
    if (bothThrew.length > 0) {
      console.log(`${label}: oracle and port both threw on ${bothThrew.length} inputs, first: ${bothThrew.slice(0, 5).join(" | ")}`);
    }
  });
}

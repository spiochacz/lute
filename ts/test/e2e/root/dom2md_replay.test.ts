// Milestone A of the per-child cache (tasks/004-incremental-and-fast-paths.md, section "Mismatch analysis and fix specification"):
// the output of VditorDOM2Md / VditorIRDOM2Md must be reproducible as the replay of the root-writer operations recorded per
// top-level node (H5, the first of the three tests). The recording renderer (render/recording_format_renderer.ts) runs the same
// stages as the public method, and the replay (ReplayFormatLogs) assembles the document from the logs with the engine's own
// document close. Both the recorder's own output and the replay must equal the normal output, and the LastOut after every
// top-level node must agree. Plain FormatStr is checked the same way, which covers the root-writer operations of the Markdown
// formatter without the Vditor DOM stages.
// DOM inputs come from the oracle's forward methods (Md2VditorDOM, Md2VditorIRDOM) and from the hand-written DOMs of the
// wysiwyg test, as in the other end-to-end tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  New,
  editor,
  parse,
  render,
  vditorDOM2MdBuildTree,
  vditorDOM2MdPrepare,
  vditorDOM2MdRenderOptions,
  vditorIRDOM2MdBuildTree,
  vditorIRDOM2MdPrepare,
  vditorIRDOM2MdRenderOptions,
} from "../../../src/index.ts";
import type { Lute } from "../../../src/index.ts";
import * as conv from "../../../src/runtime/conv.ts";
import { newEngines, normalizeOutput } from "../helpers.ts";
import type { Engines, SetterCall } from "../helpers.ts";
import { FULL, sample } from "../full.ts";
import { IR_SETS } from "../renderers/vditor_helpers.ts";
import { fileDocs, markdownCorpus, mutations, RAW_DOMS, SETS, spread, WYSIWYG } from "../dom_corpus.ts";
import { oracleRaw } from "./vditor_flow_helpers.ts";

type Mode = "wysiwyg" | "ir";

const ZWSP = editor.Zwsp;

const WYSIWYG_ONLY: SetterCall[] = [WYSIWYG];

// The public method: the engine's normal output, which the replay must equal.
function normalOutput(lute: Lute, mode: Mode, html: string): string {
  return mode === "wysiwyg" ? lute.VditorDOM2Md(html) : lute.VditorIRDOM2Md(html);
}

// The same conversion through the stages of the public method, rendered with the recording renderer and replayed from its logs.
// The public method removes the ZWSP of its input before the stages and from its output after them; the same is done here.
// It returns null where the public method returns "" before any rendering.
function replayOutput(lute: Lute, mode: Mode, html: string): { replayed: string; recorded: string } | null {
  const input = html.split(ZWSP).join("");
  const root = mode === "wysiwyg" ? vditorDOM2MdPrepare(lute, input) : vditorIRDOM2MdPrepare(lute, input);
  if (null === root) {
    return null;
  }
  const tree = mode === "wysiwyg" ? vditorDOM2MdBuildTree(lute, root) : vditorIRDOM2MdBuildTree(lute, root);
  const options = mode === "wysiwyg" ? vditorDOM2MdRenderOptions() : vditorIRDOM2MdRenderOptions();
  const [recordedBytes, logs] = render.NewRecordingFormatRenderer(tree, options, lute.ParseOptions).RenderWithLogs();
  const trace = render.ReplayFormatLogsTrace(logs);
  assert.deepEqual(trace.lastOuts, logs.pieces.map((p) => p.lastOut), "the LastOut after a top-level node differs between the replay and the recording");
  return {
    replayed: conv.StringFromBytes(trace.output).split(ZWSP).join(""),
    recorded: conv.StringFromBytes(recordedBytes).split(ZWSP).join(""),
  };
}

interface Counters {
  compared: number;
  bothThrew: number;
  failures: string[];
}

function newCounters(): Counters {
  return { compared: 0, bothThrew: 0, failures: [] };
}

// Compares the replay with the normal output of one DOM under one option set. A normal output that throws is not a replay question.
function check(lute: Lute, mode: Mode, label: string, html: string, counters: Counters): void {
  let normal: string;
  try {
    normal = normalOutput(lute, mode, html);
  } catch {
    counters.bothThrew++;
    return;
  }
  counters.compared++;
  let got: { replayed: string; recorded: string } | null;
  try {
    got = replayOutput(lute, mode, html);
  } catch (e) {
    counters.failures.push(`${label} ${JSON.stringify(html)}: the replay threw: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (null === got) {
    if ("" !== normal) {
      counters.failures.push(`${label} ${JSON.stringify(html)}: the normal output is ${JSON.stringify(normal)}, the stages give none`);
    }
    return;
  }
  if (got.recorded !== normal) {
    counters.failures.push(`${label} ${JSON.stringify(html)}: the recording renderer gives ${JSON.stringify(got.recorded)}, normal ${JSON.stringify(normal)}`);
  }
  if (got.replayed !== normal) {
    counters.failures.push(`${label} ${JSON.stringify(html)}: the replay gives ${JSON.stringify(got.replayed)}, normal ${JSON.stringify(normal)}`);
  }
}

function report(name: string, counters: Counters): void {
  console.log(`${name}: ${counters.compared} comparisons, ${counters.bothThrew} where the normal output throws, ${counters.failures.length} failures`);
}

// Fixed cases: the document of repro/cases.ts (leading U+3000 and a later list, whose trim removes the U+3000), a whitespace-only
// first paragraph, and an orphan list item at the top level. The expected texts are the engine's normal output.
const FIXED: Array<{ name: string; html: string; expected: string }> = [
  {
    name: "U+3000 paragraph before a list",
    html: '<p data-block="0">　 a</p><ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">x</li></ul>',
    expected: "a\n\n* x\n",
  },
  {
    name: "whitespace-only paragraph before a list",
    html: '<p data-block="0">　</p><ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">x</li></ul>',
    expected: "* x\n",
  },
  {
    name: "orphan list item",
    html: "<li>orphan</li>",
    expected: "* orphan\n",
  },
];

test("WYSIWYG: replay equals VditorDOM2Md on the Markdown corpus, option sets of the wysiwyg test", () => {
  const counters = newCounters();
  const docs = markdownCorpus();
  const main = ["wysiwyg", "wysiwyg + all previews"];
  SETS.forEach((set, index) => {
    const engines: Engines = newEngines(set.setters);
    const run = main.includes(set.name) ? sample(docs, index, 4) : sample(docs, index, 16);
    for (const md of run) {
      const dom = oracleRaw(engines, "Md2VditorDOM", md);
      if (null === dom) {
        continue;
      }
      check(engines.port, "wysiwyg", set.name, dom, counters);
    }
  });
  report("wysiwyg corpus", counters);
  assert.ok(counters.compared > 100, `only ${counters.compared} comparisons`);
  assert.deepEqual(counters.failures, []);
});

test("WYSIWYG: replay equals VditorDOM2Md on edited and hand-written DOMs", () => {
  const counters = newCounters();
  for (const name of ["default", "wysiwyg", "protyle wysiwyg"]) {
    const set = SETS.find((s) => s.name === name);
    assert.ok(set, name);
    const engines = newEngines(set.setters);
    for (const dom of RAW_DOMS) {
      check(engines.port, "wysiwyg", name, dom, counters);
    }
  }
  const engines = newEngines(WYSIWYG_ONLY);
  for (const md of sample(markdownCorpus(), 0, FULL ? 1 : 40)) {
    const dom = oracleRaw(engines, "Md2VditorDOM", md);
    if (null === dom) {
      continue;
    }
    for (const variant of spread(mutations(dom, 3), 6)) {
      check(engines.port, "wysiwyg", "wysiwyg edit", variant, counters);
    }
  }
  report("wysiwyg hand-written and edited", counters);
  assert.ok(counters.compared > 300, `only ${counters.compared} comparisons`);
  assert.deepEqual(counters.failures, []);
});

test("IR: replay equals VditorIRDOM2Md on the Markdown corpus, the IR option sets", () => {
  const counters = newCounters();
  const docs = markdownCorpus();
  IR_SETS.forEach((set, index) => {
    const engines = newEngines(set.setters);
    for (const md of sample(docs, index, FULL ? 1 : 24)) {
      const dom = oracleRaw(engines, "Md2VditorIRDOM", md);
      if (null === dom) {
        continue;
      }
      check(engines.port, "ir", set.name, dom, counters);
    }
  });
  report("IR corpus", counters);
  assert.ok(counters.compared > 100, `only ${counters.compared} comparisons`);
  assert.deepEqual(counters.failures, []);
});

test("IR: replay equals VditorIRDOM2Md on hand-written DOMs", () => {
  const counters = newCounters();
  for (const set of IR_SETS.filter((s) => ["default", "mode on"].includes(s.name))) {
    const engines = newEngines(set.setters);
    for (const dom of RAW_DOMS) {
      check(engines.port, "ir", set.name, dom, counters);
    }
  }
  report("IR hand-written", counters);
  assert.deepEqual(counters.failures, []);
});

test("Markdown: replay equals FormatStr on the Markdown corpus and the repository documents", () => {
  const docs = [...markdownCorpus(), ...fileDocs()];
  const sets: SetterCall[][] = [
    [],
    [["SetKramdownIAL", true]],
    [["SetChineseParagraphBeginningSpace", true]],
    [["SetAutoSpace", true], ["SetFixTermTypo", true]],
    [["SetProtyleWYSIWYG", true]],
  ];
  let compared = 0;
  const failures: string[] = [];
  sets.forEach((setters, index) => {
    const lute = New();
    for (const [name, ...args] of setters) {
      (lute as unknown as Record<string, (...a: unknown[]) => void>)[name](...args);
    }
    for (const md of sample(docs, index, FULL ? 1 : 6)) {
      let normal: string;
      try {
        normal = lute.FormatStr("", md);
      } catch {
        continue;
      }
      compared++;
      const tree = parse.Parse("", conv.BytesFromString(md), lute.ParseOptions);
      const [recorded, logs] = render.NewRecordingFormatRenderer(tree, lute.RenderOptions, lute.ParseOptions).RenderWithLogs();
      const trace = render.ReplayFormatLogsTrace(logs);
      assert.deepEqual(trace.lastOuts, logs.pieces.map((p) => p.lastOut));
      // FormatStr generates node IDs from the clock and a counter, so each render has its own; the IDs are normalised before the
      // comparison with the normal output (normalizeOutput numbers the IDs by first occurrence, as in the other end-to-end tests).
      // The replay and the recorder are compared exactly, since they carry the same bytes.
      const replayed = conv.StringFromBytes(trace.output);
      const recordedStr = conv.StringFromBytes(recorded);
      if (replayed !== recordedStr) {
        failures.push(`set ${index}, replay differs from the recording: ${JSON.stringify(md.slice(0, 80))}`);
      } else if (normalizeOutput(replayed) !== normalizeOutput(normal)) {
        failures.push(`set ${index}: ${JSON.stringify(md.slice(0, 80))}`);
      }
    }
  });
  console.log(`FormatStr: ${compared} comparisons, ${failures.length} failures`);
  assert.ok(compared > 100, `only ${compared} comparisons`);
  assert.deepEqual(failures, []);
});

test("fixed cases: the replay equals the normal output and the normal output is the expected text", () => {
  const engines = newEngines(WYSIWYG_ONLY);
  const irEngines = newEngines([["SetVditorIR", true]]);
  for (const c of FIXED) {
    const normal = engines.port.VditorDOM2Md(c.html);
    assert.equal(normal, c.expected, c.name);
    const counters = newCounters();
    check(engines.port, "wysiwyg", c.name, c.html, counters);
    assert.deepEqual(counters.failures, [], c.name);
    const irNormal = irEngines.port.VditorIRDOM2Md(c.html);
    const irCounters = newCounters();
    check(irEngines.port, "ir", c.name + " (IR)", c.html, irCounters);
    assert.deepEqual(irCounters.failures, [], c.name + " (IR)");
    assert.equal(typeof irNormal, "string");
  }
});

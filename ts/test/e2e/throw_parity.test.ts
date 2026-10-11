// Throw-parity scan. For many inputs and several engine configurations, the string-taking methods of the port and of the reference bundle
// (the oracle) must either both return or both throw. The output is NOT compared here (other tests do that), so the scan stays cheap.
//
// Stage 1 calls the forward methods on documents: the existing corpora with the caret inserted at every position of each short document,
// and random sequences of Markdown and HTML markers. Stage 2 takes the DOM that the ORACLE returns for a document (so that DOM inputs are
// well-formed, as the editors produce them) and feeds it to the reverse methods on both sides.
//
// On a mismatch the failing input is reduced by delta debugging (drop chunks, then single characters, while the mismatch persists) and
// reported with the method, the configuration and the messages of the side that threw. A port that returns where Go panics needs an
// explicit throw at the place of the panic (`// PORT-NOTE: Go panics here` plus `// UPSTREAM-BUG:`).
//
// The default run uses a deterministic sample (about 5 s); `npm run test:full` scans everything below (see ./full.ts).
// The generators use a fixed seed, so every run sees the same inputs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCorpus } from "./renderers/format_corpus.ts";
import { CARET_DOCS, JSON_DOCS } from "./renderers/json_vditor_corpus.ts";
import { CORPUS as PROTYLE_CORPUS } from "./renderers/protyle_corpus.ts";
import { FRAGMENTS as H2M_FRAGMENTS } from "./root/h2m_fragments.ts";
import { newEngines, readRepoFile } from "./helpers.ts";
import type { Engines, SetterCall } from "./helpers.ts";
import { OPTION_SETS } from "./option_sets.ts";
import { FULL } from "./full.ts";

const CARET = "‸";

// Sizes of the scan. The quick run keeps the number of calls at a few thousand per stage.
const SHORT_DOC_LIMIT = FULL ? 40 : 24; // a document up to this many characters gets the caret at every position
const CORPUS_INPUTS = FULL ? 1200 : 30; // documents of the corpora that are scanned (after the seeded shuffle)
const RANDOM_INPUTS = FULL ? 1000 : 30; // random token sequences
const DOM_INPUTS = FULL ? 400 : 18; // documents of stage 2
const REDUCTION_BUDGET = 3000; // predicate calls per reduction

// Deterministic generator (mulberry32).
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const r = rng(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Inserts the caret before every code point of s and at the end; surrogate pairs stay whole.
function caretEverywhere(s: string): string[] {
  const points = Array.from(s);
  const out: string[] = [];
  for (let i = 0; i <= points.length; i++) {
    out.push(points.slice(0, i).join("") + CARET + points.slice(i).join(""));
  }
  return out;
}

// Configurations

interface Config {
  name: string;
  setters: SetterCall[];
}

function optionSet(name: string): SetterCall[] {
  const set = OPTION_SETS.find((s) => s.name === name);
  if (set === undefined) {
    throw new Error(`no option set ${name}`);
  }
  return set.setters;
}

const CONFIGS: Config[] = [
  { name: "default", setters: [] },
  { name: "Vditor WYSIWYG", setters: optionSet("Vditor WYSIWYG") },
  { name: "Vditor IR", setters: optionSet("Vditor IR") },
  { name: "Vditor SV", setters: optionSet("Vditor SV") },
  { name: "Protyle", setters: optionSet("Protyle") },
  { name: "everything on", setters: optionSet("everything on") },
];

const engineCache = new Map<string, Engines>();
function enginesFor(config: Config): Engines {
  let e = engineCache.get(config.name);
  if (e === undefined) {
    e = newEngines(config.setters);
    engineCache.set(config.name, e);
  }
  return e;
}

// Methods

type Call = (engine: object, input: string) => unknown;
interface Method {
  name: string;
  call: Call;
}

function viaName(name: string, ...extra: (string | boolean)[]): Method {
  return {
    name,
    call: (engine, input) => {
      const fn = (engine as Record<string, unknown>)[name];
      if (typeof fn !== "function") {
        throw new Error(`no method ${name}`);
      }
      return fn.call(engine, ...(name === "MarkdownStr" || name === "FormatStr" ? ["", input] : [input]), ...extra);
    },
  };
}

const FORWARD: Method[] = [
  viaName("MarkdownStr"),
  viaName("FormatStr"),
  viaName("Md2VditorDOM"),
  viaName("Md2VditorIRDOM"),
  viaName("Md2VditorSVDOM"),
  viaName("Md2BlockDOM", false),
  viaName("RenderJSON"),
  viaName("HTML2Md"),
];

const BLOCK_REVERSE = ["SpinBlockDOM", "BlockDOM2Md", "BlockDOM2StdMd", "BlockDOM2HTML", "BlockDOM2RichHTML", "BlockDOM2Content"].map((n) => viaName(n));
const WYSIWYG_REVERSE = ["SpinVditorDOM", "VditorDOM2Md"].map((n) => viaName(n));
const IR_REVERSE = ["SpinVditorIRDOM", "VditorIRDOM2Md"].map((n) => viaName(n));

interface Side {
  threw: boolean;
  message: string;
  value: unknown;
}

function run(engine: object, method: Method, input: string): Side {
  try {
    return { threw: false, message: "", value: method.call(engine, input) };
  } catch (e) {
    return { threw: true, message: e instanceof Error ? e.message : String(e), value: undefined };
  }
}

// True when exactly one side throws.
function mismatch(engines: Engines, method: Method, input: string): boolean {
  return run(engines.port, method, input).threw !== run(engines.oracle, method, input).threw;
}

// Delta debugging: the smallest input (by code points) that still satisfies fails(), as far as the budget allows.
function reduce(input: string, fails: (s: string) => boolean): string {
  let points = Array.from(input);
  let budget = REDUCTION_BUDGET;
  const test = (candidate: string[]): boolean => {
    if (budget-- <= 0) {
      return false;
    }
    return fails(candidate.join(""));
  };
  let granularity = 2;
  while (points.length >= 2 && budget > 0) {
    const size = Math.ceil(points.length / granularity);
    let reduced = false;
    // Try to keep a single chunk, then to drop a single chunk.
    for (let start = 0; start < points.length && !reduced; start += size) {
      const chunk = points.slice(start, start + size);
      if (chunk.length < points.length && test(chunk)) {
        points = chunk;
        granularity = 2;
        reduced = true;
      }
    }
    for (let start = 0; start < points.length && !reduced; start += size) {
      const rest = points.slice(0, start).concat(points.slice(start + size));
      if (rest.length > 0 && test(rest)) {
        points = rest;
        granularity = Math.max(granularity - 1, 2);
        reduced = true;
      }
    }
    if (!reduced) {
      if (size === 1) {
        break;
      }
      granularity = Math.min(points.length, granularity * 2);
    }
  }
  return points.join("");
}

// Collector of mismatches: one reduced report per method and configuration.
class Report {
  readonly lines: string[] = [];
  private readonly seen = new Set<string>();
  calls = 0;
  bothThrew = 0;
  bothReturned = 0;

  check(config: Config, stage: string, method: Method, input: string): void {
    const engines = enginesFor(config);
    const p = run(engines.port, method, input);
    const o = run(engines.oracle, method, input);
    this.calls++;
    if (p.threw === o.threw) {
      if (p.threw) {
        this.bothThrew++;
      } else {
        this.bothReturned++;
      }
      return;
    }
    const key = `${stage} ${method.name} ${config.name}`;
    if (this.seen.has(key)) {
      return;
    }
    this.seen.add(key);
    const small = reduce(input, (s) => mismatch(engines, method, s));
    const ps = run(engines.port, method, small);
    const os = run(engines.oracle, method, small);
    this.lines.push(
      `${stage} ${method.name} [${config.name}]: ${os.threw ? `oracle threw (${os.message}) and the port returned` : `port threw (${ps.message}) and the oracle returned`}; ` +
        `reduced input ${JSON.stringify(small)} (original length ${Array.from(input).length})`,
    );
  }
}

// Inputs

interface SpecCase {
  markdown: string;
}

function corpusDocs(): string[] {
  const spec = (JSON.parse(readRepoFile("test/commonmark-spec.json")) as SpecCase[]).map((c) => c.markdown);
  const pool = new Set<string>();
  for (const list of [spec, buildCorpus(), JSON_DOCS, CARET_DOCS, PROTYLE_CORPUS, H2M_FRAGMENTS]) {
    for (const d of list) {
      pool.add(d);
    }
  }
  return [...pool];
}

// Documents of the corpora, short ones with the caret at every position, the others as they are.
function buildCorpusInputs(): string[] {
  const docs = shuffled(corpusDocs(), 20260101);
  const out: string[] = [];
  const withCaret: string[] = [];
  for (const d of docs) {
    if (d.includes(CARET)) {
      out.push(d);
    } else if (Array.from(d).length <= SHORT_DOC_LIMIT) {
      withCaret.push(...caretEverywhere(d));
    } else {
      out.push(d);
    }
  }
  // Mix both groups so that a cut keeps the proportions.
  const mixed = shuffled(out.concat(withCaret), 20260102);
  return mixed.slice(0, CORPUS_INPUTS);
}

const TOKENS: string[] = [
  "#", "# ", "## ", "###### ", "####### ", "- ", "* ", "+ ", "1. ", "2) ", "> ", ">", "- [ ] ", "- [x] ", "```", "~~~", "```js\n", "`", "``", "*", "**", "_", "__", "~~", "==", "^", "~", "$", "$$",
  "[", "]", "](", ")", "![", "(", "[^1]", "[^1]: ", "[x]: ", "<", ">", "</", "/>", "<div>", "</div>", "<span data-type=\"strong\">", "</span>", "<br>", "<br/>", "<p>", "</p>", "<h1>", "</h1>", "<h7>",
  "<ul>", "<li>", "</li>", "</ul>", "<table>", "<tr>", "<td>", "<th>", "</table>", "<pre>", "<code>", "</code>", "</pre>", "<img src=\"a\">", "<a href=\"u\">", "</a>", "<!--", "-->", "<wbr>", "<details>", "<summary>",
  "|", "| a | b |\n", "|---|---|\n", ":---:", "---", "***", "___", "===", "\n", "\n\n", "\n\n\n", " ", "  ", "    ", "\t", "\r\n", "\\", "&amp;", "&#35;", "&nbsp;", "&", ";",
  "{: id=\"20200101010101-abcdefg\"}", "{: ", "}", "{{{", "}}}", "((", "))", "((20200101010101-abcdefg \"a\"))", "{{", "[[", "]]", ":smile:", "http://a.b", "www.a.com", "a@b.co", "<http://a.b>", "#tag#",
  "[TOC]", "[toc]", "> [!NOTE]\n", "---\ntitle: t\n---\n", "<<<<<<< HEAD\n", "=======\n", ">>>>>>> x\n", "​", CARET, "text", "a", "foo", "中文", "é", "😀", "\u0000", "�",
];

function buildRandomInputs(): string[] {
  const r = rng(424242);
  const out: string[] = [];
  for (let i = 0; i < RANDOM_INPUTS; i++) {
    const n = 1 + Math.floor(r() * 9);
    let s = "";
    for (let j = 0; j < n; j++) {
      s += TOKENS[Math.floor(r() * TOKENS.length)];
    }
    out.push(s);
  }
  return out;
}

// Tests

test("throw parity: forward methods on corpus documents with the caret at every position", () => {
  const report = new Report();
  const inputs = buildCorpusInputs();
  for (const config of CONFIGS) {
    for (const input of inputs) {
      for (const method of FORWARD) {
        report.check(config, "forward/corpus", method, input);
      }
    }
  }
  console.log(`throw parity, corpus: ${inputs.length} inputs x ${CONFIGS.length} configurations x ${FORWARD.length} methods = ${report.calls} calls per side; both returned ${report.bothReturned}, both threw ${report.bothThrew}`);
  assert.deepEqual(report.lines, []);
});

test("throw parity: forward methods on random marker sequences", () => {
  const report = new Report();
  const inputs = buildRandomInputs();
  for (const config of CONFIGS) {
    for (const input of inputs) {
      for (const method of FORWARD) {
        report.check(config, "forward/random", method, input);
      }
    }
  }
  console.log(`throw parity, random: ${inputs.length} inputs x ${CONFIGS.length} configurations x ${FORWARD.length} methods = ${report.calls} calls per side; both returned ${report.bothReturned}, both threw ${report.bothThrew}`);
  assert.deepEqual(report.lines, []);
});

// Stage 2: DOM produced by the oracle for a document, then every reverse method on both sides.
interface DomGroup {
  forward: Method;
  reverse: Method[];
  configs: string[];
}

const DOM_GROUPS: DomGroup[] = [
  { forward: viaName("Md2BlockDOM", false), reverse: BLOCK_REVERSE, configs: ["Protyle", "everything on", "default"] },
  { forward: viaName("Md2VditorDOM"), reverse: WYSIWYG_REVERSE, configs: ["Vditor WYSIWYG", "everything on", "default"] },
  { forward: viaName("Md2VditorIRDOM"), reverse: IR_REVERSE, configs: ["Vditor IR", "everything on", "default"] },
];

function reverseScan(label: string, docs: readonly string[]): void {
  const report = new Report();
  let doms = 0;
  for (const group of DOM_GROUPS) {
    for (const configName of group.configs) {
      const config = CONFIGS.find((c) => c.name === configName)!;
      const engines = enginesFor(config);
      for (const doc of docs) {
        const forward = run(engines.oracle, group.forward, doc);
        if (forward.threw || typeof forward.value !== "string") {
          continue;
        }
        const dom = forward.value;
        doms++;
        for (const method of group.reverse) {
          // The reduction of a reverse mismatch keeps the Markdown document (and regenerates the DOM), so that the reduced report is readable.
          const input = dom;
          const p = run(engines.port, method, input);
          const o = run(engines.oracle, method, input);
          report.calls++;
          if (p.threw === o.threw) {
            if (p.threw) {
              report.bothThrew++;
            } else {
              report.bothReturned++;
            }
            continue;
          }
          const key = `${label} ${method.name} ${config.name}`;
          if (report.lines.some((l) => l.startsWith(key))) {
            continue;
          }
          const failsOnDoc = (s: string): boolean => {
            const f = run(engines.oracle, group.forward, s);
            return !f.threw && typeof f.value === "string" && mismatch(engines, method, f.value);
          };
          const smallDoc = reduce(doc, failsOnDoc);
          const smallDom = (run(engines.oracle, group.forward, smallDoc).value as string | undefined) ?? dom;
          const ps = run(engines.port, method, smallDom);
          const os = run(engines.oracle, method, smallDom);
          report.lines.push(
            `${key}: ${os.threw ? `oracle threw (${os.message}) and the port returned` : `port threw (${ps.message}) and the oracle returned`}; ` +
              `reduced document ${JSON.stringify(smallDoc)}, its DOM ${JSON.stringify(smallDom)}`,
          );
        }
      }
    }
  }
  console.log(`throw parity, reverse (${label}): ${doms} DOMs, ${report.calls} calls per side; both returned ${report.bothReturned}, both threw ${report.bothThrew}`);
  assert.deepEqual(report.lines, []);
}

test("throw parity: reverse methods on the DOM of the oracle, corpus documents", () => {
  reverseScan("reverse/corpus", buildCorpusInputs().filter((d) => !d.includes("\u0000")).slice(0, DOM_INPUTS));
});

test("throw parity: reverse methods on the DOM of the oracle, random marker sequences", () => {
  reverseScan("reverse/random", buildRandomInputs().slice(0, DOM_INPUTS));
});

// Inputs found by the scan or by hand that must keep matching: heading levels outside 1..6 (html_renderer.go:1404, 1431; protyle_renderer.go:1809).
test("throw parity: heading levels out of range", () => {
  const dom = (subtype: string): string =>
    `<div data-subtype="${subtype}" data-node-id="20260101000000-abcdefg" data-type="NodeHeading" class="h1"><div contenteditable="true" spellcheck="false">x</div></div>`;
  const paragraph = `<div data-node-id="20260101000000-abcdefg" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="false">x</div></div>`;
  const engines = enginesFor(CONFIGS.find((c) => c.name === "Protyle")!);
  const failures: string[] = [];
  const methods = [...BLOCK_REVERSE, viaName("BlockDOM2InlineBlockDOM"), viaName("BlockDOM2Text"), viaName("BlockDOM2TextLen"), viaName("BlockDOM2EscapeMarkerContent")];
  for (const subtype of ["h-1", "h0", "h", "h1", "h6", "h7", "h8", "h99"]) {
    for (const method of methods) {
      if (mismatch(engines, method, dom(subtype))) {
        failures.push(`${method.name} ${subtype}`);
      }
    }
  }
  for (const level of ["-5", "-1", "0", "1", "6", "7", "99", "x"]) {
    const method: Method = { name: "Blocks2Hs", call: (e, input) => (e as { Blocks2Hs(a: string, b: string): string }).Blocks2Hs(input, level) };
    if (mismatch(engines, method, paragraph)) {
      failures.push(`Blocks2Hs ${level}`);
    }
  }
  assert.deepEqual(failures, []);
  // The case of the task description.
  assert.throws(() => (engines.port as unknown as { BlockDOM2RichHTML(s: string): string }).BlockDOM2RichHTML(dom("h7")), /slice bounds out of range/);
});

// Footnote definitions with children that are not list items: Go's `md[3:]` (vditor_wysiwyg.go:931) would panic for a result shorter than
// three bytes, the reference bundle (GopherJS) does not, and the port follows the bundle. Found by test:full (a mutated hand-written DOM).
test("throw parity: footnotes block with short definitions", () => {
  const engines = enginesFor(CONFIGS.find((c) => c.name === "Vditor WYSIWYG")!);
  const wrap = (inner: string): string => `<div data-type="footnotes-block"><ol data-type="footnotes-defs-ol">${inner}</ol></div>`;
  const failures: string[] = [];
  for (const inner of ["x", "", "<li></li>", '<li data-marker="^a"></li>', "<br>", "<p>p</p>", "<ul><li>q</li></ul>", "&nbsp;", " ", "<!-- c -->", '<li data-marker="^a"><p>a</p></li>x<wbr>\n']) {
    for (const method of [...WYSIWYG_REVERSE, viaName("VditorDOM2HTML")]) {
      if (mismatch(engines, method, wrap(inner))) {
        failures.push(`${method.name} ${JSON.stringify(inner)}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

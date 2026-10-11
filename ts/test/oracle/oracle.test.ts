import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assertSameOutput,
  firstDifference,
  loadOracle,
  newOracleEngine,
  normalizeIDs,
} from "./oracle.ts";

const SPEC_PATH = fileURLToPath(new URL("../../../test/commonmark-spec.json", import.meta.url));

interface SpecCase {
  section: string;
  example: number;
  markdown: string;
  html: string;
}

test("oracle reports a non-empty version", () => {
  const lute = loadOracle();
  assert.equal(typeof lute.Version, "string");
  assert.ok(lute.Version.length > 0);
});

test("normalizeIDs replaces node IDs with stable placeholders", () => {
  const input = '<p id="20261010153000-abc1234">a</p><p id="20261010153001-xyz9876">b</p><p id="20261010153000-abc1234">c</p>';
  assert.equal(
    normalizeIDs(input),
    '<p id="ID#1">a</p><p id="ID#2">b</p><p id="ID#1">c</p>',
  );
});

test("normalizeIDs leaves text without node IDs unchanged", () => {
  assert.equal(normalizeIDs("no ids here 123-abc"), "no ids here 123-abc");
  // Longer digit runs are not node IDs.
  assert.equal(normalizeIDs("202610101530001-abc1234"), "202610101530001-abc1234");
});

test("firstDifference returns null for equal strings", () => {
  assert.equal(firstDifference("same", "same"), null);
});

test("firstDifference reports the first differing index and context", () => {
  const diff = firstDifference("0123456789X", "0123456789Y");
  assert.notEqual(diff, null);
  assert.equal(diff?.index, 10);
  assert.equal(diff?.actualContext, "0123456789X");
  assert.equal(diff?.expectedContext, "0123456789Y");
});

test("firstDifference handles one string being a prefix of the other", () => {
  const diff = firstDifference("abc", "abcdef");
  assert.equal(diff?.index, 3);
});

test("assertSameOutput throws a readable error on mismatch", () => {
  assert.doesNotThrow(() => assertSameOutput("same", "x", "x"));
  assert.throws(() => assertSameOutput("label", "<p>a</p>", "<p>b</p>"), /label: output differs at UTF-16 index 3/);
});

// CommonMark spec examples on which the oracle is known to differ from the
// spec's expected HTML. Example 540 (`[ẞ]` with `[SS]: /url`) fails because the
// JavaScript build of the Go code deliberately skips full Unicode case folding
// (see parse/linkrefdef_case_foldjs.go), so the link reference is not matched
// and the output is `<p>[ẞ]</p>\n`. Any other failure, or this example starting
// to pass, makes the test fail.
const KNOWN_ORACLE_SPEC_DIFFERENCES: readonly number[] = [540];
const KNOWN_ORACLE_540_OUTPUT = "<p>[ẞ]</p>\n";

test("oracle output matches the CommonMark spec expected HTML", () => {
  // Mirrors test/commonmark_spec_test.go: one engine, the same options turned off.
  const engine = newOracleEngine();
  engine.SetGFMTaskListItem(false);
  engine.SetGFMTable(false);
  engine.SetGFMAutoLink(false);
  engine.SetGFMStrikethrough(false);
  engine.SetSoftBreak2HardBreak(false);
  engine.SetCodeSyntaxHighlight(false);
  engine.SetHeadingID(false); // sets both ParseOptions and RenderOptions
  engine.SetAutoSpace(false);
  engine.SetFixTermTypo(false);
  engine.SetEmoji(false);
  engine.SetYamlFrontMatter(false);

  const cases = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as SpecCase[];
  const failures: string[] = [];
  const failingExamples: number[] = [];
  let example540Output: string | undefined;
  for (const c of cases) {
    const name = `${c.section} ${c.example}`;
    const actual: string = engine.MarkdownStr(name, c.markdown);
    if (c.example === 540) {
      example540Output = actual;
    }
    const diff = firstDifference(actual, c.html);
    if (diff !== null) {
      failingExamples.push(c.example);
      failures.push(
        `[${name}] actual ${JSON.stringify(diff.actualContext)} vs expected ${JSON.stringify(diff.expectedContext)}`,
      );
    }
  }

  // Deliberately not weakened: the failing set must be exactly the known differences.
  assert.deepEqual(
    failingExamples,
    [...KNOWN_ORACLE_SPEC_DIFFERENCES],
    `${failures.length} of ${cases.length} CommonMark cases differ from expected HTML; expected only ` +
      `examples ${KNOWN_ORACLE_SPEC_DIFFERENCES.join(", ")}. Failures:\n  ` +
      failures.slice(0, 10).join("\n  "),
  );
  assert.equal(example540Output, KNOWN_ORACLE_540_OUTPUT);
});

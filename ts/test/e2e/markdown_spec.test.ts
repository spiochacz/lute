import { test } from "node:test";
import assert from "node:assert/strict";
import { AddAutoLinkDomainSuffix } from "../../src/parse/index.ts";
import { assertSameOutcome, markdownBoth, newEngines, readRepoFile } from "./helpers.ts";
import type { SetterCall } from "./helpers.ts";

interface SpecCase {
  section: string;
  example: number;
  markdown: string;
  html: string;
}

// Mirrors test/commonmark_spec_test.go: one engine, the same options turned off.
const COMMONMARK_SETTERS: SetterCall[] = [
  ["SetGFMTaskListItem", false],
  ["SetGFMTable", false],
  ["SetGFMAutoLink", false],
  ["SetGFMStrikethrough", false],
  ["SetSoftBreak2HardBreak", false],
  ["SetCodeSyntaxHighlight", false],
  ["SetHeadingID", false],
  ["SetAutoSpace", false],
  ["SetFixTermTypo", false],
  ["SetEmoji", false],
  ["SetYamlFrontMatter", false],
];

// The CommonMark spec example on which the reference differs from the expected HTML (see test/oracle/oracle.test.ts).
const KNOWN_ORACLE_SPEC_DIFFERENCES = [540];

test("CommonMark spec: port equals oracle on every case", () => {
  const engines = newEngines(COMMONMARK_SETTERS);
  const cases = JSON.parse(readRepoFile("test/commonmark-spec.json")) as SpecCase[];
  assert.equal(cases.length, 652);
  const portFailing: number[] = [];
  const oracleFailing: number[] = [];
  for (const c of cases) {
    const name = `${c.section} ${c.example}`;
    const { port, oracle } = markdownBoth(engines, name, c.markdown);
    assert.equal(assertSameOutcome(`[${name}]`, port, oracle), "ok");
    if (port.value !== c.html) {
      portFailing.push(c.example);
    }
    if (oracle.value !== c.html) {
      oracleFailing.push(c.example);
    }
  }
  assert.deepEqual(oracleFailing, KNOWN_ORACLE_SPEC_DIFFERENCES);
  assert.deepEqual(portFailing, oracleFailing);
  assert.equal(cases.length - portFailing.length, 651);
});

// The GFM spec cases of test/gfm_spec_test.go are Go string literals in the test source: {"name", "markdown", "html"},
const GO_STRING = String.raw`"(?:[^"\\]|\\.)*"`;
const GO_CASE_LINE = new RegExp(String.raw`^\t\{(${GO_STRING}), (${GO_STRING}), (${GO_STRING})\},\r?$`);

function readGFMSpecCases(): { name: string; from: string; to: string }[] {
  const source = readRepoFile("test/gfm_spec_test.go").split("\n");
  const ret: { name: string; from: string; to: string }[] = [];
  for (const line of source) {
    const m = GO_CASE_LINE.exec(line);
    if (m === null) {
      continue;
    }
    ret.push({ name: JSON.parse(m[1]) as string, from: JSON.parse(m[2]) as string, to: JSON.parse(m[3]) as string });
  }
  return ret;
}

// Mirrors test/gfm_spec_test.go: soft break to hard break off, auto space off, no task list item class.
const GFM_SETTERS: SetterCall[] = [
  ["SetSoftBreak2HardBreak", false],
  ["SetAutoSpace", false],
  ["SetGFMTaskListItemClass", ""],
];

// The reference bundle cannot call parse.AddAutoLinkDomainSuffix("baz"), which the Go test calls, so the two cases that need the suffix
// differ from the expected HTML on the oracle; the port is compared with the oracle without the suffix.
const GFM_CASES_NEEDING_BAZ_SUFFIX = ["gfm628", "gfm629", "auto email link0", "auto email link1", "gfm631"];

test("GFM spec: port equals oracle on every case", () => {
  const cases = readGFMSpecCases();
  assert.equal(cases.length, 39);
  const engines = newEngines(GFM_SETTERS);
  const portFailing: string[] = [];
  const oracleFailing: string[] = [];
  for (const c of cases) {
    const { port, oracle } = markdownBoth(engines, c.name, c.from);
    assert.equal(assertSameOutcome(`[${c.name}]`, port, oracle), "ok");
    if (port.value !== c.to) {
      portFailing.push(c.name);
    }
    if (oracle.value !== c.to) {
      oracleFailing.push(c.name);
    }
  }
  assert.deepEqual(portFailing, oracleFailing);
  assert.deepEqual(oracleFailing.filter((n) => !GFM_CASES_NEEDING_BAZ_SUFFIX.includes(n)), []);
});

test("GFM spec: with the baz domain suffix, as the Go test does, the port matches the expected HTML", () => {
  AddAutoLinkDomainSuffix("baz");
  const engines = newEngines(GFM_SETTERS);
  const failing: string[] = [];
  for (const c of readGFMSpecCases()) {
    if (engines.port.MarkdownStr(c.name, c.from) !== c.to) {
      failing.push(c.name);
    }
  }
  assert.deepEqual(failing, []);
});

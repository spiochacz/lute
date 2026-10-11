// Port of test/commonmark_spec_test.go. The file test/commonmark-spec.json is read as Go does (Go runs in test/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { New } from "../../src/index.ts";
import { newOracleEngine } from "../oracle/oracle.ts";
import { repoPath } from "./wave_a_helpers.ts";

interface Testcase {
  end_line: number;
  section: string;
  html: string;
  markdown: string;
  example: number;
  start_line: number;
}

// "Links 540" ([ẞ] with the definition [SS]) needs Unicode full case folding for link labels, which the javascript build
// (port and reference bundle) does not have: both produce "<p>[ẞ]</p>\n", Go expects "<p><a href=\"/url\">ẞ</a></p>\n".
const JS_BUILD_DIFFERENCES = ["Links 540"];

test("TestSpec", () => {
  const testcases = JSON.parse(readFileSync(repoPath("test/commonmark-spec.json"), "utf8")) as Testcase[];
  const setup = (e: Record<string, (...a: unknown[]) => unknown>): void => {
    e.SetGFMTaskListItem(false);
    e.SetGFMTable(false);
    e.SetGFMAutoLink(false);
    e.SetGFMStrikethrough(false);
    e.SetSoftBreak2HardBreak(false);
    e.SetCodeSyntaxHighlight(false);
    e.SetHeadingID(false);
    e.SetAutoSpace(false);
    e.SetFixTermTypo(false);
    e.SetEmoji(false);
    e.SetYamlFrontMatter(false);
  };
  const luteEngine = New();
  luteEngine.ParseOptions.GFMTaskListItem = false;
  luteEngine.ParseOptions.GFMTable = false;
  luteEngine.ParseOptions.GFMAutoLink = false;
  luteEngine.ParseOptions.GFMStrikethrough = false;
  luteEngine.RenderOptions.SoftBreak2HardBreak = false;
  luteEngine.RenderOptions.CodeSyntaxHighlight = false;
  luteEngine.ParseOptions.HeadingID = false;
  luteEngine.RenderOptions.HeadingID = false;
  luteEngine.RenderOptions.AutoSpace = false;
  luteEngine.RenderOptions.FixTermTypo = false;
  luteEngine.ParseOptions.Emoji = false;
  luteEngine.ParseOptions.YamlFrontMatter = false;
  const oracle = newOracleEngine();
  setup(oracle);
  const failures: string[] = [];
  const seen = new Set<string>();
  for (const tc of testcases) {
    const testName = tc.section + " " + tc.example;
    const html = luteEngine.MarkdownStr(testName, tc.markdown);
    if (JS_BUILD_DIFFERENCES.includes(testName)) {
      seen.add(testName);
      const reference = oracle.MarkdownStr(testName, tc.markdown) as string;
      if (html !== reference || html === tc.html) failures.push(`JS_BUILD_DIFFERENCES [${testName}]: port ${JSON.stringify(html)}, reference ${JSON.stringify(reference)}, Go ${JSON.stringify(tc.html)}`);
    } else if (tc.html !== html) {
      failures.push(`test case [${testName}] failed\nexpected\n\t${JSON.stringify(tc.html)}\ngot\n\t${JSON.stringify(html)}\noriginal markdown text\n\t${JSON.stringify(tc.markdown)}`);
    }
  }
  assert.ok(testcases.length > 600);
  assert.equal(seen.size, JS_BUILD_DIFFERENCES.length);
  assert.equal(failures.length, 0, failures.join("\n"));
});

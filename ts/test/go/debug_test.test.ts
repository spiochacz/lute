// Port of test/debug_test.go (a scratch test of the Go repository; it asserts debugTests).
import { test } from "node:test";
import { New } from "../../src/index.ts";
import { newOracleEngine } from "../oracle/oracle.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("debug_test");

// Cases whose Go expected value the JavaScript build does not produce (port == reference bundle != Go):
//   54: the Go expectation contains class="highlight-chroma" on an empty code block (syntax highlighter, absent from the javascript build);
//   55, 56: link reference labels are matched with Unicode full case folding in Go ("ẞ" and "SS"), the javascript build lacks it.
const JS_BUILD_DIFFERENCES = ["54", "55", "56"];

test("TestDebug", () => {
  const luteEngine = New();
  luteEngine.SetCodeSyntaxHighlightDetectLang(true);
  luteEngine.SetHeadingID(true);
  luteEngine.SetSup(true);
  const oracle = newOracleEngine();
  oracle.SetCodeSyntaxHighlightDetectLang(true);
  oracle.SetHeadingID(true);
  oracle.SetSup(true);
  markdownTable(luteEngine, rows(cases, "debugTests", 80), { names: JS_BUILD_DIFFERENCES, oracle, call: (e, name, from) => e.MarkdownStr(name, from) });
});

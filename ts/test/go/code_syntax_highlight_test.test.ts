// Port of test/code_syntax_highlight_test.go. The port implements the javascript build variant, which has no syntax highlighter:
// the tests whose expectation is highlighted HTML are present and skipped; the two that do not depend on highlighter output run.
import { test } from "node:test";
import { New } from "../../src/index.ts";
import { newOracleEngine } from "../oracle/oracle.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("code_syntax_highlight_test");
const NO_HIGHLIGHT = { skip: "javascript build variant has no syntax highlighting" };

// 围栏代码块自动探测语言 https://github.com/88250/lute/issues/22 (expects highlighted Go code)
test("TestCodeSyntaxHighlightDetectLang", NO_HIGHLIGHT, () => {});

// The Go test enables detection but turns highlighting off: the expectation is a plain code block with a detected language.
test("TestCodeSyntaxHighlightDetectLang1", () => {
  const luteEngine = New();
  luteEngine.SetCodeSyntaxHighlight(false);
  luteEngine.SetCodeSyntaxHighlightDetectLang(true);
  const oracle = newOracleEngine();
  oracle.SetCodeSyntaxHighlight(false);
  oracle.SetCodeSyntaxHighlightDetectLang(true);
  // JS_BUILD_DIFFERENCES case "0": language detection uses the Chroma lexer analysers, absent from the javascript build; port and
  // reference bundle render "<pre><code>..." where Go renders class="language-mysql".
  markdownTable(luteEngine, rows(cases, "codeSyntaxHighlightDetectLang1Tests", 1), { names: ["0"], oracle, call: (e, name, from) => e.MarkdownStr(name, from) });
});

test("TestCodeSyntaxHighlightIssue17", NO_HIGHLIGHT, () => {});

test("TestCodeSyntaxHighlightLineNum", NO_HIGHLIGHT, () => {});

test("TestCodeSyntaxHighlight", NO_HIGHLIGHT, () => {});

test("TestCodeSyntaxHighlightInline", NO_HIGHLIGHT, () => {});

test("TestCodeSyntaxHighlightStyle", NO_HIGHLIGHT, () => {});

test("TestCodeSyntaxHighlightOff", () => {
  const luteEngine = New();
  luteEngine.RenderOptions.CodeSyntaxHighlight = false;
  markdownTable(luteEngine, rows(cases, "codeSyntaxHighlightOffTests", 1));
});

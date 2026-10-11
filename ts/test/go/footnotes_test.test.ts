// Port of test/footnotes_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("footnotes_test");

test("TestFootnoteLabelInlineTokens", () => {
  const ref = '<sup class="footnotes-ref" id="footnotes-ref-1"><a href="#footnotes-def-1">1</a></sup>';
  const scenarios = rows(cases, "labelScenarios", 3);
  // The Go source builds the expected paragraph with the constant ref, which the extractor has already substituted.
  assert.ok(scenarios.every(([, paragraph]) => paragraph!.includes(ref)));
  let count = 0;
  for (const protyle of [false, true]) {
    for (const sup of [false, true]) {
      for (const label of ["a_b", "a*b", "a&b", "a<b", "a=b", "a~b", "a^b", "a$b", "a#b", "a!b", "a(b)", "a`b", "a&amp;b"]) {
        const engine = New();
        engine.SetProtyleWYSIWYG(protyle);
        engine.SetSup(sup);
        for (const [source, paragraph] of scenarios) {
          // fmt.Sprintf(source, label): the sources have exactly one %s
          const markdown = source!.replace("%s", () => label) + "\n\n[^" + label + "]: body\n";
          const output = engine.MarkdownStr("", markdown);
          assert.ok(
            output.startsWith(paragraph!),
            `protyle=${protyle}/sup=${sup}/label=${label}: label altered surrounding content:\nsource: ${JSON.stringify(markdown)}\nwant: ${paragraph}\ngot: ${output}`,
          );
          count++;
        }
      }
    }
  }
  assert.equal(count, 4 * 13 * 3);
});

test("TestFootnotes", () => {
  const luteEngine = New();
  luteEngine.SetSup(true);
  markdownTable(luteEngine, rows(cases, "fnTests", 3));
});

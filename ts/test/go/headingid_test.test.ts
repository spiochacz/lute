// Port of test/headingid_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, parse, render } from "../../src/index.ts";
import { goCases, markdownTable, rows } from "./wave_a_helpers.ts";

const cases = goCases("headingid_test");

test("TestHeadingID", () => {
  const luteEngine = New();
  luteEngine.ParseOptions.HeadingID = true;
  luteEngine.RenderOptions.HeadingID = true;
  markdownTable(luteEngine, rows(cases, "headingIDTests", 4));
});

test("TestHeadingIDRaw", () => {
  const luteEngine = New();
  luteEngine.SetHeadingID(true);
  for (const [markdown, expected] of rows(cases, "headingIDRaw", 4)) {
    const tree = parse.Parse("", new TextEncoder().encode(markdown), luteEngine.ParseOptions);
    const actual = render.HeadingIDRaw(tree.Root!.FirstChild!);
    assert.equal(actual, expected, `expected raw heading ID ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} for markdown ${JSON.stringify(markdown)}`);
  }
});

test("TestHeadingAnchor", () => {
  const luteEngine = New();
  luteEngine.SetHeadingID(true);
  luteEngine.RenderOptions.HeadingAnchor = true;
  markdownTable(luteEngine, rows(cases, "headingAnchorTests", 2));
});

test("TestDisableHeadingID", () => {
  const luteEngine = New();
  luteEngine.SetHeadingID(false);
  markdownTable(luteEngine, rows(cases, "headingIDDisableTests", 1));
});

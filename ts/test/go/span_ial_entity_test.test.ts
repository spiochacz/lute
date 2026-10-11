// Port of test/span_ial_entity_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, ast, parse } from "../../src/index.ts";
import { BytesFromString } from "../../src/runtime/conv.ts";

test("TestSpanIALEntityBoundaries", () => {
  const engine = New();
  engine.SetProtyleWYSIWYG(true);
  engine.SetKramdownIAL(true);
  engine.SetAutoSpace(false);
  const cases: { input: string; want: string }[] = [
    { input: `<span data-type="text">x</span>{: style="font-family: &quot;Segoe UI&quot;;"}tail &amp; end`, want: `font-family: "Segoe UI";` },
    { input: `<span data-type="text">x</span>{: style="font-family: &#34;Segoe UI&#34;;"}tail &amp; end`, want: `font-family: "Segoe UI";` },
    { input: `<span data-type="text" style="font-family: &quot;Segoe UI&quot;;">x</span>{: style="font-family: &quot;Segoe UI&quot;;"}tail &amp; end`, want: `font-family: "Segoe UI";` },
    { input: `<span data-type="text">x</span>{: title="A &amp; B &#123;C&#125;"}tail &amp; end`, want: "A & B {C}" },
  ];
  for (const tc of cases) {
    const dom = engine.Md2BlockDOM(tc.input, false);
    assert.ok(!(dom.includes("{:") || !dom.includes("tail &amp; end")), `attributes or trailing entities were corrupted: ${dom}`);
    const tree = parse.Parse("", BytesFromString(tc.input), engine.ParseOptions);
    let found = false;
    ast.Walk(tree.Root!, (n, entering) => {
      if (entering && n.Type === ast.NodeTextMark && (n.IALAttr("style") === tc.want || n.IALAttr("title") === tc.want)) {
        found = true;
      }
      return ast.WalkContinue;
    });
    assert.ok(found, `attribute value was not preserved: ${dom}`);
  }
  for (const input of [
    `<span data-type="text">x</span>{: style="font-family: &quot;Segoe UI&quot;;"`,
    `<span data-type="text">x</span>{: style="font-family: &quot;Segoe UI&quot;;"` + "\n\n" + `tail}`,
    `<span data-type="text">x</span>{: title="&quot;a" **bold** }`,
  ]) {
    const dom = engine.Md2BlockDOM(input, false);
    assert.ok(!(!dom.includes("{:") || dom.includes(`style="font-family:`)), `incomplete or interrupted attributes were consumed: ${dom}`);
  }
});

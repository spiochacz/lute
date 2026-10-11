import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as conv from "../runtime/conv.ts";
import { applyOptions, buildNode, load } from "./testhelpers.ts";
import type { NodeSpec } from "./testhelpers.ts";

// Smoke test of the HTML renderer on hand-built trees.
// The generator (ts/tools/gen-render-vectors) builds the same trees in Go, renders them with NewHtmlRenderer(tree, options, parse.NewOptions()).Render()
// and writes the HTML; this test builds each tree from its JSON description and compares. Every tree is rendered with every option set.
// The test needs the render package, which imports the parse package; it is skipped while that cannot be imported.

interface Vectors {
  optionSets: { name: string; opts: Record<string, unknown> }[];
  smokeTrees: Record<string, NodeSpec>;
  smoke: { name: string; opt: string; out: string | null }[];
}
const data: Vectors = JSON.parse(readFileSync(new URL("./testdata/render_tree_vectors.json", import.meta.url), "utf8"));
const loaded = await load();

test("NewHtmlRenderer(tree, NewOptions(), parse.NewOptions()).Render() matches Go on hand-built trees", { skip: loaded.skip }, () => {
  const render = loaded.render!;
  const parse = loaded.parse!;
  const optsByName = new Map(data.optionSets.map((s) => [s.name, s.opts]));
  let count = 0;
  for (const v of data.smoke) {
    const root = buildNode(data.smokeTrees[v.name]);
    const o = render.NewOptions();
    applyOptions(o, optsByName.get(v.opt)!);
    const tree = new parse.Tree();
    tree.Root = root;
    const what = v.name + " / " + v.opt;
    if (null === v.out) {
      assert.throws(() => render.NewHtmlRenderer(tree, o, parse.NewOptions()).Render(), what);
    } else {
      const out = conv.StringFromBytes(render.NewHtmlRenderer(tree, o, parse.NewOptions()).Render());
      assert.equal(out, v.out, what);
    }
    count++;
  }
  assert.ok(count >= 1000);
});

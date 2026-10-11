import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as conv from "../runtime/conv.ts";
import { applyOptions, load } from "./testhelpers.ts";

// Markdown to HTML, parse.Parse + NewHtmlRenderer(...).Render(), against the output of the same calls in Go.
// Unlike the smoke test, this one exercises the parser as well, so a failure can come from the parse package.
// The test needs the render and parse packages; it is skipped while they cannot be imported.

interface Vectors {
  optionSets: { name: string; opts: Record<string, unknown> }[];
  cases: { in: string; opt: string; out: string | null }[];
}
const data: Vectors = JSON.parse(readFileSync(new URL("./testdata/render_e2e_vectors.json", import.meta.url), "utf8"));
const loaded = await load();

test("Markdown to HTML matches Go", { skip: loaded.skip }, () => {
  const render = loaded.render!;
  const parse = loaded.parse!;
  const optsByName = new Map(data.optionSets.map((s) => [s.name, s.opts]));
  const failures: string[] = [];
  for (const v of data.cases) {
    const o = render.NewOptions();
    applyOptions(o, optsByName.get(v.opt)!);
    const po = parse.NewOptions();
    let out: string | null;
    try {
      const tree = parse.Parse("", conv.BytesFromString(v.in), po);
      out = conv.StringFromBytes(render.NewHtmlRenderer(tree, o, po).Render());
    } catch (e) {
      out = null;
      failures.push(JSON.stringify(v.in) + " / " + v.opt + ": threw " + (e as Error).message);
      continue;
    }
    if (out !== v.out) {
      failures.push(JSON.stringify(v.in) + " / " + v.opt + "\n  go: " + JSON.stringify(v.out) + "\n  ts: " + JSON.stringify(out));
    }
  }
  assert.deepEqual(failures, []);
});

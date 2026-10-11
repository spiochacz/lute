// Known upstream bugs reproduced by the port: Md2BlockDOM throws on both sides (the throws come from the parser and the Protyle renderer, which are ported).

import { test } from "node:test";
import assert from "node:assert/strict";
import { PROTYLE_BASE } from "../renderers/protyle_corpus.ts";
import { attempt, newEngines } from "../helpers.ts";

const CASES: [string, string, [string, ...unknown[]][]][] = [
  ["link reference definition with SetLinkRef(true)", "[r]: /u", [["SetLinkRef", true]]],
  ["IAL id shorter than 14 characters", "foo\n{: id=\"abc\"}", []],
  ["span with an unquoted data-type", "<span data-type=ab>x</span>", []],
  ["table followed by an IAL line", "| a | b |\n|---|---|\n| 1 | 2 |\n{: id=\"x\"}\n", []],
  ["empty fenced code block, caret after the closing fence", "```\n```‸", []],
];

for (const [name, md, setters] of CASES) {
  test(name, () => {
    const engines = newEngines([...PROTYLE_BASE, ...setters]);
    const port = attempt(() => engines.port.Md2BlockDOM(md, false));
    const oracle = attempt(() => engines.oracle.Md2BlockDOM(md, false) as string);
    assert.equal(oracle.threw, true, "the oracle is expected to throw: " + oracle.value);
    assert.equal(port.threw, true, "the port must throw too");
  });
}

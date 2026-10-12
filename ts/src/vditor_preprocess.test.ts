import { test } from "node:test";
import assert from "node:assert/strict";
import * as strings from "./runtime/strings.ts";
import * as editor from "./editor/index.ts";
import { normalizeTrailingWhitespace, vditorDOM2MdPreprocess } from "./vditor_wysiwyg.ts";
import { vditorIRDOM2MdPreprocess } from "./vditor_ir.ts";

// The original preprocess: the caret, then the two trailing white space replacements, each a separate pass.
const threeCalls = (s: string, caret: string): string => {
  let out = strings.ReplaceAll(s, caret, "");
  out = strings.ReplaceAll(out, "\t\n", "\n");
  out = strings.ReplaceAll(out, "    \n", "  \n");
  return out;
};

test("normalizeTrailingWhitespace: the cases of the two patterns, including their overlaps", () => {
  const cases: Array<[string, string]> = [
    ["", ""],
    ["\n", "\n"],
    ["a", "a"],
    ["a\n", "a\n"],
    ["a\t\n", "a\n"],
    ["a    \n", "a  \n"],
    ["a     \n", "a   \n"],
    ["a\t    \n", "a\t  \n"],
    ["a    \t\n", "a  \n"],
    ["a\t\t\n", "a\t\n"],
    ["    \t\n", "  \n"],
    ["\t    \n\t    \n", "\t  \n\t  \n"],
    ["x    \n    \n", "x  \n  \n"],
    ["      \n", "    \n"],
    ["\r    \n", "\r  \n"],
    ["    \r\n", "    \r\n"],
    ["    \n    \n    \n", "  \n  \n  \n"],
  ];
  for (const [input, want] of cases) {
    assert.equal(normalizeTrailingWhitespace(input), want, JSON.stringify(input));
    assert.equal(normalizeTrailingWhitespace(input), threeCalls(input, "\u0000never"), JSON.stringify(input));
  }
});

test("normalizeTrailingWhitespace equals the two replacements on 100,000 random strings", () => {
  // alphabet: tab, space, LF, CR, 'a' and the caret marker, the last one as a single unit
  const alphabet = ["\t", " ", "\n", "\r", "a", "<wbr>"];
  let seed = 20261012;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const twoCalls = (s: string): string => strings.ReplaceAll(strings.ReplaceAll(s, "\t\n", "\n"), "    \n", "  \n");
  let changed = 0;
  for (let i = 0; i < 100000; i++) {
    const len = rnd(24);
    let s = "";
    for (let j = 0; j < len; j++) {
      s += alphabet[rnd(alphabet.length)];
    }
    const want = twoCalls(s);
    if (want !== s) {
      changed++;
    }
    assert.equal(normalizeTrailingWhitespace(s), want, JSON.stringify(s));
  }
  // the generator must reach both the changed and the unchanged results
  assert.ok(changed > 10000 && changed < 90000, `changed ${changed}`);
});

test("vditorDOM2MdPreprocess and vditorIRDOM2MdPreprocess equal the three calls on 100,000 random strings", () => {
  const alphabet = ["\t", " ", "\n", "\r", "a", editor.FrontEndCaret, "<wbr>", "<p>"];
  let seed = 7;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let i = 0; i < 100000; i++) {
    const len = rnd(28);
    let s = "";
    for (let j = 0; j < len; j++) {
      s += alphabet[rnd(alphabet.length)];
    }
    const want = threeCalls(s, editor.FrontEndCaret);
    assert.equal(vditorDOM2MdPreprocess(s), want, JSON.stringify(s));
    assert.equal(vditorIRDOM2MdPreprocess(s), threeCalls(s, "<wbr>"), JSON.stringify(s));
  }
});

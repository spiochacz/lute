// ProtyleRenderer (Md2BlockDOM and variants) against the reference bundle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { corpus, files, finish, specCases } from "./protyle_compare.ts";
import { CORPUS } from "./protyle_corpus.ts";
import { compareOne, newTally } from "./protyle_helpers.ts";
import { newEngines } from "../helpers.ts";
import { sample } from "../full.ts";
import { PROTYLE_BASE } from "./protyle_corpus.ts";

// The oracle and the port both throw on a link reference definition (UPSTREAM-BUG, protyle_renderer.go:770), and nowhere else.
const onlyLinkRefDef = (s: string): boolean => /link ref/.test(s) || /nil pointer|null|undefined/i.test(s);

test("corpus size", () => {
  assert.ok(CORPUS.length >= 300, String(CORPUS.length));
});

test("CommonMark spec cases, Md2BlockDOM(md, false)", () => {
  const t = specCases("dom");
  assert.equal(t.compared, 652);
  finish(t);
});

test("CommonMark spec cases, Md2BlockDOM(md, true)", () => {
  finish(specCases("domReserve"));
});

test("whole files", () => {
  const t = files("dom", ["test/case1.md", "README.md", "test/format-case0.md", "test/format-case1.md", "test/format-case2.md", "test/format-case3.md", "test/format-case4.md", "test/format-case5.md", "test/format-case6.md", "test/format-case7.md", "test/gfm-spec.md"], ["base", "text mark and html tag", "callout and tabs", "auto space and text mark"]);
  finish(t);
});

test("big spec file", () => {
  finish(files("dom", ["benchmark/commonmark-spec.md"], ["base", "tabs, text mark"]));
});

test("short documents under every option variation (every 2nd)", () => {
  const t = corpus("dom", 2, 0, null);
  finish(t, onlyLinkRefDef);
});

test("short documents under every option variation (the other half)", () => {
  const t = corpus("dom", 2, 1, null);
  finish(t, onlyLinkRefDef);
});

test("short documents, reserveEmptyParagraph and auto link", () => {
  const t = newTally();
  const engines = newEngines([...PROTYLE_BASE, ["SetTextMark", true], ["SetHTMLTag2TextMark", true], ["SetCallout", true], ["SetTabs", true], ["SetCustomBlock", true]]);
  for (const [i, doc] of sample(CORPUS, 0, 10).entries()) {
    compareOne(t, engines, "domReserve", `corpus ${i}`, doc);
    compareOne(t, engines, "domAutoLink", `corpus ${i}`, doc);
  }
  finish(t);
});

test("link reference definition throws on both sides (UPSTREAM-BUG)", () => {
  const t = newTally();
  const engines = newEngines([...PROTYLE_BASE, ["SetLinkRef", true]]);
  for (const md of ["[r]: /u", "[r]: /u \"t\"\n\n[r]", "a\n\n[r]: /u"]) {
    compareOne(t, engines, "dom", md, md);
  }
  assert.deepEqual(t.failures, []);
  assert.equal(t.bothThrew.length, 3, JSON.stringify(t.bothThrew));
});

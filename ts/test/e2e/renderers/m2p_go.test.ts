// Port of test/m2p_test.go: Markdown to Protyle block DOM, same options, same cases and expected values (test/m2p_test.go is read by
// m2p_go_cases.json, generated from the Go file), with ast.SetTesting(true) as the Go test does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ast, New } from "../../../src/index.ts";

type Cases = Record<string, [name: string, from: string, to: string][]>;
const cases: Cases = JSON.parse(readFileSync(new URL("./m2p_go_cases.json", import.meta.url), "utf8"));

function withTesting(fn: () => void): void {
  ast.SetTesting(true);
  try {
    fn();
  } finally {
    ast.SetTesting(false);
  }
}

test("Md2BlockDOM", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetDataTask(true);
  luteEngine.SetBlockRef(true);
  luteEngine.SetTag(true);
  luteEngine.SetSuperBlock(true);
  luteEngine.SetKramdownIAL(true);
  luteEngine.SetAutoSpace(true);
  luteEngine.SetParagraphBeginningSpace(true);
  luteEngine.SetFileAnnotationRef(true);
  luteEngine.SetImgPathAllowSpace(true);
  luteEngine.SetSanitize(true);
  luteEngine.SetTextMark(true);
  luteEngine.SetTag(true);
  luteEngine.SetTextMark(true);
  luteEngine.SetHTMLTag2TextMark(true);
  luteEngine.SetSub(true);
  luteEngine.SetSup(true);
  luteEngine.SetMark(true);
  luteEngine.SetIndentCodeBlock(false);
  luteEngine.SetCallout(true);
  luteEngine.SetCustomBlock(true);
  luteEngine.PutEmojis(new Map([["1/b3log", "/emojis/1/b3log.png"]]));

  withTesting(() => {
    assert.equal(cases.md2BlockDOMTests.length, 121);
    for (const [name, from, to] of cases.md2BlockDOMTests) {
      assert.equal(luteEngine.Md2BlockDOM( from, true), to, `test case [${name}] failed, original ${JSON.stringify(from)}`);
    }
  });
});

test("Md2BlockDOM task marker followed by link", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetArbitraryTaskListItemMarker(true);

  const tests: { markdown: string; listType: number }[] = [
    { markdown: "- [1](siyuan://blocks/20260802201342-8lzm8cy)", listType: 0 },
    { markdown: "- [1]", listType: 3 },
    { markdown: "- [x] task", listType: 3 },
    { markdown: "- [/] task", listType: 3 },
  ];
  for (const t of tests) {
    const [, tree] = luteEngine.Md2BlockDOMTree( t.markdown, true);
    const list = tree.Root!.FirstChild;
    assert.ok(null !== list && null !== list.ListData && t.listType === list.ListData.Typ, `expected list type [${t.listType}] for markdown [${t.markdown}]`);
  }
});

test("Md2BlockDOM disable syntax", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetSup(false);
  luteEngine.SetSub(false);
  luteEngine.SetGFMStrikethrough1(false);
  luteEngine.SetInlineAsterisk(false);
  luteEngine.SetHTMLTag2TextMark(true);

  withTesting(() => {
    assert.equal(cases.md2BlockDOMDisableSyntaxTests.length, 10);
    for (const [name, from, to] of cases.md2BlockDOMDisableSyntaxTests) {
      assert.equal(luteEngine.Md2BlockDOM( from, true), to, `test case [${name}] failed, original ${JSON.stringify(from)}`);
    }
  });
});

test("Md2BlockDOMWithAutoLink", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetInlineAsterisk(true);

  withTesting(() => {
    assert.equal(cases.md2BlockDOMWithAutoLinkTests.length, 8);
    for (const [name, from, to] of cases.md2BlockDOMWithAutoLinkTests) {
      assert.equal(luteEngine.Md2BlockDOMWithAutoLink( from, true), to, `test case [${name}] failed, original ${JSON.stringify(from)}`);
    }
  });
});

test("Md2BlockDOMWithAutoLink state does not leak", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);

  withTesting(() => {
    // Baseline: Md2BlockDOM must not turn a plain-text URL into a link.
    for (const [name, from, to] of cases.md2BlockDOMWithAutoLinkStateTests) {
      assert.equal(luteEngine.Md2BlockDOM( from, true), to, `test case [${name}] failed, original ${JSON.stringify(from)}`);
    }

    // Run the entry point with auto link once, then check again: the result must equal the baseline.
    luteEngine.Md2BlockDOMWithAutoLink( cases.md2BlockDOMWithAutoLinkStateTests[0][1], true);
    for (const [name, from, to] of cases.md2BlockDOMWithAutoLinkStateTests) {
      assert.equal(luteEngine.Md2BlockDOM( from, true), to, `test case [${name}-after-auto-link] failed, original ${JSON.stringify(from)}`);
    }
  });
});

test("Md2BlockDOMWithAutoLink when GFM auto link is disabled", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetGFMAutoLink(false);

  withTesting(() => {
    for (const [name, from, to] of cases.md2BlockDOMWithAutoLinkGFMAutoLinkDisabledTests) {
      assert.equal(luteEngine.Md2BlockDOMWithAutoLink( from, true), to, `test case [${name}] failed, original ${JSON.stringify(from)}`);
    }
  });
});

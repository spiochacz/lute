// Port of test/callout_icon_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, ast, parse } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import { goCases, rows } from "./wave_a_helpers.ts";

const cases = goCases("callout_icon_test");

function newCalloutLute(): Lute {
  const luteEngine = New();
  luteEngine.SetCallout(true);
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetAutoSpace(true);
  return luteEngine;
}

function parseCalloutWithLute(luteEngine: Lute, markdown: string): ast.Node {
  const tree = parse.Parse("callout-image-icon", new TextEncoder().encode(markdown), luteEngine.ParseOptions);
  assert.ok(tree.Root!.FirstChild !== null && ast.NodeCallout === tree.Root!.FirstChild.Type, `callout was not parsed: ${JSON.stringify(markdown)}`);
  return tree.Root!.FirstChild!;
}

function parseCallout(markdown: string): ast.Node {
  return parseCalloutWithLute(newCalloutLute(), markdown);
}

test("TestCalloutImageIconParse", () => {
  for (const [name, icon, title] of rows(cases, "imageIconParse", 5)) {
    const markdown = "> [!NOTE] ![callout-icon](<" + icon + ">) " + title + "\n> Content";
    const callout = parseCallout(markdown);
    assert.ok(
      1 === callout.CalloutIconType && icon === callout.CalloutIcon && title === callout.CalloutTitle,
      `${name}: unexpected callout icon state: type=${callout.CalloutIconType}, icon=${JSON.stringify(callout.CalloutIcon)}, title=${JSON.stringify(callout.CalloutTitle)}`,
    );
  }
  const callout = parseCallout("> [!NOTE] ![callout-icon](https://example.com/icon.png) Plain\n> Content");
  assert.ok(
    1 === callout.CalloutIconType && "https://example.com/icon.png" === callout.CalloutIcon && "Plain" === callout.CalloutTitle,
    `unexpected plain callout icon state: type=${callout.CalloutIconType}, icon=${JSON.stringify(callout.CalloutIcon)}, title=${JSON.stringify(callout.CalloutTitle)}`,
  );
});

test("TestCalloutImageIconDoesNotConsumeTitle", () => {
  for (const [name, title] of rows(cases, "imageIconNotConsumed", 6)) {
    const callout = parseCallout("> [!NOTE] " + title + "\n> Content");
    assert.ok(
      0 === callout.CalloutIconType && ast.GetCalloutIcon(ast.CalloutTypeNote) === callout.CalloutIcon && title === callout.CalloutTitle,
      `${name}: title was consumed as an icon: type=${callout.CalloutIconType}, icon=${JSON.stringify(callout.CalloutIcon)}, title=${JSON.stringify(callout.CalloutTitle)}`,
    );
  }
});

test("TestCalloutImageIconRoundTrip", () => {
  const icon = "https://b3logfile.com/avatar/1734703705652.png?size=64&theme=light";
  const dom =
    '<div data-subtype="NOTE" data-node-id="20260807120000-abcdefg" ' +
    'data-node-index="1" data-type="NodeCallout" class="callout"><div class="callout-info" contenteditable="false">' +
    '<span class="callout-icon"><img class="callout-img" src="' + icon + '"></span>' +
    '<span contenteditable="true" spellcheck="false" class="callout-title">Note</span></div><div class="callout-content">' +
    '<div data-node-id="20260807120001-abcdefg" data-type="NodeParagraph" class="p">' +
    '<div contenteditable="true" spellcheck="false">Content</div>' +
    '<div class="protyle-attr" contenteditable="false">&ZeroWidthSpace;</div></div></div>' +
    '<div class="protyle-attr" contenteditable="false">&ZeroWidthSpace;</div></div>';

  const luteEngine = newCalloutLute();
  const markdown = luteEngine.BlockDOM2StdMd(dom);
  const expected = "> [!NOTE] ![callout-icon](<" + icon + ">) Note\n> Content\n";
  assert.equal(markdown, expected, "unexpected markdown");

  const formatted = luteEngine.FormatStr("callout-image-icon", markdown);
  const formattedAgain = luteEngine.FormatStr("callout-image-icon", formatted);
  assert.equal(formattedAgain, formatted, "formatting is not idempotent");
  const callout = parseCalloutWithLute(luteEngine, formattedAgain);
  assert.ok(1 === callout.CalloutIconType && icon === callout.CalloutIcon && "Note" === callout.CalloutTitle, "round trip lost icon state");

  const blockDOM = luteEngine.Md2BlockDOM(formattedAgain, true);
  assert.ok(
    blockDOM.includes('src="https://b3logfile.com/avatar/1734703705652.png?size=64&amp;theme=light"') &&
      blockDOM.includes('<span contenteditable="true" spellcheck="false" class="callout-title">Note</span>'),
    `unexpected BlockDOM: ${blockDOM}`,
  );
});

test("TestCalloutEmptyTitleRoundTrip", () => {
  const luteEngine = newCalloutLute();
  const defaultMarkdown = "> [!NOTE]\n> Content";
  const defaultCallout = parseCalloutWithLute(luteEngine, defaultMarkdown);
  assert.ok(!defaultCallout.CalloutTitleExplicit, "default callout title should not be explicit");
  const defaultBlockDOM = luteEngine.Md2BlockDOM(defaultMarkdown, true);
  assert.ok(defaultBlockDOM.includes('class="callout-title">Note</span>'), `default callout title was not rendered: ${defaultBlockDOM}`);

  const emptyTitleMarkdown = "> [!NOTE] ✏️\n> Content\n";
  const emptyTitleCallout = parseCalloutWithLute(luteEngine, emptyTitleMarkdown);
  assert.ok(emptyTitleCallout.CalloutTitleExplicit && "" === emptyTitleCallout.CalloutTitle, "unexpected empty title state");
  const emptyTitleBlockDOM = luteEngine.Md2BlockDOM(emptyTitleMarkdown, true);
  assert.ok(emptyTitleBlockDOM.includes('class="callout-title"></span>'), `empty callout title was not rendered: ${emptyTitleBlockDOM}`);
  assert.equal(luteEngine.BlockDOM2StdMd(emptyTitleBlockDOM), emptyTitleMarkdown, "empty callout title did not round trip");
});

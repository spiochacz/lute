// Port of test/flashcard_occlusion_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { New, render } from "../../src/index.ts";
import { goCases, rows } from "./wave_a_helpers.ts";

const cases = goCases("flashcard_occlusion_test");

test("TestFlashcardOcclusionIDRoundTrip", () => {
  const luteEngine = New();
  luteEngine.SetHTMLTag2TextMark(true);
  luteEngine.SetProtyleWYSIWYG(true);
  const blockDOM = rows(cases, "blockDOM", 1)[0]![0]!;

  let tree = luteEngine.BlockDOM2Tree(blockDOM)!;
  const first = tree.Root!.FirstChild!.FirstChild!;
  assert.ok(
    first.TextMarkFlashcardOcclusionID === "20260812000001-occla01" && first.Next!.TextMarkFlashcardOcclusionID === "20260812000002-occlb02",
    `flashcard occlusion IDs were not parsed: first=${first.TextMarkFlashcardOcclusionID} second=${first.Next!.TextMarkFlashcardOcclusionID}`,
  );
  const both = (s: string): boolean => s.includes('data-occlusion-id="20260812000001-occla01"') && s.includes('data-occlusion-id="20260812000002-occlb02"');
  const rendered = luteEngine.RenderNodeBlockDOM(tree.Root!.FirstChild!);
  assert.ok(both(rendered), `flashcard occlusion IDs were not rendered: ${rendered}`);
  const markdown = luteEngine.BlockDOM2Md(blockDOM);
  assert.ok(both(markdown), `flashcard occlusion IDs were not persisted to Markdown: ${markdown}`);
  const roundTrip = luteEngine.Md2BlockDOM(markdown, false);
  assert.ok(both(roundTrip), `flashcard occlusion IDs did not survive Markdown round trip: ${roundTrip}`);

  tree = luteEngine.BlockDOM2Tree(blockDOM)!;
  const standardHTML = luteEngine.Tree2HTML(tree, luteEngine.RenderOptions, luteEngine.ParseOptions);
  assert.ok(!standardHTML.includes("data-occlusion-id"), `standard HTML should not expose flashcard occlusion IDs: ${standardHTML}`);
  tree = luteEngine.BlockDOM2Tree(blockDOM)!;
  const previewHTML = luteEngine.ProtylePreview(tree, luteEngine.RenderOptions, luteEngine.ParseOptions);
  assert.ok(!previewHTML.includes("data-occlusion-id"), `preview HTML should not expose flashcard occlusion IDs: ${previewHTML}`);
  tree = luteEngine.BlockDOM2Tree(blockDOM)!;
  const exportHTML = new TextDecoder().decode(render.NewProtyleExportRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render());
  assert.ok(!exportHTML.includes("data-occlusion-id"), `export HTML should not expose flashcard occlusion IDs: ${exportHTML}`);
});

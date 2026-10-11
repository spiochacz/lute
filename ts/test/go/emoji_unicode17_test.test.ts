// Port of test/emoji_unicode17_test.go. The data file is test/emoji_unicode17.json (Unicode 17.0 emoji-test.txt, E17.0 fully-qualified sequences).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { New, parse } from "../../src/index.ts";
import { repoPath } from "./wave_a_helpers.ts";

test("TestUnicode17Emoji", () => {
  const entries = JSON.parse(readFileSync(repoPath("test/emoji_unicode17.json"), "utf8")) as { alias: string; emoji: string }[];
  assert.equal(entries.length, 163, `expected 163 sequences, got ${entries.length}`);
  const engine = New();
  engine.SetCallout(true);
  for (const entry of entries) {
    assert.equal(engine.GetEmojis().get(entry.alias), entry.emoji, `${entry.alias} mapping`);
    assert.equal(parse.EmojiUnicodeAliasMap().get(entry.emoji), entry.alias, `${entry.alias} reverse mapping`);
    for (const input of [entry.emoji, ":" + entry.alias + ":"]) {
      assert.equal(engine.MarkdownStr("", input), "<p>" + entry.emoji + "</p>\n", `${entry.alias} inline ${input}`);
      const got = engine.MarkdownStr("", "> [!NOTE] " + input + " Title\n> Content\n");
      const want = '<span class="callout-icon">' + entry.emoji + '</span><span class="callout-title">Title</span>';
      assert.ok(got.includes(want), `${entry.alias} callout ${input}: ${got}`);
    }
  }
});

// Shared inputs of the benchmarks: the Markdown texts (tiny, small, medium, spec), the
// round-trip inputs that the reference makes from them, and the paths of the bundles.
// Importing this file starts nothing.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { InputKind, LuteGlobal } from "./methods.ts";

export const TS_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const PORT_BUNDLE = fileURLToPath(new URL("../../dist/lute.min.js", import.meta.url));
export const ESM_BUILD = fileURLToPath(new URL("../../dist/lute.esm.js", import.meta.url));
export const REF_BUNDLE = fileURLToPath(new URL("../../test/oracle/lute.ref.min.cjs", import.meta.url));
export const COMMONMARK_PATH = fileURLToPath(new URL("../../../benchmark/commonmark-spec.md", import.meta.url));

export const INPUT_NAMES = ["tiny", "small", "medium", "spec"] as const;
export type InputName = (typeof INPUT_NAMES)[number];

export function isInputName(s: string): s is InputName {
  return (INPUT_NAMES as readonly string[]).includes(s);
}

// About 100 bytes: one paragraph with emphasis and a link.
export const TINY_MARKDOWN = [
  "A short paragraph with *emphasis*, **strong text** and a [link](https://example.com/page).",
  "",
].join("\n");

// About 1 KB of typical Markdown: heading, paragraph with emphasis and a link, list,
// fenced code, table, quote. Used by bench/startup.ts and by the small input.
export const SMALL_MARKDOWN = [
  "# Release notes",
  "",
  "This release keeps the *fast path* for **plain paragraphs** and adds a [short guide](https://example.com/guide) to the editor. Existing output stays the same.",
  "",
  "## Changes",
  "",
  "- Faster parsing of long lists",
  "- Fixed the anchor of nested headings",
  "- New option for [task list](https://example.com/tasks) markers",
  "  - Works with nested items too",
  "",
  "The parser reads each line once and keeps the state of open blocks in a small stack, so long documents stay linear in their length. Inline markers such as *emphasis*, `code` and ~~strikethrough~~ are resolved after the block structure is known, which keeps the rules of each step simple to check.",
  "",
  "1. Update the package",
  "2. Run the test suite",
  "3. Read the guide",
  "",
  "Example:",
  "",
  "```js",
  "const engine = Lute.New();",
  "console.log(engine.MarkdownStr(\"\", \"# Hello\"));",
  "```",
  "",
  "| Option | Default | Meaning |",
  "|--------|---------|---------|",
  "| `ToC` | off | Table of contents |",
  "| `Footnotes` | on | Footnote syntax |",
  "| `Sanitize` | on | Filter unsafe HTML |",
  "",
  "> Keep the output stable: the same input must always give the same HTML.",
  "",
].join("\n");

// The longest prefix of text that is at most maxBytes long and ends at a line break.
export function cutAtLine(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) {
    return text;
  }
  const nl = buf.lastIndexOf(0x0a, maxBytes - 1);
  return buf.subarray(0, nl + 1).toString("utf8");
}

const commonmark = (): string => readFileSync(COMMONMARK_PATH, "utf8");

export function markdownInput(name: InputName): string {
  switch (name) {
    case "tiny":
      return TINY_MARKDOWN;
    case "small":
      return SMALL_MARKDOWN;
    case "medium":
      return cutAtLine(commonmark(), 10 * 1024);
    case "spec":
      return commonmark();
  }
}

// Loads a bundle the way test/e2e/bundle_driver.mjs does: as a CommonJS module that sets globalThis.Lute.
export function loadBundle(path: string): LuteGlobal {
  createRequire(import.meta.url)(path);
  const lute = (globalThis as unknown as { Lute?: LuteGlobal }).Lute;
  if (lute === undefined) {
    throw new Error(`bundle ${path} did not set globalThis.Lute`);
  }
  return lute;
}

// The inputs of the round trips, made by the reference from one Markdown text.
export function makeRoundTripInputs(markdown: string): Record<InputKind, string> {
  const lute = loadBundle(REF_BUNDLE) as LuteGlobal & Record<string, any>;
  const plain = lute.New();
  const wysiwyg = lute.New();
  wysiwyg.SetVditorWYSIWYG(true);
  return {
    markdown,
    html: plain.MarkdownStr("", markdown),
    vditorDOM: wysiwyg.Md2VditorDOM(markdown),
    blockDOM: plain.Md2BlockDOM(markdown),
  };
}

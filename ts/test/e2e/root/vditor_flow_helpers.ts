// Helpers of the end-to-end tests of vditor_ir.go and vditor_sv.go: editor flows (typing, caret movement, small edits) whose inputs
// come from the ORACLE's own forward methods, and the comparison of port and oracle on the same input.

import { attempt, assertSameOutcome, newEngines } from "../helpers.ts";
import type { Engines, Outcome } from "../helpers.ts";
import { caretVariants, snippets, CARET_SPECIAL } from "../renderers/vditor_helpers.ts";

export { newEngines, caretVariants, snippets, CARET_SPECIAL };
export type { Engines };

export const CARET = "‸";

// Counts of the inputs on which both engines threw, by label; reported by the last test of each file.
export const bothThrew = new Map<string, number>();
export const bothThrewExamples = new Map<string, string>();

export function recordBothThrew(label: string, input: string): void {
  bothThrew.set(label, (bothThrew.get(label) ?? 0) + 1);
  if (!bothThrewExamples.has(label)) {
    bothThrewExamples.set(label, input);
  }
}

// Calls method `name` of both engines with `args`. Returns the oracle outcome (normalised).
export function compareCall(engines: Engines, failures: string[], where: string, name: string, ...args: string[]): Outcome {
  const port = attempt(() => (engines.port as unknown as Record<string, (...a: string[]) => string>)[name](...args));
  const oracle = attempt(() => engines.oracle[name](...args) as string);
  try {
    if (assertSameOutcome(`${where} ${name}`, port, oracle) === "bothThrew") {
      recordBothThrew(name, JSON.stringify(args[0]));
    }
  } catch (e) {
    failures.push((e as Error).message + "\n  input: " + JSON.stringify(args[0]));
  }
  return oracle;
}

// Raw (not normalised) oracle call, for inputs of the next step; returns null when it throws.
export function oracleRaw(engines: Engines, name: string, arg: string): string | null {
  try {
    return engines.oracle[name](arg) as string;
  } catch {
    return null;
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// What a user types, stage by stage: half-typed Markdown.
export const TYPED: string[] = [
  "**abc", "**abc*", "*a", "_a", "~~a", "==a", "^a", "~a", "`", "`a", "``a`", "``", "```", "```js", "``` js", "~~~", "````",
  "- ", "-", "- a", "* ", "+ ", "1.", "1. ", "1)", "1) a", "2. ", "10. ", "- [ ] ", "- [x", "- [ ]", "- [x] a",
  "#", "# ", "##", "## a", "###### x", "####### x", "#x", "# a #", "# a {#id}", "# a {#i", "# a {#id", "# a {#i d}",
  "|", "| a", "| a |", "| a | b", "| a | b |", "| a | b |\n|", "| a | b |\n| -", "| a | b |\n| - | -", "| a | b |\n| - | - |", "| a | b |\n| - | - |\n| 1",
  "[a](", "[a](htt", "[a](http://x.y", "[a](http://x.y \"t", "[a](http://x.y \"t\"", "[a]", "[a][b]", "[a]: /u", "[", "[]", "[]()", "![", "![a](", "![a](b.png",
  "<div>", "<div>a", "<b>x", "<b>x</b>", "<!--", "<http://a.b", "<http://a.b>", "http://a.b",
  "$$", "$$\nx", "$", "$x", "$x$", "a $x", "a $x$ b", "$$x$$",
  "[^1]", "[^1]: ", "[^1]: a", "[toc]", "[TOC]", "> ", ">", "> a", ">> a", "---", "***", "___", "===", "a\n===", "a\n---", "a\n--",
  "\\*", "\\", "&amp", "&amp;", "&#35", "&#35;", "a  ", "a  \nb", "a\\\nb", ":smile", ":smile:", "{{{", "{{{row", "{: id=\"x\"}", "((", "((20200101000000-abcdefg",
  "---\ntitle: x", "---\ntitle: x\n---", "    code", "\tcode", "  a", "1. a\n2. b", "- a\n  - b", "- a\n\n  b",
];

// `<p data-block="0">` with the half-typed text and the caret at spread positions (never inside a surrogate pair).
export function typedParagraphs(text: string, maxPositions: number): string[] {
  const out: string[] = [];
  const stride = Math.max(1, Math.ceil((text.length + 1) / maxPositions));
  for (let i = 0; i <= text.length; i += stride) {
    if (i > 0 && i < text.length && /[\udc00-\udfff]/.test(text[i])) continue;
    out.push(`<p data-block="0">${escapeText(text.slice(0, i))}<wbr>${escapeText(text.slice(i))}</p>`);
  }
  return out;
}

// Positions in an HTML string where a text node can be edited: inside text, not inside a tag.
function textPositions(dom: string): number[] {
  const out: number[] = [];
  let inTag = false;
  for (let i = 0; i < dom.length; i++) {
    const c = dom[i];
    if (c === "<") {
      inTag = true;
    } else if (c === ">") {
      inTag = false;
      out.push(i + 1);
    } else if (!inTag) {
      out.push(i + 1);
    }
  }
  return out;
}

function isHigh(s: string, i: number): boolean {
  const c = s.charCodeAt(i);
  return c >= 0xd800 && c <= 0xdbff;
}

function isLow(s: string, i: number): boolean {
  const c = s.charCodeAt(i);
  return c >= 0xdc00 && c <= 0xdfff;
}

const EDIT_CHARS = ["*", "`", "_", "#", " ", "\n", "[", "(", "|", "$", "~", "<", "-", "1.", "\t"];

// Small edits of an IR DOM at `n` spread positions: the caret alone, a typed marker character before the caret, a deleted character,
// a split line.
export function domEdits(dom: string, n: number, salt: number): string[] {
  const clean = dom.split(CARET).join("<wbr>");
  const out: string[] = [clean];
  const pos = textPositions(clean);
  if (pos.length === 0) {
    return out;
  }
  for (let k = 0; k < n; k++) {
    const p = pos[Math.floor(((k + 0.5) * pos.length) / n)];
    if (isLow(clean, p) || isHigh(clean, p - 1)) {
      continue; // never split a surrogate pair
    }
    const ch = EDIT_CHARS[(k + salt) % EDIT_CHARS.length];
    out.push(clean.slice(0, p) + "<wbr>" + clean.slice(p));
    out.push(clean.slice(0, p) + ch + "<wbr>" + clean.slice(p));
    // delete the character before the position when it is plain text
    if (p > 0 && /[^<>;]/.test(clean[p - 1]) && !isLow(clean, p - 1)) {
      out.push(clean.slice(0, p - 1) + "<wbr>" + clean.slice(p));
    }
    out.push(clean.slice(0, p) + "\n<wbr>" + clean.slice(p));
  }
  return out;
}

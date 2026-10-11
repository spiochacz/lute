// Helpers of the end-to-end tests of protyle.go / protyle_tabs.go: the inputs of every DOM-taking method come from the ORACLE's own
// forward method (Md2BlockDOM), are mutated the way the editor or a user would, and the same call is run on the port and on the oracle.

import { attempt, assertSameOutcome, newEngines } from "../helpers.ts";
import type { Engines, Outcome } from "../helpers.ts";

export { newEngines };
export type { Engines };

export const CARET = "‸";
export const EDITABLE = '<div contenteditable="true" spellcheck="false">';

// Counts of the inputs on which both engines threw, by label.
export const bothThrew = new Map<string, number>();
export const bothThrewExamples = new Map<string, string>();

export function recordBothThrew(label: string, input: string): void {
  bothThrew.set(label, (bothThrew.get(label) ?? 0) + 1);
  if (!bothThrewExamples.has(label)) {
    bothThrewExamples.set(label, input);
  }
}

// Calls method `name` of both engines with `args`. Failures are collected. Returns the RAW oracle output (null when it threw).
export function compareCall(engines: Engines, failures: string[], where: string, name: string, ...args: (string | boolean)[]): string | null {
  const call = (target: unknown): string => {
    const fn = (target as Record<string, (...a: unknown[]) => unknown>)[name];
    return String(fn.apply(target, args));
  };
  const port: Outcome = attempt(() => call(engines.port));
  const oracle: Outcome = attempt(() => call(engines.oracle));
  try {
    if (assertSameOutcome(`${where} ${name}`, port, oracle) === "bothThrew") {
      recordBothThrew(name, JSON.stringify(args[0]));
    }
  } catch (e) {
    failures.push((e as Error).message + "\n  input: " + JSON.stringify(args[0]));
  }
  try {
    return call(engines.oracle);
  } catch {
    return null;
  }
}

// Raw oracle call; null when it throws.
export function oracleRaw(engines: Engines, name: string, ...args: (string | boolean)[]): string | null {
  try {
    return String((engines.oracle[name] as (...a: unknown[]) => unknown).apply(engines.oracle, args));
  } catch {
    return null;
  }
}

// The DOM-taking methods that return a string.
export const DOM_METHODS = [
  "BlockDOM2Md", "BlockDOM2StdMd", "BlockDOM2HTML", "BlockDOM2Content", "BlockDOM2Text", "BlockDOM2TextLen",
  "BlockDOM2EscapeMarkerContent", "BlockDOM2RichHTML", "BlockDOM2InlineBlockDOM", "SpinBlockDOM",
];
export const CONVERSION_METHODS = [
  "CancelSuperBlock", "CancelList", "CancelListRecursively", "CancelBlockquote", "CancelCallout", "Blocks2Ps",
  "UL2OL", "OL2UL", "UL2TL", "OL2TL", "TL2OL", "TL2UL", "Callout2Blockquote", "Blockquote2Callout",
];

// Deterministic generator.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(r: () => number, items: readonly T[]): T {
  return items[Math.floor(r() * items.length)];
}

// [start, end) of the content of every editable div (and cell) of a DOM string.
export function editableRanges(dom: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  for (;;) {
    const at = dom.indexOf(EDITABLE, i);
    if (at < 0) {
      break;
    }
    const start = at + EDITABLE.length;
    const end = dom.indexOf("</div>", start);
    if (end < 0) {
      break;
    }
    out.push([start, end]);
    i = end;
  }
  return out;
}

function isHigh(c: number): boolean {
  return c >= 0xd800 && c <= 0xdbff;
}
function isLow(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

// Positions inside the editable ranges that are not inside a tag.
export function caretPositions(dom: string): number[] {
  const out: number[] = [];
  for (const [s, e] of editableRanges(dom)) {
    let inTag = false;
    for (let p = s; p <= e; p++) {
      if (p < e) {
        const c = dom[p];
        if (c === "<") {
          if (!inTag) {
            out.push(p);
          }
          inTag = true;
          continue;
        }
        if (c === ">" && inTag) {
          inTag = false;
          out.push(p + 1);
          continue;
        }
      }
      if (!inTag && !(p > 0 && p < dom.length && isHigh(dom.charCodeAt(p - 1)) && isLow(dom.charCodeAt(p)))) {
        out.push(p);
      }
    }
  }
  return out;
}

export function insertAt(dom: string, p: number, s: string): string {
  return dom.slice(0, p) + s + dom.slice(p);
}

const TYPED_TEXT = ["**", "*", "_", "`", "~~", "==", "$", "#", "> ", "- ", "1. ", "[ ] ", "[a](b)", "((20200101000000-abcdefg \"t\"))", "\\", "<b>", "&amp;", " ", "\n", "​", "x", "中文", "#tag#", "^s^", "~s~", "![i](a.png)", "{: custom-x=\"y\"}", "|", "@tab", ":::"];
const TYPES = ["strong", "em", "code", "a", "tag", "block-ref", "inline-math", "mark", "s", "u", "sub", "sup", "kbd", "inline-memo", "text", "file-annotation-ref", "strong em", "strong code", "em a", "strong a", "text strong", "a tag", "search-mark", "virtual-block-ref", "backslash"];

// Applies one small edit of the kind a user or the SiYuan front end makes. Returns null when the edit does not apply.
export function mutate(dom: string, r: () => number): string | null {
  const positions = caretPositions(dom);
  const kind = Math.floor(r() * 16);
  const posOf = (): number | null => (positions.length === 0 ? null : pick(r, positions));
  switch (kind) {
    case 0:
    case 1:
    case 2: {
      // caret
      const p = posOf();
      return p === null ? null : insertAt(dom, p, "<wbr>");
    }
    case 3:
    case 4: {
      // type a marker or text with the caret after it
      const p = posOf();
      return p === null ? null : insertAt(dom, p, pick(r, TYPED_TEXT) + "<wbr>");
    }
    case 5: {
      // delete one character of text
      const p = posOf();
      if (p === null || dom[p] === "<" || dom[p] === undefined || isHigh(dom.charCodeAt(p))) {
        return null;
      }
      return dom.slice(0, p) + "<wbr>" + dom.slice(p + 1);
    }
    case 6: {
      // wrap a range into a span
      const ranges = editableRanges(dom);
      if (ranges.length === 0) {
        return null;
      }
      const [s, e] = pick(r, ranges);
      if (e - s < 2) {
        return null;
      }
      const a = s + Math.floor(r() * (e - s));
      const b = a + Math.floor(r() * (e - a));
      if (isLow(dom.charCodeAt(a)) || isLow(dom.charCodeAt(b))) {
        return null;
      }
      const seg = dom.slice(a, b);
      // keep tags balanced
      if ((seg.match(/</g) ?? []).length !== (seg.match(/>/g) ?? []).length || /<\/?[a-z]/.test(seg)) {
        return null;
      }
      const type = pick(r, TYPES);
      const extra = type.includes("a") && /(^| )a( |$)/.test(type) ? ' data-href="https://b3log.org" data-title="t"' : type.includes("block-ref") ? ' data-subtype="s" data-id="20200101000000-abcdefg"' : type.includes("inline-math") ? ' data-content="a+b"' : type.includes("file-annotation-ref") ? ' data-id="a/b"' : "";
      return dom.slice(0, a) + `<span data-type="${type}"${extra}>` + seg + "</span>" + dom.slice(b);
    }
    case 7: {
      // change the type of an existing span
      const m = [...dom.matchAll(/<span data-type="([^"]*)"/g)];
      if (m.length === 0) {
        return null;
      }
      const x = pick(r, m);
      return dom.slice(0, x.index) + `<span data-type="${pick(r, TYPES)}"` + dom.slice(x.index + x[0].length);
    }
    case 8: {
      // change data-subtype
      const m = [...dom.matchAll(/data-subtype="([^"]*)"/g)];
      if (m.length === 0) {
        return null;
      }
      const x = pick(r, m);
      const v = pick(r, ["h1", "h2", "h6", "h7", "u", "o", "t", "NOTE", "", "s", "d", "echarts", "mermaid", "go", "math"]);
      return dom.slice(0, x.index) + `data-subtype="${v}"` + dom.slice(x.index + x[0].length);
    }
    case 9: {
      // drop a data-node-id
      const m = [...dom.matchAll(/ data-node-id="[^"]*"/g)];
      if (m.length === 0) {
        return null;
      }
      const x = pick(r, m);
      return dom.slice(0, x.index) + dom.slice(x.index + x[0].length);
    }
    case 10: {
      // duplicate a block
      const m = [...dom.matchAll(/<div data-node-id="[^"]*" data-type="NodeParagraph"[^>]*>/g)];
      if (m.length === 0) {
        return null;
      }
      const x = pick(r, m);
      const end = dom.indexOf('<div class="protyle-attr" contenteditable="false">', x.index);
      const close = dom.indexOf("</div></div>", end);
      if (end < 0 || close < 0) {
        return null;
      }
      const block = dom.slice(x.index, close + 12);
      return dom.slice(0, close + 12) + block + dom.slice(close + 12);
    }
    case 11: {
      // empty a paragraph
      const ranges = editableRanges(dom);
      if (ranges.length === 0) {
        return null;
      }
      const [s, e] = pick(r, ranges);
      return dom.slice(0, s) + (r() < 0.5 ? "" : "<wbr>") + dom.slice(e);
    }
    case 12: {
      // change a list item's marker
      const m = [...dom.matchAll(/data-marker="([^"]*)"/g)];
      if (m.length === 0) {
        return null;
      }
      const x = pick(r, m);
      const v = pick(r, ["*", "-", "+", "1.", "2.", "10.", "1)", "", "x"]);
      return dom.slice(0, x.index) + `data-marker="${v}"` + dom.slice(x.index + x[0].length);
    }
    case 13: {
      // add a table row or a cell
      if (r() < 0.5) {
        const i = dom.indexOf("</tr>");
        if (i < 0) {
          return null;
        }
        const j = dom.indexOf("<tr>");
        const row = dom.slice(j, i + 5);
        return dom.slice(0, i + 5) + row + dom.slice(i + 5);
      }
      const i = dom.search(/<\/t[dh]>/);
      if (i < 0) {
        return null;
      }
      return dom.slice(0, i) + "<wbr>" + dom.slice(i) + "<td>new</td>";
    }
    case 14: {
      // toggle a task item
      if (dom.includes("protyle-task--done")) {
        return dom.replace("protyle-task--done", "");
      }
      const i = dom.indexOf("protyle-action--task");
      if (i < 0) {
        return null;
      }
      return dom.slice(0, i) + "protyle-action--task protyle-task--done" + dom.slice(i + "protyle-action--task".length);
    }
    default: {
      // paste a second block inside a list item
      const m = [...dom.matchAll(/data-type="NodeListItem"[^>]*>/g)];
      if (m.length === 0) {
        return null;
      }
      const x = pick(r, m);
      const at = x.index + x[0].length;
      const pasted = '<div data-node-id="20200101000000-pasted0" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="false">pasted<wbr></div><div class="protyle-attr" contenteditable="false">​</div></div>';
      const act = dom.indexOf("</div>", at);
      return act < 0 ? null : dom.slice(0, act + 6) + pasted + dom.slice(act + 6);
    }
  }
}

// Ported from parse/text_mark_delimiters.go @ 8e7896b6

import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";
import * as slices from "../runtime/slices.ts";
import * as strings from "../runtime/strings.ts";
import * as ast from "../ast/index.ts";
import { InlineContext } from "./parse.ts";
import type { Tree } from "./types.ts";

// parseTextMarkDelimiters pairs delimiters between adjacent text and style nodes, and keeps the style of each text segment.
export function parseTextMarkDelimiters(tree: Tree): void {
  const groups: ast.Node[][] = [];
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering || n.FirstChild === null) {
      return ast.WalkContinue;
    }
    let group: ast.Node[] = [];
    const flush = (): void => {
      if (group.length > 1) {
        groups.push(group);
      }
      group = [];
    };
    for (let c: ast.Node | null = n.FirstChild; c !== null; c = c.Next) {
      if (c.Type === ast.NodeText || isDelimiterTextMark(c)) {
        group.push(c);
      } else {
        flush();
      }
    }
    flush();
    return ast.WalkContinue;
  });
  for (const group of groups) {
    parseTextMarkDelimiterGroup(tree, group);
  }
}

export function isDelimiterTextMark(n: ast.Node): boolean {
  if (n.Type !== ast.NodeTextMark || n.TextMarkFlashcardOcclusionID !== "") {
    return false;
  }
  for (const typ of strings.Fields(n.TextMarkType)) {
    switch (typ) {
      case "strong":
      case "em":
      case "s":
      case "mark":
      case "sup":
      case "sub":
      case "u":
      case "text":
        break;
      default:
        return false;
    }
  }
  return n.TextMarkType !== "";
}

export function parseTextMarkDelimiterGroup(tree: Tree, group: ast.Node[]): void {
  let tokens: Uint8Array = new Uint8Array(0);
  const owners: ast.Node[] = [];
  let hasStyle = false;
  for (const n of group) {
    let content: Uint8Array = n.Tokens ?? new Uint8Array(0);
    if (n.Type === ast.NodeTextMark) {
      content = conv.BytesFromString(n.TextMarkTextContent);
      hasStyle = true;
    }
    // Escapes, entities and standalone syntax are left to the full inline parser.
    if (bytes.ContainsAny(content, "\\`$&<>\n[]()")) {
      return;
    }
    tokens = slices.Append(tokens, content);
    for (let i = 0; i < content.length; i++) {
      owners.push(n);
    }
  }
  if (!hasStyle || !bytes.ContainsAny(tokens, "*_~=#^")) {
    return;
  }
  const block = new ast.Node(ast.NodeParagraph);
  const ctx = new InlineContext();
  ctx.tokens = tokens;
  ctx.tokensLen = tokens.length;
  const markerOwners = new Map<ast.Node, ast.Node>();
  const markerLengths = new Map<ast.Node, number>();
  const appendText = (start: number, end: number): void => {
    while (start < end) {
      let next = start + 1;
      while (next < end && owners[next] === owners[start]) {
        next++;
      }
      const owner = owners[start];
      if (owner.Type === ast.NodeTextMark) {
        const textMark = new ast.Node(ast.NodeTextMark);
        textMark.TextMarkType = owner.TextMarkType;
        textMark.TextMarkTextContent = conv.StringFromBytes(tokens.subarray(start, next));
        textMark.KramdownIAL = owner.KramdownIAL;
        block.AppendChild(textMark);
      } else {
        block.AppendChild(new ast.Node(ast.NodeText, tokens.subarray(start, next)));
      }
      start = next;
    }
  };
  while (ctx.pos < ctx.tokensLen) {
    const start = ctx.pos;
    if (strings.ContainsRune("*_~=#^", tokens[start])) {
      tree.handleDelim(block, ctx);
      // When one delimiter run crosses a style boundary, keep the original nodes, so the remaining markers are not given the wrong style.
      for (let i = start + 1; i < ctx.pos; i++) {
        if (owners[i] !== owners[start]) {
          return;
        }
      }
      markerOwners.set(block.LastChild!, owners[start]);
      markerLengths.set(block.LastChild!, ctx.pos - start);
    } else {
      ctx.pos++;
      while (ctx.pos < ctx.tokensLen && !strings.ContainsRune("*_~=#^", tokens[ctx.pos])) {
        ctx.pos++;
      }
      appendText(start, ctx.pos);
    }
  }
  tree.processEmphasis(null, ctx);
  let matched = false;
  for (const [n, length] of markerLengths) {
    if (n.Parent === null || (n.Tokens ?? new Uint8Array(0)).length !== length) {
      matched = true;
    }
    if (n.Parent !== null && markerOwners.get(n)!.Type === ast.NodeTextMark) {
      const owner = markerOwners.get(n)!;
      n.Type = ast.NodeTextMark;
      n.TextMarkType = owner.TextMarkType;
      n.TextMarkTextContent = conv.StringFromBytes(n.Tokens ?? new Uint8Array(0));
      n.KramdownIAL = owner.KramdownIAL;
      n.Tokens = null;
    }
  }
  if (!matched) {
    return;
  }
  while (block.FirstChild !== null) {
    group[0].InsertBefore(block.FirstChild);
  }
  for (const n of group) {
    n.Unlink();
  }
}

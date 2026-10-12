// Ported from parse/text.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";
import * as slices from "../runtime/slices.ts";
import * as ast from "../ast/index.ts";
import * as editor from "../editor/index.ts";
import * as lex from "../lex/index.ts";
import * as util from "../util/index.ts";
import { fullWidthTilde } from "./delimiter.ts";
import type { InlineContext } from "./parse.ts";
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseText(ctx: InlineContext): ast.Node;
    isMarker(token: number): boolean;
    parseBackslash(block: ast.Node, ctx: InlineContext): ast.Node | null;
    parseNewline(block: ast.Node, ctx: InlineContext): ast.Node;
    MergeText(): void;
    mergeText(node: ast.Node): void;
  }
}

const brSpaceSlash: Uint8Array = conv.BytesFromString("<br />");
const brSlash: Uint8Array = conv.BytesFromString("<br/>");
const br: Uint8Array = conv.BytesFromString("<br>");

Tree.prototype.parseText = function (this: Tree, ctx: InlineContext): ast.Node {
  const t = this;
  const start = ctx.pos;
  for (; ctx.pos < ctx.tokensLen; ctx.pos++) {
    if (t.isMarker(ctx.tokens[ctx.pos]) || (t.Context!.ParseOption.FullWidthStrikethrough &&
      bytes.HasPrefixAt(ctx.tokens, ctx.pos, fullWidthTilde))) {
      // On a potential marker, break out of this text node and return to the main inline parsing loop
      break;
    }
  }
  return new ast.Node(ast.NodeText, ctx.tokens.subarray(start, ctx.pos));
};

// isMarker reports whether token is a potential Markdown marker.
Tree.prototype.isMarker = function (this: Tree, token: number): boolean {
  const t = this;
  if (lex.IsMarker(token)) {
    return true;
  }

  if (t.Context!.ParseOption.Sup && lex.ItemCaret === token) {
    return true;
  }
  return false;
};

const backslash: Uint8Array = util.StrToBytes("\\");

Tree.prototype.parseBackslash = function (this: Tree, block: ast.Node, ctx: InlineContext): ast.Node | null {
  const t = this;
  if (ctx.pos === ctx.tokensLen - 1) {
    ctx.pos++;
    return new ast.Node(ast.NodeText, backslash);
  }

  ctx.pos++;
  let token = ctx.tokens[ctx.pos];
  if (lex.ItemNewline === token) {
    ctx.pos++;
    // PERF-TODO: allocates a one-element array; a later task may share them.
    return new ast.Node(ast.NodeHardBreak, new Uint8Array([token]));
  }
  if (lex.IsASCIIPunct(token)) {
    if (0x3c /* < */ === token && null !== t.Context!.oldtip && ast.NodeTable === t.Context!.oldtip.Type) {
      // When a table cell spans several lines and a trailing escape `\` is typed, `<br />` is exposed https://github.com/siyuan-note/siyuan/issues/7725
      const isBr = ctx.tokens.subarray(ctx.pos);
      if (bytes.HasPrefix(isBr, brSpaceSlash) || bytes.HasPrefix(isBr, brSlash) || bytes.HasPrefix(isBr, br)) {
        return new ast.Node(ast.NodeText, backslash);
      }
    }

    ctx.pos++;
    const n = new ast.Node(ast.NodeBackslash);
    block.AppendChild(n);
    // PERF-TODO: allocates a one-element array; a later task may share them.
    n.AppendChild(new ast.Node(ast.NodeBackslashContent, new Uint8Array([token])));
    return null;
  }
  if (t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.ProtyleWYSIWYG) {
    // Handle the \‸x case, the character after the caret is the one to escape
    const tokens = ctx.tokens.subarray(ctx.pos);
    const caret = editor.CaretTokens;
    if (caret.length < tokens.length && bytes.HasPrefix(tokens, caret)) {
      token = ctx.tokens[ctx.pos + caret.length];
      if (lex.IsASCIIPunct(token)) {
        if (0x3c /* < */ === token && null !== t.Context!.oldtip && ast.NodeTable === t.Context!.oldtip.Type) {
          // When a table cell spans several lines and a trailing escape `\` is typed, `<br />` is exposed https://github.com/siyuan-note/siyuan/issues/7725
          const isBr = ctx.tokens.subarray(ctx.pos + caret.length);
          if (bytes.HasPrefix(isBr, brSpaceSlash) || bytes.HasPrefix(isBr, brSlash) || bytes.HasPrefix(isBr, br)) {
            return new ast.Node(ast.NodeText, backslash);
          }
        }

        ctx.pos += caret.length;
        ctx.pos++;
        const n = new ast.Node(ast.NodeBackslash);
        block.AppendChild(n);
        // PERF-TODO: allocates a one-element array; a later task may share them.
        n.AppendChild(new ast.Node(ast.NodeBackslashContent, new Uint8Array([token])));
        if (t.Context!.ParseOption.ProtyleWYSIWYG) {
          // In Protyle WYSIWYG mode the caret moves in front of the backslash node
          n.InsertBefore(new ast.Node(ast.NodeText, caret));
        } else {
          block.AppendChild(new ast.Node(ast.NodeText, caret));
        }
        return null;
      }
    }
  }
  return new ast.Node(ast.NodeText, backslash);
};

Tree.prototype.parseNewline = function (this: Tree, block: ast.Node, ctx: InlineContext): ast.Node {
  const t = this;
  const pos = ctx.pos;
  ctx.pos++;

  let isHardBreak = false;
  // Check the trailing spaces of the previous node, two or more mean a hard break
  const lastc = block.LastChild;
  if (null !== lastc && ast.NodeText === lastc.Type) {
    const tokens = lastc.Tokens!;
    const valueLen = tokens.length;
    if (lex.ItemSpace === tokens[valueLen - 1]) {
      [, lastc.Tokens] = lex.TrimRight(tokens);
      if (1 < valueLen) {
        isHardBreak = lex.ItemSpace === tokens[tokens.length - 2];
      }
    }
  }

  // PERF-TODO: allocates a one-element array; a later task may share them.
  const ret = new ast.Node(ast.NodeSoftBreak, new Uint8Array([ctx.tokens[pos]]));
  if (t.Context!.ParseOption.ProtyleWYSIWYG) {
    // All line breaks in Protyle are soft breaks. Improve soft line break paste parsing https://github.com/siyuan-note/siyuan/issues/14481
    return ret;
  }

  if (isHardBreak) {
    ret.Type = ast.NodeHardBreak;
  }
  return ret;
};

Tree.prototype.MergeText = function (this: Tree): void {
  const t = this;
  t.mergeText(t.Root!);
};

// mergeText merges all consecutive text nodes in node (including child nodes).
// After merging, it also does Chinese typography optimization and GFM auto email link recognition.
Tree.prototype.mergeText = function (this: Tree, node: ast.Node): void {
  const t = this;
  for (let child = node.FirstChild; null !== child;) {
    let next = child.Next;
    if (ast.NodeText === child.Type) {
      if (null !== next && ast.NodeText === next.Type) {
        // The Tokens of text nodes are all sub-slices of the same inline buffer and cannot be merged by appending in place (they would overwrite each other),
        // so count the total length first and allocate the merged result once
        let total = (child.Tokens ?? new Uint8Array(0)).length;
        for (let n: ast.Node | null = next; null !== n && ast.NodeText === n.Type; n = n.Next) {
          total += (n.Tokens ?? new Uint8Array(0)).length;
        }
        let merged: Uint8Array = slices.Make(0, total);
        merged = slices.Append(merged, child.Tokens ?? new Uint8Array(0));
        while (null !== next && ast.NodeText === next.Type) {
          merged = slices.Append(merged, next.Tokens ?? new Uint8Array(0));
          next.Unlink();
          next = child.Next;
        }
        child.Tokens = merged;
      }
    } else if (ast.NodeLinkText === child.Type) {
      if (null !== next && ast.NodeLinkText === next.Type) {
        let total = (child.Tokens ?? new Uint8Array(0)).length;
        for (let n: ast.Node | null = next; null !== n && ast.NodeLinkText === n.Type; n = n.Next) {
          total += (n.Tokens ?? new Uint8Array(0)).length;
        }
        let merged: Uint8Array = slices.Make(0, total);
        merged = slices.Append(merged, child.Tokens ?? new Uint8Array(0));
        while (null !== next && ast.NodeLinkText === next.Type) {
          merged = slices.Append(merged, next.Tokens ?? new Uint8Array(0));
          next.Unlink();
          next = child.Next;
        }
        child.Tokens = merged;
      }
    } else {
      t.mergeText(child); // Recurse into child nodes
    }
    child = next;
  }
};

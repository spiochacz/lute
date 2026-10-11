// Ported from parse/callout.go @ 8e7896b6
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
import * as strings from "../runtime/strings.ts";
import * as ast from "../ast/index.ts";
import * as lex from "../lex/index.ts";
import { EmojiAliasUnicodeMap, IsEmoji } from "./emoji_map.ts";
import { Context } from "./types.ts";
import type { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Context {
    calloutFinalize(callout: ast.Node): void;
    parseCalloutImageIcon(title: string): [string, string, boolean];
  }
}

const emptyTokens: Uint8Array = new Uint8Array(0);
const newlineTokens: Uint8Array = conv.BytesFromString("\n");

// CalloutStart decides whether a callout (> [!Note]) starts.
export function CalloutStart(t: Tree, container: ast.Node): number {
  if (!t.Context!.ParseOption.Callout) {
    return 0;
  }

  if (t.Context!.indented) {
    return 0;
  }

  const marker = lex.Peek(t.Context!.currentLine, t.Context!.nextNonspace);
  if (lex.ItemGreater !== marker) {
    return 0;
  }

  t.Context!.advanceNextNonspace();
  t.Context!.advanceOffset(1, false);

  const content = conv.StringFromBytes(bytes.TrimSpace(t.Context!.currentLine.subarray(t.Context!.offset)));
  if (!strings.HasPrefix(content, "[!")) {
    return 0;
  }

  const idx = strings.Index(content, "]");
  if (0 > idx) {
    return 0;
  }

  t.Context!.closeUnmatchedBlocks();
  t.Context!.addChild(ast.NodeCallout);
  return 1;
}

export function CalloutContinue(callout: ast.Node, context: Context): number {
  const ln = context.currentLine;
  if (!context.indented && lex.Peek(ln, context.nextNonspace) === lex.ItemGreater) {
    context.advanceNextNonspace();
    context.advanceOffset(1, false);
    const token = lex.Peek(ln, context.offset);
    if (lex.ItemSpace === token || lex.ItemTab === token) {
      context.advanceOffset(1, true);
    }
    return 0;
  }
  return 1;
}

Context.prototype.calloutFinalize = function (this: Context, callout: ast.Node): void {
  const context = this;
  if (null === callout.FirstChild!.Next && !bytes.Contains(callout.FirstChild!.Tokens ?? emptyTokens, newlineTokens)) {
    // If there is only one child block, convert it to a block quote
    callout.Type = ast.NodeBlockquote;
    callout.PrependChild(new ast.Node(ast.NodeBlockquoteMarker));
    return;
  }

  const p = callout.FirstChild!;
  const lines = bytes.Split(p.Tokens ?? emptyTokens, newlineTokens);
  const content = bytes.TrimSpace(lines[0]);
  const typ = conv.StringFromBytes(bytes.TrimSpace(content.subarray(2, bytes.IndexByte(content, 0x5d /* ] */))));
  let title = conv.StringFromBytes(bytes.TrimSpace(content.subarray(bytes.IndexByte(content, 0x5d /* ] */) + 1)));
  callout.CalloutType = typ;
  callout.CalloutTitleExplicit = "" !== title;
  const [icon0, remains, ok] = context.parseCalloutImageIcon(title);
  if (ok) {
    callout.CalloutIcon = icon0;
    callout.CalloutIconType = 1;
    title = remains;
  }
  const icon = strings.Split(title, " ")[0];
  if ("" === callout.CalloutIcon && "" !== icon) {
    if (IsEmoji(icon)) {
      callout.CalloutIcon = icon;
      title = strings.TrimSpace(title.slice(icon.length)); // PORT-NOTE: byte offset. icon is a prefix of title, so its UTF-16 length is the right offset into title.
    } else {
      const emoji = EmojiAliasUnicodeMap().get(strings.ReplaceAll(icon, ":", "")) ?? "";
      if ("" !== emoji) {
        callout.CalloutIcon = emoji;
        title = strings.TrimSpace(title.slice(icon.length)); // PORT-NOTE: byte offset. Same as above.
        if (strings.HasPrefix(emoji, "/emojis/")) {
          callout.CalloutIconType = 1;
        }
      }
    }
  }

  if ("" === callout.CalloutIcon && ast.IsBuiltInCalloutType(typ)) {
    callout.CalloutIcon = ast.GetCalloutIcon(typ);
  }

  callout.CalloutTitle = title;
  p.Tokens = bytes.Join(lines.slice(1), newlineTokens);
  if (1 > p.Tokens.length) {
    p.Tokens = null;
  }
};

// parseCalloutImageIcon returns (icon, remains, ok).
Context.prototype.parseCalloutImageIcon = function (this: Context, title: string): [string, string, boolean] {
  const context = this;
  const marker = "![" + ast.CalloutIconImageAlt + "]";
  if (!strings.HasPrefix(title, marker)) {
    return ["", "", false];
  }

  const [passed, remains0, destination] = context.parseInlineLinkDest(conv.BytesFromString(title.slice(marker.length))); // marker is ASCII, so its length is the same in bytes and UTF-16
  let rest: Uint8Array = remains0;
  if (null === passed || !ast.IsValidCalloutImageSrc(conv.StringFromBytes(destination))) {
    return ["", "", false];
  }
  if (0 < rest.length && lex.ItemCloseParen === rest[0]) {
    rest = rest.subarray(1);
  }
  if (0 < rest.length && !lex.IsWhitespace(rest[0])) {
    return ["", "", false];
  }
  return [conv.StringFromBytes(destination), strings.TrimSpace(conv.StringFromBytes(rest)), true];
};

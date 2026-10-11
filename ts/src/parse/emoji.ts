// Ported from parse/emoji.go @ 8e7896b6
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
import * as slices from "../runtime/slices.ts";
import * as ast from "../ast/index.ts";
import * as lex from "../lex/index.ts";
import * as util from "../util/index.ts";
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    emoji(node: ast.Node): void;
    emoji0(node: ast.Node): void;
    EmojiImgTokens(alias: string, src: string): Uint8Array;
  }
}

// emoji replaces the Emoji aliases in the text nodes and link text nodes under node with native Unicode characters.
Tree.prototype.emoji = function (this: Tree, node: ast.Node): void {
  const t = this;
  for (let child = node.FirstChild; null !== child;) {
    const next = child.Next;
    if (ast.NodeText === child.Type || ast.NodeLinkText === child.Type) {
      t.emoji0(child);
    } else {
      t.emoji(child); // Process the child nodes recursively
    }
    child = next;
  }
};

export const EmojiSitePlaceholder: Uint8Array = util.StrToBytes("${emojiSite}");
const emojiDot: Uint8Array = util.StrToBytes(".");

Tree.prototype.emoji0 = function (this: Tree, node: ast.Node): void {
  const t = this;
  const first = node;
  const tokens: Uint8Array = node.Tokens ?? new Uint8Array(0);
  if (0 < tokens.length && 0 > bytes.IndexByte(tokens, lex.ItemColon)) {
    return;
  }
  node.Tokens = new Uint8Array(0); // Clear first, then add Tokens or Emoji sibling nodes one by one
  const length = tokens.length;
  let token = 0;
  let maybeEmoji: Uint8Array = new Uint8Array(0);
  let pos = 0;
  for (let i = 0; i < length;) {
    token = tokens[i];
    if (i === length - 1) {
      node.Tokens = slices.Append(node.Tokens!, tokens.subarray(pos));
      break;
    }

    if (lex.ItemColon !== token) {
      i++;
      continue;
    }

    node.Tokens = slices.Append(node.Tokens!, tokens.subarray(pos, i));

    let matchCloseColon = false;
    for (pos = i + 1; pos < length; pos++) {
      token = tokens[pos];
      if (lex.IsWhitespace(token)) {
        break;
      }
      if (lex.ItemColon === token) {
        matchCloseColon = true;
        break;
      }
    }
    if (!matchCloseColon) {
      node.Tokens = slices.Append(node.Tokens!, tokens.subarray(i, pos));
      i++;
      continue;
    }

    maybeEmoji = tokens.subarray(i + 1, pos);
    if (1 > maybeEmoji.length) {
      node.Tokens = slices.AppendByte(node.Tokens!, tokens[pos]);
      i++;
      continue;
    }

    // PORT-NOTE: EmojiLock is dropped (no mutexes, see PORTING.md)
    const emoji = t.Context!.ParseOption.AliasEmoji.get(util.BytesToStr(maybeEmoji));
    if (undefined !== emoji) {
      const emojiNode = new ast.Node(ast.NodeEmoji);
      const emojiUnicodeOrImg = new ast.Node(ast.NodeEmojiUnicode);
      emojiNode.AppendChild(emojiUnicodeOrImg);
      const emojiTokens = util.StrToBytes(emoji);
      if (bytes.Contains(emojiTokens, EmojiSitePlaceholder)) { // Some Emoji are image links and need separate handling
        const alias = util.BytesToStr(maybeEmoji);
        let suffix = ".png";
        if ("huaji" === alias) {
          suffix = ".gif";
        } else if ("siyuan" === alias) {
          suffix = ".svg";
        }
        const src = t.Context!.ParseOption.EmojiSite + "/" + alias + suffix;
        emojiUnicodeOrImg.Type = ast.NodeEmojiImg;
        emojiUnicodeOrImg.Tokens = t.EmojiImgTokens(alias, src);
      } else if (bytes.Contains(emojiTokens, emojiDot)) { // A custom Emoji path is detected by "."; a path containing "." is treated as an image path
        const alias = util.BytesToStr(maybeEmoji);
        emojiUnicodeOrImg.Type = ast.NodeEmojiImg;
        emojiUnicodeOrImg.Tokens = t.EmojiImgTokens(alias, emoji);
      } else {
        emojiUnicodeOrImg.Tokens = emojiTokens;
      }

      emojiUnicodeOrImg.AppendChild(new ast.Node(ast.NodeEmojiAlias, tokens.subarray(i, pos + 1)));
      node.InsertAfter(emojiNode);

      if (pos + 1 < length) {
        // Insert an empty text node after the Emoji node, left for the next iteration
        const text = new ast.Node(ast.NodeText, new Uint8Array(0));
        emojiNode.InsertAfter(text);
        node = text;
      }
    } else {
      node.Tokens = slices.Append(node.Tokens!, tokens.subarray(i, pos + 1));
    }

    pos++;
    i = pos;
  }

  // Discard empty text nodes
  if (1 > first.Tokens!.length) {
    first.Unlink();
  }
  if (1 > node.Tokens!.length) {
    node.Unlink();
  }
};

Tree.prototype.EmojiImgTokens = function (this: Tree, alias: string, src: string): Uint8Array {
  return util.StrToBytes("<img alt=\"" + alias + "\" class=\"emoji\" src=\"" + src + "\" title=\"" + alias + "\" />");
};

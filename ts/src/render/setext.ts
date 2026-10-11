// Ported from render/setext.go @ 8e7896b6
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
import * as editor from "../editor/index.ts";
import * as lex from "../lex/index.ts";
import { nodeTokens } from "./renderer.ts";

// setextHeadingMarkerOffsetInListParagraph returns the position of the first character of the Setext marker in a continuation line of a list paragraph.
export function setextHeadingMarkerOffsetInListParagraph(node: ast.Node): number {
  if (ast.NodeText !== node.Type || null === node.Parent || ast.NodeParagraph !== node.Parent.Type ||
    null === node.Parent.Parent || ast.NodeListItem !== node.Parent.Parent.Type) {
    return -1;
  }

  let lineStart: ast.Node = node;
  let foundBreak = false;
  for (let previous = node.Previous; null !== previous; previous = previous.Previous) {
    if (ast.NodeSoftBreak === previous.Type || ast.NodeHardBreak === previous.Type) {
      foundBreak = true;
      break;
    }
    lineStart = previous;
  }
  if (!foundBreak) {
    return -1;
  }

  let leadingWhitespace = 0;
  let marker = 0;
  let markerCount = 0;
  let trailingWhitespace = false;
  let markerNode: ast.Node | null = null;
  let markerOffset = -1;
  for (let current: ast.Node | null = lineStart; null !== current; current = current.Next) {
    if (ast.NodeSoftBreak === current.Type || ast.NodeHardBreak === current.Type) {
      break;
    }
    if (ast.NodeVditorCaret === current.Type) {
      continue;
    }
    if (ast.NodeText !== current.Type) {
      return -1;
    }

    const currentTokens = nodeTokens(current);
    for (let i = 0; i < currentTokens.length; ) {
      if (bytes.HasPrefix(currentTokens.subarray(i), editor.CaretTokens)) {
        i += editor.CaretTokens.length;
        continue;
      }

      const token = currentTokens[i];
      if (0 === marker) {
        if (lex.ItemSpace === token || lex.ItemTab === token) {
          leadingWhitespace++;
          if (3 < leadingWhitespace) {
            return -1;
          }
          i++;
          continue;
        }
        if (lex.ItemHyphen !== token && lex.ItemEqual !== token) {
          return -1;
        }
        marker = token;
        markerCount = 1;
        markerNode = current;
        markerOffset = i;
        i++;
        continue;
      }

      if (marker === token && !trailingWhitespace) {
        markerCount++;
        i++;
        continue;
      }
      if (lex.ItemSpace === token || lex.ItemTab === token) {
        trailingWhitespace = true;
        i++;
        continue;
      }
      return -1;
    }
  }

  if (0 === markerCount || markerNode !== node) {
    return -1;
  }
  return markerOffset;
}

export function escapeSetextHeadingMarkersInListParagraph(node: ast.Node, tokens: Uint8Array): Uint8Array {
  if (ast.NodeText !== node.Type || null === node.Parent || ast.NodeParagraph !== node.Parent.Type ||
    null === node.Parent.Parent || ast.NodeListItem !== node.Parent.Parent.Type) {
    return tokens;
  }

  const offsets: number[] = [];
  {
    const offset = setextHeadingMarkerOffsetInListParagraph(node);
    if (0 <= offset) {
      offsets.push(offset);
    }
  }
  for (let lineStart = bytes.IndexByte(tokens, lex.ItemNewline) + 1; 0 < lineStart && lineStart <= tokens.length; ) {
    let lineEnd = bytes.IndexByte(tokens.subarray(lineStart), lex.ItemNewline);
    if (0 > lineEnd) {
      lineEnd = tokens.length;
    } else {
      lineEnd += lineStart;
    }
    const offset = setextHeadingMarkerOffset(tokens.subarray(lineStart, lineEnd));
    if (0 <= offset) {
      offsets.push(lineStart + offset);
    }
    if (tokens.length <= lineEnd) {
      break;
    }
    lineStart = lineEnd + 1;
  }
  if (0 === offsets.length) {
    return tokens;
  }

  let escaped: Uint8Array = slices.Clone(tokens);
  for (let i = offsets.length - 1; 0 <= i; i--) {
    const offset = offsets[i];
    escaped = slices.AppendByte(escaped, 0);
    slices.Copy(escaped.subarray(offset + 1), escaped.subarray(offset));
    escaped[offset] = lex.ItemBackslash;
  }
  return escaped;
}

export function setextHeadingMarkerOffset(tokens: Uint8Array): number {
  let leadingWhitespace = 0;
  let marker = 0;
  let markerOffset = -1;
  let trailingWhitespace = false;
  let markerCount = 0;
  for (let i = 0; i < tokens.length; ) {
    if (bytes.HasPrefix(tokens.subarray(i), editor.CaretTokens)) {
      i += editor.CaretTokens.length;
      continue;
    }

    const token = tokens[i];
    if (0 === marker) {
      if (lex.ItemSpace === token || lex.ItemTab === token) {
        leadingWhitespace++;
        if (3 < leadingWhitespace) {
          return -1;
        }
        i++;
        continue;
      }
      if (lex.ItemHyphen !== token && lex.ItemEqual !== token) {
        return -1;
      }
      marker = token;
      markerOffset = i;
      markerCount = 1;
      i++;
      continue;
    }

    if (marker === token && !trailingWhitespace) {
      markerCount++;
      i++;
      continue;
    }
    if (lex.ItemSpace === token || lex.ItemTab === token) {
      trailingWhitespace = true;
      i++;
      continue;
    }
    return -1;
  }
  if (0 === markerCount) {
    return -1;
  }
  return markerOffset;
}

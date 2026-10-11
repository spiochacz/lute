// Ported from parse/table_rich_style.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as conv from "../runtime/conv.ts";
import * as strconv from "../runtime/strconv.ts";
import * as strings from "../runtime/strings.ts";
import * as ast from "../ast/index.ts";
import * as lutehtml from "../html/index.ts";
import * as stdhtml from "../runtime/stdhtml.ts";
import { IAL2Tokens } from "./inline_attribute_list.ts";
import type { Tree } from "./types.ts";

// PORT-NOTE: byte offset. Go searches the first min(len(value), 32) BYTES of value for ';' and returns the byte index.
// The index only measures a prefix of value that is cut at the ';' itself, so a UTF-16 index is returned here, found among the characters that start within the first 32 bytes.
function semicolonWithin32Bytes(value: string): number {
  let bytesSeen = 0;
  for (let k = 0; k < value.length && 32 > bytesSeen; k++) {
    const c = value.charCodeAt(k);
    if (0x3b /* ; */ === c) {
      return k;
    }
    if (0x80 > c) {
      bytesSeen += 1;
    } else if (0x800 > c) {
      bytesSeen += 2;
    } else if (0xd800 <= c && 0xdc00 > c) {
      bytesSeen += 4;
      k++;
    } else {
      bytesSeen += 3;
    }
  }
  return -1;
}

// protectTableCellRichStyles protects the style entities before parsing, and after parsing tells style values from literal content in code.
export function protectTableCellRichStyles(source: string): [string, (tree: Tree) => void] {
  const sentinel = tableCellRichStyleSentinel(source);
  const styles: string[] = [];
  const literals: string[] = [];
  const codeLiterals: string[] = [];
  const mathLiterals: string[] = [];
  const out = new strings.Builder();
  let cursor = 0;
  while (cursor < source.length) {
    let start = strings.Index(source.slice(cursor), "</span>{:");
    if (start < 0) {
      out.WriteString(source.slice(cursor));
      break;
    }
    start += cursor + "</span>{:".length;
    let position = start;
    while (position < source.length && strings.ContainsRune(" \t\r\n", source.charCodeAt(position))) {
      position++;
    }
    if (!strings.HasPrefix(source.slice(position), "style=") || position + 7 > source.length ||
      (source.charCodeAt(position + 6) !== 0x27 /* ' */ && source.charCodeAt(position + 6) !== 0x22 /* " */)) {
      out.WriteString(source.slice(cursor, start));
      cursor = start;
      continue;
    }
    const quote = source.charCodeAt(position + 6);
    start = position + 7;
    let end = strings.IndexByte(source.slice(start), quote);
    if (end < 0) {
      out.WriteString(source.slice(cursor));
      break;
    }
    end += start;
    out.WriteString(source.slice(cursor, start));
    let value = source.slice(start, end);
    while (value.length > 0) {
      const index = strings.IndexAny(value, "&`");
      if (index < 0) {
        out.WriteString(value);
        break;
      }
      out.WriteString(value.slice(0, index));
      value = value.slice(index);
      let length = 1;
      if (value.charCodeAt(0) === 0x26 /* & */) {
        const semicolon = semicolonWithin32Bytes(value); // PORT-NOTE: byte offset
        if (semicolon >= 0) {
          length = semicolon + 1;
        }
      }
      const literal = value.slice(0, length);
      const token = sentinel + strconv.Itoa(styles.length) + "";
      styles.push(token, stdhtml.UnescapeString(literal));
      literals.push(token, literal);
      const code = strings.ReplaceAll(literal, "&", "&amp;");
      codeLiterals.push(token, code);
      mathLiterals.push(token, strings.ReplaceAll(code, "&", "&amp;"));
      out.WriteString(token);
      value = value.slice(length);
    }
    cursor = end;
  }
  return [out.String(), (tree: Tree): void => {
    if (styles.length === 0) {
      return;
    }
    const styleReplacer = strings.NewReplacer(...styles);
    const literalReplacer = strings.NewReplacer(...literals);
    const codeReplacer = strings.NewReplacer(...codeLiterals);
    const mathReplacer = strings.NewReplacer(...mathLiterals);
    ast.Walk(tree.Root!, (node: ast.Node, entering: boolean): ast.WalkStatus => {
      if (!entering) {
        return ast.WalkContinue;
      }
      for (const attr of node.KramdownIAL ?? []) {
        if (attr[0] === "style" && node.IsTextMarkType("text")) {
          attr[1] = lutehtml.EscapeAttrVal(styleReplacer.Replace(lutehtml.UnescapeAttrVal(attr[1])));
        } else {
          attr[1] = literalReplacer.Replace(attr[1]);
        }
      }
      node.Tokens = conv.BytesFromString(literalReplacer.Replace(conv.StringFromBytes(node.Tokens ?? new Uint8Array(0))));
      node.TextMarkTextContent = codeReplacer.Replace(node.TextMarkTextContent);
      node.TextMarkInlineMathContent = mathReplacer.Replace(node.TextMarkInlineMathContent);
      if (ast.NodeKramdownSpanIAL === node.Type && null !== node.Previous && node.Previous.IsTextMarkType("text")) {
        node.Tokens = IAL2Tokens(node.Previous.KramdownIAL);
      }
      return ast.WalkContinue;
    });
  }];
}

export function tableCellRichStyleSentinel(source: string): string {
  const prefix = "table-cell-style-";
  const used = new Map<string, boolean>();
  for (let cursor = 0; cursor < source.length;) {
    let start = strings.Index(source.slice(cursor), prefix);
    if (start < 0) {
      break;
    }
    start += cursor + prefix.length; // PORT-NOTE: byte offset. Go's len(prefix) counts 20 bytes; the indices here are UTF-16, where the prefix is 18 units
    let end = start;
    while (end < source.length && source.charCodeAt(end) >= 0x30 /* 0 */ && source.charCodeAt(end) <= 0x39 /* 9 */) {
      end++;
    }
    if (strings.HasPrefix(source.slice(end), "")) {
      used.set(source.slice(start, end), true);
    }
    cursor = end;
  }
  for (let index = 0; ; index++) {
    const candidate = strconv.Itoa(index);
    if (!used.get(candidate)) {
      return prefix + candidate + "";
    }
  }
}

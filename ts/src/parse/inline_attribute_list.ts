// Ported from parse/inline_attribute_list.go @ 8e7896b6
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
import * as editor from "../editor/index.ts";
import * as html from "../html/index.ts";
import * as util from "../util/index.ts";
import { closeCurlyBrace } from "./heading_id.ts";
import { TagAttr } from "./inline_html.ts";
import { Context, Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseKramdownBlockIAL(): string[][] | null;
    parseKramdownSpanIAL(): void;
  }
  interface Context {
    parseKramdownBlockIAL(tokens: Uint8Array): string[][] | null;
    parseKramdownSpanIAL(tokens: Uint8Array): [number, string[][]];
    parseKramdownIALInListItem(tokens: Uint8Array | null): string[][] | null;
  }
}

const curlyBracesOpenColon: Uint8Array = util.StrToBytes("{:");
const closeCurlyBraceNewline: Uint8Array = util.StrToBytes("}\n");
const idEqQuote: Uint8Array = util.StrToBytes("id=\"");
const newlineBytes: Uint8Array = util.StrToBytes("\n");
const iALValEscNewLineBytes: Uint8Array = util.StrToBytes(editor.IALValEscNewLine);

// IALStart determines whether a kramdown block-level inline attribute list ({: attrs}) starts.
export function IALStart(t: Tree, container: ast.Node): number {
  if (!t.Context!.ParseOption.KramdownBlockIAL || t.Context!.indented) {
    return 0;
  }

  if (ast.NodeListItem === t.Context!.Tip!.Type && null === t.Context!.Tip!.FirstChild) { // Handled while the list is finalized
    return 0;
  }

  const ial = t.parseKramdownBlockIAL();
  if (null !== ial) {
    t.Context!.closeUnmatchedBlocks();
    t.Context!.offset = t.Context!.currentLineLen; // The whole line is consumed
    if (util.IsDocIAL2(ial)) { // Document block IAL
      t.Context!.rootIAL = new ast.Node(ast.NodeKramdownBlockIAL, t.Context!.currentLine.subarray(t.Context!.nextNonspace));
      t.Root!.KramdownIAL = ial;
      t.Root!.ID = ial[0][1];
      t.ID = t.Root!.ID;
      return 2;
    }

    let lastMatchedContainer = t.Context!.lastMatchedContainer!;
    if (t.Context!.allClosed) {
      if (ast.NodeDocument === lastMatchedContainer.Type || ast.NodeListItem === lastMatchedContainer.Type || ast.NodeBlockquote === lastMatchedContainer.Type || ast.NodeCallout === lastMatchedContainer.Type || ast.NodeSuperBlock === lastMatchedContainer.Type ||
        ast.NodeTabs === lastMatchedContainer.Type || ast.NodeTabItem === lastMatchedContainer.Type) {
        const last = t.Context!.Tip!.LastChild; // Attach to the last child block
        if (null === last) {
          lastMatchedContainer = t.Context!.lastMatchedContainer!;
        } else {
          lastMatchedContainer = last;
        }
        if ((ast.NodeSuperBlockLayoutMarker === lastMatchedContainer.Type || // A super block merged from three empty blocks becomes two blocks after the template is exported and used https://github.com/siyuan-note/siyuan/issues/4692
          ast.NodeKramdownBlockIAL === lastMatchedContainer.Type) &&
          null !== lastMatchedContainer.Parent) { // Two consecutive IALs
          const tokens = IAL2Tokens(ial);
          if (!bytes.HasPrefix(lastMatchedContainer.Tokens ?? new Uint8Array(0), tokens)) { // Some block parsers have already done the break handling
            // Insert an empty paragraph between two consecutive IALs so the empty paragraph is kept
            const p = new ast.Node(ast.NodeParagraph, conv.BytesFromString(" "));
            lastMatchedContainer.InsertAfter(p);
            t.Context!.Tip = p;
            lastMatchedContainer = p;
          }
        } else if (ast.NodeBlockquoteMarker === lastMatchedContainer.Type) { // A block quote without a paragraph child needs an empty paragraph attached
          const p = new ast.Node(ast.NodeParagraph, conv.BytesFromString(" "));
          lastMatchedContainer.InsertAfter(p);
          t.Context!.Tip = p;
          lastMatchedContainer = p;
        } else if (ast.NodeDocument === lastMatchedContainer.Type ||
          (ast.NodeTabItem === lastMatchedContainer.Type && !lastMatchedContainer.Close)) {
          // When the first node of the document or of a tab body is an IAL, keep an empty paragraph that carries the attributes.
          const p = new ast.Node(ast.NodeParagraph, conv.BytesFromString(" "));
          lastMatchedContainer.AppendChild(p);
          t.Context!.Tip = p;
          lastMatchedContainer = p;
        }
      }
    }
    lastMatchedContainer.KramdownIAL = ial;
    const ialMap = IAL2MapUnEsc(ial);
    lastMatchedContainer.ID = ialMap.get("id") ?? "";
    const node = t.Context!.addChild(ast.NodeKramdownBlockIAL);
    node.Tokens = t.Context!.currentLine.subarray(t.Context!.nextNonspace);
    return 2;
  }
  return 0;
}

const openCurlyBraceColon: Uint8Array = util.StrToBytes("{: ");
const emptyIAL: Uint8Array = util.StrToBytes("{:}");

// PORT-NOTE: ial is nullable because Go callers pass nil IALs.
export function IAL2Tokens(ial: string[][] | null): Uint8Array {
  const buf = new bytes.Buffer();
  buf.WriteString("{: ");
  if (null !== ial) {
    for (let i = 0; i < ial.length; i++) {
      const kv = ial[i];
      buf.WriteString(kv[0]);
      buf.WriteString("=\"");
      buf.WriteString(kv[1]);
      buf.WriteByte(0x22 /* " */);
      if (i < ial.length - 1) {
        buf.WriteByte(0x20 /* space */);
      }
    }
  }
  buf.WriteByte(0x7d /* } */);
  return buf.Bytes();
}

export function IALVal(ial: ast.Node, name: string): string {
  const array = Tokens2IAL(ial.Tokens);
  const m = IAL2Map(array);
  return m.get(name) ?? "";
}

export function IALValMap(ial: ast.Node): Map<string, string> {
  let ret: Map<string, string> = new Map<string, string>();
  const array = Tokens2IAL(ial.Tokens);
  ret = IAL2Map(array);
  return ret;
}

// PORT-NOTE: ial is nullable because Go callers pass the nil result of Tokens2IAL.
export function IAL2Map(ial: string[][] | null): Map<string, string> {
  const ret = new Map<string, string>();
  if (null === ial) {
    return ret;
  }
  for (const kv of ial) {
    ret.set(kv[0], html.UnescapeAttrVal(kv[1]));
  }
  return ret;
}

// PORT-NOTE: ial is nullable because Go callers may pass a nil IAL.
export function IAL2MapUnEsc(ial: string[][] | null): Map<string, string> {
  const ret = new Map<string, string>();
  if (null === ial) {
    return ret;
  }
  for (const kv of ial) {
    ret.set(kv[0], kv[1]);
  }
  return ret;
}

// mergeIALPreservingOrder merges IALs while preserving the attribute order. It is semantically the same as IAL2Map+Map2IAL,
// but the output attribute order does not drift because of unordered maps. Duplicate keys are collapsed and the last value wins.
export function mergeIALPreservingOrder(dst: string[][] | null, src: string[][]): string[][] {
  const ret: string[][] = [];
  const indexByName = new Map<string, number>();
  for (const kv of dst ?? []) {
    const name = kv[0];
    const value = html.UnescapeAttrVal(kv[1]);
    const idx = indexByName.get(name);
    if (undefined !== idx) {
      ret[idx][1] = value;
      continue;
    }

    indexByName.set(name, ret.length);
    ret.push([name, value]);
  }

  for (const kv of src) {
    const name = kv[0];
    const value = html.UnescapeAttrVal(kv[1]);
    const idx = indexByName.get(name);
    if (undefined !== idx) {
      ret[idx][1] = value;
      continue;
    }

    indexByName.set(name, ret.length);
    ret.push([name, value]);
  }
  return ret;
}

export function Map2IAL(properties: Map<string, string>): string[][] {
  const ret: string[][] = [];
  for (const [k, v] of properties) {
    ret.push([k, v]);
  }
  return ret;
}

export function simpleCheckIsBlockIAL(tokens: Uint8Array): boolean {
  if ("{: id=\"".length >= tokens.length) {
    return false;
  }
  return bytes.Contains(tokens, idEqQuote);
}

export function Tokens2IAL(tokens: Uint8Array | null): string[][] | null {
  let ret: string[][] | null = null;
  // The tokens must start with a space
  let toks: Uint8Array = tokens ?? new Uint8Array(0);
  toks = bytes.TrimRight(toks, " \n");
  toks = bytes.TrimPrefix(toks, curlyBracesOpenColon);
  toks = bytes.TrimSuffix(toks, closeCurlyBrace);
  toks = bytes.ReplaceAll(toks, newlineBytes, iALValEscNewLineBytes);
  for (;;) {
    const [valid, remains, attr, name, v] = TagAttr(toks);
    if (!valid) {
      break;
    }

    toks = remains;
    if (1 > attr.length) {
      break;
    }

    const val = bytes.ReplaceAll(v, iALValEscNewLineBytes, newlineBytes);
    if (null === ret) {
      ret = [];
    }
    ret.push([util.BytesToStr(name), util.BytesToStr(val)]);
  }
  return ret;
}

Tree.prototype.parseKramdownBlockIAL = function (this: Tree): string[][] | null {
  const t = this;
  const tokens = t.Context!.currentLine.subarray(t.Context!.nextNonspace);
  return t.Context!.parseKramdownBlockIAL(tokens);
};

Tree.prototype.parseKramdownSpanIAL = function (this: Tree): void {
  const t = this;
  ast.Walk(t.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }

    if (null !== n.Previous && ast.NodeKramdownSpanIAL === n.Previous.Type && ast.NodeText === n.Type && null !== n.Previous.Previous) {
      const [tokens, end] = spanIALText(n);
      const [pos, ial] = t.Context!.parseKramdownSpanIAL(tokens);
      if (0 < ial.length) {
        let same = true;
        for (const kv of ial) {
          if (n.Previous.Previous.IALAttr(kv[0]) !== html.UnescapeAttrVal(kv[1])) {
            same = false;
            break;
          }
        }
        if (same) {
          mergeSpanIALText(n, end);
          n.Tokens = tokens.subarray(pos + 1);
        }
      }
      return ast.WalkContinue;
    }

    switch (n.Type) {
      case ast.NodeEmphasis:
      case ast.NodeStrong:
      case ast.NodeCodeSpan:
      case ast.NodeStrikethrough:
      case ast.NodeTag:
      case ast.NodeMark:
      case ast.NodeInlineMath:
      case ast.NodeImage:
      case ast.NodeTextMark:
        break;
      default:
        return ast.WalkContinue;
    }

    if (null === n.Next || ast.NodeText !== n.Next.Type) {
      return ast.WalkContinue;
    }

    const [tokens, end] = spanIALText(n.Next);
    const [pos, ial] = t.Context!.parseKramdownSpanIAL(tokens);
    if (0 < ial.length) {
      n.KramdownIAL = ial;
      mergeSpanIALText(n.Next, end);
      const rest = tokens.subarray(pos + 1);
      n.Next.Tokens = rest;
      if (1 > rest.length) {
        n.Next.Unlink(); // Remove the empty text node {: ial}
      }
      const spanIAL = new ast.Node(ast.NodeKramdownSpanIAL, tokens.subarray(0, pos + 1));
      n.InsertAfter(spanIAL);
    }
    return ast.WalkContinue;
  });
};

// spanIALText collects the attribute source split by HTML entities, keeping the entity encoding so a quote does not end the attribute value early.
export function spanIALText(start: ast.Node): [Uint8Array, ast.Node] {
  const tokens: Uint8Array = start.Tokens ?? new Uint8Array(0);
  const end: ast.Node = start;
  if (!bytes.HasPrefix(tokens, curlyBracesOpenColon) || bytes.Contains(tokens, closeCurlyBrace)) {
    return [tokens, end];
  }
  const buffer = new bytes.Buffer();
  buffer.Write(tokens);
  for (let next = start.Next; next !== null; next = next.Next) {
    switch (next.Type) {
      case ast.NodeText:
        buffer.Write(next.Tokens ?? new Uint8Array(0));
        break;
      case ast.NodeHTMLEntity:
        buffer.Write(next.HtmlEntityTokens);
        break;
      default:
        return [start.Tokens ?? new Uint8Array(0), start];
    }
    if (next.Type === ast.NodeText && bytes.Contains(next.Tokens ?? new Uint8Array(0), closeCurlyBrace)) {
      return [buffer.Bytes(), next];
    }
  }
  return [start.Tokens ?? new Uint8Array(0), start];
}

// mergeSpanIALText removes the consumed sibling nodes only after the attributes are parsed successfully; unclosed attributes are left as they are.
export function mergeSpanIALText(start: ast.Node, end: ast.Node): void {
  while (start !== end && start.Next !== null) {
    const next = start.Next;
    next.Unlink();
    if (next === end) {
      return;
    }
  }
}

Context.prototype.parseKramdownBlockIAL = function (this: Context, tokens: Uint8Array): string[][] | null {
  const context = this;
  let ret: string[][] | null = null;
  const curlyBracesStart = bytes.Index(tokens, curlyBracesOpenColon);
  if (0 === curlyBracesStart) {
    tokens = tokens.subarray(curlyBracesStart + 2);
    const curlyBracesEnd = bytes.LastIndex(tokens, closeCurlyBrace);
    if (3 > curlyBracesEnd) {
      return ret;
    }

    if (!bytes.Equal(tokens.subarray(curlyBracesEnd), closeCurlyBraceNewline)) { // Nothing else may follow the IAL; it must take a whole line
      return ret;
    }
    ret = Tokens2IAL(tokens);
  }
  return ret;
};

Context.prototype.parseKramdownSpanIAL = function (this: Context, tokens: Uint8Array): [number, string[][]] {
  const context = this;
  const ret: string[][] = [];
  const pos = bytes.Index(tokens, closeCurlyBrace);
  const curlyBracesStart = bytes.Index(tokens, curlyBracesOpenColon);
  if (0 === curlyBracesStart && curlyBracesStart + 2 < pos) {
    tokens = tokens.subarray(curlyBracesStart + 2);
    const curlyBracesEnd = bytes.Index(tokens, closeCurlyBrace);
    if (3 > curlyBracesEnd) {
      return [pos, ret];
    }

    tokens = tokens.subarray(0, curlyBracesEnd);
    for (;;) {
      const [valid, remains, attr, name, val] = TagAttr(tokens);
      if (!valid) {
        break;
      }

      tokens = remains;
      if (1 > attr.length) {
        break;
      }

      const nameStr = strings.ReplaceAll(util.BytesToStr(name), editor.Caret, "");
      const valStr = strings.ReplaceAll(util.BytesToStr(val), editor.Caret, "");
      ret.push([nameStr, valStr]);
    }
  }
  return [pos, ret];
};

Context.prototype.parseKramdownIALInListItem = function (this: Context, tokens: Uint8Array | null): string[][] | null {
  const context = this;
  let ret: string[][] | null = null;
  let toks: Uint8Array = tokens ?? new Uint8Array(0);
  const curlyBracesStart = bytes.Index(toks, curlyBracesOpenColon);
  if (0 === curlyBracesStart) {
    toks = toks.subarray(curlyBracesStart + 2);
    const curlyBracesEnd = bytes.Index(toks, closeCurlyBrace);
    if (3 > curlyBracesEnd) {
      return ret;
    }

    toks = toks.subarray(0, bytes.Index(toks, closeCurlyBrace));
    for (;;) {
      const [valid, remains, attr, name, val] = TagAttr(toks);
      if (!valid) {
        break;
      }

      toks = remains;
      if (1 > attr.length) {
        break;
      }

      if (null === ret) {
        ret = [];
      }
      ret.push([util.BytesToStr(name), util.BytesToStr(val)]);
    }
  }
  return ret;
};

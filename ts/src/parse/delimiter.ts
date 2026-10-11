// Ported from parse/delimiter.go @ 8e7896b6
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
import * as unicode from "../runtime/unicode.ts";
import * as utf8 from "../runtime/utf8.ts";
import * as ast from "../ast/index.ts";
import * as editor from "../editor/index.ts";
import * as lex from "../lex/index.ts";
import type { InlineContext } from "./parse.ts";
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    handleDelim(block: ast.Node, ctx: InlineContext): void;
    handleFullWidthStrikethroughDelim(block: ast.Node, ctx: InlineContext): void;
    handleDelimByMarker(block: ast.Node, ctx: InlineContext, marker: Uint8Array, typ: number, fullWidthStrikethrough: boolean): void;
    processEmphasis(stackBottom: delimiter | null, ctx: InlineContext): void;
    scanDelims(ctx: InlineContext, marker: Uint8Array, typ: number, fullWidthStrikethrough: boolean): [number, boolean, boolean];
    removeDelimiter(delim: delimiter, ctx: InlineContext): delimiter | null;
  }
}

// delimiter describes the delimiters ([, ![, *, _, ~) used while parsing emphasis, links and images.
export class delimiter {
  node: ast.Node | null; // Text node of the delimiter
  typ: number; // Delimiter byte [*_~
  num: number; // Number of delimiters
  originalNum: number; // Original number of delimiters
  unitLen: number; // UTF-8 byte length of a single delimiter
  canOpen: boolean; // Whether it can be an opening delimiter
  canClose: boolean; // Whether it can be a closing delimiter
  previous: delimiter | null; // Previous node of the doubly linked list
  next: delimiter | null; // Next node of the doubly linked list

  active: boolean;
  image: boolean;
  bracketAfter: boolean;
  index: number;
  previousDelimiter: delimiter | null;

  constructor() {
    this.node = null;
    this.typ = 0;
    this.num = 0;
    this.originalNum = 0;
    this.unitLen = 0;
    this.canOpen = false;
    this.canClose = false;
    this.previous = null;
    this.next = null;
    this.active = false;
    this.image = false;
    this.bracketAfter = false;
    this.index = 0;
    this.previousDelimiter = null;
  }
}

// A Chinese walkthrough of the nested emphasis and link parsing algorithm: https://ld246.com/article/1566893557720

// handleDelim pushes the delimiter *_~ onto the stack.
Tree.prototype.handleDelim = function (this: Tree, block: ast.Node, ctx: InlineContext): void {
  const t = this;
  // PERF-TODO: allocates a one-element array per delimiter run; a later task may share them.
  t.handleDelimByMarker(block, ctx, new Uint8Array([ctx.tokens[ctx.pos]]), ctx.tokens[ctx.pos], false);
};

export const fullWidthTilde: Uint8Array = conv.BytesFromString("～");

Tree.prototype.handleFullWidthStrikethroughDelim = function (this: Tree, block: ast.Node, ctx: InlineContext): void {
  const t = this;
  t.handleDelimByMarker(block, ctx, fullWidthTilde, lex.ItemTilde, true);
};

Tree.prototype.handleDelimByMarker = function (this: Tree, block: ast.Node, ctx: InlineContext, marker: Uint8Array, typ: number,
  fullWidthStrikethrough: boolean): void {
  const t = this;
  const startPos = ctx.pos;
  const [num, canOpen, canClose] = t.scanDelims(ctx, marker, typ, fullWidthStrikethrough);

  const text = ctx.tokens.subarray(startPos, ctx.pos);
  const node = new ast.Node(ast.NodeText, text);
  block.AppendChild(node);

  // Push this delimiter onto the stack
  if (canOpen || canClose) {
    const delim = new delimiter();
    delim.typ = typ;
    delim.num = num;
    delim.originalNum = num;
    delim.unitLen = marker.length;
    delim.node = node;
    delim.previous = ctx.delimiters;
    delim.next = null;
    delim.canOpen = canOpen;
    delim.canClose = canClose;
    ctx.delimiters = delim;
    if (null !== ctx.delimiters.previous) {
      ctx.delimiters.previous.next = ctx.delimiters;
    }
  }
};

// processEmphasis handles emphasis, strong and strikethrough.
Tree.prototype.processEmphasis = function (this: Tree, stackBottom: delimiter | null, ctx: InlineContext): void {
  const t = this;
  if (null === ctx.delimiters) {
    return;
  }

  let opener: delimiter | null = null;
  let closer: delimiter | null = null;
  let oldCloser: delimiter | null = null;
  let openerInl: ast.Node | null = null;
  let closerInl: ast.Node | null = null;
  let tempStack: delimiter | null = null;
  let useDelims = 0;
  let openerFound = false;
  // PERF-TODO: only the six slots of _ * ~ = # ^ are used, yet 128 pointers are zeroed per call.
  const openersBottom: (delimiter | null)[] = new Array<delimiter | null>(128).fill(null); // Lower search bound for each delimiter byte
  let oddMatch = false;

  openersBottom[lex.ItemUnderscore] = stackBottom;
  openersBottom[lex.ItemAsterisk] = stackBottom;
  openersBottom[lex.ItemTilde] = stackBottom;
  openersBottom[lex.ItemEqual] = stackBottom;
  openersBottom[lex.ItemCrosshatch] = stackBottom;
  openersBottom[lex.ItemCaret] = stackBottom;

  // find first closer above stack_bottom:
  closer = ctx.delimiters;
  while (null !== closer && closer.previous !== stackBottom) {
    closer = closer.previous;
  }

  // move forward, looking for closers, and handling each
  while (null !== closer) {
    const closercc = closer.typ;
    if (!closer.canClose) {
      closer = closer.next;
      continue;
    }

    // found emphasis closer. now look back for first matching opener:
    opener = closer.previous;
    openerFound = false;
    while (null !== opener && opener !== stackBottom && opener !== openersBottom[closercc]) {
      oddMatch = (closer.canOpen || opener.canClose) && closer.originalNum % 3 !== 0 && (opener.originalNum + closer.originalNum) % 3 === 0;
      if (opener.typ === closer.typ && opener.canOpen && !oddMatch) {
        openerFound = true;
        break;
      }
      opener = opener.previous;
    }
    oldCloser = closer;

    if (!openerFound) {
      closer = closer.next;
    } else {
      opener = opener!; // PORT-NOTE: openerFound implies opener is non-null; this narrows the type
      if (lex.ItemCrosshatch === closercc && t.Context!.ParseOption.Tag) {
        const tagContent = new strings.Builder();
        for (let n = opener.node!.Next; null !== n && n !== closer.node; n = n.Next) {
          tagContent.WriteString(n.Text());
        }
        let content = strings.ReplaceAll(tagContent.String(), editor.Caret, "");
        content = strings.ReplaceAll(content, editor.Zwsp, "");
        if ("" === strings.TrimSpace(content)) {
          closer = closer.next;
          continue;
        }
      }

      // calculate actual number of delimiters used from closer
      if (closer.num >= 2 && opener.num >= 2) {
        useDelims = 2;
      } else {
        useDelims = 1;
      }

      openerInl = opener.node;
      closerInl = closer.node;

      if (t.Context!.ParseOption.GFMStrikethrough || t.Context!.ParseOption.Sub) {
        if (lex.ItemTilde === closercc && opener.num !== closer.num) {
          closer = closer.next;
          continue;
        }
      } else {
        if (lex.ItemTilde === closercc) {
          closer = closer.next;
          continue;
        }
      }

      if (t.Context!.ParseOption.Sup) {
        if (lex.ItemCaret === closercc && opener.num !== closer.num) {
          closer = closer.next;
          continue;
        }
      } else {
        if (lex.ItemCaret === closercc) {
          closer = closer.next;
          continue;
        }
      }

      if (!t.Context!.ParseOption.InlineAsterisk) {
        if (lex.ItemAsterisk === closercc) {
          closer = closer.next;
          continue;
        }
      }

      if (!t.Context!.ParseOption.InlineUnderscore) {
        if (lex.ItemUnderscore === closercc) {
          closer = closer.next;
          continue;
        }
      }

      if (t.Context!.ParseOption.Mark) {
        if (lex.ItemEqual === closercc && opener.num !== closer.num) {
          closer = closer.next;
          continue;
        }
      } else {
        if (lex.ItemEqual === closercc) {
          closer = closer.next;
          continue;
        }
      }

      if (t.Context!.ParseOption.Tag) {
        if (lex.ItemCrosshatch === closercc && opener.num !== closer.num) {
          closer = closer.next;
          continue;
        }
      } else {
        if (lex.ItemCrosshatch === closercc) {
          closer = closer.next;
          continue;
        }
      }

      // remove used delimiters from stack elts and inlines
      opener.num -= useDelims;
      closer.num -= useDelims;

      const openerTokenLen = useDelims * opener.unitLen;
      const closerTokenLen = useDelims * closer.unitLen;
      let openerTokens: Uint8Array = openerInl!.Tokens!.subarray(openerInl!.Tokens!.length - openerTokenLen);
      let text: Uint8Array = openerInl!.Tokens!.subarray(0, openerInl!.Tokens!.length - openerTokenLen);
      openerInl!.Tokens = text;
      let closerTokens: Uint8Array = closerInl!.Tokens!.subarray(closerInl!.Tokens!.length - closerTokenLen);
      text = closerInl!.Tokens!.subarray(0, closerInl!.Tokens!.length - closerTokenLen);
      closerInl!.Tokens = text;
      if (opener.unitLen > 1) {
        openerTokens = bytes.Repeat(new Uint8Array([lex.ItemTilde]), useDelims);
      }
      if (closer.unitLen > 1) {
        closerTokens = bytes.Repeat(new Uint8Array([lex.ItemTilde]), useDelims);
      }

      const openMarker = new ast.Node(ast.NodeDocument, openerTokens);
      openMarker.Close = true;
      const emStrongDelMark = new ast.Node(ast.NodeDocument);
      emStrongDelMark.Close = true;
      const closeMarker = new ast.Node(ast.NodeDocument, closerTokens);
      closeMarker.Close = true;
      if (1 === useDelims) {
        if (lex.ItemAsterisk === closercc) {
          emStrongDelMark.Type = ast.NodeEmphasis;
          openMarker.Type = ast.NodeEmA6kOpenMarker;
          closeMarker.Type = ast.NodeEmA6kCloseMarker;
        } else if (lex.ItemUnderscore === closercc) {
          emStrongDelMark.Type = ast.NodeEmphasis;
          openMarker.Type = ast.NodeEmU8eOpenMarker;
          closeMarker.Type = ast.NodeEmU8eCloseMarker;
        } else if (lex.ItemTilde === closercc) {
          if (t.Context!.ParseOption.Sub) { // Subscript takes precedence
            emStrongDelMark.Type = ast.NodeSub;
            openMarker.Type = ast.NodeSubOpenMarker;
            closeMarker.Type = ast.NodeSubCloseMarker;
          } else if (t.Context!.ParseOption.GFMStrikethrough && t.Context!.ParseOption.GFMStrikethrough1) {
            emStrongDelMark.Type = ast.NodeStrikethrough;
            openMarker.Type = ast.NodeStrikethrough1OpenMarker;
            closeMarker.Type = ast.NodeStrikethrough1CloseMarker;
          }
        } else if (lex.ItemEqual === closercc) {
          if (t.Context!.ParseOption.Mark) {
            emStrongDelMark.Type = ast.NodeMark;
            openMarker.Type = ast.NodeMark1OpenMarker;
            closeMarker.Type = ast.NodeMark1CloseMarker;
          }
        } else if (lex.ItemCrosshatch === closercc) {
          if (t.Context!.ParseOption.Tag) {
            emStrongDelMark.Type = ast.NodeTag;
            openMarker.Type = ast.NodeTagOpenMarker;
            closeMarker.Type = ast.NodeTagCloseMarker;
          }
        } else if (lex.ItemCaret === closercc) {
          if (t.Context!.ParseOption.Sup) {
            emStrongDelMark.Type = ast.NodeSup;
            openMarker.Type = ast.NodeSupOpenMarker;
            closeMarker.Type = ast.NodeSupCloseMarker;
          }
        }
      } else {
        if (lex.ItemAsterisk === closercc) {
          emStrongDelMark.Type = ast.NodeStrong;
          openMarker.Type = ast.NodeStrongA6kOpenMarker;
          closeMarker.Type = ast.NodeStrongA6kCloseMarker;
        } else if (lex.ItemUnderscore === closercc) {
          emStrongDelMark.Type = ast.NodeStrong;
          openMarker.Type = ast.NodeStrongU8eOpenMarker;
          closeMarker.Type = ast.NodeStrongU8eCloseMarker;
        } else if (lex.ItemTilde === closercc) {
          if (t.Context!.ParseOption.GFMStrikethrough) {
            emStrongDelMark.Type = ast.NodeStrikethrough;
            openMarker.Type = ast.NodeStrikethrough2OpenMarker;
            closeMarker.Type = ast.NodeStrikethrough2CloseMarker;
          }
        } else if (lex.ItemEqual === closercc) {
          if (t.Context!.ParseOption.Mark) {
            emStrongDelMark.Type = ast.NodeMark;
            openMarker.Type = ast.NodeMark2OpenMarker;
            closeMarker.Type = ast.NodeMark2CloseMarker;
          }
        }
      }

      let tmp: ast.Node | null = openerInl!.Next;
      while (null !== tmp && tmp !== closerInl) {
        const next: ast.Node | null = tmp.Next;
        tmp.Unlink();
        emStrongDelMark.AppendChild(tmp);
        tmp = next;
      }

      emStrongDelMark.PrependChild(openMarker); // Insert the opening marker
      emStrongDelMark.AppendChild(closeMarker); // Insert the closing marker
      openerInl!.InsertAfter(emStrongDelMark);

      // remove elts between opener and closer in delimiters stack
      if (opener.next !== closer) {
        opener.next = closer;
        closer.previous = opener;
      }

      // if opener has 0 delims, remove it and the inline
      if (opener.num === 0) {
        openerInl!.Unlink();
        t.removeDelimiter(opener, ctx);
      }

      if (closer.num === 0) {
        closerInl!.Unlink();
        tempStack = closer.next;
        t.removeDelimiter(closer, ctx);
        closer = tempStack;
      }
    }

    if (!openerFound && !oddMatch) {
      // Set lower bound for future searches for openers:
      openersBottom[closercc] = oldCloser.previous;
      if (!oldCloser.canOpen) {
        // We can remove a closer that can't be an opener,
        // once we've seen there's no matching opener:
        t.removeDelimiter(oldCloser, ctx);
      }
    }
  }

  // Remove all delimiters
  while (null !== ctx.delimiters && ctx.delimiters !== stackBottom) {
    t.removeDelimiter(ctx.delimiters, ctx);
  }
};

// scanDelims scans the delimiters and decides their left and right boundaries. It returns the number of delimiters and whether they can open and close.
Tree.prototype.scanDelims = function (this: Tree, ctx: InlineContext, marker: Uint8Array, typ: number,
  fullWidthStrikethrough: boolean): [number, boolean, boolean] {
  const t = this;
  let delimitersCount = 0;
  let canOpen = false;
  let canClose = false;
  const startPos = ctx.pos;
  while (ctx.pos < ctx.tokensLen && bytes.HasPrefixAt(ctx.tokens, ctx.pos, marker)) {
    // The #Tag# marker uses one crosshatch and does not greedily merge consecutive ones, otherwise adjacent tags (such as #foo##bar#) would be parsed wrongly https://github.com/siyuan-note/siyuan/issues/18191
    if (lex.ItemCrosshatch === typ && t.Context!.ParseOption.Tag && delimitersCount >= 1) {
      break;
    }
    delimitersCount++;
    ctx.pos += marker.length;
  }

  let tokenBefore: number = lex.ItemNewline;
  let tokenAfter: number = lex.ItemNewline;
  if (0 < startPos) {
    let c = ctx.tokens[startPos - 1];
    if (c >= utf8.RuneSelf) {
      tokenBefore = utf8.DecodeLastRunePacked(ctx.tokens, startPos) & 0xFFFFFF;
    } else {
      tokenBefore = c;
    }

    if ((t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV || t.Context!.ParseOption.ProtyleWYSIWYG) && editor.CaretRune === tokenBefore) {
      // Skip the caret position when looking backward
      const caretLen = editor.CaretTokens.length;
      if (0 < startPos - caretLen) {
        c = ctx.tokens[startPos - caretLen - 1];
        if (c >= utf8.RuneSelf) {
          tokenBefore = utf8.DecodeLastRunePacked(ctx.tokens, startPos - caretLen) & 0xFFFFFF;
        } else {
          tokenBefore = c;
        }
      }
    }
  }

  if (ctx.tokensLen > ctx.pos) {
    // PORT-NOTE: Go names this local t, shadowing the receiver
    const tok = ctx.tokens[ctx.pos];
    if (tok >= utf8.RuneSelf) {
      tokenAfter = utf8.DecodeRunePacked(ctx.tokens, ctx.pos) & 0xFFFFFF;
    } else {
      tokenAfter = tok;
    }
  }

  let afterIsWhitespace = lex.IsUnicodeWhitespace(tokenAfter);
  let afterIsPunct = unicode.IsPunct(tokenAfter) || unicode.IsSymbol(tokenAfter);
  if ((lex.ItemAsterisk === typ && 0x7e /* ~ */ === tokenAfter) || (lex.ItemTilde === typ && 0x2a /* * */ === tokenAfter) ||
    (lex.ItemCaret === typ && (0x2b /* + */ === tokenAfter || 0x2d /* - */ === tokenAfter)) ||
    (lex.ItemTilde === typ && (0x2b /* + */ === tokenAfter || 0x2d /* - */ === tokenAfter))) {
    afterIsPunct = false;
  }
  const beforeIsWhitespace = lex.IsUnicodeWhitespace(tokenBefore);
  let beforeIsPunct = unicode.IsPunct(tokenBefore) || unicode.IsSymbol(tokenBefore);
  if ((lex.ItemAsterisk === typ && 0x7e /* ~ */ === tokenBefore) || (lex.ItemTilde === typ && 0x2a /* * */ === tokenBefore) ||
    (lex.ItemCaret === typ && (0x2b /* + */ === tokenBefore || 0x2d /* - */ === tokenBefore)) ||
    (lex.ItemTilde === typ && (0x2b /* + */ === tokenBefore || 0x2d /* - */ === tokenBefore))) {
    beforeIsPunct = false;
  }

  if (t.Context!.ParseOption.ProtyleWYSIWYG) {
    // ** bold does not work in Markdown https://ld246.com/article/1597581380183
    if (lex.ItemCrosshatch !== typ) {
      afterIsPunct = false;
      beforeIsPunct = false;
    }

    // _foo_ optimization https://github.com/siyuan-note/siyuan/issues/17769
    if (lex.ItemUnderscore === typ && editor.CaretRune === tokenBefore) {
      afterIsWhitespace = true;
    }
    if (lex.ItemUnderscore === typ && editor.CaretRune === tokenAfter) {
      afterIsWhitespace = true;
    }
  }

  const isLeftFlanking = !afterIsWhitespace && (!afterIsPunct || beforeIsWhitespace || beforeIsPunct);
  const isRightFlanking = !beforeIsWhitespace && (!beforeIsPunct || afterIsWhitespace || afterIsPunct);
  if (lex.ItemUnderscore === typ) {
    canOpen = isLeftFlanking && (!isRightFlanking || beforeIsPunct);
    canClose = isRightFlanking && (!isLeftFlanking || afterIsPunct);
  } else {
    if (lex.ItemEqual === typ) {
      if (!t.Context!.ParseOption.Mark || 2 !== delimitersCount /* ==Mark== uses two equal signs */) {
        canOpen = false;
        canClose = false;
      } else {
        canOpen = isLeftFlanking;
        canClose = isRightFlanking;
      }
    } else if (lex.ItemCrosshatch === typ) {
      if (!t.Context!.ParseOption.Tag || 1 !== delimitersCount /* #Tag# uses one crosshatch */) {
        canOpen = false;
        canClose = false;
      } else {
        canOpen = isLeftFlanking;
        canClose = isRightFlanking;
      }
    } else if (lex.ItemCaret === typ) {
      if (!t.Context!.ParseOption.Sup || 1 !== delimitersCount /* ^Sup^ uses one ^ */) {
        canOpen = false;
        canClose = false;
      } else {
        canOpen = isLeftFlanking;
        canClose = isRightFlanking;
      }
    } else if (lex.ItemTilde === typ) {
      if (fullWidthStrikethrough && 2 !== delimitersCount) {
        canOpen = false;
        canClose = false;
        return [delimitersCount, canOpen, canClose];
      }
      if (t.Context!.ParseOption.Sub) {
        if (t.Context!.ParseOption.GFMStrikethrough && 3 === delimitersCount) { // Special case ~~~foo~~~, that is subscript nested in strikethrough
          canOpen = isLeftFlanking;
          canClose = isRightFlanking;
        } else if (1 !== delimitersCount) { // ~Sub~ uses one ~
          canOpen = false;
          canClose = false;
          if (t.Context!.ParseOption.GFMStrikethrough && 2 === delimitersCount) {
            canOpen = isLeftFlanking;
            canClose = isRightFlanking;
          }
        } else {
          canOpen = isLeftFlanking;
          canClose = isRightFlanking;
        }
      } else if (t.Context!.ParseOption.GFMStrikethrough) {
        if (1 === delimitersCount) {
          if (!t.Context!.ParseOption.GFMStrikethrough1) {
            canOpen = false;
            canClose = false;
          } else {
            canOpen = isLeftFlanking;
            canClose = isRightFlanking;
          }
        } else {
          canOpen = isLeftFlanking;
          canClose = isRightFlanking;
        }
      } else {
        canOpen = isLeftFlanking;
        canClose = isRightFlanking;
      }
    } else {
      canOpen = isLeftFlanking;
      canClose = isRightFlanking;
    }
  }
  return [delimitersCount, canOpen, canClose];
};

Tree.prototype.removeDelimiter = function (this: Tree, delim: delimiter, ctx: InlineContext): delimiter | null {
  const ret: delimiter | null = null;
  if (null !== delim.previous) {
    delim.previous.next = delim.next;
  }
  if (null === delim.next) {
    ctx.delimiters = delim.previous; // Top of the stack
  } else {
    delim.next.previous = delim.previous;
  }
  return ret;
};

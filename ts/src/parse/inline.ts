// Ported from parse/inline.go @ 8e7896b6
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
import * as strconv from "../runtime/strconv.ts";
import * as ast from "../ast/index.ts";
import * as editor from "../editor/index.ts";
import * as html from "../html/index.ts";
import * as lex from "../lex/index.ts";
import * as util from "../util/index.ts";
import { delimiter, fullWidthTilde } from "./delimiter.ts";
import type { InlineContext } from "./parse.ts";
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseInline(block: ast.Node, ctx: InlineContext): void;
    parseEntity(ctx: InlineContext): ast.Node;
    parseCloseBracket(ctx: InlineContext): ast.Node;
    parseOpenBracket(ctx: InlineContext): ast.Node;
    addBracket(node: ast.Node, index: number, image: boolean, ctx: InlineContext): void;
    removeBracket(ctx: InlineContext): void;
  }
}

const caretCloseParen: string = editor.Caret + ")";
const closeParenCaret: string = ")" + editor.Caret;
const caretCloseParenTokens: Uint8Array = conv.BytesFromString(caretCloseParen);
const closeParenCaretTokens: Uint8Array = conv.BytesFromString(closeParenCaret);

// parseInline parses and generates the inline-level child nodes of the block node block.
Tree.prototype.parseInline = function (this: Tree, block: ast.Node, ctx: InlineContext): void {
  const t = this;
  while (ctx.pos < ctx.tokensLen) {
    if (t.Context!.ParseOption.FullWidthStrikethrough &&
      bytes.HasPrefixAt(ctx.tokens, ctx.pos, fullWidthTilde)) {
      t.handleFullWidthStrikethroughDelim(block, ctx);
      continue;
    }
    const token = ctx.tokens[ctx.pos];
    let n: ast.Node | null = null;
    switch (token) {
      case lex.ItemBackslash:
        n = t.parseBackslash(block, ctx);
        break;
      case lex.ItemBacktick:
        n = t.parseCodeSpan(block, ctx);
        break;
      case lex.ItemAsterisk:
      case lex.ItemUnderscore:
      case lex.ItemTilde:
      case lex.ItemEqual:
      case lex.ItemCrosshatch:
        t.handleDelim(block, ctx);
        break;
      case lex.ItemCaret:
        if (t.Context!.ParseOption.Sup) {
          t.handleDelim(block, ctx);
        } else {
          n = t.parseText(ctx);
        }
        break;
      case lex.ItemNewline:
        n = t.parseNewline(block, ctx);
        break;
      case lex.ItemLess:
        if (null === (n = t.parseAutolink(ctx))) {
          if (null === (n = t.parseAutoEmailLink(ctx))) {
            if (null === (n = t.parseFileAnnotationRef(ctx))) {
              n = t.parseInlineHTML(ctx);
              if (t.Context!.ParseOption.ProtyleWYSIWYG && null !== n && ast.NodeInlineHTML === n.Type) {
                // There is no inline HTML in Protyle, use text
                n.Type = ast.NodeText;
              }
            }
          }
        }
        break;
      case lex.ItemOpenBracket:
        n = t.parseOpenBracket(ctx);
        break;
      case lex.ItemCloseBracket:
        n = t.parseCloseBracket(ctx);
        break;
      case lex.ItemAmpersand:
        n = t.parseEntity(ctx);
        break;
      case lex.ItemBang:
        n = t.parseBang(ctx);
        break;
      case lex.ItemDollar:
        n = t.parseInlineMath(ctx);
        break;
      case lex.ItemOpenBrace:
        n = t.parseHeadingID(block, ctx);
        break;
      case lex.ItemOpenParen:
        n = t.parseBlockRef(ctx);
        break;
      default:
        n = t.parseText(ctx);
        break;
    }

    if (null !== n) {
      if (null === n.Previous && null === n.Next) {
        // In the vast majority of cases the parse function returns a single node without linked siblings, attach it directly
        block.AppendChild(n);
        continue;
      }

      const nodes: ast.Node[] = [];
      let first: ast.Node = n;
      for (; ; first = first.Previous!) {
        if (null === first.Previous) {
          break;
        }
      }
      for (let node: ast.Node | null = first; null !== node; node = node.Next) {
        nodes.push(node);
      }
      for (const node of nodes) {
        block.AppendChild(node);
      }
    }
  }
  block.Tokens = null;
};

Tree.prototype.parseEntity = function (this: Tree, ctx: InlineContext): ast.Node {
  const t = this;
  // PERF-TODO: allocates a one-element array; a later task may share them.
  const and: Uint8Array = new Uint8Array([ctx.tokens[ctx.pos]]);
  if (2 > ctx.tokensLen || ctx.tokensLen <= ctx.pos + 1) {
    ctx.pos++;
    return new ast.Node(ast.NodeText, and);
  }

  const start = ctx.pos;
  let numeric = false;
  if (3 < ctx.tokensLen) {
    numeric = lex.ItemCrosshatch === ctx.tokens[start + 1];
  }
  let i = ctx.pos;
  let token = 0;
  let endWithSemicolon = false;
  for (; i < ctx.tokensLen; i++) {
    token = ctx.tokens[i];
    if (lex.IsWhitespace(token)) {
      break;
    }
    if (lex.ItemSemicolon === token) {
      i++;
      endWithSemicolon = true;
      break;
    }
  }

  if (!endWithSemicolon) {
    ctx.pos++;
    return new ast.Node(ast.NodeText, and);
  }

  const entityName = util.BytesToStr(ctx.tokens.subarray(start, i));
  if (numeric) {
    // PORT-NOTE: byte offset. Go takes len(entityName) in bytes and indexes it by byte; the string is not used for either, the token bytes are
    const entityNameLen = i - start;
    if (10 < entityNameLen || 4 > entityNameLen) {
      ctx.pos++;
      return new ast.Node(ast.NodeText, and);
    }

    if ((0x78 /* x */ === ctx.tokens[start + 2] || 0x58 /* X */ === ctx.tokens[start + 2]) && 5 > entityNameLen) {
      ctx.pos++;
      return new ast.Node(ast.NodeText, and);
    }
  }

  const v = html.HtmlUnescapeString(entityName);
  if (v === entityName) {
    ctx.pos++;
    return new ast.Node(ast.NodeText, and);
  }
  ctx.pos += i - start;
  const ret = new ast.Node(ast.NodeHTMLEntity, util.StrToBytes(v));
  ret.HtmlEntityTokens = util.StrToBytes(entityName);
  return ret;
};

// Try to match close bracket against an opening in the delimiter stack. Add either a link or image, or a plain [ character,
// to block's children. If there is a matching delimiter, remove it from the delimiter stack.
Tree.prototype.parseCloseBracket = function (this: Tree, ctx: InlineContext): ast.Node {
  const t = this;
  // PERF-TODO: allocates a one-element array; a later task may share them.
  const closeBracket: Uint8Array = new Uint8Array([ctx.tokens[ctx.pos]]);
  ctx.pos++;
  const startPos = ctx.pos;

  // Get the latest [ or ![
  let opener = ctx.brackets;
  if (null === opener) {
    return new ast.Node(ast.NodeText, closeBracket);
  }

  if (!opener.active) {
    t.removeBracket(ctx);
    return new ast.Node(ast.NodeText, closeBracket);
  }

  const isImage = opener.image;

  // Check whether the link or image rules are satisfied

  let openParen: Uint8Array | null = null;
  let dest: Uint8Array | null = null;
  let space: Uint8Array | null = null;
  let title: Uint8Array | null = null;
  let closeParen: Uint8Array | null = null;
  const savepos = ctx.pos;
  let matched = false;
  // Try to parse an inline link [text](url "tile")
  if (ctx.pos + 1 < ctx.tokensLen && lex.ItemOpenParen === ctx.tokens[ctx.pos]) {
    ctx.pos++;
    let isLink = false;
    let passed: Uint8Array | null = null;
    let remains: Uint8Array = new Uint8Array(0);

    for (; ;) { // A for is used here to simplify the logic, not to loop
      [isLink, passed, remains] = lex.Spnl(ctx.tokens.subarray(ctx.pos - 1));
      if (!isLink) {
        break;
      }
      ctx.pos += passed.length;
      [passed, remains, dest] = t.Context!.parseInlineLinkDest(remains);
      if (null === passed) {
        break;
      }
      if (t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV || t.Context!.ParseOption.ProtyleWYSIWYG) {
        if (!isImage && null === opener.node!.Next) {
          break;
        }
      }
      ctx.pos += passed.length;
      openParen = passed.subarray(0, 1);
      closeParen = passed.subarray(passed.length - 1);
      matched = lex.ItemCloseParen === passed[passed.length - 1];
      if (matched && 1 < remains.length) {
        // If passed ends with ), keep checking whether remains starts with a space and "
        // Fixes cases like [foo](bar.com(baz) "bar.com(baz)", test case debug_test.go #75
        matched = !lex.IsWhitespace(remains[0]) && lex.ItemDoublequote !== remains[1];
      }

      if (matched) {
        ctx.pos--;
        break;
      }
      if (1 > remains.length || !lex.IsWhitespace(remains[0])) {
        break;
      }
      // If a space follows, go on to try the title
      [isLink, passed, remains] = lex.Spnl(remains);
      if (!isLink) {
        break;
      }
      space = passed;
      ctx.pos += passed.length;
      matched = lex.ItemCloseParen === remains[0];
      closeParen = remains.subarray(0, 1);
      if (matched) {
        break;
      }
      ctx.pos++;
      let validTitle = false;
      [validTitle, passed, remains, title] = t.Context!.parseLinkTitle(remains);
      if (!validTitle) {
        break;
      }
      ctx.pos += passed.length;
      [isLink, passed, remains] = lex.Spnl(remains);
      ctx.pos += passed.length;
      matched = isLink && 0 < remains.length;
      if (matched) {
        if (t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV || t.Context!.ParseOption.ProtyleWYSIWYG) {
          if (bytes.HasPrefix(remains, caretCloseParenTokens)) {
            if (0 < (title ?? new Uint8Array(0)).length) {
              // Swap ‸) to )‸
              remains = remains.subarray(caretCloseParenTokens.length);
              remains = slices.Append(conv.BytesFromString(closeParenCaret), remains);
              slices.Copy(ctx.tokens.subarray(ctx.pos - 1), remains); // Swap the tokens too, so later parsing starts from the caret position
            } else {
              // Swap ""‸ to "‸"
              title = editor.CaretTokens;
              remains = remains.subarray(editor.CaretTokens.length);
              ctx.pos += 3;
            }
          } else if (bytes.HasPrefix(remains, closeParenCaretTokens)) {
            if (0 === (title ?? new Uint8Array(0)).length) {
              // Swap "")‸ to "‸")
              title = editor.CaretTokens;
              remains = bytes.ReplaceAll(remains, editor.CaretTokens, new Uint8Array(0));
              ctx.pos += 3;
            }
          }
        }
        matched = lex.ItemCloseParen === remains[0];
      }
      closeParen = remains.subarray(0);
      break;
    }
    if (!matched) {
      ctx.pos = savepos;
    }
  }

  let reflabel: Uint8Array | null = null;
  let linkType = 0;
  if (!matched) {
    // Try to parse the link label
    const beforelabel = ctx.pos;
    const [n, , label] = t.Context!.parseLinkLabel(ctx.tokens.subarray(beforelabel));
    if (2 < n) { // If the label is parsed, the format is [text][label]
      reflabel = label;
      ctx.pos += n;
    } else if (!opener.bracketAfter) {
      // Format [text][], treat text as the label
      let start = opener.index;
      if (lex.ItemOpenBracket === ctx.tokens[start]) {
        start++;
      }
      reflabel = ctx.tokens.subarray(start, startPos - 1);
      ctx.pos += 2;
    }
    if (0 === n) {
      ctx.pos = startPos;
    }
    if (null !== reflabel) {
      if (t.Context!.ParseOption.Footnotes) {
        // Look up the footnote
        const [idx, footnotesDef] = t.FindFootnotesDef(reflabel);
        if (null !== footnotesDef) {
          t.removeBracket(ctx);

          // The footnote label is matched literally, clear the delimiters inside the label and all inline nodes.
          while (null !== ctx.delimiters && ctx.delimiters !== opener.previousDelimiter) {
            t.removeDelimiter(ctx.delimiters, ctx);
          }
          while (null !== opener.node!.Next) {
            opener.node!.Next.Unlink();
          }
          opener.node!.Unlink(); // [

          let refId = strconv.Itoa(idx);
          const refsLen = footnotesDef.FootnotesRefs.length;
          if (0 < refsLen) {
            refId += ":" + strconv.Itoa(refsLen + 1);
          }
          const ref = new ast.Node(ast.NodeFootnotesRef, reflabel);
          ref.FootnotesRefId = refId;
          ref.FootnotesRefLabel = bytes.ReplaceAll(reflabel, editor.CaretTokens, new Uint8Array(0));
          footnotesDef.FootnotesRefs.push(ref);
          return ref;
        }
      }

      // Look up the link reference definition
      const link = t.FindLinkRefDefLink(reflabel);
      if (null !== link) {
        dest = link.ChildByType(ast.NodeLinkDest)!.Tokens;
        const titleNode = link.ChildByType(ast.NodeLinkTitle);
        if (null !== titleNode) {
          title = titleNode.Tokens;
        }
        matched = true;
        linkType = 3;
      }
    }
  }

  if (matched) {
    const node = new ast.Node(ast.NodeLink);
    node.LinkType = linkType;
    node.LinkRefLabel = reflabel ?? new Uint8Array(0);
    if (isImage) {
      node.Type = ast.NodeImage;
      node.AppendChild(new ast.Node(ast.NodeBang, opener.node!.Tokens!.subarray(0, 1)));
      opener.node!.Tokens = opener.node!.Tokens!.subarray(1);
    }
    node.AppendChild(new ast.Node(ast.NodeOpenBracket, opener.node!.Tokens));

    let tmp: ast.Node | null = null;
    let next: ast.Node | null = null;
    tmp = opener.node!.Next;
    while (null !== tmp) {
      next = tmp.Next;
      tmp.Unlink();
      if (ast.NodeText === tmp.Type) {
        tmp.Type = ast.NodeLinkText;
        if (t.Context!.ParseOption.ProtyleWYSIWYG) {
          if (bytes.Contains(tmp.Tokens!, editor.CaretTokens)) {
            node.InsertAfter(new ast.Node(ast.NodeText, editor.CaretTokens));
            tmp.Tokens = bytes.ReplaceAll(tmp.Tokens!, editor.CaretTokens, new Uint8Array(0));
          }
        }
      }
      node.AppendChild(tmp);
      tmp = next;
    }
    node.AppendChild(new ast.Node(ast.NodeCloseBracket, closeBracket));
    node.AppendChild(new ast.Node(ast.NodeOpenParen, openParen));
    if (t.Context!.ParseOption.ProtyleWYSIWYG) {
      if (bytes.Contains(dest ?? new Uint8Array(0), editor.CaretTokens)) {
        node.InsertAfter(new ast.Node(ast.NodeText, editor.CaretTokens));
        dest = bytes.ReplaceAll(dest ?? new Uint8Array(0), editor.CaretTokens, new Uint8Array(0));
      }
    }
    node.AppendChild(new ast.Node(ast.NodeLinkDest, dest));
    if (null !== space) {
      node.AppendChild(new ast.Node(ast.NodeLinkSpace, space));
    }
    if (0 < (title ?? new Uint8Array(0)).length) {
      node.AppendChild(new ast.Node(ast.NodeLinkTitle, title));
    }
    node.AppendChild(new ast.Node(ast.NodeCloseParen, closeParen));
    t.processEmphasis(opener.previousDelimiter, ctx);
    t.removeBracket(ctx);
    opener.node!.Unlink();

    // We remove this bracket and processEmphasis will remove later delimiters.
    // Now, for a link, we also deactivate earlier link openers.
    // (no links in links)
    if (!isImage) {
      opener = ctx.brackets;
      while (null !== opener) {
        if (!opener.image) {
          opener.active = false; // deactivate this opener
        }
        opener = opener.previous;
      }
    }

    return node;
  } else { // No match
    t.removeBracket(ctx);
    ctx.pos = startPos;
    return new ast.Node(ast.NodeText, closeBracket);
  }
};

Tree.prototype.parseOpenBracket = function (this: Tree, ctx: InlineContext): ast.Node {
  const t = this;
  let ret: ast.Node | null = null;
  const startPos = ctx.pos;
  ctx.pos++;
  ret = new ast.Node(ast.NodeText, ctx.tokens.subarray(startPos, ctx.pos));
  // Push [ onto the stack
  t.addBracket(ret, ctx.pos - 1, false, ctx);
  return ret;
};

Tree.prototype.addBracket = function (this: Tree, node: ast.Node, index: number, image: boolean, ctx: InlineContext): void {
  const t = this;
  if (null !== ctx.brackets) {
    ctx.brackets.bracketAfter = true;
  }

  const d = new delimiter();
  d.node = node;
  d.previous = ctx.brackets;
  d.previousDelimiter = ctx.delimiters;
  d.index = index;
  d.image = image;
  d.active = true;
  ctx.brackets = d;
};

Tree.prototype.removeBracket = function (this: Tree, ctx: InlineContext): void {
  const t = this;
  ctx.brackets = ctx.brackets!.previous;
};

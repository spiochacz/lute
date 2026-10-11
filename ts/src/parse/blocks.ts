// Ported from parse/blocks.go @ 8e7896b6
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
import * as util from "../util/index.ts";
import { blockStarts } from "./block_start.ts";
import { BlockquoteContinue } from "./blockquote.ts";
import { CalloutContinue } from "./callout.ts";
import { CodeBlockContinue } from "./code_block.ts";
import { CustomBlockContinue } from "./custom_block.ts";
import { FootnotesContinue } from "./footnotes.ts";
import { GitConflictContinue } from "./gitconflict.ts";
import { HtmlBlockContinue } from "./html_block.ts";
import { IAL2MapUnEsc } from "./inline_attribute_list.ts";
import { ListItemContinue } from "./list.ts";
import { MathBlockContinue, MathBlockMarker } from "./math_block.ts";
import { ParagraphContinue } from "./paragraph.ts";
import { SuperBlockContinue } from "./super_block.ts";
import { YamlFrontMatterContinue } from "./yaml_front_matter.ts";
import { Context, Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseBlocks(): void;
    BlockCount(): number;
    DocBlockCount(): number;
    incorporateLine(line: Uint8Array): void;
    addLine(): void;
  }
}

const newlineTokens: Uint8Array = util.StrToBytes("\n");
const spaceTokens: Uint8Array = util.StrToBytes(" ");
const emptyTokens: Uint8Array = new Uint8Array(0);

// parseBlocks parses and generates block-level nodes.
Tree.prototype.parseBlocks = function (this: Tree): void {
  const t = this;
  t.Context!.Tip = t.Root;
  let lines = 0;
  for (let line = t.lexer!.NextLine(); null !== line; line = t.lexer!.NextLine()) {
    if (t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV || t.Context!.ParseOption.ProtyleWYSIWYG) {
      if (!bytes.Equal(line, editor.CaretNewlineTokens) && t.Context!.Tip!.ParentIs(ast.NodeListItem) && bytes.HasPrefix(line, editor.CaretTokens)) {
        // If the caret is at the start, move it to the end of the previous line. Handles some cases of https://github.com/Vanessa219/vditor/issues/633
        if (ast.NodeListItem === t.Context!.Tip!.Type) {
          t.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, line));
          break;
        } else {
          t.Context!.Tip!.Tokens = bytes.TrimSuffix(t.Context!.Tip!.Tokens ?? emptyTokens, newlineTokens);
          t.Context!.Tip!.Tokens = slices.Append(t.Context!.Tip!.Tokens, editor.CaretNewlineTokens);
        }
        line = line.subarray(editor.CaretTokens.length);
      }
    }

    t.incorporateLine(line);
    lines++;
  }
  for (; null !== t.Context!.Tip;) {
    t.Context!.finalize(t.Context!.Tip!);
  }
};

Tree.prototype.BlockCount = function (this: Tree): number {
  const t = this;
  let ret = 0;
  ast.Walk(t.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }

    if ("" === n.ID || !n.IsBlock()) {
      return ast.WalkContinue;
    }

    ret++;
    return ast.WalkContinue;
  });
  return ret;
};

Tree.prototype.DocBlockCount = function (this: Tree): number {
  const t = this;
  let ret = 0;
  ast.Walk(t.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }

    if (!n.IsChildBlockOf(t.Root, 1)) {
      return ast.WalkContinue;
    }

    ret++;
    return ast.WalkContinue;
  });
  return ret;
};

// incorporateLine processes the text line and attaches the generated block-level nodes to the tree.
Tree.prototype.incorporateLine = function (this: Tree, line: Uint8Array): void {
  const t = this;
  const itemIAL = t.Context!.tabsItemIAL;
  t.Context!.tabsItemIAL = null;
  t.Context!.oldtip = t.Context!.Tip;
  t.Context!.offset = 0;
  t.Context!.column = 0;
  t.Context!.blank = false;
  t.Context!.partiallyConsumedTab = false;
  t.Context!.currentLine = line;
  t.Context!.currentLineLen = t.Context!.currentLine.length;

  let allMatched = true;
  let container: ast.Node;
  container = t.Root!;
  let lastChild = container.LastChild;
  for (; null !== lastChild && !lastChild.Close; lastChild = container.LastChild) {
    container = lastChild;
    t.Context!.findNextNonspace();

    switch (_continue(container, t.Context!)) {
      case 0: // The match can be processed further
        break;
      case 1: // The match failed, cannot be processed further
        allMatched = false;
        break;
      case 2: // Matched the closing of a fenced code block, process the next line
        return;
      case 3: // Matched the closing of a super block, process the next line
        t.Context!.closeSuperBlockChildren(); // Close the child nodes under the super block
        if (ast.NodeSuperBlock !== t.Context!.Tip!.Type) {
          const sb = t.Context!.Tip!.Parent!;
          sb.Close = true;
          sb.AppendChild(new ast.Node(ast.NodeSuperBlockCloseMarker));
          t.Context!.Tip = sb.Parent;
          t.Context!.lastMatchedContainer = sb;
        } else {
          t.Context!.Tip!.AppendChild(new ast.Node(ast.NodeSuperBlockCloseMarker));
          t.Context!.Tip!.Close = true;
          t.Context!.Tip = t.Context!.Tip!.Parent;
          t.Context!.lastMatchedContainer = t.Context!.Tip;
        }
        return;
    }

    if (!allMatched) {
      container = container.Parent!; // Go back to the last matched block
      break;
    }
  }

  t.Context!.allClosed = container === t.Context!.oldtip;
  t.Context!.lastMatchedContainer = container;
  if (null !== itemIAL && itemIAL === container && t.Context!.ParseOption.KramdownBlockIAL && !t.Context!.indented) {
    const ial = t.parseKramdownBlockIAL();
    if (null !== ial && !util.IsDocIAL2(ial)) {
      // Attributes right after a heading belong to the tab item; attributes after a blank line are still handled as body blocks.
      itemIAL.KramdownIAL = ial;
      itemIAL.ID = IAL2MapUnEsc(ial).get("id") ?? "";
      return;
    }
  }

  let matchedLeaf = container.Type !== ast.NodeParagraph && container.AcceptLines();
  const blockParsers = blockStarts();
  const startsLen = blockParsers.length;

  // Unless the last match is a code block, start a new block-level node
  for (; !matchedLeaf;) {
    t.Context!.findNextNonspace();

    // If the line does not start with a potential node marker ^[#`~*+_=<>0-9-${], there is no need to keep iterating to generate child nodes.
    // A simple check here gives some performance gain.
    const maybeMarker = t.Context!.currentLine[t.Context!.nextNonspace];
    if (!t.Context!.indented && // Indented code block
      lex.ItemHyphen !== maybeMarker && lex.ItemAsterisk !== maybeMarker && lex.ItemPlus !== maybeMarker && // Unordered list
      !lex.IsDigit(maybeMarker) && // Ordered list
      lex.ItemBacktick !== maybeMarker && lex.ItemTilde !== maybeMarker && // Code block
      lex.ItemSemicolon !== maybeMarker && // Definition block
      lex.ItemColon !== maybeMarker && 0x40 /* @ */ !== maybeMarker && // Tabs container
      lex.ItemCrosshatch !== maybeMarker && // ATX heading
      lex.ItemGreater !== maybeMarker && // Block quote
      lex.ItemLess !== maybeMarker && // HTML block
      lex.ItemUnderscore !== maybeMarker && lex.ItemEqual !== maybeMarker && // Setext heading
      lex.ItemDollar !== maybeMarker && // Math
      lex.ItemOpenBracket !== maybeMarker && // Footnote
      lex.ItemOpenBrace !== maybeMarker && // Start of a kramdown inline attribute list or super block
      lex.ItemCloseBrace !== maybeMarker && // Close of a super block
      lex.ItemBang !== maybeMarker && 0xef /* first byte of the full-width ！ (EF BC 81) */ !== maybeMarker && // Content block embed
      editor.CaretTokens[0] !== maybeMarker) { // Vditor editor support
      t.Context!.advanceNextNonspace();
      break;
    }

    // Try one by one whether a block-level node can start
    let i = 0;
    for (; i < startsLen;) {
      const res = blockParsers[i](t, container);
      if (res === 3) {
        return;
      }
      if (res === 1) { // Matched a container block, keep descending
        container = t.Context!.Tip!;
        break;
      } else if (res === 2) { // Matched a leaf block, leave the descending
        container = t.Context!.Tip!;
        matchedLeaf = true;
        break;
      } else { // No match, try the next block start pattern
        i++;
      }
    }

    if (i === startsLen) { // No block matched
      t.Context!.advanceNextNonspace();
      break;
    }
  }

  // The rest of the content after offset counts as a text line and must be added to the corresponding block node

  if (!t.Context!.allClosed && !t.Context!.blank && t.Context!.Tip!.Type === ast.NodeParagraph) {
    // The line continues a paragraph, add it directly to the tip paragraph
    t.addLine();
  } else {
    // Finalize the unmatched blocks
    t.Context!.closeUnmatchedBlocks();

    if (t.Context!.blank && null !== container.LastChild) {
      container.LastChild.LastLineBlank = true;
    }

    const typ = container.Type;
    const isFenced = ast.NodeCodeBlock === typ && container.IsFencedCodeBlock;

    // Blank line check, mainly to decide whether a list is tight or loose
    const lastLineBlank = t.Context!.blank &&
      !(typ === ast.NodeFootnotesDef ||
        typ === ast.NodeBlockquote || typ === ast.NodeCallout || // Block quotes and callouts are never blank because they have at least one >
        (typ === ast.NodeCodeBlock && isFenced) || // A fenced code block does not count as a blank line
        (typ === ast.NodeCustomBlock) || // A custom block does not count as a blank line
        (typ === ast.NodeMathBlock) || // A math block does not count as a blank line
        (typ === ast.NodeGitConflict) || // A Git conflict marker does not count as a blank line
        (typ === ast.NodeListItem && null === container.FirstChild)); // An empty list item does not count as a blank line
    // A list is a block container (it can nest), so LastLineBlank must be propagated towards the parents
    // LastLineBlank is currently only used to decide whether a list is tight
    for (let cont: ast.Node | null = container; null !== cont; cont = cont.Parent) {
      cont.LastLineBlank = lastLineBlank;
    }

    if (container.AcceptLines()) {
      t.addLine();
      switch (typ) {
        case ast.NodeHTMLBlock: {
          // HTML blocks (types 1-5) need a check of the closing condition
          const html = container;
          if (html.HtmlBlockType >= 1 && html.HtmlBlockType <= 5) {
            const tokens = t.Context!.currentLine.subarray(t.Context!.offset);
            if (t.isHTMLBlockClose(tokens, html.HtmlBlockType)) {
              t.Context!.finalize(container);
            }
          }
          break;
        }
        case ast.NodeMathBlock: {
          // A math block marker without a newline ($$foo$$) needs a check of the closing marker on the right
          if (null === container.Tokens || 3 > container.Tokens.length) {
            break;
          }
          const firstMarkerIdx = bytes.Index(container.Tokens, MathBlockMarker);
          if (firstMarkerIdx === -1) {
            break;
          }
          const lastMarkerIdx = bytes.LastIndex(container.Tokens, MathBlockMarker);
          if (lastMarkerIdx === -1) {
            break;
          }
          if (lastMarkerIdx === firstMarkerIdx) {
            break;
          }

          const tails = container.Tokens.subarray(lastMarkerIdx);
          if (bytes.HasPrefix(tails, MathBlockMarker) && bytes.HasSuffix(tails, newlineTokens)) {
            if (bytes.Equal(MathBlockMarker, bytes.TrimSpace(tails))) {
              t.Context!.finalize(container);
            }
          }
          break;
        }
      }
    } else if (t.Context!.offset < t.Context!.currentLineLen && !t.Context!.blank) {
      // A plain paragraph starts
      t.Context!.addChild(ast.NodeParagraph);
      t.Context!.advanceNextNonspace();
      t.addLine();
    }
  }
};

// addLine adds all the remaining tokens of the iterated line to the tip node context.Tip.
// The tip must be known to accept new lines before calling this.
Tree.prototype.addLine = function (this: Tree): void {
  const t = this;
  if (t.Context!.partiallyConsumedTab) {
    t.Context!.offset++; // skip over tab
    // add space characters:
    const charsToTab = 4 - (t.Context!.column % 4);
    t.Context!.Tip!.AppendTokens(bytes.Repeat(spaceTokens, charsToTab));
  }

  const startWithSpace = 1 < t.Context!.currentLineLen && (0x20 /* space */ === t.Context!.currentLine[0] || 0x09 /* \t */ === t.Context!.currentLine[0]);
  const docChildPara = ast.NodeDocument === t.Context!.Tip!.Parent!.Type;
  if (t.Context!.ParseOption.ParagraphBeginningSpace && startWithSpace && docChildPara) {
    t.Context!.Tip!.AppendTokens(t.Context!.currentLine);
  } else {
    t.Context!.Tip!.AppendTokens(t.Context!.currentLine.subarray(t.Context!.offset));
  }
};

// _continue decides whether the node can be processed further. For example a block quote needs >, an indented code block needs 4 spaces, a fenced code block needs ```.
// It returns 0 if it can be processed further, 1 if it cannot, and 2 (only when a fenced code block, super block or custom block closes) if the next line can be processed.
export function _continue(n: ast.Node, context: Context): number {
  switch (n.Type) {
    case ast.NodeCodeBlock:
      return CodeBlockContinue(n, context);
    case ast.NodeHTMLBlock:
      return HtmlBlockContinue(n, context);
    case ast.NodeParagraph:
      return ParagraphContinue(n, context);
    case ast.NodeListItem:
      return ListItemContinue(n, context);
    case ast.NodeBlockquote:
      return BlockquoteContinue(n, context);
    case ast.NodeMathBlock:
      return MathBlockContinue(n, context);
    case ast.NodeYamlFrontMatter:
      return YamlFrontMatterContinue(n, context);
    case ast.NodeFootnotesDef:
      return FootnotesContinue(n, context);
    case ast.NodeSuperBlock:
      return SuperBlockContinue(n, context);
    case ast.NodeGitConflict:
      return GitConflictContinue(n, context);
    case ast.NodeCustomBlock:
      return CustomBlockContinue(n, context);
    case ast.NodeCallout:
      return CalloutContinue(n, context);
    case ast.NodeTabs:
      return context.tabsContinue(n);
    case ast.NodeHeading:
    case ast.NodeThematicBreak:
    case ast.NodeKramdownBlockIAL:
    case ast.NodeLinkRefDefBlock:
    case ast.NodeBlockQueryEmbed:
    case ast.NodeIFrame:
    case ast.NodeVideo:
    case ast.NodeAudio:
    case ast.NodeWidget:
    case ast.NodeAttributeView:
      return 1;
  }
  return 0;
}

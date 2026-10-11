// Ported from parse/paragraph.go @ 8e7896b6
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
import { IAL2Map, IAL2Tokens, Tokens2IAL } from "./inline_attribute_list.ts";
import { parse } from "./parse.ts";
import type { Context } from "./types.ts";

const emptyTokens: Uint8Array = new Uint8Array(0);
const closeBraceTokens: Uint8Array = conv.BytesFromString("}");

export function ParagraphContinue(p: ast.Node, context: Context): number {
  if (context.blank) {
    return 1;
  }
  return 0;
}

// paragraphFinalize returns insertTable.
export function paragraphFinalize(p: ast.Node, context: Context): boolean {
  if (context.ParseOption.ParagraphBeginningSpace) {
    [, p.Tokens] = null === p.Tokens ? [emptyTokens, null] : lex.TrimRight(p.Tokens); // nil stays nil in Go (lex.TrimRight returns tokens itself or a slice of it)
  } else {
    p.Tokens = lex.TrimWhitespace(p.Tokens); // null stays null, as nil does in Go
  }

  // Parse link reference definitions
  let hasReferenceDefs = false;
  for (let tokens = p.Tokens; null !== tokens && 0 < tokens.length && lex.ItemOpenBracket === tokens[0]; tokens = p.Tokens) {
    const remains = context.parseLinkRefDef(tokens);
    if (null !== remains) {
      p.Tokens = remains;
      hasReferenceDefs = true;
      continue;
    }
    break;
  }
  if (hasReferenceDefs && lex.IsBlankLine(p.Tokens ?? emptyTokens)) {
    p.Unlink();
  }

  if (context.ParseOption.KramdownBlockIAL && null !== context.Tip!.Parent && ast.NodeListItem === context.Tip!.Parent.Type && p === context.Tip!.Parent.FirstChild) {
    const ial = Tokens2IAL(p.Tokens);
    if (null !== ial) {
      // The list item has no child nodes, so an empty paragraph should be attached and the current paragraph converted into the IAL node of the empty paragraph
      const emptyP = new ast.Node(ast.NodeParagraph);
      emptyP.KramdownIAL = ial;
      const m = IAL2Map(ial);
      emptyP.ID = m.get("id") ?? "";
      context.Tip!.Parent.AppendChild(emptyP);
      emptyP.InsertAfter(new ast.Node(ast.NodeKramdownBlockIAL, IAL2Tokens(ial)));
      p.Unlink();
      return false;
    }
  }

  if (context.ParseOption.GFMTaskListItem) {
    // Try to parse a task list item
    const listItem = p.Parent;
    if (null !== listItem && ast.NodeListItem === listItem.Type && listItem.FirstChild === p) {
      if (3 === listItem.ListData!.Typ) {
        const isEditor = context.ParseOption.VditorWYSIWYG || context.ParseOption.VditorIR || context.ParseOption.VditorSV || context.ParseOption.ProtyleWYSIWYG;
        let isTaskListItem = 3 < (p.Tokens ?? emptyTokens).length;
        if (context.ParseOption.ProtyleWYSIWYG) {
          isTaskListItem = 3 <= (p.Tokens ?? emptyTokens).length;
        }
        if (isTaskListItem) {
          // If it is a task list item, add a task list marker node

          let tokens: Uint8Array = p.Tokens ?? emptyTokens;
          if (context.ParseOption.KramdownBlockIAL) {
            const ial = context.parseKramdownIALInListItem(tokens);
            if (null !== ial && 0 < ial.length) {
              tokens = tokens.subarray(bytes.Index(tokens, closeBraceTokens) + 1);
              p.KramdownIAL = ial; // Stored temporarily on the IAL of p, it is cleared when the list is finalized
            }
          }

          if ((3 === tokens.length && tokens[0] === lex.ItemOpenBracket && tokens[2] === lex.ItemCloseBracket && tokens[1] !== lex.ItemCloseBracket) ||
            (3 < tokens.length && (lex.IsWhitespace(tokens[3]) || editor.CaretTokens[0] === tokens[3] || editor.CaretTokens[0] === tokens[2]))) {
            let caretStartText = false;
            let caretAfterCloseBracket = false;
            let caretInBracket = false;
            if (context.ParseOption.VditorWYSIWYG || context.ParseOption.VditorIR || context.ParseOption.VditorSV || context.ParseOption.ProtyleWYSIWYG) {
              const closeBracket = bytes.IndexByte(tokens, lex.ItemCloseBracket);
              if (bytes.HasPrefix(tokens, editor.CaretTokens)) {
                tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyTokens);
                caretStartText = true;
              } else if (bytes.HasPrefix(tokens.subarray(closeBracket + 1), editor.CaretTokens)) {
                tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyTokens);
                caretAfterCloseBracket = true;
              } else if (bytes.Contains(tokens.subarray(1, closeBracket), editor.CaretTokens)) {
                tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyTokens);
                caretInBracket = true;
              }
            }
            const marker = tokens[1];
            if (context.ParseOption.IsValidTaskListItemMarker(marker)) {
              const taskListItemMarker = new ast.Node(ast.NodeTaskListItemMarker, tokens.subarray(0, 3));
              taskListItemMarker.ReviveFromMarker(marker);
              if (context.ParseOption.ProtyleWYSIWYG) {
                p.InsertBefore(taskListItemMarker);
              } else {
                p.PrependChild(taskListItemMarker);
              }
              p.Tokens = tokens.subarray(3); // Remove the leading [ ], [x] or [X]
              if (isEditor) {
                p.Tokens = slices.NilIfEmpty(bytes.TrimSpace(p.Tokens)); // Go: nil when the result is empty
                if (caretStartText || caretAfterCloseBracket || caretInBracket) {
                  p.Tokens = slices.Append(conv.BytesFromString(" " + editor.Caret), p.Tokens ?? new Uint8Array(0));
                } else {
                  if (!context.ParseOption.ProtyleWYSIWYG) {
                    p.Tokens = slices.Append(conv.BytesFromString(" "), p.Tokens ?? new Uint8Array(0));
                  }
                }
              }

              if (0 < (p.Tokens ?? new Uint8Array(0)).length) { // Go: len(nil) is 0
                const subTree = parse("", p.Tokens!, context.ParseOption, true);
                const subBlock = subTree.Root!.FirstChild!;
                if (ast.NodeParagraph !== subBlock.Type) {
                  if (!context.ParseOption.ProtyleWYSIWYG) {
                    // Protyle `Optimize typography` exception in case of task list and heading https://github.com/siyuan-note/siyuan/issues/9035
                    listItem.PrependChild(new ast.Node(ast.NodeText, conv.BytesFromString(" ")));
                  }
                  if (null !== p.FirstChild) {
                    listItem.PrependChild(p.FirstChild);
                  }
                  subBlock.ID = p.ID;
                  subBlock.KramdownIAL = p.KramdownIAL;

                  // Incomplete data when pasting task list nested list https://github.com/siyuan-note/siyuan/issues/9239
                  let last: ast.Node | null = null;
                  const blocks: ast.Node[] = [];
                  for (let b: ast.Node | null = subBlock; null !== b && ast.NodeDocument !== b.Type; b = b.Next) {
                    if (ast.NodeKramdownBlockIAL === b.Type) {
                      if (util.IsDocIAL(b.Tokens ?? emptyTokens)) {
                        break;
                      }
                    }

                    last = b;
                  }
                  for (let b: ast.Node | null = last; null !== b; b = b.Previous) {
                    blocks.push(b);
                  }
                  for (const b of blocks) {
                    p.InsertAfter(b);
                  }

                  p.Unlink();
                }
              }
            }
          }
        }
      }
    }
  }

  if (context.ParseOption.GFMTable) {
    const [paragraph, table] = context.parseTable(p);
    if (null !== table) {
      if (null !== paragraph) {
        p.Tokens = paragraph.Tokens;
        p.InsertAfter(table);
        // Set the tip and its state
        table.Close = true;
        context.Tip = table;
        return true;
      } else {
        // Convert the paragraph node into a table node
        p.Type = ast.NodeTable;
        p.TableAligns = table.TableAligns;
        for (let tr = table.FirstChild; null !== tr;) {
          const nextTr: ast.Node | null = tr.Next;
          p.AppendChild(tr);
          tr = nextTr;
        }
      }
      return false;
    }
  }

  if (context.ParseOption.ToC) {
    const toc = context.parseToC(p);
    if (null !== toc) {
      // Convert the paragraph node into a ToC node
      p.Type = ast.NodeToC;
      return false;
    }
  }
  return false;
}

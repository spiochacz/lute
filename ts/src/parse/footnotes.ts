// Ported from parse/footnotes.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as slices from "../runtime/slices.ts";
import * as ast from "../ast/index.ts";
import * as lex from "../lex/index.ts";
import type { Context } from "./types.ts";
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    ExistFootnotesDef(): boolean;
  }
}

// FootnotesStart decides whether a footnote definition ([^label]) starts.
export function FootnotesStart(t: Tree, container: ast.Node): number {
  if (!t.Context!.ParseOption.Footnotes || t.Context!.indented) {
    return 0;
  }

  const marker = lex.Peek(t.Context!.currentLine, t.Context!.nextNonspace);
  if (lex.ItemOpenBracket !== marker) {
    return 0;
  }
  const caret = lex.Peek(t.Context!.currentLine, t.Context!.nextNonspace + 1);
  if (lex.ItemCaret !== caret) {
    return 0;
  }

  let label: Uint8Array = new Uint8Array([lex.ItemCaret]);
  let token = 0;
  let i = 0;
  for (i = t.Context!.nextNonspace + 2; i < t.Context!.currentLineLen; i++) {
    token = t.Context!.currentLine[i];
    if (lex.ItemSpace === token || lex.ItemNewline === token || lex.ItemTab === token) {
      return 0;
    }
    if (lex.ItemCloseBracket === token) {
      break;
    }
    label = slices.AppendByte(label, token);
  }
  if (i >= t.Context!.currentLineLen) {
    return 0;
  }
  if (lex.ItemColon !== t.Context!.currentLine[i + 1]) {
    return 0;
  }
  t.Context!.advanceOffset(1, false);

  t.Context!.closeUnmatchedBlocks();
  t.Context!.advanceOffset(label.length + 2, true);

  if (ast.NodeFootnotesDefBlock !== t.Context!.Tip!.Type) {
    t.Context!.addChild(ast.NodeFootnotesDefBlock);
  }

  const def = t.Context!.addChild(ast.NodeFootnotesDef);
  def.Tokens = label;
  return 1;
}

export function FootnotesContinue(footnotesDef: ast.Node, context: Context): number {
  if (context.blank) {
    return 0;
  }

  if (4 > context.indent) {
    return 1;
  }

  context.advanceOffset(4, true);
  return 0;
}

Tree.prototype.ExistFootnotesDef = function (this: Tree): boolean {
  const t = this;
  return 0 < t.Root!.ChildrenByType(ast.NodeFootnotesDef).length;
};

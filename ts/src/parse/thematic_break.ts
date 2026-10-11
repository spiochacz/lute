// Ported from parse/thematic_break.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as ast from "../ast/index.ts";
import * as editor from "../editor/index.ts";
import * as lex from "../lex/index.ts";
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseThematicBreak(): [boolean, Uint8Array | null];
  }
}

// ThematicBreakStart decides whether a thematic break (--- ***) starts.
export function ThematicBreakStart(t: Tree, container: ast.Node): number {
  if (t.Context!.indented) {
    return 0;
  }

  const [ok, caretTokens] = t.parseThematicBreak();
  if (ok) {
    t.Context!.closeUnmatchedBlocks();
    const thematicBreak = t.Context!.addChild(ast.NodeThematicBreak);
    thematicBreak.Tokens = caretTokens;
    t.Context!.advanceOffset(t.Context!.currentLineLen - t.Context!.offset, false);
    return 2;
  }
  return 0;
}

// PORT-NOTE: the nil result of caretTokens is typed nullable because it is assigned to the nullable node.Tokens.
Tree.prototype.parseThematicBreak = function (this: Tree): [boolean, Uint8Array | null] {
  const t = this;
  let caretTokens: Uint8Array | null = null;
  let markerCnt = 0;
  let marker = 0;
  const ln = t.Context!.currentLine;
  const caretInLn = false; // UPSTREAM-BUG: caretInLn is never set to true (parse/thematic_break.go:39), so caretTokens is always nil.
  const length = ln.length;
  for (let i = t.Context!.nextNonspace; i < length - 1; i++) {
    const token = ln[i];
    if (lex.ItemSpace === token || lex.ItemTab === token) {
      continue;
    }

    if (lex.ItemHyphen !== token && lex.ItemUnderscore !== token && lex.ItemAsterisk !== token) {
      return [false, caretTokens];
    }

    if (0 !== marker) {
      if (marker !== token) {
        return [false, caretTokens];
      }
    } else {
      marker = token;
    }
    markerCnt++;
  }

  if ((t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV || t.Context!.ParseOption.ProtyleWYSIWYG) && caretInLn) {
    caretTokens = editor.CaretTokens;
  }
  return [3 <= markerCnt, caretTokens];
};

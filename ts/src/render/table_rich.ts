// Ported from render/table_rich.go @ 8e7896b6
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
import * as ast from "../ast/index.ts";
import * as parse from "../parse/index.ts";
import { NewHtmlRenderer } from "./html_renderer.ts";
import type { Options } from "./renderer.ts";

const pipeBytes: Uint8Array = conv.BytesFromString("|");
const pipeEntityBytes: Uint8Array = conv.BytesFromString("&#124;");

// tableCellRichInlineHTML keeps the inline formatting in a Markdown cell, and uses hard line breaks to carry the paragraphs and code lines of the fragment.
export function tableCellRichInlineHTML(cell: ast.Node, options: Options, parseOptions: parse.Options): Uint8Array {
  const inline = parse.CloneTableCellInline(cell);
  inline.TableCellRich = null;
  const opt = options.Copy();
  opt.ProtyleWYSIWYG = false;
  opt.KramdownBlockIAL = false;
  opt.KramdownSpanIAL = false;
  opt.Sanitize = true;
  opt.SoftBreak2HardBreak = true;
  const tree = new parse.Tree();
  tree.Root = inline;
  const renderer = NewHtmlRenderer(tree, opt, parseOptions);
  renderer.SetTextMarkStandardTag();
  renderer.RendererFuncs.set(ast.NodeTableCell, (_n: ast.Node, _entering: boolean): ast.WalkStatus => ast.WalkContinue);
  return bytes.ReplaceAll(renderer.Render(), pipeBytes, pipeEntityBytes);
}

// TableCellRichHTML outputs the static HTML of the fragment, without exposing the inner nodes as editable document blocks.
export function TableCellRichHTML(rich: ast.TableCellRich, options: Options): [Uint8Array | null, Error | null] {
  let tree: parse.Tree;
  {
    const [t, err] = parse.ParseTableCellRich(rich);
    if (null !== err) {
      return [null, err];
    }
    tree = t!;
  }
  const remove: ast.Node[] = [];
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (entering && n.IsBlock()) {
      n.ID = "";
      n.RemoveIALAttr("id");
      n.RemoveIALAttr("updated");
      if (ast.NodeKramdownBlockIAL === n.Type) {
        remove.push(n);
      }
    }
    return ast.WalkContinue;
  });
  for (const n of remove) {
    n.Unlink();
  }
  const opt = options.Copy();
  opt.ProtyleWYSIWYG = false;
  opt.KramdownBlockIAL = false;
  opt.KramdownSpanIAL = false;
  opt.CodeSyntaxHighlight = false;
  opt.Sanitize = true;
  opt.HeadingID = false;
  return [NewHtmlRenderer(tree, opt, tree.Context!.ParseOption).Render(), null];
}

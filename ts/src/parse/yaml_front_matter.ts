// Ported from parse/yaml_front_matter.go @ 8e7896b6
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
import { IAL2Map, simpleCheckIsBlockIAL } from "./inline_attribute_list.ts";
import { Context, Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseYamlFrontMatter(): boolean;
  }
  interface Context {
    yamlFrontMatterFinalize(node: ast.Node): void;
  }
}

const emptyTokens: Uint8Array = new Uint8Array(0);

// YamlFrontMatterStart decides whether a YAML Front Matter (---) starts.
export function YamlFrontMatterStart(t: Tree, container: ast.Node): number {
  if (!t.Context!.ParseOption.YamlFrontMatter || t.Context!.indented || null !== t.Root!.FirstChild) {
    return 0;
  }

  if (t.parseYamlFrontMatter()) {
    const node = new ast.Node(ast.NodeYamlFrontMatter);
    t.Root!.AppendChild(node);
    t.Context!.Tip = node;
    return 2;
  }
  return 0;
}

export function YamlFrontMatterContinue(node: ast.Node, context: Context): number {
  if (isYamlFrontMatterClose(context)) {
    context.finalize(node);
    return 2;
  }
  return 0;
}

export const YamlFrontMatterMarker: Uint8Array = util.StrToBytes("---");
export const YamlFrontMatterMarkerNewline: Uint8Array = util.StrToBytes("---\n");
export const YamlFrontMatterMarkerCaret: Uint8Array = util.StrToBytes("---" + editor.Caret);
export const YamlFrontMatterMarkerCaretNewline: Uint8Array = util.StrToBytes("---" + editor.Caret + "\n");

Context.prototype.yamlFrontMatterFinalize = function (this: Context, node: ast.Node): void {
  const context = this;
  let tokens: Uint8Array = node.Tokens!.subarray(3); // Remove the leading ---\n
  tokens = lex.TrimWhitespace(tokens) ?? emptyTokens;
  if (context.ParseOption.VditorWYSIWYG || context.ParseOption.VditorIR || context.ParseOption.VditorSV) {
    if (bytes.HasSuffix(tokens, YamlFrontMatterMarkerCaret)) {
      // Remove the trailing ---‸
      tokens = bytes.TrimSuffix(tokens, YamlFrontMatterMarkerCaret);
      // Move the Vditor caret to the end of the content
      tokens = slices.Append(tokens, editor.CaretTokens);
    }
  }
  if (bytes.HasSuffix(tokens, YamlFrontMatterMarker)) {
    tokens = tokens.subarray(0, tokens.length - 3); // Remove the trailing ---
  }
  node.Tokens = tokens;
  node.AppendChild(new ast.Node(ast.NodeYamlFrontMatterOpenMarker));
  node.AppendChild(new ast.Node(ast.NodeYamlFrontMatterContent, tokens));
  node.AppendChild(new ast.Node(ast.NodeYamlFrontMatterCloseMarker));
};

Tree.prototype.parseYamlFrontMatter = function (this: Tree): boolean {
  const t = this;
  if (lex.ItemHyphen !== t.Context!.currentLine[0]) {
    return false;
  }

  let hyphenLength = 0;
  for (let i = 0; i < t.Context!.currentLineLen && lex.ItemHyphen === t.Context!.currentLine[i]; i++) {
    hyphenLength++;
  }
  return 3 === hyphenLength;
};

function isYamlFrontMatterClose(context: Context): boolean {
  if (context.ParseOption.KramdownBlockIAL && simpleCheckIsBlockIAL(context.currentLine)) {
    // Decide whether an IAL interrupts
    const ial = context.parseKramdownBlockIAL(context.currentLine);
    if (null !== ial && 0 < ial.length) {
      context.Tip!.ID = IAL2Map(ial).get("id") ?? "";
      context.Tip!.KramdownIAL = ial;
      context.Tip!.InsertAfter(new ast.Node(ast.NodeKramdownBlockIAL, context.currentLine));
      return true;
    }
  }

  if (lex.ItemHyphen !== context.currentLine[0]) {
    return false;
  }

  let hyphenLength = 0;
  for (let i = 0; i < context.currentLineLen && lex.ItemHyphen === context.currentLine[i]; i++) {
    hyphenLength++;
  }
  return 3 === hyphenLength;
}

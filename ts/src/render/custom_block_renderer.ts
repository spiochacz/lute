// Ported from render/custom_block_renderer.go @ 8e7896b6
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
import * as ast from "../ast/index.ts";
import * as html from "../html/index.ts";
import { BaseRenderer } from "./types.ts";
import { nodeTokens } from "./renderer.ts";

declare module "./types.ts" {
  interface BaseRenderer {
    renderCustomBlockFallback(node: ast.Node): void;
  }
}

export function customBlockDataAttrs(node: ast.Node): string[][] {
  return [
    ["data-info", html.EscapeHTMLStr(node.CustomBlockInfo)],
    ["data-content", conv.StringFromBytes(html.EscapeHTML(nodeTokens(node)))],
  ];
}

export function customBlockAttrs(node: ast.Node): string[][] {
  const attrs: string[][] = [["data-type", "NodeCustomBlock"]];
  return attrs.concat(customBlockDataAttrs(node));
}

BaseRenderer.prototype.renderCustomBlockFallback = function (this: BaseRenderer, node: ast.Node): void {
  const r = this;
  r.Tag("pre", null, false);
  BaseRenderer.prototype.Write.call(r, html.EscapeHTML(nodeTokens(node))); // PORT-NOTE: Go embedding, base method
  BaseRenderer.prototype.WriteString.call(r, "</pre>"); // PORT-NOTE: Go embedding, base method
};

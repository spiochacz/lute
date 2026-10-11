// Ported from render/textbundle_renderer.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as strings from "../runtime/strings.ts";
import * as ast from "../ast/index.ts";
import type * as parse from "../parse/index.ts";
import * as util from "../util/index.ts";
import { BaseRenderer, FormatRenderer } from "./types.ts";
import type { Options } from "./renderer.ts";
import { registerFormatRendererFuncs } from "./format_renderer.ts";

// PORT-NOTE: Go embedding with a different signature. TextBundleRenderer.Render returns two values while the embedded Render returns one, which a TypeScript
// subclass cannot declare. The base class is therefore typed as FormatRenderer without Render and renderLinkDest (the mapped type turns methods into properties, which a method may not override); at run time it is still a subclass of FormatRenderer.
type FormatRendererWithoutRender = Omit<FormatRenderer, "Render" | "renderLinkDest">;
const FormatRendererWithoutRenderBase = FormatRenderer as unknown as new (tree: parse.Tree, options: Options, parseOptions: parse.Options) => FormatRendererWithoutRender;

// TextBundleRenderer describes the TextBundle renderer. https://github.com/88250/lute/issues/77
//
// It inherits FormatRenderer and overrides the link destination render function renderLinkDest: if the URL is in the given link prefix list, it is replaced with assets/xxx, for example for the Markdown source:
//
//	[foo](https://img.hacpai.com/dir1/bar.zip)
//
//	![foo](https://b3logfile.com/dir2/baz.png)
//
// With the link prefix list ["https://img.hacpai.com", "https://b3logfile.com"], the rendering is:
//
//	[foo](assets/dir1/bar.zip)
//
//	![foo](assets/dir2/baz.png)
export class TextBundleRenderer extends FormatRendererWithoutRenderBase {
  linkPrefixes: string[]; // Link prefix list
  // PORT-NOTE: nil rule, Go leaves originalLink nil until the first link is replaced; the reference returns null to its callers then, so it is `string[] | null`.
  originalLink: string[] | null; // Original link list

  constructor(tree: parse.Tree, linkPrefixes: string[], options: Options, parseOptions: parse.Options) {
    super(tree, options, parseOptions);
    this.linkPrefixes = linkPrefixes;
    this.originalLink = null;
  }

  Render(): [Uint8Array, string[] | null] {
    const r = this;
    let output: Uint8Array = new Uint8Array(0);
    let originalLink: string[] | null = null;
    // PORT-NOTE: Go embedding, r.FormatRenderer.Render() is the promoted BaseRenderer.Render
    output = BaseRenderer.prototype.Render.call(r as unknown as BaseRenderer);
    originalLink = r.originalLink;
    return [output, originalLink];
  }

  renderLinkDest(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      let dest = util.BytesToStr(node.Tokens ?? new Uint8Array(0));
      for (const linkPrefix of r.linkPrefixes) {
        if ("" !== linkPrefix && strings.HasPrefix(dest, linkPrefix)) {
          if (null === r.originalLink) {
            r.originalLink = [];
          }
          r.originalLink.push(dest);
          // PORT-NOTE: byte offset, dest starts with linkPrefix, so its UTF-16 length is the same offset
          dest = "assets" + dest.slice(linkPrefix.length);
        }
      }
      r.WriteString(dest);
    }
    return ast.WalkContinue;
  }
}

// NewTextBundleRenderer creates a TextBundle renderer.
export function NewTextBundleRenderer(tree: parse.Tree, linkPrefixes: string[], options: Options, parseOptions: parse.Options): TextBundleRenderer {
  const ret = new TextBundleRenderer(tree, linkPrefixes, options, parseOptions);
  // PORT-NOTE: Go's NewFormatRenderer does these registrations on the embedded FormatRenderer
  registerFormatRendererFuncs(ret as unknown as FormatRenderer);
  ret.RendererFuncs.set(ast.NodeLinkDest, ret.renderLinkDest.bind(ret));
  return ret;
}

// Ported from vditor_sv.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as conv from "./runtime/conv.ts";
import * as strings from "./runtime/strings.ts";
import * as editor from "./editor/index.ts";
import * as parse from "./parse/index.ts";
import * as render from "./render/index.ts";
import { Lute } from "./types.ts";

declare module "./types.ts" {
  interface Lute {
    SpinVditorSVDOM(markdown: string): string;
    HTML2VditorSVDOM(sHTML: string): string;
    Md2VditorSVDOM(markdown: string): string;
  }
}

// SpinVditorSVDOM spins the Vditor Split-View DOM, used for editing in the split-view preview mode.
Lute.prototype.SpinVditorSVDOM = function (this: Lute, markdown: string): string {
  const lute = this;
  let ovHTML = "";
  // Special case for empty content
  if (editor.Caret === strings.TrimSpace(markdown)) {
    return "<span data-type=\"text\"><wbr></span>" + conv.StringFromBytes(render.NewlineSV);
  }

  const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);

  const renderer = render.NewVditorSVRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  const output = renderer.Render();
  // Replace the caret
  ovHTML = strings.ReplaceAll(conv.StringFromBytes(output), editor.Caret, "<wbr>");
  return ovHTML;
};

// HTML2VditorSVDOM converts HTML to Vditor Split-View DOM, used for pasting in the split-view preview mode.
Lute.prototype.HTML2VditorSVDOM = function (this: Lute, sHTML: string): string {
  const lute = this;
  let vHTML = "";
  const [markdown, err] = lute.HTML2Markdown(sHTML);
  if (null !== err) {
    vHTML = err.message;
    return vHTML;
  }

  const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);
  const renderer = render.NewVditorSVRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  for (const [nodeType, rendererFunc] of lute.HTML2VditorSVDOMRendererFuncs) {
    renderer.ExtRendererFuncs.set(nodeType, rendererFunc);
  }
  const output = renderer.Render();
  vHTML = conv.StringFromBytes(output);
  return vHTML;
};

// Md2VditorSVDOM converts markdown to Vditor Split-View DOM, used for switching from the source mode to the split-view preview mode.
Lute.prototype.Md2VditorSVDOM = function (this: Lute, markdown: string): string {
  const lute = this;
  let vHTML = "";
  const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);
  const renderer = render.NewVditorSVRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  for (const [nodeType, rendererFunc] of lute.Md2VditorSVDOMRendererFuncs) {
    renderer.ExtRendererFuncs.set(nodeType, rendererFunc);
  }
  const output = renderer.Render();
  // Replace the caret
  vHTML = strings.ReplaceAll(conv.StringFromBytes(output), editor.Caret, "<wbr>");
  return vHTML;
};

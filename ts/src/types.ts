// Ported from lute.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

// PORT-NOTE: this file holds only the class whose methods are spread over several files of the root package (see PORTING.md, "Structs whose methods live in several files").
// Lute has methods in lute.go, h2m.go, protyle.go, protyle_tabs.go, vditor_ir.go, vditor_sv.go and vditor_wysiwyg.go; those of lute.go are attached in lute.ts.
// It must not import another file of this package at runtime; `import type` is fine.

import type * as ast from "./ast/index.ts";
import type * as parse from "./parse/index.ts";
import type * as render from "./render/index.ts";

// Lute describes the top-level entry of the Lute engine.
export class Lute {
  ParseOptions: parse.Options; // Parse options. PORT-NOTE: Go's *parse.Options is never nil (New always sets it), so it is non-null here and the constructor requires it.
  RenderOptions: render.Options; // Render options. PORT-NOTE: same as ParseOptions.

  HTML2MdRendererFuncs: Map<ast.NodeType, render.ExtRendererFunc>; // User-defined HTML2Md renderer functions
  HTML2VditorDOMRendererFuncs: Map<ast.NodeType, render.ExtRendererFunc>; // User-defined HTML2VditorDOM renderer functions
  HTML2VditorIRDOMRendererFuncs: Map<ast.NodeType, render.ExtRendererFunc>; // User-defined HTML2VditorIRDOM renderer functions
  HTML2BlockDOMRendererFuncs: Map<ast.NodeType, render.ExtRendererFunc>; // User-defined HTML2BlockDOM renderer functions
  HTML2VditorSVDOMRendererFuncs: Map<ast.NodeType, render.ExtRendererFunc>; // User-defined HTML2VditorSVDOM renderer functions
  Md2HTMLRendererFuncs: Map<ast.NodeType, render.ExtRendererFunc>; // User-defined Md2HTML renderer functions
  Md2VditorDOMRendererFuncs: Map<ast.NodeType, render.ExtRendererFunc>; // User-defined Md2VditorDOM renderer functions
  Md2VditorIRDOMRendererFuncs: Map<ast.NodeType, render.ExtRendererFunc>; // User-defined Md2VditorIRDOM renderer functions
  Md2BlockDOMRendererFuncs: Map<ast.NodeType, render.ExtRendererFunc>; // User-defined Md2BlockDOM renderer functions
  Md2VditorSVDOMRendererFuncs: Map<ast.NodeType, render.ExtRendererFunc>; // User-defined Md2VditorSVDOM renderer functions

  constructor(parseOptions: parse.Options, renderOptions: render.Options) {
    this.ParseOptions = parseOptions;
    this.RenderOptions = renderOptions;
    this.HTML2MdRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
    this.HTML2VditorDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
    this.HTML2VditorIRDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
    this.HTML2BlockDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
    this.HTML2VditorSVDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
    this.Md2HTMLRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
    this.Md2VditorDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
    this.Md2VditorIRDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
    this.Md2BlockDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
    this.Md2VditorSVDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
  }
}

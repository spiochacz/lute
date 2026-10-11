// Ported from render/renderer.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

// PORT-NOTE: this file holds only the classes whose methods are spread over several files of the package (see PORTING.md, "Structs whose methods live in several files").
// BaseRenderer has methods in renderer.go, link.go, space.go, term_typographer.go, custom_block_renderer.go and tabs.go; HtmlRenderer in html_renderer.go and code_block_html_renderjs.go;
// FormatRenderer, ProtyleRenderer and ProtyleExportMdRenderer in their own renderer files and in tabs.go.
// It must not import another file of this package at runtime; `import type` is fine.

import * as bytes from "../runtime/bytes.ts";
import type * as ast from "../ast/index.ts";
import type * as parse from "../parse/index.ts";
import type { ExtRendererFunc, Options, RendererFunc } from "./renderer.ts";

// BaseRenderer describes the renderer structure.
export class BaseRenderer {
  Options: Options; // Render options
  ParseOptions: parse.Options; // Parse options
  // PERF-TODO: Go uses a map keyed by node type; an array indexed by node type and unbound methods (no per-renderer bind) were proposed, not done now.
  RendererFuncs: Map<ast.NodeType, RendererFunc>; // Renderers
  DefaultRendererFunc: RendererFunc | null; // Default renderer, used when no node renderer is found in RendererFuncs
  ExtRendererFuncs: Map<ast.NodeType, ExtRendererFunc>; // User-defined renderers
  Writer: bytes.Buffer; // Output buffer
  LastOut: number; // The latest output byte
  Tree: parse.Tree; // The tree to render
  DisableTags: number; // Tag nesting counter, used to detect cases where tags cannot nest, for example the syntax tree allows an image node to contain a link node, but HTML <img> cannot contain <a>
  FootnotesDefs: ast.Node[]; // Footnote definitions
  RenderingFootnotes: boolean; // Whether footnote definitions are being rendered
  tableCellRichInline: boolean; // The inline projection of rich text that a Markdown table outputs

  // The constructor does what Go's NewBaseRenderer does: it creates the tables and the output buffer.
  // PORT-NOTE: Go embedding, the HtmlRenderer constructor calls this one through super().
  constructor(tree: parse.Tree, options: Options, parseOptions: parse.Options) {
    this.Options = options;
    this.ParseOptions = parseOptions;
    this.RendererFuncs = new Map<ast.NodeType, RendererFunc>();
    this.DefaultRendererFunc = null;
    this.ExtRendererFuncs = new Map<ast.NodeType, ExtRendererFunc>();
    this.Writer = new bytes.Buffer();
    this.LastOut = 0;
    this.Tree = tree;
    this.DisableTags = 0;
    this.FootnotesDefs = [];
    this.RenderingFootnotes = false;
    this.tableCellRichInline = false;
    this.Writer.Grow(4096);
  }
}

// HtmlRenderer describes the HTML renderer.
// PORT-NOTE: Go embedding, `*BaseRenderer` becomes inheritance.
export class HtmlRenderer extends BaseRenderer {
  constructor(tree: parse.Tree, options: Options, parseOptions: parse.Options) {
    super(tree, options, parseOptions);
  }
}

// FormatRenderer describes the formatting renderer.
// PORT-NOTE: Go embedding, `*BaseRenderer` becomes inheritance.
export class FormatRenderer extends BaseRenderer {
  NodeWriterStack: bytes.Buffer[]; // Node output buffer stack
  tabsFenceLengths: Map<ast.Node, number> | null;

  constructor(tree: parse.Tree, options: Options, parseOptions: parse.Options) {
    super(tree, options, parseOptions);
    this.NodeWriterStack = [];
    this.tabsFenceLengths = null;
  }
}

// ProtyleExportMdRenderer describes the Protyle export Markdown renderer.
// PORT-NOTE: Go embedding, `*BaseRenderer` becomes inheritance.
export class ProtyleExportMdRenderer extends BaseRenderer {
  NodeWriterStack: bytes.Buffer[]; // Node output buffer stack
  tabsFormatter: FormatRenderer | null;

  constructor(tree: parse.Tree, options: Options, parseOptions: parse.Options) {
    super(tree, options, parseOptions);
    this.NodeWriterStack = [];
    this.tabsFormatter = null;
  }
}

// ProtyleRenderer describes the Protyle WYSIWYG Block DOM renderer.
// PORT-NOTE: Go embedding, `*BaseRenderer` becomes inheritance.
export class ProtyleRenderer extends BaseRenderer {
  NodeIndex: number;

  constructor(tree: parse.Tree, options: Options, parseOptions: parse.Options) {
    super(tree, options, parseOptions);
    this.NodeIndex = options.NodeIndexStart;
  }
}

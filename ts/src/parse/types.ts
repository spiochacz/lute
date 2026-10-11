// Ported from parse/parse.go @ 8e7896b6
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
// It must not import another file of this package at runtime; `import type` is fine.

import type * as ast from "../ast/index.ts";
import type * as lex from "../lex/index.ts";
import type { linkRefDef } from "./linkrefdef_index.ts";
import type { InlineContext, Options } from "./parse.ts";
import type { tabsParseState } from "./tabs.ts";

// Context maintains the common data used while parsing block-level elements.
export class Context {
  Tree: Tree | null; // Associated syntax tree
  ParseOption: Options; // Parse options. PORT-NOTE: Go's *Options is never nil in the Go code base (every `&Context{...}` literal sets it), so it is non-null here and the constructor requires it.

  Tip: ast.Node | null; // Tip node
  oldtip: ast.Node | null; // Old tip node
  currentLine: Uint8Array; // Current line
  currentLineLen: number; // Current line length
  offset: number; // Indexes, indentation columns and so on used while parsing
  column: number;
  nextNonspace: number;
  nextNonspaceColumn: number;
  indent: number;
  indented: boolean; // Flags: whether the line is indented, blank, and so on
  blank: boolean;
  partiallyConsumedTab: boolean;
  allClosed: boolean;
  lastMatchedContainer: ast.Node | null; // Last matched block node

  rootIAL: ast.Node | null; // Root node kramdown IAL
  tabs: Map<ast.Node, tabsParseState> | null; // Parse state of tab fences and the selected item. Nullable: Go checks `nil == context.tabs` and creates the map lazily
  tabsItemIAL: ast.Node | null; // Node that owns the attributes of the previous line's tab title

  constructor(ParseOption: Options) {
    this.Tree = null;
    this.ParseOption = ParseOption;
    this.Tip = null;
    this.oldtip = null;
    this.currentLine = new Uint8Array(0);
    this.currentLineLen = 0;
    this.offset = 0;
    this.column = 0;
    this.nextNonspace = 0;
    this.nextNonspaceColumn = 0;
    this.indent = 0;
    this.indented = false;
    this.blank = false;
    this.partiallyConsumedTab = false;
    this.allClosed = false;
    this.lastMatchedContainer = null;
    this.rootIAL = null;
    this.tabs = null;
    this.tabsItemIAL = null;
  }
}

// Tree describes the Markdown abstract syntax tree structure.
export class Tree {
  Root: ast.Node | null; // Root node
  Context: Context | null; // Block-level parse context
  lexer: lex.Lexer | null; // Lexer
  inlineContext: InlineContext | null; // Inline-level parse context

  Name: string; // Name
  ID: string; // ID
  Box: string; // Container
  Path: string; // Path
  HPath: string; // Human readable path
  Marks: string[]; // Text marks
  Created: number; // Creation time
  Updated: number; // Update time
  Hash: string; // Content hash

  // The fields below are used to lazily build the link reference definition and footnote definition indexes, so a lookup does not walk the whole syntax tree
  linkRefDefs: Map<string, linkRefDef>; // Simple-fold index of link reference definitions
  linkRefDefsFolded: Map<string, linkRefDef>; // Full-fold index of link reference definitions
  linkRefDefIndexed: boolean; // Whether the link reference definition index is built
  footnotesDefs: ast.Node[]; // Footnote definition index (document order)
  footnotesDefsIndex: boolean; // Whether the footnote definition index is built

  constructor() {
    this.Root = null;
    this.Context = null;
    this.lexer = null;
    this.inlineContext = null;
    this.Name = "";
    this.ID = "";
    this.Box = "";
    this.Path = "";
    this.HPath = "";
    this.Marks = [];
    this.Created = 0;
    this.Updated = 0;
    this.Hash = "";
    this.linkRefDefs = new Map();
    this.linkRefDefsFolded = new Map();
    this.linkRefDefIndexed = false;
    this.footnotesDefs = [];
    this.footnotesDefsIndex = false;
  }
}

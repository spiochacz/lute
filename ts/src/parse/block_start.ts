// Ported from parse/block_start.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import type * as ast from "../ast/index.ts";
import { BlockQueryEmbedStart } from "./block_query_embed.ts";
import { BlockquoteStart } from "./blockquote.ts";
import { CalloutStart } from "./callout.ts";
import { FenceCodeBlockStart, IndentCodeBlockStart } from "./code_block.ts";
import { CustomBlockStart } from "./custom_block.ts";
import { FootnotesStart } from "./footnotes.ts";
import { GitConflictStart } from "./gitconflict.ts";
import { ATXHeadingStart, SetextHeadingStart } from "./heading.ts";
import { HtmlBlockStart } from "./html_block.ts";
import { IALStart } from "./inline_attribute_list.ts";
import { ListStart } from "./list.ts";
import { MathBlockStart } from "./math_block.ts";
import { SuperBlockStart } from "./super_block.ts";
import { TabsStart } from "./tabs.ts";
import { ThematicBreakStart } from "./thematic_break.ts";
import type { Tree } from "./types.ts";
import { YamlFrontMatterStart } from "./yaml_front_matter.ts";

// blockStartsFuncs is the slice of defined block start pattern functions; each decides whether a kind of block node can start.
// The slice is read-only and referenced by every line parse, so the same slice is reused to avoid allocating it each time.
// Go initializes it in init() to avoid initialization-order cycles between package-level variables.
// PORT-NOTE: init() is run lazily by the first blockStarts() call, not at module load: the start functions live in other files of the package that may still be loading
// when this module is evaluated (circular imports), so reading the imported bindings at load time is not safe.
let blockStartsFuncs: blockStartFunc[] = [];

function init(): void {
  blockStartsFuncs = [
    GitConflictStart,
    TabsStart,
    CalloutStart,
    BlockquoteStart,
    ATXHeadingStart,
    FenceCodeBlockStart,
    CustomBlockStart,
    SetextHeadingStart,
    HtmlBlockStart,
    YamlFrontMatterStart,
    ThematicBreakStart,
    ListStart,
    MathBlockStart,
    IndentCodeBlockStart,
    FootnotesStart,
    IALStart,
    BlockQueryEmbedStart,
    SuperBlockStart,
  ];
}

// blockStarts returns the slice of block start pattern functions.
export function blockStarts(): blockStartFunc[] {
  if (0 === blockStartsFuncs.length) {
    init();
  }
  return blockStartsFuncs;
}

// blockStartFunc defines the signature of the function that decides whether a block starts. Return values:
//
//	0: no match
//	1: matched a container block, keep descending
//	2: matched a leaf block
export type blockStartFunc = (t: Tree, container: ast.Node) => number;

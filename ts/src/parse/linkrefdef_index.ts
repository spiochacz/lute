// Ported from parse/linkrefdef_index.go @ 8e7896b6
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
import * as strings from "../runtime/strings.ts";
import * as unicode from "../runtime/unicode.ts";
import * as utf8 from "../runtime/utf8.ts";
import * as ast from "../ast/index.ts";
import * as editor from "../editor/index.ts";
import { foldBytes } from "./linkrefdef_case_fold.ts";
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    indexLinkRefDefs(): void;
    indexFootnotesDefs(): void;
    FindLinkRefDefLink(label: Uint8Array): ast.Node | null;
    FindFootnotesDef(label: Uint8Array): [number, ast.Node | null];
  }
}

// linkRefDef keeps the document order of a definition, used to pick the first match across the case-insensitive indexes.
export class linkRefDef {
  order: number;
  link: ast.Node | null;

  constructor() {
    this.order = 0;
    this.link = null;
  }
}

// linkRefFoldKey builds a key with the smallest character in the simple case folding orbit, consistent with bytes.EqualFold.
export function linkRefFoldKey(tokens: Uint8Array): string {
  const key = new strings.Builder();
  key.Grow(tokens.length);
  // Go ranges over string(tokens): each invalid byte yields RuneError with width 1
  for (let i = 0; i < tokens.length;) {
    const v = utf8.DecodeRunePacked(tokens, i);
    let r = v & 0xFFFFFF;
    i += v >>> 24;
    if (0x61 /* a */ <= r && r <= 0x7a /* z */) {
      r -= 0x61 /* a */ - 0x41 /* A */;
    } else if (unicode.MaxASCII < r) {
      let minimum = r;
      for (let folded = unicode.SimpleFold(r); folded !== r; folded = unicode.SimpleFold(folded)) {
        if (folded < minimum) {
          minimum = folded;
        }
      }
      r = minimum;
    }
    key.WriteRune(r);
  }
  return key.String();
}

// indexLinkRefDefs lazily builds the link reference definition index, so a lookup does not walk the whole syntax tree.
Tree.prototype.indexLinkRefDefs = function (this: Tree): void {
  const t = this;
  if (t.linkRefDefIndexed) {
    return;
  }
  t.linkRefDefIndexed = true;
  t.linkRefDefs = new Map<string, linkRefDef>();
  t.linkRefDefsFolded = new Map<string, linkRefDef>();
  let order = 0;

  ast.Walk(t.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (entering && ast.NodeLinkRefDef === n.Type) {
      const def = new linkRefDef();
      def.order = order;
      def.link = n.FirstChild;
      // PORT-NOTE: n.Tokens is nil-safe in Go (range over string(nil) is empty); an empty array stands in for null
      let key = linkRefFoldKey(n.Tokens ?? new Uint8Array(0));
      if (!t.linkRefDefs.has(key)) {
        t.linkRefDefs.set(key, def);
      }
      key = linkRefFoldKey(foldBytes(n.Tokens ?? new Uint8Array(0)));
      if (!t.linkRefDefsFolded.has(key)) {
        t.linkRefDefsFolded.set(key, def);
      }
      order++;
    }
    return ast.WalkContinue;
  });
};

// indexFootnotesDefs lazily builds the footnote definition index (keeping document order), so a lookup does not walk the whole syntax tree.
Tree.prototype.indexFootnotesDefs = function (this: Tree): void {
  const t = this;
  if (t.footnotesDefsIndex) {
    return;
  }
  t.footnotesDefsIndex = true;

  ast.Walk(t.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (entering && ast.NodeFootnotesDef === n.Type) {
      t.footnotesDefs.push(n);
    }
    return ast.WalkContinue;
  });
};

Tree.prototype.FindLinkRefDefLink = function (this: Tree, label: Uint8Array): ast.Node | null {
  const t = this;
  let link: ast.Node | null = null;
  if (!t.Context!.ParseOption.LinkRef) {
    return link;
  }

  if (t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV || t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.ProtyleWYSIWYG) {
    label = bytes.ReplaceAll(label, editor.CaretTokens, new Uint8Array(0));
  }

  t.indexLinkRefDefs();
  if (0 === t.linkRefDefs.size) {
    return link;
  }
  const key = linkRefFoldKey(label);
  let first: linkRefDef = t.linkRefDefs.get(key) ?? new linkRefDef();
  let found = t.linkRefDefs.has(key);
  // Query the original text, the label-only full fold and the definition-only full fold separately, keeping all three matches and the document order.
  let def: linkRefDef | undefined = t.linkRefDefs.get(linkRefFoldKey(foldBytes(label)));
  if (undefined !== def && (!found || def.order < first.order)) {
    first = def;
    found = true;
  }
  def = t.linkRefDefsFolded.get(key);
  if (undefined !== def && (!found || def.order < first.order)) {
    first = def;
    found = true;
  }
  if (found) {
    return first.link;
  }
  return link;
};

Tree.prototype.FindFootnotesDef = function (this: Tree, label: Uint8Array): [number, ast.Node | null] {
  const t = this;
  let pos = 0;
  let def: ast.Node | null = null;
  pos = 0;
  if (null !== t.Context && (t.Context.ParseOption.VditorIR || t.Context.ParseOption.VditorSV || t.Context.ParseOption.VditorWYSIWYG || t.Context.ParseOption.ProtyleWYSIWYG)) {
    label = bytes.ReplaceAll(label, editor.CaretTokens, new Uint8Array(0));
  }

  t.indexFootnotesDefs();
  for (let i = 0; i < t.footnotesDefs.length; i++) {
    const n = t.footnotesDefs[i];
    if (bytes.EqualFold(n.Tokens ?? new Uint8Array(0), label)) {
      pos = i + 1;
      def = n;
      return [pos, def];
    }
  }
  return [pos, def];
};

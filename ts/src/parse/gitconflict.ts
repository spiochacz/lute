// Ported from parse/gitconflict.go @ 8e7896b6
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
import * as slices from "../runtime/slices.ts";
import * as ast from "../ast/index.ts";
import { Context, Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseGitConflict(): boolean;
  }
  interface Context {
    gitConflictFinalize(gitConflictBlock: ast.Node): void;
    isGitConflictClose(): boolean;
  }
}

const emptyTokens: Uint8Array = new Uint8Array(0);
const newlineTokens: Uint8Array = conv.BytesFromString("\n");
const gitConflictOpenTokens: Uint8Array = conv.BytesFromString("<<<<<<<");
const gitConflictCloseTokens: Uint8Array = conv.BytesFromString(">>>>>>>");

// GitConflictStart decides whether a Git conflict marker starts.
//   <<<<<<< HEAD
//   The original local content is here
//   =======
//   The pulled content is here
//   >>>>>>> feebfeb6bef44cf1384d51cdd7aef7e4197b8180
export function GitConflictStart(t: Tree, container: ast.Node): number {
  if (!t.Context!.ParseOption.GitConflict) {
    return 0;
  }

  if (t.Context!.indented) {
    return 0;
  }

  const ok = t.parseGitConflict();
  if (ok) {
    t.Context!.closeUnmatchedBlocks();
    t.Context!.addChild(ast.NodeGitConflict);
    return 2;
  }
  return 0;
}

export function GitConflictContinue(gitConflictBlock: ast.Node, context: Context): number {
  if (context.isGitConflictClose()) {
    context.finalize(gitConflictBlock);
    return 2;
  }
  return 0;
}

Context.prototype.gitConflictFinalize = function (this: Context, gitConflictBlock: ast.Node): void {
  const context = this;
  const tokens: Uint8Array = gitConflictBlock.Tokens ?? emptyTokens;
  const contentParts = bytes.Split(tokens, newlineTokens);
  const openMarkerTokens = null === gitConflictBlock.Tokens ? null : contentParts[0]; // Go: Split(nil, sep) is [nil]
  // Go: bytes.TrimSpace returns nil when the result is empty, and these are nodes' Tokens
  const content = slices.NilIfEmpty(bytes.TrimSpace(bytes.Join(contentParts.slice(1), newlineTokens)));
  const closeMarkerTokens = slices.NilIfEmpty(bytes.TrimSpace(context.currentLine));
  gitConflictBlock.Tokens = null;
  gitConflictBlock.AppendChild(new ast.Node(ast.NodeGitConflictOpenMarker, openMarkerTokens));
  gitConflictBlock.AppendChild(new ast.Node(ast.NodeGitConflictContent, content));
  gitConflictBlock.AppendChild(new ast.Node(ast.NodeGitConflictCloseMarker, closeMarkerTokens));
};

Tree.prototype.parseGitConflict = function (this: Tree): boolean {
  const t = this;
  return bytes.HasPrefix(t.Context!.currentLine, gitConflictOpenTokens);
};

Context.prototype.isGitConflictClose = function (this: Context): boolean {
  const context = this;
  return bytes.HasPrefix(context.currentLine, gitConflictCloseTokens);
};

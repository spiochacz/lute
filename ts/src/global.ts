// Ported from javascript/main.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

// PORT-NOTE: javascript/main.go sets the global `Lute` object with js.Global.Set. Here makeGlobal() builds and returns that object and does not assign it
// to globalThis; the bundle entry will do that.

import * as ast from "./ast/index.ts";
import * as editor from "./editor/index.ts";
import * as html from "./html/index.ts";
import * as render from "./render/index.ts";
import * as lute from "./lute.ts";
import type { JSRendererOptions } from "./lute.ts";

// LuteGlobal describes the members of the global Lute object of the JavaScript build.
export interface LuteGlobal {
  Version: string;
  New: (options?: JSRendererOptions | null) => lute.Lute;
  WalkStop: ast.WalkStatus;
  WalkSkipChildren: ast.WalkStatus;
  WalkContinue: ast.WalkStatus;
  GetHeadingID: (heading: ast.Node) => string;
  GetHeadingIDRaw: (heading: ast.Node) => string;
  Caret: string;
  NewNodeID: () => string;
  EscapeHTMLStr: (h: string) => string;
  UnEscapeHTMLStr: (h: string) => string;
  EChartsMindmapStr: (listContent: string) => string;
  Sanitize: (str: string) => string;
  BlockDOM2Content: (dom: string) => string;
}

// PORT-NOTE: in the JavaScript build of Go only the exported methods of *Lute are visible on the object that New returns (GopherJS exposes
// exported methods only). Here the unexported methods are attached to Lute.prototype as ordinary properties, so they would show up in a
// for...in loop or in Object.keys of a prototype walk. They are made non-enumerable once, when the global object is built, so that the
// enumerable function-valued members of an engine are the same as in the reference bundle. Calls through their names keep working.
let hideUnexportedMethods = true;

function hideUnexported(): void {
  if (!hideUnexportedMethods) {
    return;
  }
  hideUnexportedMethods = false;
  const proto = lute.Lute.prototype as unknown as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (/^[a-z]/.test(name) && typeof proto[name] === "function") {
      Object.defineProperty(proto, name, { enumerable: false });
    }
  }
}

export function makeGlobal(): LuteGlobal {
  hideUnexported();
  return {
    Version: lute.Version,
    New: New,
    WalkStop: ast.WalkStop,
    WalkSkipChildren: ast.WalkSkipChildren,
    WalkContinue: ast.WalkContinue,
    GetHeadingID: render.HeadingID,
    GetHeadingIDRaw: render.HeadingIDRaw,
    Caret: editor.Caret,
    NewNodeID: ast.NewNodeID,
    EscapeHTMLStr: html.EscapeHTMLStr,
    UnEscapeHTMLStr: html.UnescapeHTMLStr,
    EChartsMindmapStr: render.EChartsMindmapStr,
    Sanitize: render.Sanitize,
    BlockDOM2Content: BlockDOM2Content,
  };
}

function New(options?: JSRendererOptions | null): lute.Lute {
  const engine = lute.New();
  engine.SetJSRenderers(options);
  adaptMapMethods(engine);
  return engine;
}

// PORT-NOTE: GopherJS passes a Go map[string]string as a plain JavaScript object, in both directions. The engine methods of the port take and
// return Map<string, string> (PORTING.md: map[K]V is Map<K, V>). The engines that the global New returns, which JavaScript code uses, get these
// six methods as own properties that convert at the boundary; a Map is still accepted as an argument. The methods on Lute.prototype are unchanged.
function adaptMapMethods(engine: lute.Lute): void {
  const toMap = (o: Map<string, string> | Record<string, string>): Map<string, string> => (o instanceof Map ? o : new Map(Object.entries(o)));
  const toObject = (m: Map<string, string>): Record<string, string> => Object.fromEntries(m);
  const proto = lute.Lute.prototype;
  engine.GetEmojis = function (this: lute.Lute) {
    return toObject(proto.GetEmojis.call(this)) as unknown as Map<string, string>;
  };
  engine.GetTerms = function (this: lute.Lute) {
    return toObject(proto.GetTerms.call(this)) as unknown as Map<string, string>;
  };
  engine.PutEmojis = function (this: lute.Lute, emojiMap: Map<string, string>) {
    proto.PutEmojis.call(this, toMap(emojiMap));
  };
  engine.PutTerms = function (this: lute.Lute, termMap: Map<string, string>) {
    proto.PutTerms.call(this, toMap(termMap));
  };
  engine.SetEmojis = function (this: lute.Lute, emojis: Map<string, string>) {
    proto.SetEmojis.call(this, toMap(emojis));
  };
  engine.SetTerms = function (this: lute.Lute, terms: Map<string, string>) {
    proto.SetTerms.call(this, toMap(terms));
  };
}

function BlockDOM2Content(dom: string): string {
  const luteEngine = lute.New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.SetBlockRef(true);
  luteEngine.SetFileAnnotationRef(true);
  luteEngine.SetKramdownIAL(true);
  luteEngine.SetTag(true);
  luteEngine.SetSuperBlock(true);
  luteEngine.SetImgPathAllowSpace(true);
  luteEngine.SetGitConflict(true);
  luteEngine.SetMark(true);
  luteEngine.SetSup(true);
  luteEngine.SetSub(true);
  luteEngine.SetInlineMathAllowDigitAfterOpenMarker(true);
  luteEngine.SetFootnotes(false);
  luteEngine.SetToC(false);
  luteEngine.SetIndentCodeBlock(false);
  luteEngine.SetParagraphBeginningSpace(true);
  luteEngine.SetAutoSpace(false);
  luteEngine.SetHeadingID(false);
  luteEngine.SetSetext(false);
  luteEngine.SetYamlFrontMatter(false);
  luteEngine.SetLinkRef(false);
  luteEngine.SetCodeSyntaxHighlight(false);
  luteEngine.SetSanitize(true);
  return luteEngine.BlockDOM2Content(dom);
}

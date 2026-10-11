// Ported from parse/html_text_style.go @ 8e7896b6
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
import * as strconv from "../runtime/strconv.ts";
import * as strings from "../runtime/strings.ts";
import * as unicode from "../runtime/unicode.ts";
import * as utf8 from "../runtime/utf8.ts";
import * as ast from "../ast/index.ts";
import * as html from "../html/index.ts";
import * as atom from "../html/atom/index.ts";
import * as util from "../util/index.ts";
import { IAL2Tokens } from "./inline_attribute_list.ts";

// HTMLTextStyle only keeps the external styles that can be mapped to text marks, it carries no page layout or resource references.
export class HTMLTextStyle {
  Color: string;
  Background: string;
  Family: string;
  Size: number;
  SizeUnit: string;

  constructor() {
    this.Color = "";
    this.Background = "";
    this.Family = "";
    this.Size = 0;
    this.SizeUnit = "";
  }

  CSS(): string {
    const s = this;
    let ret = "";
    for (const pair of [["color", s.Color], ["background-color", s.Background], ["font-family", s.Family]]) {
      if (pair[1] !== "") {
        ret += pair[0] + ": " + pair[1] + ";";
      }
    }
    if (s.SizeUnit !== "") {
      ret += "font-size: " + strconv.FormatFloat(s.Size, "f", 6, 64) + s.SizeUnit + ";";
    }
    return ret;
  }
}

// PORT-NOTE: Go copies a struct with "s := parent"; a class instance needs an explicit copy. This helper is a port addition.
function copyHTMLTextStyle(parent: HTMLTextStyle): HTMLTextStyle {
  const s = new HTMLTextStyle();
  s.Color = parent.Color;
  s.Background = parent.Background;
  s.Family = parent.Family;
  s.Size = parent.Size;
  s.SizeUnit = parent.SizeUnit;
  return s;
}

// PORT-NOTE: Go compiles these with regexp (RE2). (?i) becomes the i flag together with the u flag: RE2 folds with Unicode simple case folding, so [a-z] also matches U+017F and U+212A, which only the iu flags do in JavaScript. Neither expression uses the m flag, so ^ and $ match only at the ends of the input.
const htmlTextColor = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|[a-z]+|(?:rgb|rgba|hsl|hsla)\([0-9.,%+ /-]+\))$/iu;
const htmlTextSize = /^([0-9]*\.?[0-9]+)(px|pt|pc|in|cm|mm|em|rem|%)$/u;

// PORT-NOTE: Go builds these lookup tables inside the functions on every call; they are module-level here.
const htmlFontSizeKeywords: string[] = ["", "x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large"];
const htmlFontSizeRatios: Map<string, number> = new Map([["xx-small", .6], ["x-small", .75], ["small", .888889], ["large", 1.2], ["x-large", 1.5], ["xx-large", 2], ["xxx-large", 3]]);
// PORT-NOTE: 96 / 2.54 and 96 / 25.4 are constant expressions in Go, evaluated exactly and rounded once; 4800 / 127 and 480 / 127 are the same rationals with exactly representable operands.
const htmlFontSizeUnitPixels: Map<string, number> = new Map([["pt", 96.0 / 72], ["pc", 16], ["in", 96], ["cm", 4800 / 127], ["mm", 480 / 127]]);

// HTMLStyleDeclarations splits declarations outside quotes and parentheses, keeping the priority of the same property.
export function HTMLStyleDeclarations(style: string): Map<string, string> {
  const ret = new Map<string, string>();
  const important = new Map<string, boolean>();
  let start = 0;
  let depth = 0;
  let quote = 0;
  let escaped = false;
  // PORT-NOTE: byte offset. Go ranges over style + ";" by byte index; i is a UTF-16 offset here, and every slice below uses offsets of the same loop.
  const full = style + ";";
  for (let i = 0; i < full.length;) {
    const packed = utf8.DecodeRuneInStringPacked(full, i);
    const c = packed & 0xffffff;
    const at = i;
    i += packed >>> 24;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === 0x5c /* \ */) {
      escaped = true;
      continue;
    }
    if (quote !== 0) {
      if (c === quote) {
        quote = 0;
      }
      continue;
    }
    if (c === 0x27 /* ' */ || c === 0x22 /* " */) {
      quote = c;
      continue;
    }
    if (c === 0x28 /* ( */) {
      depth++;
    }
    if (c === 0x29 /* ) */) {
      depth--;
    }
    if (c !== 0x3b /* ; */ || depth !== 0) {
      continue;
    }
    let [key, value, ok] = strings.Cut(style.slice(start, at), ":");
    start = at + 1;
    if (!ok) {
      continue;
    }
    key = strings.ToLower(strings.TrimSpace(key));
    value = strings.TrimSpace(value);
    let priority = false;
    const idx = strings.LastIndex(value, "!");
    if (idx >= 0 && strings.EqualFold(strings.TrimSpace(value.slice(idx + 1)), "important")) {
      priority = true;
      value = strings.TrimSpace(value.slice(0, idx));
    }
    // WPS uses the plain-colour background shorthand; after converting it to a background colour it is still handled in declaration order and priority.
    if (key === "background" && htmlTextColor.test(value)) {
      key = "background-color";
    }
    if (!(important.get(key) ?? false) || priority) {
      ret.set(key, value);
      important.set(key, priority);
    }
  }
  return ret;
}

// ResolveHTMLTextStyle computes relative font sizes against the parent; without an absolute base the em value relative to the editor font size is kept.
export function ResolveHTMLTextStyle(n: html.Node, parent: HTMLTextStyle): HTMLTextStyle {
  const s = copyHTMLTextStyle(parent);
  const rawStyle = util.DomAttrValue(n, "style");
  if (rawStyle === "" && n.DataAtom !== atom.Small && n.DataAtom !== atom.Font) {
    return s;
  }
  const decl = HTMLStyleDeclarations(rawStyle);
  if (n.DataAtom === atom.Font) {
    for (const pair of [["color", "color"], ["face", "font-family"]]) {
      if (!decl.has(pair[1])) {
        decl.set(pair[1], util.DomAttrValue(n, pair[0]));
      }
    }
    if (!decl.has("font-size")) {
      const [size, err] = strconv.Atoi(util.DomAttrValue(n, "size"));
      if (err === null && size >= 1 && size <= 7) {
        decl.set("font-size", htmlFontSizeKeywords[size]);
      }
    }
  }
  // PORT-NOTE: Go uses a *string field pointer; here dst names the field of s.
  const properties: { key: string; dst: "Color" | "Background" | "Family" }[] = [{ key: "color", dst: "Color" }, { key: "background-color", dst: "Background" }, { key: "font-family", dst: "Family" }];
  for (const property of properties) {
    const key = property.key;
    const dst = property.dst;
    let value = decl.get(key);
    if (value === undefined || value === "") {
      continue;
    }
    switch (strings.ToLower(value)) {
      case "inherit":
      case "unset":
        continue;
      case "initial":
      case "revert":
      case "revert-layer":
        s[dst] = "";
        continue;
      case "currentcolor":
        if (key === "color") {
          continue;
        }
        value = s.Color;
        break;
    }
    if (key === "font-family") {
      if (safeHTMLFontFamily(value)) {
        s[dst] = value;
      }
    } else if (htmlTextColor.test(value)) {
      s[dst] = value;
    }
  }
  let value = strings.ToLower(decl.get("font-size") ?? "");
  if (value === "" && n.DataAtom === atom.Small) {
    value = "smaller";
  }
  if (value !== "") {
    let base = parent.Size;
    let unit = parent.SizeUnit;
    if (unit === "") {
      base = 1;
      unit = "em";
    }
    switch (value) {
      case "inherit":
      case "unset":
        break;
      case "initial":
      case "medium":
      case "revert":
      case "revert-layer":
        s.Size = 1;
        s.SizeUnit = "rem";
        break;
      case "smaller":
        s.Size = base / 1.2;
        s.SizeUnit = unit;
        break;
      case "larger":
        s.Size = base * 1.2;
        s.SizeUnit = unit;
        break;
      default: {
        const ratio = htmlFontSizeRatios.get(value);
        if (ratio !== undefined) {
          s.Size = ratio;
          s.SizeUnit = "rem";
        } else {
          const match = htmlTextSize.exec(value);
          if (match !== null) {
            const [num] = strconv.ParseFloat(match[1], 64);
            if (num > 0 && num <= 10000) {
              switch (match[2]) {
                case "em":
                  s.Size = base * num;
                  s.SizeUnit = unit;
                  break;
                case "%":
                  s.Size = base * num / 100;
                  s.SizeUnit = unit;
                  break;
                case "rem":
                case "px":
                  s.Size = num;
                  s.SizeUnit = match[2];
                  break;
                default:
                  s.Size = num * htmlFontSizeUnitPixels.get(match[2])!;
                  s.SizeUnit = "px";
                  break;
              }
            }
          }
        }
        break;
      }
    }
  }
  return s;
}

// ApplyHTMLTextSemantics keeps the CSS emphasis and ancestor links of styled text, so combined formats are not lost when flattened.
export function ApplyHTMLTextSemantics(node: ast.Node, dom: html.Node): void {
  let weight = "";
  let italic = "";
  for (let p: html.Node | null = dom; p !== null; p = p.Parent) {
    const decl = HTMLStyleDeclarations(util.DomAttrValue(p, "style"));
    if (weight === "") {
      weight = strings.ToLower(decl.get("font-weight") ?? "");
    }
    if (italic === "") {
      italic = strings.ToLower(decl.get("font-style") ?? "");
    }
    const decoration = (decl.get("text-decoration") ?? "") + " " + (decl.get("text-decoration-line") ?? "");
    for (const pair of [["underline", "u"], ["line-through", "s"]]) {
      if (strings.Contains(decoration, pair[0]) && !node.ContainTextMarkTypes(pair[1])) {
        node.TextMarkType += " " + pair[1];
      }
    }
  }
  const [numericWeight] = strconv.Atoi(weight);
  if ((weight === "bold" || weight === "bolder" || numericWeight >= 600) && !node.ContainTextMarkTypes("strong")) {
    node.TextMarkType += " strong";
  }
  if ((italic === "italic" || strings.HasPrefix(italic, "oblique")) && !node.ContainTextMarkTypes("em")) {
    node.TextMarkType += " em";
  }
}

export function safeHTMLFontFamily(value: string): boolean {
  // PORT-NOTE: byte offset. len(value) is a byte count.
  if (utf8.ByteLen(value) > 1024) {
    return false;
  }
  let quote = 0;
  for (let i = 0; i < value.length;) {
    const packed = utf8.DecodeRuneInStringPacked(value, i);
    const c = packed & 0xffffff;
    i += packed >>> 24;
    if (c === 0x27 /* ' */ || c === 0x22 /* " */) {
      if (quote === c) {
        quote = 0;
      } else if (quote === 0) {
        quote = c;
      }
      continue;
    }
    if (!unicode.IsLetter(c) && !unicode.IsDigit(c) && !unicode.IsSpace(c) && c !== 0x2d /* - */ && c !== 0x5f /* _ */ && c !== 0x2c /* , */) {
      return false;
    }
  }
  return quote === 0;
}

export function HTMLNodeTextStyle(n: html.Node): HTMLTextStyle {
  const parents: html.Node[] = [];
  for (let p: html.Node | null = n; p !== null; p = p.Parent) {
    parents.push(p);
  }
  let s = new HTMLTextStyle();
  for (let i = parents.length - 1; i >= 0; i--) {
    s = ResolveHTMLTextStyle(parents[i], s);
  }
  return s;
}

// ApplyHTMLTextStyle attaches the style to the native text mark, keeping the data of links and combined formats.
export function ApplyHTMLTextStyle(n: ast.Node, style: string): void {
  if (style === "") {
    return;
  }
  if (!ensureHTMLTextMark(n)) {
    return;
  }
  n.SetIALAttr("style", style);
  if (n.Next !== null && n.Next.Type === ast.NodeKramdownSpanIAL) {
    n.Next.Tokens = IAL2Tokens(n.KramdownIAL);
  } else {
    n.InsertAfter(new ast.Node(ast.NodeKramdownSpanIAL, IAL2Tokens(n.KramdownIAL)));
  }
}

export function ensureHTMLTextMark(n: ast.Node): boolean {
  switch (n.Type) {
    case ast.NodeText:
    case ast.NodeLinkText:
    case ast.NodeHTMLEntity:
      if (n.ParentIs(ast.NodeImage)) {
        return false;
      }
      n.TextMarkType = "text";
      n.TextMarkTextContent = conv.StringFromBytes(html.EscapeHTML(n.Tokens ?? new Uint8Array(0)));
      n.Tokens = null;
      n.Type = ast.NodeTextMark;
      break;
    case ast.NodeTextMark:
      break;
    default:
      return false;
  }
  for (let p: ast.Node | null = n.Parent; p !== null && !p.IsBlock(); p = p.Parent) {
    if (p.Type === ast.NodeLink) {
      if (!n.ContainTextMarkTypes("a")) {
        n.TextMarkType = "a " + n.TextMarkType;
      }
      const dest = p.ChildByType(ast.NodeLinkDest);
      if (dest !== null) {
        n.TextMarkAHref = dest.TokensStr();
      }
      const title = p.ChildByType(ast.NodeLinkTitle);
      if (title !== null) {
        n.TextMarkATitle = title.TokensStr();
      }
    }
  }
  return true;
}

// Ported from util/html.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

// PORT-NOTE: Go's nil *html.Node is null here. Functions whose Go code checks `nil == n`
// take `html.Node | null`; the others dereference n as Go does, so a nil node throws a
// TypeError where Go panics.

import * as editor from "../editor/index.ts";
import * as html from "../html/index.ts";
import * as atom from "../html/atom/index.ts";
import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";
import * as strings from "../runtime/strings.ts";

// zwspBytes is the bytes of editor.Zwsp, computed once.
const zwspBytes: Uint8Array = conv.BytesFromString(editor.Zwsp);

// PORT-NOTE: a document that starts with <!DOCTYPE html> has a doctype node as its first child,
// and that node's Data is "html" too. So for input such as "<!DOCTYPE html><p>x</p>" Go takes
// the doctype's LastChild, which is nil, and ParseHTML returns nil. The port keeps that result.
export function ParseHTML(htmlStr: string): html.Node | null {
  const reader: Uint8Array = conv.BytesFromString(htmlStr);
  const [doc, err] = html.Parse(reader);
  if (null !== err) {
    return null;
  }
  if ("html" !== doc!.FirstChild!.Data) {
    return doc;
  }
  return doc!.FirstChild!.LastChild;
}

export function GetTextMarkTextDataWithoutEscapeQuote(n: html.Node | null): string {
  let content: string = "";
  content = DomText(n);
  content = strings.ReplaceAll(content, editor.Zwsp, "");
  content = strings.TrimSuffix(content, "\n");
  content = html.EscapeHTMLStr(content);
  // Double quotes in inline elements are no longer converted to entities when pasting Markdown https://github.com/siyuan-note/siyuan/issues/14503
  content = strings.ReplaceAll(content, "&quot;", '"');
  while (strings.Contains(content, "\n\n")) {
    content = strings.ReplaceAll(content, "\n\n", "\n");
  }
  return content;
}

export function GetTextMarkTextData(n: html.Node | null): string {
  let content: string = "";
  content = GetTextMarkTextDataWithoutEscapeQuote(n);
  content = strings.TrimPrefix(content, "\n");
  content = strings.ReplaceAll(content, "'", "&apos;");
  while (strings.Contains(content, "\n\n")) {
    content = strings.ReplaceAll(content, "\n\n", "\n");
  }
  return content;
}

export function GetTextMarkInlineMemoData(n: html.Node | null): string {
  let content: string = "";
  content = DomAttrValue(n, "data-inline-memo-content");
  content = strings.ReplaceAll(content, editor.Zwsp, "");
  content = strings.ReplaceAll(content, "\n", editor.IALValEscNewLine);
  content = html.UnescapeHTMLStr(content);
  return content;
}

export function GetTextMarkAData(n: html.Node | null): [string, string] {
  let href: string = "";
  let title: string = "";
  href = DomAttrValue(n, "data-href");
  href = html.EscapeHTMLStr(href);
  title = DomAttrValue(n, "data-title");
  title = html.EscapeHTMLStr(title);
  // < and > are not escaped, which conforms to the Markdown specification https://github.com/siyuan-note/siyuan/issues/15023
  title = strings.ReplaceAll(title, "&amp;lt;", "<");
  title = strings.ReplaceAll(title, "&amp;gt;", ">");
  return [href, title];
}

export function GetTextMarkInlineMathData(n: html.Node | null): string {
  let content: string = "";
  content = DomAttrValue(n, "data-content");
  content = strings.ReplaceAll(content, "\n", editor.IALValEscNewLine);
  content = html.UnescapeHTMLStr(content);
  content = strings.ReplaceAll(content, editor.Zwsp, "");
  return content;
}

export function GetTextMarkBlockRefData(n: html.Node | null): [string, string] {
  let id: string = "";
  let subtype: string = "";
  id = DomAttrValue(n, "data-id");
  subtype = DomAttrValue(n, "data-subtype");
  if ("" === subtype) {
    subtype = "s";
  }
  return [id, subtype];
}

export function GetTextMarkFileAnnotationRefData(n: html.Node | null): string {
  let id: string = "";
  id = DomAttrValue(n, "data-id");
  return id;
}

export function GetFormula(n: html.Node | null): string {
  if (null === n) {
    return "";
  }

  {
    const ret = strings.TrimSpace(DomAttrValue(n, "data-tex"));
    if ("" !== ret) {
      return ret;
    }
  }

  for (let c = n.FirstChild; null !== c; c = c.NextSibling) {
    const ret = GetFormula(c);
    if ("" !== ret) {
      return ret;
    }
  }
  return "";
}

// PORT-NOTE: Go's parameter `class` is a reserved word in TypeScript, so it is named cls.
export function DomChildByTypeAndClass(n: html.Node | null, dataAtom: atom.Atom, ...cls: string[]): html.Node | null {
  if (null === n) {
    return null;
  }

  if (n.DataAtom === dataAtom) {
    for (const c of cls) {
      if (strings.Contains(DomAttrValue(n, "class"), c)) {
        return n;
      }
    }
  }
  for (let c = n.FirstChild; null !== c; c = c.NextSibling) {
    const ret = DomChildByTypeAndClass(c, dataAtom, ...cls);
    if (null !== ret) {
      return ret;
    }
  }
  return null;
}

// PERF-TODO: each recursion level copies the descendants of its children into its own
// result, so a deep subtree is copied once per level of depth.
export function DomChildrenByType(n: html.Node, dataAtom: atom.Atom): html.Node[] {
  let ret: html.Node[] = [];
  // Walk all child nodes recursively.
  for (let c = n.FirstChild; null !== c; c = c.NextSibling) {
    if (c.DataAtom === dataAtom) {
      ret.push(c);
    }
    for (const d of DomChildrenByType(c, dataAtom)) {
      ret.push(d);
    }
  }
  return ret;
}

export function DomExistChildByType(n: html.Node | null, ...dataAtom: atom.Atom[]): boolean {
  if (null === n) {
    return false;
  }

  for (const a of dataAtom) {
    if (null !== domChildByType(n, a)) {
      return true;
    }
  }

  for (let c = n.FirstChild; null !== c; c = c.NextSibling) {
    if (DomExistChildByType(c, ...dataAtom)) {
      return true;
    }
  }
  return false;
}

function domChildByType(n: html.Node, dataAtom: atom.Atom): html.Node | null {
  for (let c = n.FirstChild; null !== c; c = c.NextSibling) {
    if (c.DataAtom === dataAtom) {
      return c;
    }
  }
  return null;
}

// PORT-NOTE: Go returns nil for a nil node. Here the empty array is returned for it, because
// no caller of the Go function compares the result with nil.
export function DomHTML(n: html.Node | null): Uint8Array {
  if (null === n) {
    return new Uint8Array(0);
  }

  const buf = new bytes.Buffer();
  html.Render(buf, n);
  return bytes.ReplaceAll(buf.Bytes(), zwspBytes, new Uint8Array(0));
}

export function DomTexhtml(n: html.Node | null): string {
  if (null === n) {
    return "";
  }

  const buf = new bytes.Buffer();
  if (html.TextNode === n.Type) {
    buf.WriteString(n.Data);
    return buf.String();
  }
  for (let child = n.FirstChild; null !== child; child = child.NextSibling) {
    domTexhtml0(child, buf);
  }
  return buf.String();
}

function domTexhtml0(n: html.Node | null, buffer: bytes.Buffer): void {
  if (null === n) {
    return;
  }

  switch (n.DataAtom) {
    case 0:
      buffer.WriteString(escapeMathSymbol(n.Data));
      break;
    case atom.Sup:
      buffer.WriteString("^{");
      break;
    case atom.Sub:
      buffer.WriteString("_{");
      break;
  }

  for (let child = n.FirstChild; null !== child; child = child.NextSibling) {
    domTexhtml0(child, buffer);
  }

  switch (n.DataAtom) {
    case atom.Sup:
      buffer.WriteString("}");
      break;
    case atom.Sub:
      buffer.WriteString("}");
      break;
  }
}

function escapeMathSymbol(s: string): string {
  // Escape the symbols of a Tex formula, such as _ ^ { }.
  s = strings.ReplaceAll(s, "_", "\\_");
  s = strings.ReplaceAll(s, "^", "\\^");
  s = strings.ReplaceAll(s, "{", "\\{");
  s = strings.ReplaceAll(s, "}", "\\}");
  return s;
}

export function DomText(n: html.Node | null): string {
  if (null === n) {
    return "";
  }

  const buf = new bytes.Buffer();
  if (html.TextNode === n.Type) {
    buf.WriteString(n.Data);
    return buf.String();
  }
  // PORT-NOTE: perf, departs from 1:1 (util/html.go:235, DomText): the buffer starts at 256 bytes, so the text of a typical element is written without the 0 -> 64 -> 128 reallocations. Only the string result is returned, so its capacity is not observable.
  buf.Grow(256);
  for (let child = n.FirstChild; null !== child; child = child.NextSibling) {
    domText0(child, buf);
  }
  return buf.String();
}

function domText0(n: html.Node | null, buffer: bytes.Buffer): void {
  if (null === n) {
    return;
  }
  if (html.CommentNode === n.Type) {
    return;
  }

  {
    const dataRender = DomAttrValue(n, "data-render");
    if ("1" === dataRender || "2" === dataRender) {
      return;
    }
  }

  if ("svg" === n.Namespace) {
    return;
  }

  let isTempMark = false;
  if (0 === n.DataAtom && html.ElementNode === n.Type) {
    // It may be a custom tag.
    const parent = n.Parent;
    if (null === parent) {
      return;
    }
    if (atom.Span !== parent.DataAtom) {
      return;
    }

    if (!IsTempMarkSpan(parent)) {
      // The search highlight marks in Protyle are kept https://github.com/siyuan-note/siyuan/issues/9821
      return;
    }

    isTempMark = true;
  }

  switch (n.DataAtom) {
    case 0:
      if (isTempMark) {
        buffer.WriteString("<" + n.Data + ">");
      } else {
        buffer.WriteString(n.Data);
      }
      break;
    case atom.Br:
      buffer.WriteString("\n");
      break;
    case atom.P:
      buffer.WriteString("\n\n");
      break;
  }

  for (let child = n.FirstChild; null !== child; child = child.NextSibling) {
    domText0(child, buffer);
  }
}

export function IsTempMarkSpan(n: html.Node): boolean {
  const dataType = DomAttrValue(n, "data-type");
  return "search-mark" === dataType || "virtual-block-ref" === dataType;
}

export function SetDomAttrValue(n: html.Node | null, attrName: string, attrVal: string): void {
  if (null === n) {
    return;
  }

  for (const attr of n.Attr) {
    if (attr.Key === attrName) {
      attr.Val = attrVal;
      return;
    }
  }

  const attr = new html.Attribute();
  attr.Key = attrName;
  attr.Val = attrVal;
  n.Attr.push(attr);
}

// PORT-NOTE: Go removes the attribute with append(n.Attr[:i], n.Attr[i+1:]...), which shifts
// the elements in place. splice does the same on the array of n.Attr.
export function RemoveDomAttr(n: html.Node | null, attrName: string): void {
  if (null === n) {
    return;
  }

  for (let i = 0; i < n.Attr.length; i++) {
    const attr = n.Attr[i];
    if (attr.Key === attrName) {
      n.Attr.splice(i, 1);
      return;
    }
  }
}

export function RemoveDomAttrs(n: html.Node | null): void {
  if (null === n) {
    return;
  }

  n.Attr = [];
}

export function DomAttrValue(n: html.Node | null, attrName: string): string {
  if (null === n) {
    return "";
  }

  for (const attr of n.Attr) {
    if (attr.Key === attrName) {
      return attr.Val;
    }
  }
  return "";
}

export function ExistDomAttr(n: html.Node | null, attrName: string): boolean {
  if (null === n) {
    return false;
  }

  for (const attr of n.Attr) {
    if (attr.Key === attrName) {
      return true;
    }
  }
  return false;
}

export function DomCustomAttrs(n: html.Node | null): Map<string, string> | null {
  if (null === n) {
    return null;
  }

  let ret: Map<string, string> = new Map<string, string>();
  for (const attr of n.Attr) {
    if (strings.HasPrefix(attr.Key, "custom-")) {
      ret.set(attr.Key, attr.Val);
    }
  }
  if (1 > ret.size) {
    return null;
  }
  return ret;
}

export function DomAttrValuesWithPrefix(n: html.Node | null, prefix: string): Map<string, string> | null {
  if (null === n) {
    return null;
  }

  let ret: Map<string, string> = new Map<string, string>();
  for (const attr of n.Attr) {
    if (strings.HasPrefix(attr.Key, prefix)) {
      ret.set(attr.Key, attr.Val);
    }
  }

  if (1 > ret.size) {
    return null;
  }
  return ret;
}

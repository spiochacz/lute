// Scratch copies of searchEmptyNodes (variants). Each is a function (lute, n, out).
import { html, util, editor } from "./common.ts";
import * as atom from "../../src/html/atom/index.ts";
import * as strings from "../../src/runtime/strings.ts";
import type { Lute } from "../../src/index.ts";

// COPY: verbatim body of Lute.prototype.searchEmptyNodes (ts/src/vditor_wysiwyg.ts:835-970)
export function search(lute: Lute, n: html.Node, emptyNodes: html.Node[]): void {
  const aa = n.DataAtom;
  if (aa === atom.Code || aa === atom.Pre || aa === atom.P || aa === atom.Div) { if ("katex" === util.DomAttrValue(n, "class")) { emptyNodes.push(n); } } else switch (aa) {
    case 0: {
      if (lute.isInline(n.PrevSibling) || lute.isInline(n.NextSibling) || lute.isInline(n.Parent)) {
        if (html.TextNode === n.Type && null !== n.PrevSibling && atom.Strong === n.PrevSibling.DataAtom) {
          let data = strings.TrimPrefix(n.Data, editor.Zwsp);
          data = strings.TrimSuffix(data, editor.Zwsp);
          n.Data = data;
        }
        break;
      }
      if (html.TextNode === n.Type) {
        let data = strings.TrimLeft(n.Data, " ");
        data = strings.TrimRight(data, " ");
        while (strings.Contains(data, "\n\n")) { data = strings.ReplaceAll(data, "\n\n", ""); }
        if ("" === data) { emptyNodes.push(n); return; }
      }
      const parent = n.Parent;
      if (null !== parent && (atom.Ol === parent.DataAtom || atom.Ul === parent.DataAtom || atom.Li === parent.DataAtom)) {
        if (null === n.NextSibling || (html.TextNode === n.NextSibling.Type || atom.Ul === n.NextSibling.DataAtom) || "" === strings.TrimSpace(n.Data)) {
          n.Data = strings.TrimRight(n.Data, "\n\t ");
        }
      }
      if (null !== parent && (atom.Table === parent.DataAtom || atom.Thead === parent.DataAtom || atom.Tbody === parent.DataAtom || atom.Tr === parent.DataAtom)) {
        n.Data = strings.TrimSpace(n.Data);
      }
      if ("" === n.Data) { emptyNodes.push(n); }
      if (html.CommentNode === n.Type) { emptyNodes.push(n); }
      break;
    }
    case atom.Span: {
      const lc = n.LastChild;
      if (null !== lc && atom.Br === lc.DataAtom) { n.InsertAfter(lc); }
      if (util.IsTempMarkSpan(n)) {
        emptyNodes.push(n);
        const children: html.Node[] = [];
        for (let c = n.FirstChild; c !== null; c = c.NextSibling) { children.push(c); }
        for (const c of children) { n.InsertBefore(c); }
        return;
      }
      break;
    }
    case atom.Strong: case atom.B: case atom.Em: case atom.I: case atom.Del: case atom.S: case atom.Strike: case atom.Mark: {
      if (null !== n.FirstChild) {
        if (atom.Br === n.FirstChild.DataAtom) { emptyNodes.push(n.FirstChild); n.InsertBefore(newHTMLNode(html.ElementNode, atom.Br, "br")); }
        if (html.TextNode === n.FirstChild.Type) {
          const text = n.FirstChild.Data;
          const spaces = lute.prefixSpaces(text);
          if ("" !== spaces) { n.FirstChild.Data = editor.Zwsp + n.FirstChild.Data; }
        }
      }
      if (null !== n.LastChild) {
        if (atom.Br === n.LastChild.DataAtom) { emptyNodes.push(n.LastChild); n.InsertAfter(newHTMLNode(html.ElementNode, atom.Br, "br")); }
        if (html.TextNode === n.LastChild.Type) {
          const text = n.LastChild.Data;
          const spaces = lute.suffixSpaces(text);
          if ("" !== spaces) { n.FirstChild!.Data = n.FirstChild!.Data + editor.Zwsp; }
        }
      }
      break;
    }
    default: {
      if ("katex" === util.DomAttrValue(n, "class")) { emptyNodes.push(n); }
    }
  }
  for (let c = n.FirstChild; c !== null; c = c.NextSibling) { search(lute, c, emptyNodes); }
  switch (n.DataAtom) {
    case atom.Ol: case atom.Ul: {
      const dataType = util.DomAttrValue(n, "data-type");
      if ("footnotes-defs-ol" === dataType) { return; }
      if (null !== n.FirstChild && null !== n.FirstChild.FirstChild && atom.Input !== n.FirstChild.FirstChild.DataAtom) { return; }
      const text = util.DomText(n);
      if ("" === text) { emptyNodes.push(n); }
      break;
    }
  }
}
function newHTMLNode(type: html.NodeType, dataAtom: atom.Atom, data: string): html.Node {
  const ret = new html.Node(); ret.Type = type; ret.DataAtom = dataAtom; ret.Data = data; return ret;
}

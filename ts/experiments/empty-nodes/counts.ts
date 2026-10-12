import { lute, loadRaw, freshDom, html, util } from "./common.ts";
import * as atomNs from "../../src/html/atom/index.ts";
import * as strings from "../../src/runtime/strings.ts";
const atom = atomNs;
const pre = loadRaw();
const root = freshDom(pre);
let calls = 0, maxDepth = 0, depth = 0, pushes = 0;
const byAtom = new Map<number, number>(); const branch: Record<string, number> = {};
let strOps = 0, strLen = 0, textNodes = 0, textLen = 0; const lens: number[] = [];
let shapes = new Set<string>();
const b = (k: string) => (branch[k] = (branch[k] ?? 0) + 1);
function s(n: html.Node, out: html.Node[]) {
  calls++; depth++; if (depth > maxDepth) maxDepth = depth;
  byAtom.set(n.DataAtom, (byAtom.get(n.DataAtom) ?? 0) + 1);
  shapes.add(Object.keys(n).join(","));
  switch (n.DataAtom) {
    case 0:
      b("atom0 type=" + n.Type);
      if (lute.isInline(n.PrevSibling) || lute.isInline(n.NextSibling) || lute.isInline(n.Parent)) { b("0:inlineKeep"); if (html.TextNode === n.Type && null !== n.PrevSibling && atom.Strong === n.PrevSibling.DataAtom) { b("0:strongPrevTrim"); strOps += 2; } break; }
      if (html.TextNode === n.Type) {
        textNodes++; textLen += n.Data.length; lens.push(n.Data.length);
        strOps += 2; let data = strings.TrimLeft(n.Data, " "); data = strings.TrimRight(data, " ");
        if (strings.Contains(data, "\n\n")) b("0:hasDoubleNL"); strOps++;
        while (strings.Contains(data, "\n\n")) data = strings.ReplaceAll(data, "\n\n", "");
        if ("" === data) { b("0:textEmptyPush"); pushes++; out.push(n); depth--; return; }
        b("0:textNonEmpty");
      }
      const parent = n.Parent;
      if (parent && (atom.Ol === parent.DataAtom || atom.Ul === parent.DataAtom || atom.Li === parent.DataAtom)) { b("0:listParent"); strOps += 2; n.Data = strings.TrimRight(n.Data, "\n\t "); }
      if (parent && (atom.Table === parent.DataAtom || atom.Thead === parent.DataAtom || atom.Tbody === parent.DataAtom || atom.Tr === parent.DataAtom)) { b("0:tableParent"); n.Data = strings.TrimSpace(n.Data); }
      if ("" === n.Data) { pushes++; out.push(n); b("0:emptyPush"); }
      if (html.CommentNode === n.Type) { pushes++; out.push(n); b("0:comment"); }
      break;
    case atom.Span: b("span"); break;
    case atom.Strong: case atom.B: case atom.Em: case atom.I: case atom.Del: case atom.S: case atom.Strike: case atom.Mark: b("inlineMark"); break;
    default: b("default"); if ("katex" === util.DomAttrValue(n, "class")) { pushes++; out.push(n); b("katex"); }
  }
  for (let c = n.FirstChild; c !== null; c = c.NextSibling) s(c, out);
  switch (n.DataAtom) { case atom.Ol: case atom.Ul: b("listPost"); const t = util.DomText(n); b("listPost textlen>0:" + (t !== "")); strLen += t.length; }
  depth--;
}
const out: html.Node[] = [];
for (let c: html.Node | null = root; c !== null; c = c.NextSibling) s(c, out);
console.log({ calls, maxDepth, pushes, textNodes, textLen, shapes: shapes.size, shapeKeys: [...shapes][0] });
console.log(branch);
console.log("listPost DomText total chars", strLen);
lens.sort((a, b) => a - b); console.log("text len p50/p90/max", lens[lens.length >> 1], lens[(lens.length * .9) | 0], lens[lens.length - 1]);
const names: any = atom; const inv = new Map<number, string>(); for (const k of Object.keys(names)) if (typeof names[k] === "number") inv.set(names[k], k);
console.log([...byAtom].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([a, c]) => (inv.get(a) ?? a) + ":" + c).join(" "));
console.log("root children", (() => { let k = 0; for (let c = root.FirstChild; c; c = c.NextSibling) k++; return k; })(), "top-level calls to removeEmptyNodes loop:", (() => { let k = 0; for (let c: html.Node | null = root; c; c = c.NextSibling) k++; return k; })());

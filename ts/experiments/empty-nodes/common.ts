import { readFileSync } from "node:fs";
import { New, vditorDOM2MdPreprocess, editor, util, html } from "../../src/index.ts";
export { html, util, editor };
export const lute = New();
const here = new URL(".", import.meta.url);
export function loadRaw(file = "spec.wysiwyg.html"): string {
  const raw = readFileSync(new URL(file, here), "utf8").split(editor.Zwsp).join("");
  return vditorDOM2MdPreprocess(raw);
}
export function freshDom(pre: string): html.Node { return util.ParseHTML(pre)!; }
export function serialize(root: html.Node): string {
  // deterministic dump of the whole tree including Data, attrs
  const out: string[] = [];
  const walk = (n: html.Node | null, d: number) => {
    for (let c = n; c !== null; c = c.NextSibling) {
      out.push(d + "|" + c.Type + "|" + c.DataAtom + "|" + JSON.stringify(c.Data) + "|" + c.Attr.map((a) => a.Key + "=" + a.Val).join(",") );
      walk(c.FirstChild, d + 1);
    }
  };
  walk(root, 0);
  return out.join("\n");
}

import { loadRaw, freshDom, html } from "./common.ts";
const root = freshDom(loadRaw());
let shown = 0; const seen = new Set<string>();
const w = (n: html.Node) => { if (n.Attr.length && shown < 3) { shown++; (globalThis as any).dp?.(n.Attr[0].Key); } for (let c = n.FirstChild; c; c = c.NextSibling) w(c); };
w(root);

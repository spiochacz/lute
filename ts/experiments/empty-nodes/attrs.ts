import { loadRaw, freshDom, html } from "./common.ts";
const root = freshDom(loadRaw());
const hist = new Map<number, number>(); const keys = new Map<string, number>(); let iters = 0, keyEq = 0, lenEq = 0, nodes = 0;
const w = (n: html.Node) => { nodes++; if (n.DataAtom !== 0 && n.DataAtom !== 0) { hist.set(n.Attr.length, (hist.get(n.Attr.length) ?? 0) + 1); for (const a of n.Attr) { iters++; keys.set(a.Key, (keys.get(a.Key) ?? 0) + 1); if (a.Key === "class") keyEq++; if (a.Key.length === 5) lenEq++; } } for (let c = n.FirstChild; c; c = c.NextSibling) w(c); };
w(root);
console.log("element attr-count hist", Object.fromEntries(hist), "total attr visits (class lookup, worst case)", iters, "key==class", keyEq, "len==5", lenEq);
console.log([...keys].sort((a, b) => b[1] - a[1]).slice(0, 12));

import { loadRaw, freshDom, html } from "./common.ts";
const root = freshDom(loadRaw());
const nodes: html.Node[] = []; const attrs: any[] = []; const arrs: any[][] = [];
const w = (n: html.Node) => { nodes.push(n); arrs.push(n.Attr); for (const a of n.Attr) attrs.push(a); for (let c = n.FirstChild; c; c = c.NextSibling) w(c); };
w(root);
const same = (eval("(a,b)=>%HaveSameMap(a,b)") as (a: any, b: any) => boolean);
const kinds = new Map<string, number>();
let nodeDiff = 0, attrDiff = 0, arrDiff = 0; for (const n of nodes) if (!same(n, nodes[0])) nodeDiff++; for (const a of attrs) if (!same(a, attrs[0])) attrDiff++; for (const a of arrs) if (!same(a, arrs[0])) arrDiff++;
console.log({ nodes: nodes.length, nodeDiff, attrs: attrs.length, attrDiff, arrays: arrs.length, arrDiff });

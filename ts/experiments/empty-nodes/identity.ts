// A copy must equal the real method (byte-equal serialisation) on the spec DOM.
import { lute, loadRaw, freshDom, serialize } from "./common.ts";
import { search } from "./variants.ts";
import type { html } from "./common.ts";
const pre = loadRaw();
const a = freshDom(pre); lute.removeEmptyNodes(a);
const b = freshDom(pre); const out: html.Node[] = []; search(lute, b, out); for (const e of out) e.Unlink();
console.log(serialize(a) === serialize(b), serialize(a).length);

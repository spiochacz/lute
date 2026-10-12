// Scratch: how many DOM nodes of the spec have no attributes (for the EMPTY_ATTR gate arithmetic).
import { readFileSync } from "node:fs";
import { CONFIGS, engines } from "../dom2md-cache/corpus.ts";
import { editor, util } from "../../src/index.ts";
import { vditorDOM2MdPreprocess } from "../../src/vditor_wysiwyg.ts";
const md = readFileSync(new URL("../../../benchmark/commonmark-spec.md", import.meta.url), "utf8");
const { port } = engines(CONFIGS[0], "wysiwyg");
const h = port.Md2VditorDOM(md).split(editor.Zwsp).join("");
const root: any = util.ParseHTML(vditorDOM2MdPreprocess(h))!;
let total = 0, empty = 0, cap = 0;
const st: any[] = [root];
while (st.length) { const x = st.pop(); total++; if (x.Attr.length === 0) empty++; cap += 0; for (let k = x.FirstChild; k; k = k.NextSibling) st.push(k); }
console.log(`nodes ${total}, without attributes ${empty} (${(100 * empty / total).toFixed(1)} %)`);

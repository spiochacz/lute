import { New } from "../../../src/index.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER, runChild } from "../../../src/incremental/sandbox.ts";
const lute = New();
const wys = [
 '<div data-type="footnotes-block"><ol data-type="footnotes-defs-ol"><li data-marker="^a"><p>foo bar</p></li>\n<li data-marker="^b"><p>baz</p></li></ol></div>',
 '<div data-type="footnotes-block"><ol data-type="footnotes-defs-ol"><li data-marker="^a"><p>foo</p><blockquote><p>q</p></blockquote></li><li data-marker="^b"><ul><li>x</li></ul></li></ol></div>',
 '<blockquote><p>a</p></blockquote>', '<blockquote><blockquote><p>a</p></blockquote><ul><li>x</li></ul></blockquote>',
 '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>', '<ol><li><p>a</p><p>b</p></li></ol>', '<ul><li><input type="checkbox"> a</li></ul>',
 '<p>a<br>b</p>', '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>', '<hr>', '<pre><code>x</code></pre>',
 '<li>orphan</li>', '<div data-type="link-ref-defs-block">[a]: b</div>',
];
const ir = [
 '<div data-block="0" data-type="footnotes-block"><div data-type="footnotes-def">[^1]: <p data-block="0">def one</p></div><div data-type="footnotes-def">[^2]: <p data-block="0">two</p></div></div>',
 '<blockquote data-block="0"><p data-block="0">a</p></blockquote>', '<ul data-block="0"><li data-marker="*"><p data-block="0">a</p></li></ul>',
 '<table data-block="0"><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>',
];
let found = 0;
for (const [mode, list] of [["wysiwyg", wys], ["ir", ir]] as const) for (const h of list) for (const lo of [10, 120]) for (const [pv, nx] of [[-1, -1], [16, 1], [1, -1]]) {
  const r = runChild(lute, mode === "ir" ? IR_ADAPTER : WYSIWYG_ADAPTER, h, { lastOut: lo, prev: pv, next: nx, isFirst: pv < 0, isLast: nx < 0, domPrev: -1, domNext: -1, domNextAttrs: 0 }, { certify: true, opaque: false });
  if (!r.variant) { if (lo === 10 && pv === -1) console.log("no variant", mode, h.slice(0, 40), JSON.stringify(r.refusal)); continue; }
  const ops = r.variant.ops;
  const s = ops.map((o) => o.kind === "Append" ? (o.setsLastOut ? "T" : "F") + JSON.stringify(new TextDecoder().decode(o.bytes)) : o.kind[0]).join(" ");
  if (lo === 10 && pv === -1 && nx === -1) console.log(mode, h.slice(0, 50), "=>", s.slice(0, 160));
  for (let i = 0; i + 1 < ops.length; i++) if (ops[i].kind === "Append" && ops[i + 1].kind === "Append") { found++; console.log("ADJ", mode, h.slice(0, 60), s.slice(0, 200)); break; }
}
console.log("adjacent append pairs with different flags:", found);

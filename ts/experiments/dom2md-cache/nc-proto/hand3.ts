import { show } from "./hand.ts";
const h1 = '<h1 data-block="0" id="wysiwyg-h" data-marker="#">h</h1>';
const cases: [string, string][] = [
 ["code in last li", '<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*"><p data-block="0">a</p><pre><code>x</code></pre></li></ul>'],
 ["code in li", '<ul data-tight="false" data-marker="*" data-block="0"><li data-marker="*"><pre><code>x</code></pre></li></ul>'],
 ["code in bq", '<blockquote data-block="0"><pre><code>x</code></pre></blockquote>'],
 ["hr in bq", '<blockquote data-block="0"><hr></blockquote>'],
 ["html block in bq", '<blockquote data-block="0"><div data-type="html-block" data-block="0"><pre><code>&lt;b&gt;</code></pre></div></blockquote>'],
 ["table in bq", '<blockquote data-block="0"><table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></blockquote>'],
 ["table in li", '<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">a<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></li></ul>'],
 ["math in bq", '<blockquote data-block="0"><div data-type="math-block" class="vditor-math" data-block="0"><pre><code data-type="math-block">x</code></pre></div></blockquote>'],
];
for (const [name, c] of cases) { console.log("###", name); show("isLast", { isLast: true }, "wysiwyg", [c + h1]); }

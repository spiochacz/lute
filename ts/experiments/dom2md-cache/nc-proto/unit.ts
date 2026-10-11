import { New } from "../../../src/index.ts";
import * as ast from "../../../src/ast/index.ts";
import { FormatRenderer } from "../../../src/render/types.ts";
import { WYSIWYG_ADAPTER, runChild } from "./sandbox_nc.ts";
import { setNC } from "./driver.ts";
const lute = New();
const ctx = (o: Record<string, unknown> = {}) => ({ lastOut: 10, prev: -1, next: -1, isFirst: true, isLast: true, domPrev: -1, domNext: -1, domNextAttrs: 0, ...o }) as never;
const run = (h: string, c: never) => runChild(lute, WYSIWYG_ADAPTER, h, c, { certify: true, opaque: false });
const ops = (r: ReturnType<typeof run>) => JSON.stringify(r.variant?.ops.map((o) => (o.kind === "Append" ? [o.setsLastOut, new TextDecoder().decode(o.bytes)] : o.kind)));
const pbr = '<p data-block="0">line1<br />line2<br />line3\nline4</p>';
const bq = '<blockquote data-block="0"><h1 data-block="0" id="wysiwyg-Foo" data-marker="#">Foo</h1><p data-block="0">bar\nbaz</p></blockquote>';
for (const nc of [{}, { nc5: true }]) { setNC(nc); console.log("NC5", JSON.stringify(nc), "readKeys of pinned domNext witness:", JSON.stringify(run(pbr, ctx()).variant?.readKeys), "ops differ across domNext -1/42754:", ops(run(pbr, ctx())) !== ops(run(pbr, ctx({ domNext: 42754 })))); }
for (const nc of [{}, { nc15: true }]) { setNC(nc); console.log("NC15", JSON.stringify(nc), "pinned lastOut witness ops differ (10 vs 0x78):", ops(run(bq, ctx())) !== ops(run(bq, ctx({ lastOut: 0x78 })))); }
// NC14
const orig = (FormatRenderer.prototype as never as Record<string, unknown>).renderParagraph as (n: ast.Node, e: boolean) => number;
(FormatRenderer.prototype as never as Record<string, unknown>).renderParagraph = function (this: FormatRenderer, n: ast.Node, e: boolean) { if (e) this.WriteString(ast.NewNodeID()); return orig.call(this, n, e); };
for (const nc of [{}, { nc14: true }]) { setNC(nc); const r = run('<p data-block="0">x</p>', ctx()); console.log("NC14", JSON.stringify(nc), "refusal:", JSON.stringify(r.refusal), "variant:", r.variant ? ops(r) : null); }

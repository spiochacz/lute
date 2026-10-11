import { New } from "../../../src/index.ts";
import { WYSIWYG_ADAPTER, runChild } from "../../../src/incremental/sandbox.ts";
const lute = New();
const show = (h: string, lo: number, pv = -1): void => {
  const r = runChild(lute, WYSIWYG_ADAPTER, h, { lastOut: lo, prev: pv, next: -1, isFirst: pv < 0, isLast: true, domPrev: -1, domNext: -1, domNextAttrs: 0 }, { certify: true, opaque: false });
  console.log(lo, pv, JSON.stringify(r.variant?.readKeys), "end", r.variant?.endLastOut, JSON.stringify(r.variant?.ops.map((o) => o.kind === "Append" ? [o.setsLastOut ? "T" : "F", new TextDecoder().decode(o.bytes)] : o.kind)));
};
const bq = '<blockquote data-block="0"><h1 data-block="0" id="wysiwyg-Foo" data-marker="#">Foo</h1><p data-block="0">bar\nbaz</p></blockquote>';
const ulbr = '<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*"><br></li></ul>';
for (const h of [bq, ulbr]) for (const lo of [10, 120]) for (const pv of [-1, 16]) show(h, lo, pv);

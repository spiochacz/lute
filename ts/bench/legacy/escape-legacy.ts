// Bench-only copy of the OLD html.EscapeHTML (before the counted single allocation):
// two Append calls and two views per special byte, with the legacy Append. Used only as
// the A side of the ab.escape rows.
import * as conv from "../../src/runtime/conv.ts";
import * as slices from "../../src/runtime/slices.ts";
import * as lex from "../../src/lex/index.ts";
import { AppendLegacy } from "./append-legacy.ts";

const amp = conv.BytesFromString("&amp;");
const lt = conv.BytesFromString("&lt;");
const gt = conv.BytesFromString("&gt;");
const quot = conv.BytesFromString("&quot;");

export function EscapeHTMLLegacy(html: Uint8Array): Uint8Array {
  let ret: Uint8Array = html;
  const length = html.length;
  let start = 0;
  let i = 0;
  let inited = false;
  for (; i < length; i++) {
    switch (html[i]) {
      case lex.ItemAmpersand:
        if (!inited) {
          ret = slices.Make(0, length + 128);
          inited = true;
        }
        ret = AppendLegacy(ret, html.subarray(start, i));
        ret = AppendLegacy(ret, amp);
        start = i + 1;
        break;
      case lex.ItemLess:
        if (!inited) {
          ret = slices.Make(0, length + 128);
          inited = true;
        }
        ret = AppendLegacy(ret, html.subarray(start, i));
        ret = AppendLegacy(ret, lt);
        start = i + 1;
        break;
      case lex.ItemGreater:
        if (!inited) {
          ret = slices.Make(0, length + 128);
          inited = true;
        }
        ret = AppendLegacy(ret, html.subarray(start, i));
        ret = AppendLegacy(ret, gt);
        start = i + 1;
        break;
      case lex.ItemDoublequote:
        if (!inited) {
          ret = slices.Make(0, length + 128);
          inited = true;
        }
        ret = AppendLegacy(ret, html.subarray(start, i));
        ret = AppendLegacy(ret, quot);
        start = i + 1;
        break;
    }
  }
  if (inited) {
    ret = AppendLegacy(ret, html.subarray(start));
  }
  return ret;
}

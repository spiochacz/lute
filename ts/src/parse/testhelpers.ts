// Canonical dump of a parsed tree, shared by tree.vectors.test.ts and debugging scripts. The format is the one of dumpNode in ts/tools/gen-parse-tree-vectors:
// one line per node, depth first, "key=value" pairs, zero values left out, byte slices as lowercase hex in single quotes, N for nil.
// Tokens, CodeBlockCloseFence and KramdownIAL keep nil and empty apart; other byte slices (not nullable in the port) do not.

import assert from "node:assert/strict";
import * as conv from "../runtime/conv.ts";
import * as ast from "../ast/index.ts";
import * as parse from "./index.ts";

export interface OptionSet {
  name: string;
  opts: Record<string, boolean | string>;
}

export function hexBytes(b: Uint8Array): string {
  return Buffer.from(b.buffer, b.byteOffset, b.length).toString("hex");
}

export function hexq(b: Uint8Array): string {
  return "'" + hexBytes(b) + "'";
}

export function hexs(s: string): string {
  return "'" + hexBytes(conv.BytesFromString(s)) + "'";
}

export function nilq(b: Uint8Array | null): string {
  return null === b ? "N" : hexq(b);
}

export function b2i(b: boolean): string {
  return b ? "1" : "0";
}

export function dumpIAL(ial: string[][] | null): string {
  if (null === ial) {
    return "N";
  }
  return "[" + ial.map((kv) => hexs(kv.join("\0"))).join(",") + "]";
}

export function dumpNode(n: ast.Node, depth: number, lines: string[]): void {
  let sb = String(depth);
  const add = (k: string, v: string, zero: string): void => {
    if (v !== zero) {
      sb += " " + k + "=" + v;
    }
  };
  sb += " t=" + n.Type;
  sb += " tok=" + nilq(n.Tokens);
  add("close", b2i(n.Close), "0");
  add("id", hexs(n.ID), "''");
  add("ial", dumpIAL(n.KramdownIAL), "N");
  add("h", n.HeadingLevel + "/" + b2i(n.HeadingSetext) + "/" + hexs(n.HeadingNormalizedID), "0/0/''");
  if (null !== n.ListData) {
    const ld = n.ListData;
    sb += ` list=${ld.Typ},${b2i(ld.Tight)},${ld.BulletChar},${ld.Start},${ld.Delimiter},${ld.Padding},${ld.MarkerOffset},${b2i(ld.Checked)},${hexq(ld.Marker)},${ld.Num}`;
  }
  add("task", `${b2i(n.TaskListItemChecked)},${n.TaskListItemMarker}`, "0,0");
  add(
    "fence",
    `${b2i(n.IsFencedCodeBlock)},${n.CodeBlockFenceChar},${n.CodeBlockFenceLen},${n.CodeBlockFenceOffset},${hexq(n.CodeBlockOpenFence)},${hexq(n.CodeBlockInfo)},${nilq(n.CodeBlockCloseFence)}`,
    "0,0,0,0,'','',N",
  );
  add("code", String(n.CodeMarkerLen), "0");
  add("html", String(n.HtmlBlockType), "0");
  add("math", String(n.MathBlockDollarOffset), "0");
  add("link", `${n.LinkType},${hexq(n.LinkRefLabel)}`, "0,''");
  add("fn", `${hexq(n.FootnotesRefLabel)},${hexs(n.FootnotesRefId)},${n.FootnotesRefs.length}`, "'','',0");
  add("ent", hexq(n.HtmlEntityTokens), "''");
  add("table", `[${n.TableAligns.join(" ")}],${n.TableCellAlign},${n.TableCellContentWidth},${n.TableCellContentMaxWidth}`, "[],0,0,0");
  if (null !== n.TableCellRich) {
    const r = n.TableCellRich;
    sb += ` rich=${r.Spec},${hexs(r.Format)},${hexs(r.Content)},${hexs(r.Raw)},${b2i(r.Invalid)}`;
  }
  add("custom", `${n.CustomBlockFenceOffset},${hexs(n.CustomBlockInfo)}`, "0,''");
  add("callout", `${hexs(n.CalloutType)},${hexs(n.CalloutTitle)},${b2i(n.CalloutTitleExplicit)},${hexs(n.CalloutIcon)},${n.CalloutIconType}`, "'','',0,'',0");
  add("tab", hexs(n.TabItemTitle), "''");
  add("av", hexs(n.AttributeViewID) + "," + hexs(n.AttributeViewType), "'',''");
  add(
    "tm",
    [
      n.TextMarkType,
      n.TextMarkAHref,
      n.TextMarkATitle,
      n.TextMarkInlineMathContent,
      n.TextMarkInlineMemoContent,
      n.TextMarkBlockRefID,
      n.TextMarkBlockRefSubtype,
      n.TextMarkFileAnnotationRefID,
      n.TextMarkFlashcardOcclusionID,
      n.TextMarkTextContent,
    ]
      .map(hexs)
      .join(","),
    "'','','','','','','','','',''",
  );
  if (0 < n.Properties.size) {
    const keys = [...n.Properties.keys()].sort((a, b) => {
      const ba = conv.BytesFromString(a);
      const bb = conv.BytesFromString(b);
      return Buffer.compare(ba, bb);
    });
    sb += " props=" + keys.map((k) => hexs(k) + ":" + hexs(n.Properties.get(k)!)).join(",");
  }
  lines.push(sb);
  for (let c = n.FirstChild; null !== c; c = c.Next) {
    dumpNode(c, depth + 1, lines);
  }
}

export function options(set: OptionSet): parse.Options {
  const o = parse.NewOptions();
  const rec = o as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(set.opts)) {
    assert.ok(k in o, `no option ${k}`);
    rec[k] = v;
  }
  return o;
}


// Ported from render/json_renderer.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as json from "../runtime/json.ts";
import * as ast from "../ast/index.ts";
import * as parse from "../parse/index.ts";
import * as util from "../util/index.ts";
import { BaseRenderer } from "./types.ts";
import { nodeTokens } from "./renderer.ts";
import type { Options, Renderer } from "./renderer.ts";

export class JSONRenderer extends BaseRenderer {
  constructor(tree: parse.Tree, options: Options, parseOptions: parse.Options) {
    super(tree, options, parseOptions);
  }

  renderNode(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (null !== node.Previous) {
        r.WriteString(",");
      }
      node.Data = util.BytesToStr(nodeTokens(node));
      node.TypeStr = ast.NodeTypeString(node.Type);
      node.Properties = ial2Map(node.KramdownIAL);
      node.Properties.delete("refcount");
      node.Properties.delete("av-names");
      let data: string;
      try {
        data = marshalNode(node);
      } finally {
        node.Data = "";
        node.TypeStr = "";
        node.Properties = new Map<string, string>(); // PORT-NOTE: Go sets nil; an empty map is encoded the same (omitempty)
      }
      let n = data;
      n = n.slice(0, n.length - 1); // Remove the trailing }
      r.WriteString(n);
      if (null !== node.FirstChild) {
        r.WriteString(",\"Children\":[");
      } else {
        r.WriteString("}");
      }
    } else {
      if (null !== node.FirstChild) {
        r.WriteByte(0x5d /* ] */);
        r.WriteString("}");
      }
    }
    return ast.WalkContinue;
  }
}

export function NewJSONRenderer(tree: parse.Tree, options: Options, parseOptions: parse.Options): Renderer {
  const ials: ast.Node[] = []; // The renderer removes block-level IAL nodes from the syntax tree
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }

    if (ast.NodeKramdownBlockIAL === n.Type) {
      ials.push(n);
    }
    return ast.WalkContinue;
  });
  for (const ial of ials) {
    ial.Unlink();
  }

  const ret = new JSONRenderer(tree, options, parseOptions);
  ret.DefaultRendererFunc = ret.renderNode.bind(ret);
  return ret;
}

function ial2Map(ial: string[][] | null): Map<string, string> {
  const ret = new Map<string, string>();
  for (const kv of ial ?? []) {
    ret.set(kv[0], kv[1]);
  }
  return ret;
}

// PORT-NOTE: the rest of this file is a serializer for ast.Node that produces the bytes of Go's encoding/json (json.Marshal(node)),
// driven by the struct tag tables NodeJSONFields, ListDataJSONFields and TableCellRichJSONFields of ast/node.ts.
// It is generic only as far as Node needs: field order of the tables, skipped fields, omitempty per Go type, []byte as padded base64,
// strings through json.QuoteString, nested structs and pointers, maps with keys sorted by their UTF-8 bytes.

const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// base64StdEncode encodes b as standard base64 with padding (Go's base64.StdEncoding).
function base64StdEncode(b: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const v = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out += base64Alphabet[(v >> 18) & 63] + base64Alphabet[(v >> 12) & 63] + base64Alphabet[(v >> 6) & 63] + base64Alphabet[v & 63];
  }
  const rest = b.length - i;
  if (1 === rest) {
    const v = b[i] << 16;
    out += base64Alphabet[(v >> 18) & 63] + base64Alphabet[(v >> 12) & 63] + "==";
  } else if (2 === rest) {
    const v = (b[i] << 16) | (b[i + 1] << 8);
    out += base64Alphabet[(v >> 18) & 63] + base64Alphabet[(v >> 12) & 63] + base64Alphabet[(v >> 6) & 63] + "=";
  }
  return out;
}

// compareUTF8 compares two strings by their UTF-8 bytes, which is Go's string order; the UTF-16 order of JS differs for astral characters.
function compareUTF8(a: string, b: string): number {
  const ca = Array.from(a);
  const cb = Array.from(b);
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const x = ca[i].codePointAt(0)!;
    const y = cb[i].codePointAt(0)!;
    if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return ca.length - cb.length;
}

// isEmptyValue is Go's isEmptyValue of encoding/json: the omitempty test.
function isEmptyValue(v: unknown, goType: string): boolean {
  switch (goType) {
    case "string":
      return "" === v;
    case "int":
    case "byte":
      return 0 === v;
    case "bool":
      return false === v;
    case "[]byte":
      return null === v || 0 === (v as Uint8Array).length;
    case "[]int":
    case "[]*Node":
      return null === v || 0 === (v as unknown[]).length;
    case "map[string]string":
      return null === v || 0 === (v as Map<string, string>).size;
    case "*ListData":
    case "*TableCellRich":
      return null === v;
  }
  throw new Error("unsupported JSON type " + goType);
}

function encodeStruct(obj: object, fields: ast.JSONField[]): string {
  const rec = obj as unknown as Record<string, unknown>;
  let out = "{";
  let first = true;
  for (const f of fields) {
    if (f.skipped) {
      continue;
    }
    const v = rec[f.goName];
    if (f.omitempty && isEmptyValue(v, f.goType)) {
      continue;
    }
    if (!first) {
      out += ",";
    }
    first = false;
    out += json.QuoteString(f.jsonKey) + ":" + encodeValue(v, f.goType);
  }
  return out + "}";
}

function encodeValue(v: unknown, goType: string): string {
  switch (goType) {
    case "string":
      return json.QuoteString(v as string);
    case "int":
    case "byte":
      return String(v as number);
    case "bool":
      return v ? "true" : "false";
    case "[]byte":
      return null === v ? "null" : "\"" + base64StdEncode(v as Uint8Array) + "\"";
    case "[]int":
      return null === v ? "null" : "[" + (v as number[]).map((x) => String(x)).join(",") + "]";
    case "[]*Node":
      return null === v ? "null" : "[" + (v as (ast.Node | null)[]).map((n) => (null === n ? "null" : marshalNode(n))).join(",") + "]";
    case "map[string]string": {
      if (null === v) {
        return "null";
      }
      const m = v as Map<string, string>;
      const keys = Array.from(m.keys()).sort(compareUTF8);
      return "{" + keys.map((k) => json.QuoteString(k) + ":" + json.QuoteString(m.get(k)!)).join(",") + "}";
    }
    case "*ListData":
      return null === v ? "null" : encodeStruct(v as ast.ListData, ast.ListDataJSONFields);
    case "*TableCellRich":
      return null === v ? "null" : encodeStruct(v as ast.TableCellRich, ast.TableCellRichJSONFields);
  }
  throw new Error("unsupported JSON type " + goType);
}

// marshalNode is json.Marshal(node).
export function marshalNode(node: ast.Node): string {
  return encodeStruct(node, ast.NodeJSONFields);
}

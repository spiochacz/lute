// Ported from util/ial.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";

// typeDocAttr is the bytes of type="doc", computed once.
const typeDocAttr: Uint8Array = conv.BytesFromString('type="doc"');

export function IsDocIAL(tokens: Uint8Array): boolean {
  return bytes.Contains(tokens, typeDocAttr);
}

export function IsDocIAL2(ial: string[][]): boolean {
  for (const kv of ial) {
    // PORT-NOTE: Go panics here when kv is too short (index out of range on kv[0],
    // or on kv[1] when kv[0] is "type"). TypeScript would return undefined instead,
    // so the panics are reproduced explicitly.
    if (kv.length < 1) {
      throw new Error("runtime error: index out of range [0] with length 0");
    }
    if ("type" === kv[0]) {
      if (kv.length < 2) {
        throw new Error("runtime error: index out of range [1] with length 1");
      }
      if ("doc" === kv[1]) {
        return true;
      }
    }
  }
  return false;
}

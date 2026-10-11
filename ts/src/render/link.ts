// Ported from render/link.go @ 8e7896b6
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
import * as slices from "../runtime/slices.ts";
import * as strings from "../runtime/strings.ts";
import * as util from "../util/index.ts";
import { BaseRenderer } from "./types.ts";

declare module "./types.ts" {
  interface BaseRenderer {
    EncodeLinkSpace(dest: string): string;
    LinkPath(dest: Uint8Array): Uint8Array;
    PrefixPath(dest: Uint8Array): Uint8Array;
    RelativePath(dest: Uint8Array): Uint8Array;
    isRelativePath(dest: Uint8Array): boolean;
  }
}

const assetsPrefix: Uint8Array = util.StrToBytes("assets/");
const percent5C: Uint8Array = util.StrToBytes("%5C");
const backslashBytes: Uint8Array = util.StrToBytes("\\");
const slashBytes: Uint8Array = util.StrToBytes("/");
const colonSlash: Uint8Array = util.StrToBytes(":/");
const colonBackslash: Uint8Array = util.StrToBytes(":\\");
const colonPercent5C: Uint8Array = util.StrToBytes(":%5C");

BaseRenderer.prototype.EncodeLinkSpace = function (this: BaseRenderer, dest: string): string {
  const r = this;
  if (r.Options.PreventEncodeLinkSpace) {
    return dest;
  }

  // Improve export of Markdown hyperlink spaces and markers https://github.com/siyuan-note/siyuan/issues/9792
  return strings.ReplaceAll(dest, " ", "%20");
};

BaseRenderer.prototype.LinkPath = function (this: BaseRenderer, dest: Uint8Array): Uint8Array {
  const r = this;
  dest = r.RelativePath(dest);
  dest = r.PrefixPath(dest);
  return dest;
};

BaseRenderer.prototype.PrefixPath = function (this: BaseRenderer, dest: Uint8Array): Uint8Array {
  const r = this;
  if ("" === r.Options.LinkPrefix) {
    return dest;
  }

  const linkPrefix = util.StrToBytes(r.Options.LinkPrefix);
  const ret = slices.Append(linkPrefix, dest);
  return ret;
};

BaseRenderer.prototype.RelativePath = function (this: BaseRenderer, dest: Uint8Array): Uint8Array {
  const r = this;
  if ("" === r.Options.LinkBase) {
    return dest;
  }

  if (!r.isRelativePath(dest)) {
    return dest;
  }

  if (!bytes.HasPrefix(dest, assetsPrefix) &&
    (strings.HasPrefix(r.Options.LinkBase, "https://assets.b3logfile.com/siyuan/") || strings.HasPrefix(r.Options.LinkBase, "https://assets.liuyun.io/siyuan/"))) {
    return dest;
  }

  dest = bytes.ReplaceAll(dest, percent5C, backslashBytes);
  let linkBase: Uint8Array = util.StrToBytes(r.Options.LinkBase);
  if (!bytes.HasSuffix(linkBase, slashBytes)) {
    linkBase = slices.Append(linkBase, slashBytes);
  }
  const ret = slices.Append(linkBase, dest);
  if (bytes.Equal(linkBase, ret)) {
    return new Uint8Array(0);
  }
  return ret;
};

BaseRenderer.prototype.isRelativePath = function (this: BaseRenderer, dest: Uint8Array): boolean {
  const r = this;
  if (1 > dest.length) {
    return true;
  }

  if (0x2f /* / */ === dest[0]) {
    return false;
  }

  // Check specific protocol prefixes
  const lowerDest = strings.ToLower(conv.StringFromBytes(dest));
  if (strings.HasPrefix(lowerDest, "data:") ||
    strings.HasPrefix(lowerDest, "mailto:") ||
    strings.HasPrefix(lowerDest, "tel:") ||
    strings.HasPrefix(lowerDest, "sms:")) {
    return false;
  }
  return !bytes.Contains(dest, colonSlash) && !bytes.Contains(dest, colonBackslash) && !bytes.Contains(dest, colonPercent5C);
};

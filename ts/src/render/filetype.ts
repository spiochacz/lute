// Ported from render/filetype.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as conv from "../runtime/conv.ts";
import * as strings from "../runtime/strings.ts";

export function isFileExt(pos: number, length: number, runes: number[]): boolean {
  let max = pos + maxCommonFileTypeLen;
  if (max > length) {
    max = length;
  }

  const ext = conv.StringFromRunes(runes.slice(pos, max));
  for (let j = 0; j < commonFileTypesLen; j++) {
    if (strings.HasPrefix(ext, commonFileTypes[j])) {
      return true;
    }
  }
  return false;
}

// PORT-NOTE: Go declares commonFileTypesLen and maxCommonFileTypeLen before commonFileTypes and relies on package-level initialization order; here commonFileTypes is declared first, because a TypeScript const is not usable before its declaration.
// commonFileTypes lists the common file extensions, mainly used to decide whether an English period . needs to be converted to a Chinese period.
export const commonFileTypes: string[] = [
  // Images

  "jpg",
  "png",
  "gif",
  "webp",
  "cr2",
  "tif",
  "bmp",
  "heif",
  "jxr",
  "psd",
  "ico",
  "dwg",

  // Video

  "mp4",
  "m4v",
  "mkv",
  "webm",
  "mov",
  "avi",
  "wmv",
  "mpg",
  "flv",
  "3gp",

  // Audio

  "mid",
  "mp3",
  "m4a",
  "ogg",
  "flac",
  "wav",
  "amr",
  "aac",

  // Archives

  "epub",
  "zip",
  "tar",
  "rar",
  "gz",
  "bz2",
  "7z",
  "xz",
  "pdf",
  "exe",
  "swf",
  "rtf",
  "iso",
  "eot",
  "ps",
  "sqli",
  "nes",
  "crx",
  "cab",
  "deb",
  "ar",
  "Z",
  "lz",
  "rpm",
  "elf",
  "dcm",

  // Files

  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "md",
  "txt",

  // Fonts

  "woff",
  "woff2",
  "ttf",
  "otf",

  // Applications

  "wasm",
  "exe",

  // Programming languages

  "html",
  "js",
  "css",
  "go",
  "java",

  // Others

  "textbundle",
];

export const commonFileTypesLen: number = commonFileTypes.length;
export const maxCommonFileTypeLen = 10; // textbundle

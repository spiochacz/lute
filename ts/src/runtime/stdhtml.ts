// Port of the Go 1.21 standard library package html (src/html/escape.go, entity.go): UnescapeString.
// Lute's own fork of the package is in ../html; Lute calls the standard one only in
// parse/table_rich_style.go. EscapeString of the standard library is not called by Lute.
//
// PORT-NOTE: Go works on bytes and this port on UTF-16 strings. Entity names, digits and '&' are
// ASCII, so every index used below is the same in both. The only byte length test, "len(s) <= 3"
// after "&#", gives the same result for non-ASCII input because no digit can follow in that case.

import * as conv from "./conv.ts";
import { entity2Data, entityData } from "./stdhtml_entity.ts";

// All entities that do not end with ';' are 6 or fewer bytes long.
const longestEntityWithoutSemicolon = 6;

// replacementTable: Windows-1252 replacements for the numeric references 0x80 to 0x9F.
const replacementTable: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

let entity: Map<string, string> | null = null;
let entity2: Map<string, string> | null = null;

function decode(data: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of data.split("\x02")) {
    if (e === "") {
      continue;
    }
    const sep = e.indexOf("\x01");
    let v = "";
    for (const cp of e.slice(sep + 1).split(",")) {
      v += conv.StringFromRune(Number.parseInt(cp, 16));
    }
    m.set(e.slice(0, sep), v);
  }
  return m;
}

// populateMaps populates entity and entity2 on first use.
function populateMaps(): void {
  if (entity === null) {
    entity = decode(entityData);
    entity2 = decode(entity2Data);
  }
}

// unescapeEntity reads the entity starting at s[src] ('&') and returns the replacement text and
// the index after the consumed input.
function unescapeEntity(s: string, src: number): [string, number] {
  const attribute = false;

  // Consume the '&'.
  let i = 1;
  const rest = s.length - src;

  if (rest <= 1) {
    return ["&", src + 1];
  }

  if (s.charCodeAt(src + i) === 0x23 /* # */) {
    if (rest <= 3) {
      // We need to have at least "&#.".
      return ["&", src + 1];
    }
    i++;
    let c = s.charCodeAt(src + i);
    let hex = false;
    if (c === 0x78 /* x */ || c === 0x58 /* X */) {
      hex = true;
      i++;
    }

    // Go's rune is an int32; the arithmetic wraps on very long references.
    let x = 0;
    while (i < rest) {
      c = s.charCodeAt(src + i);
      i++;
      if (hex) {
        if (0x30 <= c && c <= 0x39) {
          x = (Math.imul(16, x) + c - 0x30) | 0;
          continue;
        } else if (0x61 <= c && c <= 0x66) {
          x = (Math.imul(16, x) + c - 0x61 + 10) | 0;
          continue;
        } else if (0x41 <= c && c <= 0x46) {
          x = (Math.imul(16, x) + c - 0x41 + 10) | 0;
          continue;
        }
      } else if (0x30 <= c && c <= 0x39) {
        x = (Math.imul(10, x) + c - 0x30) | 0;
        continue;
      }
      if (c !== 0x3b /* ; */) {
        i--;
      }
      break;
    }

    if (i <= 3) {
      // No characters matched.
      return ["&", src + 1];
    }

    if (0x80 <= x && x <= 0x9f) {
      // Replace characters from Windows-1252 with UTF-8 equivalents.
      x = replacementTable[x - 0x80]!;
    } else if (x === 0 || (0xd800 <= x && x <= 0xdfff) || x > 0x10ffff || x < 0) {
      // Replace invalid characters with the replacement character.
      x = 0xfffd;
    }

    return [conv.StringFromRune(x), src + i];
  }

  // Consume the maximum number of characters possible, with the consumed characters matching one of the named references.
  while (i < rest) {
    const c = s.charCodeAt(src + i);
    i++;
    // Lower-cased characters are more common in entities, so we check for them first.
    if ((0x61 <= c && c <= 0x7a) || (0x41 <= c && c <= 0x5a) || (0x30 <= c && c <= 0x39)) {
      continue;
    }
    if (c !== 0x3b /* ; */) {
      i--;
    }
    break;
  }

  const entityName = s.slice(src + 1, src + i);
  if (entityName.length === 0) {
    // No-op.
  } else if (attribute && entityName.charCodeAt(entityName.length - 1) !== 0x3b && rest > i && s.charCodeAt(src + i) === 0x3d /* = */) {
    // No-op.
  } else {
    populateMaps();
    const x = entity!.get(entityName);
    if (x !== undefined) {
      return [x, src + i];
    }
    const x2 = entity2!.get(entityName);
    if (x2 !== undefined) {
      return [x2, src + i];
    }
    if (!attribute) {
      let maxLen = entityName.length - 1;
      if (maxLen > longestEntityWithoutSemicolon) {
        maxLen = longestEntityWithoutSemicolon;
      }
      for (let j = maxLen; j > 1; j--) {
        const y = entity!.get(entityName.slice(0, j));
        if (y !== undefined) {
          return [y, src + j + 1];
        }
      }
    }
  }

  return [s.slice(src, src + i), src + i];
}

// UnescapeString unescapes entities like "&lt;" to become "<". It unescapes a larger range of
// entities than EscapeString escapes. For example, "&aacute;" unescapes to "á", as does "&#225;"
// and "&#xE1;".
export function UnescapeString(s: string): string {
  let i = s.indexOf("&");
  if (i < 0) {
    return s;
  }

  let out = s.slice(0, i);
  let src = i;
  while (src < s.length) {
    // s[src] is '&' here.
    const [text, next] = unescapeEntity(s, src);
    out += text;
    src = next;
    if (src >= s.length) {
      break;
    }
    i = s.indexOf("&", src);
    if (i < 0) {
      out += s.slice(src);
      break;
    }
    out += s.slice(src, i);
    src = i;
  }
  return out;
}

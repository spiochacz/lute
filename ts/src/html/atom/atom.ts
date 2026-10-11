// Ported from html/atom/atom.go @ 8e7896b6
// Copyright 2012 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package atom provides integer codes (also known as atoms) for a fixed set of
// frequently occurring HTML strings: tag names and attribute keys such as "p"
// and "id".
//
// Sharing an atom's name between all elements with the same tag can result in
// fewer string allocations when tokenizing and parsing HTML. Integer
// comparisons are also generally faster than string comparisons.
//
// The value of an atom's particular code is not guaranteed to stay the same
// between versions of this package. Neither is any ordering guaranteed:
// whether atom.H1 < atom.H2 may also change. The codes are not guaranteed to
// be dense. The only guarantees are that e.g. looking up "div" will yield
// atom.Div, calling atom.Div.String will return "div", and atom.Div != 0.

// PORT-NOTE: Go's methods on Atom are ported as free functions, because a
// number cannot have methods in TypeScript. Atom.String becomes AtomString(a),
// and the unexported Atom.string becomes atomStringRaw(a).

import * as conv from "../../runtime/conv.ts";
import { table, hash0, maxAtomLen, atomText } from "./table.ts";

// Atom is an integer code for a string. The zero value maps to "".
export type Atom = number;

// String returns the atom's name.
export function AtomString(a: Atom): string {
  const start = a >>> 8; // PORT-NOTE: byte offset (atomText is ASCII, so UTF-16 offsets match)
  const n = a & 0xff;
  if (start + n > atomText.length) {
    return "";
  }
  return atomText.slice(start, start + n); // PORT-NOTE: byte offset
}

// PORT-NOTE: Go's method Atom.string, renamed because the name is unexported in Go.
function atomStringRaw(a: Atom): string {
  // Go precedence: a>>8+a&0xff is (a>>8) + (a&0xff).
  return atomText.slice(a >>> 8, (a >>> 8) + (a & 0xff)); // PORT-NOTE: byte offset
}

// fnv computes the FNV hash with an arbitrary starting value h.
function fnv(h: number, s: Uint8Array): number {
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s[i]!) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function match(s: string, t: Uint8Array): boolean {
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (s.charCodeAt(i) !== c) {
      return false;
    }
  }
  return true;
}

// Lookup returns the atom whose name is s. It returns zero if there is no
// such atom. The lookup is case sensitive.
export function Lookup(s: Uint8Array): Atom {
  if (s.length === 0 || s.length > maxAtomLen) {
    return 0;
  }
  const h = fnv(hash0, s);
  {
    const a = table[h & (table.length - 1)]!;
    if ((a & 0xff) === s.length && match(atomStringRaw(a), s)) {
      return a;
    }
  }
  {
    const a = table[(h >>> 16) & (table.length - 1)]!;
    if ((a & 0xff) === s.length && match(atomStringRaw(a), s)) {
      return a;
    }
  }
  return 0;
}

// String returns a string whose contents are equal to s. In that sense, it is
// equivalent to string(s) but may be more efficient.
export function String(s: Uint8Array): string {
  const a = Lookup(s);
  if (a !== 0) {
    return AtomString(a);
  }
  return conv.StringFromBytes(s); // PORT-NOTE: Go string(s); invalid bytes become U+FFFD (see runtime conv.ts)
}


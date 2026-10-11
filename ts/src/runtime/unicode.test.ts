import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as unicode from "./unicode.ts";

interface Entry {
  count: number;
  checksum: number;
}

interface MapEntry {
  changed: number;
  checksum: number;
}

interface Probe {
  r: number;
  predicates: Record<string, boolean>;
  mappings: Record<string, number>;
}

interface ChecksumFile {
  goVersion: string;
  unicodeVersion: string;
  predicates: Record<string, Entry>;
  tables: Record<string, Entry>;
  mappings: Record<string, MapEntry>;
  probes: Probe[];
}

const expected: ChecksumFile = JSON.parse(
  readFileSync(new URL("./testdata/unicode_checksums.json", import.meta.url), "utf8"),
);

// The namespace object indexed by name, for the generated lists below.
const api = unicode as unknown as Record<string, unknown>;
type Pred = (r: number) => boolean;
type MapFn = (r: number) => number;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// fnvAdd feeds the 4 little-endian bytes of v into a 32-bit FNV-1a hash.
function fnvAdd(h: number, v: number): number {
  for (let i = 0; i < 4; i++) {
    h = Math.imul(h ^ ((v >>> (8 * i)) & 0xff), FNV_PRIME) >>> 0;
  }
  return h;
}

const MAX_RUNE = 0x10ffff;

test("unicode version matches the generator", () => {
  assert.equal(unicode.Version, expected.unicodeVersion);
  assert.equal(unicode.MaxRune, MAX_RUNE);
  assert.equal(unicode.MaxASCII, 0x7f);
  assert.equal(unicode.ReplacementChar, 0xfffd);
});

test("predicates, range tables, and mappings match Go for every rune 0..0x10FFFF", () => {
  const predNames = Object.keys(expected.predicates);
  const tableNames = Object.keys(expected.tables);
  const mapNames = Object.keys(expected.mappings);

  const preds = predNames.map((name) => api[name] as Pred);
  const tabs = tableNames.map((name) => api[name] as Uint32Array);
  const maps = mapNames.map((name) => api[name] as MapFn);

  for (const [i, f] of preds.entries()) {
    assert.equal(typeof f, "function", `missing predicate ${predNames[i]}`);
  }
  for (const [i, t] of tabs.entries()) {
    assert.ok(t instanceof Uint32Array, `missing table ${tableNames[i]}`);
  }
  for (const [i, f] of maps.entries()) {
    assert.equal(typeof f, "function", `missing mapping ${mapNames[i]}`);
  }

  const predCount = new Array<number>(preds.length).fill(0);
  const predHash = new Array<number>(preds.length).fill(FNV_OFFSET);
  const tabCount = new Array<number>(tabs.length).fill(0);
  const tabHash = new Array<number>(tabs.length).fill(FNV_OFFSET);
  const mapChanged = new Array<number>(maps.length).fill(0);
  const mapHash = new Array<number>(maps.length).fill(FNV_OFFSET);

  for (let r = 0; r <= MAX_RUNE; r++) {
    for (let i = 0; i < preds.length; i++) {
      if (preds[i](r)) {
        predCount[i]++;
        predHash[i] = fnvAdd(predHash[i], r);
      }
    }
    for (let i = 0; i < tabs.length; i++) {
      if (unicode.Is(tabs[i], r)) {
        tabCount[i]++;
        tabHash[i] = fnvAdd(tabHash[i], r);
      }
    }
    for (let i = 0; i < maps.length; i++) {
      const m = maps[i](r);
      if (m !== r) {
        mapChanged[i]++;
      }
      mapHash[i] = fnvAdd(mapHash[i], m >>> 0);
    }
  }

  for (let i = 0; i < preds.length; i++) {
    const want = expected.predicates[predNames[i]];
    assert.equal(predCount[i], want.count, `count ${predNames[i]}`);
    assert.equal(predHash[i] >>> 0, want.checksum, `checksum ${predNames[i]}`);
  }
  for (let i = 0; i < tabs.length; i++) {
    const want = expected.tables[tableNames[i]];
    assert.equal(tabCount[i], want.count, `count ${tableNames[i]}`);
    assert.equal(tabHash[i] >>> 0, want.checksum, `checksum ${tableNames[i]}`);
  }
  for (let i = 0; i < maps.length; i++) {
    const want = expected.mappings[mapNames[i]];
    assert.equal(mapChanged[i], want.changed, `changed ${mapNames[i]}`);
    assert.equal(mapHash[i] >>> 0, want.checksum, `checksum ${mapNames[i]}`);
  }

  // Each generated predicate and table, and each mapping, is covered by this test.
  assert.equal(predNames.length, 13);
  assert.equal(tableNames.length, 16);
  assert.equal(mapNames.length, 4);
});

test("out-of-range and boundary probes match Go", () => {
  assert.ok(expected.probes.length >= 20);
  for (const p of expected.probes) {
    for (const [name, want] of Object.entries(p.predicates)) {
      const f = api[name];
      const got =
        typeof f === "function"
          ? (f as Pred)(p.r)
          : unicode.Is(api[name.slice(2)] as Uint32Array, p.r);
      assert.equal(got, want, `${name}(${p.r})`);
    }
    for (const [name, want] of Object.entries(p.mappings)) {
      assert.equal((api[name] as MapFn)(p.r), want, `${name}(${p.r})`);
    }
  }
});

test("ASCII fast paths and spot checks", () => {
  assert.equal(unicode.ToLower(0x41), 0x61);
  assert.equal(unicode.ToUpper(0x7a), 0x5a);
  assert.equal(unicode.ToTitle(0x61), 0x41);
  assert.equal(unicode.ToLower(0x5b), 0x5b);
  assert.equal(unicode.ToLower(-1), -1);
  assert.equal(unicode.SimpleFold(0x4b), 0x6b);
  assert.equal(unicode.SimpleFold(0x6b), 0x212a);
  assert.equal(unicode.SimpleFold(0x212a), 0x4b);
  assert.equal(unicode.SimpleFold(-5), -5);
  assert.equal(unicode.SimpleFold(0x110000), 0x110000);
  assert.equal(unicode.ToLower(0x3a3), 0x3c3);
  assert.equal(unicode.ToUpper(0x1c5), 0x1c4);
  assert.equal(unicode.ToTitle(0x1c5), 0x1c5);
  assert.equal(unicode.IsLetter(0x41), true);
  assert.equal(unicode.IsLetter(0x31), false);
  assert.equal(unicode.IsDigit(0x39), true);
  assert.equal(unicode.IsSpace(0x20), true);
  assert.equal(unicode.IsSpace(0x85), true);
  assert.equal(unicode.IsSpace(0x200b), false);
  assert.equal(unicode.IsControl(0x7f), true);
  assert.equal(unicode.IsPrint(0x20), true);
  assert.equal(unicode.IsPrint(0x7f), false);
  assert.equal(unicode.IsPunct(0x21), true);
  assert.equal(unicode.IsSymbol(0x2b), true);
  assert.equal(unicode.IsUpper(0x41), true);
  assert.equal(unicode.IsLower(0x61), true);
  assert.equal(unicode.IsMark(0x301), true);
  assert.equal(unicode.Is(unicode.Han, 0x4e2d), true);
  assert.equal(unicode.Is(unicode.Han, -1), false);
  assert.equal(unicode.Is(unicode.Latin, 0x41), true);
  assert.equal(unicode.Is(unicode.Zs, 0x3000), true);
  assert.equal(unicode.Is(unicode.Lm, 0x2b0), true);
  assert.equal(unicode.IsEastAsianWideOrFullwidth(0x4e2d), true);
  assert.equal(unicode.IsEastAsianWideOrFullwidth(0x41), false);
  assert.equal(unicode.IsEastAsianWideOrFullwidth(0xff21), true);
});

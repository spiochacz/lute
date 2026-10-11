import { test } from "node:test";
import assert from "node:assert/strict";
import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";
import * as lex from "./index.ts";

// bytesOf builds a byte array from UTF-8 text (strings) and raw bytes (numbers),
// so invalid UTF-8 can be written exactly as the Go test writes it with \x escapes.
function bytesOf(...parts: (string | number)[]): Uint8Array {
  const chunks = parts.map((p) => (typeof p === "number" ? Uint8Array.of(p) : conv.BytesFromString(p)));
  return bytes.Join(chunks, new Uint8Array(0));
}

// Ported from lex/lexer_test.go: TestLexerNormalizeLines.
test("TestLexerNormalizeLines", () => {
  const cases: [Uint8Array, Uint8Array][] = [
    [bytesOf(""), bytesOf("")],
    [bytesOf("a"), bytesOf("a\n")],
    [bytesOf("a\n"), bytesOf("a\n")],
    [bytesOf("a\r"), bytesOf("a\n")],
    [bytesOf("a\r\nb\rc\n"), bytesOf("a\nb\nc\n")],
    [bytesOf("\r\r\n\n"), bytesOf("\n\n\n")],
    [bytesOf(0), bytesOf("�\n")],
    [bytesOf("a", 0, 0, "b\r\nc", 0, "\rd"), bytesOf("a��b\nc�\nd\n")],
    [bytesOf("中文\r\n日文", 0, "\r"), bytesOf("中文\n日文�\n")],
    [bytesOf(0xff, "\r\n", 0xfe, 0), bytesOf(0xff, "\n", 0xfe, "�\n")],
  ];
  for (const [input, want] of cases) {
    const lexer = lex.NewLexer(input);
    const lines: Uint8Array[] = [];
    for (let line = lexer.NextLine(); line !== null; line = lexer.NextLine()) {
      lines.push(line);
    }
    assert.deepEqual(bytes.Join(lines, new Uint8Array(0)), want, `input ${Buffer.from(input).toString("hex")}`);
    assert.equal(lexer.NextLine(), null, "expected end of input");
  }
});

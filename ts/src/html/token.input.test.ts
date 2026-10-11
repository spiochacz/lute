import { test } from "node:test";
import assert from "node:assert/strict";
import * as conv from "../runtime/conv.ts";
import * as token from "./token.ts";

// Go's tokenizer reads its input into its own buffer, so the caller's slice is never changed.
// The port works on a private copy (NewTokenizer and NewTokenizerFragment clone the input),
// and this test checks that the caller's array keeps its bytes after the tokenizer has run
// over entities, upper-case tag names and CR LF. Token(), Text(), TagName() and TagAttr()
// are called, because those are the calls that lower-case, unescape and convert newlines in
// place.

const doc = "<DIV Class=\"A&amp;B\" ID=x&lt;y>x &lt; y\r\n<P>é &#65; &unknown;</P><!-- c -->\r\n<br/>\r\n</DIV>\r\n";

test("tokenizing leaves the caller's input array unchanged", () => {
  const input = conv.BytesFromString(doc);
  const before = input.slice();

  // High-level API.
  const z = token.NewTokenizer(input);
  for (;;) {
    const tt = z.Next();
    if (tt === token.ErrorToken) {
      break;
    }
    z.Raw();
    z.Token();
  }
  assert.deepEqual(input, before);

  // Low-level API, on a second tokenizer over the same caller array.
  const z2 = token.NewTokenizer(input);
  for (;;) {
    const tt = z2.Next();
    if (tt === token.ErrorToken) {
      break;
    }
    z2.Raw();
    if (tt === token.TextToken) {
      z2.Text();
    } else if (tt === token.StartTagToken || tt === token.SelfClosingTagToken) {
      let [, more] = z2.TagName();
      while (more) {
        [, , more] = z2.TagAttr();
      }
    }
  }
  assert.deepEqual(input, before);
});

test("both tokenizers over the same input give the same tokens", () => {
  const input = conv.BytesFromString(doc);
  const first: string[] = [];
  const z = token.NewTokenizer(input);
  for (;;) {
    if (z.Next() === token.ErrorToken) {
      break;
    }
    first.push(z.Token().String());
  }
  const second: string[] = [];
  const z2 = token.NewTokenizer(input);
  for (;;) {
    if (z2.Next() === token.ErrorToken) {
      break;
    }
    second.push(z2.Token().String());
  }
  assert.deepEqual(second, first);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as tr from "./table_rich.ts";

type EncodeVector = { spec: number; format: string; content: string; encoded: string };
type DecodeVector = {
  input: string;
  valid: boolean;
  spec?: number;
  specRaw?: string;
  format?: string;
  content?: string;
  validateError?: boolean;
};

const vectors = JSON.parse(
  readFileSync(new URL("./testdata/table_rich_121_vectors.json", import.meta.url), "utf8"),
) as { encode: EncodeVector[]; decode: DecodeVector[] };

function richFrom(c: EncodeVector): tr.TableCellRich {
  const rich = new tr.TableCellRich();
  rich.Spec = c.spec;
  rich.Format = c.format;
  rich.Content = c.content;
  return rich;
}

test("table_rich vectors: encode cases include U+0008 and U+000C", () => {
  assert.ok(vectors.encode.length >= 500, `only ${vectors.encode.length} encode cases`);
  assert.ok(vectors.encode.some((c) => c.content.includes("\b")));
  assert.ok(vectors.encode.some((c) => c.content.includes("\f")));
});

test("TableCellRich.Encode matches Go 1.21 json.Marshal + base64 for every vector", () => {
  for (const c of vectors.encode) {
    assert.equal(richFrom(c).Encode(), c.encoded, JSON.stringify(c));
  }
});

test("TableCellRich: Encode of the Go 1.21 short forms uses \\u0008 and \\u000c", () => {
  const rich = new tr.TableCellRich();
  rich.Spec = 1;
  rich.Format = "kramdown";
  rich.Content = "\b\f";
  const decoded = Buffer.from(rich.Encode().replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  assert.equal(decoded, "{\"spec\":1,\"format\":\"kramdown\",\"content\":\"\\u0008\\u000c\"}");
});

test("DecodeTableCellRich matches Go 1.21 for every decode vector", () => {
  assert.ok(vectors.decode.length >= 90, `only ${vectors.decode.length} decode cases`);
  for (const c of vectors.decode) {
    const rich = tr.DecodeTableCellRich(c.input);
    const label = JSON.stringify(c.input);
    assert.equal(!rich.Invalid, c.valid, `valid mismatch for ${label}`);
    if (!c.valid) {
      assert.equal(rich.Raw, c.input, label);
      continue;
    }
    assert.equal(rich.Raw, "", label);
    assert.equal(rich.Spec, Number(c.specRaw), `spec for ${label}`);
    assert.equal(rich.Format, c.format, `format for ${label}`);
    assert.equal(rich.Content, c.content, `content for ${label}`);
    assert.equal(rich.Validate() !== null, c.validateError, `validate for ${label}`);
  }
});

test("DecodeTableCellRich: duplicate keys are checked per occurrence", () => {
  const enc = (s: string): string => Buffer.from(s, "utf8").toString("base64url");
  // A type error in the first occurrence fails the decode even when the last occurrence is valid.
  assert.equal(tr.DecodeTableCellRich(enc("{\"spec\":\"x\",\"spec\":1,\"format\":\"kramdown\",\"content\":\"x\"}")).Invalid, true);
  // A null in the last occurrence fails the map step.
  assert.equal(tr.DecodeTableCellRich(enc("{\"spec\":1,\"spec\":null,\"format\":\"kramdown\",\"content\":\"x\"}")).Invalid, true);
  // A null before a valid value is a no-op for the struct decode.
  const ok = tr.DecodeTableCellRich(enc("{\"spec\":null,\"spec\":1,\"format\":\"kramdown\",\"content\":\"x\"}"));
  assert.equal(ok.Invalid, false);
  assert.equal(ok.Spec, 1);
});

test("DecodeTableCellRich: integer literals must be int64 integers", () => {
  const enc = (s: string): string => Buffer.from(s, "utf8").toString("base64url");
  const withSpec = (spec: string): string => enc(`{"spec":${spec},"format":"kramdown","content":"x"}`);
  assert.equal(tr.DecodeTableCellRich(withSpec("1")).Invalid, false);
  assert.equal(tr.DecodeTableCellRich(withSpec("1.0")).Invalid, true);
  assert.equal(tr.DecodeTableCellRich(withSpec("1e0")).Invalid, true);
  assert.equal(tr.DecodeTableCellRich(withSpec("9223372036854775807")).Invalid, false);
  assert.equal(tr.DecodeTableCellRich(withSpec("9223372036854775808")).Invalid, true);
  assert.equal(tr.DecodeTableCellRich(withSpec("-9223372036854775808")).Invalid, false);
  assert.equal(tr.DecodeTableCellRich(withSpec("-9223372036854775809")).Invalid, true);
});

test("DecodeTableCellRich: a valid payload decodes and validates", () => {
  const rich = new tr.TableCellRich();
  rich.Spec = tr.TableCellRichSpec;
  rich.Format = tr.TableCellRichFormat;
  rich.Content = "a|b\nc\"d\\e<f>&g 中 😀";
  const back = tr.DecodeTableCellRich(rich.Encode());
  assert.equal(back.Invalid, false);
  assert.equal(back.Content, rich.Content);
  assert.equal(back.Validate(), null);
});

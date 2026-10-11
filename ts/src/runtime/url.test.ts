import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as url from "./url.ts";

type UserVector = { username: string; password: string; passwordSet: boolean } | null;
type UrlVector = {
  input: string;
  err: boolean;
  scheme: string;
  opaque: string;
  user: UserVector;
  host: string;
  path: string;
  rawPath: string;
  omitHost: boolean;
  forceQuery: boolean;
  rawQuery: string;
  fragment: string;
  rawFragment: string;
};

const vectors = JSON.parse(readFileSync(new URL("./testdata/url_vectors.json", import.meta.url), "utf8")) as {
  cases: UrlVector[];
};

test("url vectors: at least 400 inputs from Go 1.21 net/url.Parse", () => {
  assert.ok(vectors.cases.length >= 400, `only ${vectors.cases.length} cases`);
});

test("url.Parse matches Go 1.21 for every vector", () => {
  for (const c of vectors.cases) {
    const [u, err] = url.Parse(c.input);
    const label = JSON.stringify(c.input);
    assert.equal(err !== null, c.err, `error mismatch for ${label}: ${err?.message ?? "ok"}`);
    if (c.err) {
      assert.equal(u, null, label);
      continue;
    }
    assert.ok(u !== null, label);
    assert.equal(u.Scheme, c.scheme, `Scheme ${label}`);
    assert.equal(u.Opaque, c.opaque, `Opaque ${label}`);
    if (c.user === null) {
      assert.equal(u.User, null, `User ${label}`);
    } else {
      assert.ok(u.User !== null, `User ${label}`);
      assert.equal(u.User.username, c.user.username, `Username ${label}`);
      assert.equal(u.User.password, c.user.password, `Password ${label}`);
      assert.equal(u.User.passwordSet, c.user.passwordSet, `PasswordSet ${label}`);
    }
    assert.equal(u.Host, c.host, `Host ${label}`);
    assert.equal(u.Path, c.path, `Path ${label}`);
    assert.equal(u.RawPath, c.rawPath, `RawPath ${label}`);
    assert.equal(u.OmitHost, c.omitHost, `OmitHost ${label}`);
    assert.equal(u.ForceQuery, c.forceQuery, `ForceQuery ${label}`);
    assert.equal(u.RawQuery, c.rawQuery, `RawQuery ${label}`);
    assert.equal(u.Fragment, c.fragment, `Fragment ${label}`);
    assert.equal(u.RawFragment, c.rawFragment, `RawFragment ${label}`);
  }
});

test("url.Parse: named cases", () => {
  const [u, err] = url.Parse("https://user:pw@example.com:8080/a%2Fb?x=1#frag");
  assert.equal(err, null);
  assert.equal(u!.Scheme, "https");
  assert.equal(u!.Host, "example.com:8080");
  assert.equal(u!.Path, "/a/b");
  assert.equal(u!.RawPath, "/a%2Fb");
  assert.equal(u!.RawQuery, "x=1");
  assert.equal(u!.Fragment, "frag");
  assert.equal(url.Parse("http://[::1")[1]?.message, "parse \"http://[::1\": missing ']' in host");
  assert.equal(url.Parse("a:b:c/d")[0]?.Scheme, "a");
  assert.equal(url.Parse("1a:b")[1]?.message, "parse \"1a:b\": first path segment in URL cannot contain colon");
  assert.equal(url.Parse(":x")[1]?.message, "parse \":x\": missing protocol scheme");
});

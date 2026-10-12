import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The build script is plain JavaScript; it is loaded through a variable path so that the type checker does not need a declaration for it.
type Departures = {
  buildDepartures: () => string;
  goReference: (text: string) => { file: string; fn: string };
  kindOf: (text: string) => string;
};
const modulePath = "../tools/departures/build.mjs";
const mod = (await import(modulePath)) as Departures;

test("DEPARTURES.md is up to date with the PORT-NOTE comments and the oracle patches", () => {
  const want = mod.buildDepartures();
  const got = readFileSync(new URL("../DEPARTURES.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal(got, want, "ts/DEPARTURES.md is out of date: run `npm run departures` in ts/ and commit the result");
});

test("goReference reads the Go file and the function a note names", () => {
  assert.deepEqual(mod.goReference("departs from html/escape.go:unescapeEntity: the entity name"), { file: "html/escape.go", fn: "unescapeEntity" });
  assert.deepEqual(mod.goReference("departs from 1:1 (render/vditor_sv_renderer.go:881, 1091, renderX): rewrite"), {
    file: "render/vditor_sv_renderer.go",
    fn: "renderX",
  });
  assert.deepEqual(mod.goReference("departs from vditor_wysiwyg.go:179-181: removeWbr"), { file: "vditor_wysiwyg.go", fn: "" });
  assert.deepEqual(mod.goReference("departs from Go's string(b) conversion (no Lute source line; runtime layer)"), { file: "", fn: "" });
});

test("kindOf takes the kind from the first words of a note", () => {
  assert.equal(mod.kindOf("perf, departs from x"), "perf");
  assert.equal(mod.kindOf("Behaviour: differs"), "behaviour");
  assert.equal(mod.kindOf("behavior: differs"), "behaviour");
  assert.equal(mod.kindOf("New code for the cache"), "new code");
  assert.equal(mod.kindOf("Go embedding, base method"), "other");
  assert.equal(mod.kindOf("performance of x"), "other");
});

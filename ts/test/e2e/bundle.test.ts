// The drop-in bundle: dist/lute.min.js (built by `npm run build`) is loaded as a consumer would load it, in a fresh Node process, next to the
// reference bundle test/oracle/lute.ref.min.cjs (or $LUTE_ORACLE) in another fresh process, so that the two `globalThis.Lute` never mix.
// bundle_driver.mjs makes a fixed list of calls in each process and prints the results as JSON; the test compares the two documents.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { oraclePath, normalizeIDs } from "../oracle/oracle.ts";

const TS_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DRIVER = fileURLToPath(new URL("./bundle_driver.mjs", import.meta.url));
const PORT_BUNDLE = fileURLToPath(new URL("../../dist/lute.min.js", import.meta.url));

interface Report {
  keys: string[];
  version: string;
  consts: Record<string, unknown>;
  engineFunctions: string[];
  results: [label: string, value: string][];
}

// Always rebuilds: the bundle build takes well under a second and the test then never runs against a stale bundle.
function build(): void {
  const r = spawnSync(process.execPath, ["scripts/build.mjs", "--no-types"], { cwd: TS_ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, `the build failed:\n${r.stdout}\n${r.stderr}`);
  assert.ok(existsSync(PORT_BUNDLE), "build did not produce dist/lute.min.js");
}

function drive(bundle: string): Report {
  const r = spawnSync(process.execPath, [DRIVER, bundle], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(r.status, 0, `driver failed for ${bundle}:\n${r.stderr}`);
  return JSON.parse(r.stdout) as Report;
}

let reports: { port: Report; reference: Report } | undefined;
function both(): { port: Report; reference: Report } {
  if (reports === undefined) {
    build();
    reports = { port: drive(PORT_BUNDLE), reference: drive(oraclePath()) };
  }
  return reports;
}

test("the global object has the same keys, version and constants", () => {
  const { port, reference } = both();
  assert.deepEqual(port.keys, reference.keys);
  assert.equal(port.version, reference.version);
  assert.deepEqual(port.consts, reference.consts);
});

test("an engine has the same function-valued keys", () => {
  const { port, reference } = both();
  assert.deepEqual(port.engineFunctions, reference.engineFunctions);
  assert.ok(port.engineFunctions.length >= 152, `only ${port.engineFunctions.length} functions`);
});

test("about 300 calls give equal results (IDs and timestamps normalised)", () => {
  const { port, reference } = both();
  assert.ok(reference.results.length >= 300, `only ${reference.results.length} calls`);
  assert.deepEqual(
    port.results.map(([label]) => label),
    reference.results.map(([label]) => label),
  );
  const normalize = (s: string): string => normalizeIDs(s).replace(/updated=\\"\d{14}\\"/g, 'updated=\\"TIMESTAMP\\"').replace(/\\"updated\\":\\"\d{14}\\"/g, '\\"updated\\":\\"TIMESTAMP\\"');
  const differences: string[] = [];
  let threw = 0;
  for (let i = 0; i < reference.results.length; i++) {
    const [label, expected] = reference.results[i];
    const actual = port.results[i][1];
    if (expected === "THROW") {
      threw++;
    }
    if (normalize(actual) !== normalize(expected)) {
      differences.push(`${label}\n  port:      ${actual.slice(0, 200)}\n  reference: ${expected.slice(0, 200)}`);
    }
  }
  console.log(`bundle: ${reference.results.length} calls compared, the reference threw in ${threw} of them`);
  assert.deepEqual(differences.slice(0, 5), []);
  assert.equal(differences.length, 0);
});

test("the global functions work on both bundles", () => {
  const { port, reference } = both();
  for (const label of ["NewNodeID shape", "renderers/heading ids"]) {
    const p = port.results.find(([l]) => l === label)!;
    const r = reference.results.find(([l]) => l === label)!;
    assert.equal(normalizeIDs(p[1]), normalizeIDs(r[1]), label);
  }
  assert.ok(port.results.some(([l, v]) => l === "renderers/heading ids" && v !== "[]"), "GetHeadingID was never called from a renderer");
});

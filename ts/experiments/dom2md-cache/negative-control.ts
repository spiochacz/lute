// Negative controls: deliberately wrong versions of the rules in cached.ts, each made by rewriting ONE
// statement of a scratch copy (the statements are marked "NC:" in cached.ts), then run through fuzz.ts.
// The controls with names "allow-*" are not wrong rules but the removal of a fallback: they show whether
// the fallback is necessary (the fuzzer finds a mismatch) or only precautionary (it does not).
//
//   node negative-control.ts [--only=a,b] [--cmp=4000] [--seed=7] [--mode=both]
//
// The scratch copies go to $D2M_SCRATCH (default: the OS temp directory); the repository is not touched.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const scratch = (process.env.D2M_SCRATCH ?? tmpdir()) + "/d2m-mut";
mkdirSync(scratch, { recursive: true });

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? "1");
}

// name -> [statement in cached.ts, replacement, what is wrong]
const MUTATIONS: Record<string, [string, string, string]> = {
  constsep: ['const joined = parts.join(""); // NC: assemble', 'const joined = parts.map(trimBlank).join("\\n\\n"); // MUTANT', "constant blank line between trimmed parts"],
  "trim-parts": ['const joined = parts.join(""); // NC: assemble', 'const joined = parts.map((p) => trimBlank(p) + "\\n\\n").join(""); // MUTANT', "every part trimmed, then a blank line added"],
  "no-next-bit": ['if (bits[i] && ch[i].tag === "p" && raw[i].indexOf("<br") >= 0) v |= 1; // NC: next-bit', "// MUTANT", "ignore the next-sibling bit of the <br> rule"],
  "no-last-bit": ["if (i === lastEmit) v |= 2; // NC: last-bit", "// MUTANT", "never use the last-AST-node variant"],
  "dom-last": ["const lastEmit = lastEmitting(entries); // NC: last-emit", "const lastEmit = n - 1; // MUTANT", "last means last DOM child, not last AST node"],
  "raw-neighbours": ["const alive = (i: number): boolean => entries[i]!.alive; // NC: alive", "const alive = (_i: number): boolean => true; // MUTANT", "sibling rules look at raw neighbours, not at those that survive removeEmptyNodes"],
  "no-adjacent-lists": ["b.attrs === 1) { // NC: adjacent-lists", "b.attrs === 1 && false) { // MUTANT", "no fallback for the list merge rule"],
  "no-fingerprint": ["const fp = this.fingerprint(); // NC: fingerprint", 'const fp = ""; // MUTANT', "options changes do not invalidate the cache"],
  "no-leak-check": ["if (tree.Context.Tip !== tree.Root) { // NC: leak-check", "if (false) { // MUTANT", "children that leave the AST builder's Tip open are accepted"],
  "no-clean-check": ["if (c.opaque && !cleanParse(child, c)) { // NC: clean-check", "if (false) { // MUTANT", "opaque preview content is not checked with the parser"],
  "allow-link-ref-defs": ['new Set(["code-block", ', 'new Set(["link-ref-defs-block", "code-block", ', "fallback removed: link-ref-defs-block composes"],
  "allow-footnotes": ['new Set(["code-block", ', 'new Set(["footnotes-block", "code-block", ', "fallback removed: footnotes-block composes"],
  "allow-other-div": ['if (c.tag === "div" && CACHEABLE_DIV_TYPES.has(c.dataType)) { // NC: div-kinds', 'if (c.tag === "div") { // MUTANT', "fallback removed: any div composes"],
  "allow-top-inline": ['const BLOCK_TAGS = new Set(["p", ', 'const BLOCK_TAGS = new Set(["span", "a", "em", "strong", "code", "b", "i", "p", ', "fallback removed: top-level inline elements compose"],
};

const original = readFileSync(here + "cached.ts", "utf8");
const srcUrl = pathToFileURL(here + "../../src/index.ts").href;
const scanUrl = pathToFileURL(here + "scan.ts").href;
const fuzz = here + "fuzz.ts";

const only = args.has("only") ? args.get("only")!.split(",") : Object.keys(MUTATIONS);
for (const name of only) {
  const m = MUTATIONS[name];
  if (!m) throw new Error("unknown mutation " + name);
  const [from, to, what] = m;
  if (!original.includes(from)) throw new Error("statement for " + name + " not found in cached.ts");
  const text = original
    .replace(from, () => to)
    .replace('"../../src/index.ts"', JSON.stringify(srcUrl))
    .replace('"../../src/index.ts"', JSON.stringify(srcUrl))
    .replace('"./scan.ts"', JSON.stringify(scanUrl))
    .replace('"./scan.ts"', JSON.stringify(scanUrl));
  const file = scratch + "/cached." + name + ".ts";
  writeFileSync(file, text);
  const r = spawnSync(process.execPath, [fuzz, "--mode=" + (args.get("mode") ?? "both"), "--cmp=" + (args.get("cmp") ?? "4000"), "--seed=" + (args.get("seed") ?? "7")], {
    env: { ...process.env, D2M_CACHED: pathToFileURL(file).href },
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const lines = out.split("\n");
  console.log(`### ${name}: ${what}`);
  for (const l of lines) {
    if (l.startsWith("== ")) console.log("  " + l.replace(/ splitAudits=\d+ splitDisagreements=\d+/, ""));
  }
  const i = lines.findIndex((l) => l.includes("MINIMAL"));
  if (i >= 0) console.log("  first reduced case: " + lines[i].trim().slice(0, 420));
}

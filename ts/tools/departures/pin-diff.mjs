// Prints the departures that must be re-checked when the upstream pin moves: the rows of the manifest (see build.mjs) whose Go file changed
// between two upstream commits. Read-only: it runs `git rev-parse`, `git cat-file` and `git diff --name-only`.
//
// Usage: npm run departures:pin-diff -- <old commit> <new commit>
// Example: npm run departures:pin-diff -- f47ad925bd9723025c464b3bbccf479f68ed1600 $(cat ts/UPSTREAM_PIN)

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { collectNotes } from "./build.mjs";

const tsRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = path.resolve(tsRoot, "..");

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// changedGoFiles returns the Go files (repository paths, forward slashes) that differ between the two commits, sorted.
export function changedGoFiles(oldRef, newRef) {
  for (const ref of [oldRef, newRef]) {
    git(["cat-file", "-t", ref + "^{commit}"]);
  }
  const names = git(["diff", "--name-only", oldRef, newRef, "--", "*.go"]).split("\n").filter((n) => n !== "");
  return [...new Set(names)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// departuresFor returns the manifest rows that name one of the given Go files.
export function departuresFor(goFiles, notes = collectNotes()) {
  const wanted = new Set(goFiles);
  return notes.filter((n) => n.goFile !== "" && wanted.has(n.goFile));
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const [oldRef, newRef] = process.argv.slice(2);
  if (!oldRef || !newRef) {
    console.error("usage: npm run departures:pin-diff -- <old commit> <new commit>");
    process.exit(2);
  }
  const changed = changedGoFiles(oldRef, newRef);
  const rows = departuresFor(changed);
  console.log(`Go files changed between ${oldRef.slice(0, 8)} and ${newRef.slice(0, 8)}: ${changed.length}`);
  for (const f of changed) {
    console.log(`  ${f}`);
  }
  console.log(`departure rows naming a changed Go file: ${rows.length}`);
  for (const r of rows) {
    const fn = r.goFunction === "" ? "" : ` (${r.goFunction})`;
    console.log(`- ts/${r.file}:${r.line} [${r.kind}] ${r.goFile}${fn}: ${r.text.slice(0, 120)}${r.text.length > 120 ? "..." : ""}`);
  }
}

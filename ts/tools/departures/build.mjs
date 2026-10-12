// Writes ts/DEPARTURES.md: the manifest of the places where the TypeScript port departs from the Go source.
//
// The rows are the PORT-NOTE comments of ts/src (test files excluded), one row per note, in path and line order. For each note the
// manifest gives the file and line, the kind (taken from the first word of the note: perf, behaviour, new code, or other), the Go file and
// function the note names when it names one, and the text. A note that spans several comment lines is one row; the following comment
// lines belong to it. The oracle patches in ts/tools/oracle/patches/ are listed with the purpose that test/oracle/README.md gives them.
//
// Output is deterministic (sorted, LF, no timestamps), so the file can be committed and diffed. test/departures.test.ts fails when the
// committed file differs from this output.
//
// Usage: node tools/departures/build.mjs            (writes ts/DEPARTURES.md)
//        import { buildDepartures, collectNotes } from "./tools/departures/build.mjs"   (tests and pin-diff.mjs)

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const tsRoot = fileURLToPath(new URL("../../", import.meta.url));

// collectNotes returns one object per PORT-NOTE of the TypeScript sources under tsRoot/src, sorted by file and line.
// Each object: { file (relative to tsRoot, forward slashes), line (1-based), kind, goFile, goFunction, text }.
export function collectNotes(root = tsRoot) {
  const srcDir = path.join(root, "src");
  const files = [];
  walk(srcDir, (p) => {
    if (p.endsWith(".ts") && !p.endsWith(".test.ts")) {
      files.push(p);
    }
  });
  const rel = (p) => path.relative(root, p).split(path.sep).join("/");
  files.sort((a, b) => (rel(a) < rel(b) ? -1 : rel(a) > rel(b) ? 1 : 0));
  const notes = [];
  for (const p of files) {
    const lines = readFileSync(p, "utf8").split("\n").map((l) => l.replace(/\r$/, ""));
    for (let i = 0; i < lines.length; i++) {
      const at = lines[i].indexOf("PORT-NOTE:");
      const slash = lines[i].indexOf("//");
      if (at < 0 || slash < 0 || slash > at) {
        continue;
      }
      const parts = [lines[i].slice(at + "PORT-NOTE:".length).trim()];
      for (let j = i + 1; j < lines.length; j++) {
        const m = /^\s*\/\/(.*)$/.exec(lines[j]);
        if (m === null || lines[j].includes("PORT-NOTE:")) {
          break;
        }
        const part = m[1].trim();
        if (part === "") {
          break;
        }
        parts.push(part);
      }
      const text = parts.join(" ").replace(/\s+/g, " ").trim();
      const go = goReference(text);
      notes.push({ file: rel(p), line: i + 1, kind: kindOf(text), goFile: go.file, goFunction: go.fn, text });
    }
  }
  return notes;
}

// kindOf takes the kind from the first words of the note.
export function kindOf(text) {
  const head = text.toLowerCase();
  if (/^perf\b/.test(head)) {
    return "perf";
  }
  if (/^behaviou?r\b/.test(head)) {
    return "behaviour";
  }
  if (/^new code\b/.test(head)) {
    return "new code";
  }
  return "other";
}

// goReference finds the first Go file the note names and, after it, the function: "file.go:name", or "file.go:881, name" (the
// "1:1 (file.go:line, name)" form). It gives "" for a note that names no Go file or no function.
export function goReference(text) {
  const m = /([A-Za-z0-9_][A-Za-z0-9_/.-]*\.go)\b/.exec(text);
  if (m === null) {
    return { file: "", fn: "" };
  }
  const after = text.slice(m.index + m[1].length, m.index + m[1].length + 60);
  let fn = "";
  const lineThenName = /^:\d+(?:[-,]\s*\d+)*,\s*([A-Za-z_]\w*)/.exec(after);
  const nameDirect = /^:([A-Za-z_]\w*)/.exec(after);
  if (lineThenName !== null) {
    fn = lineThenName[1];
  } else if (nameDirect !== null) {
    fn = nameDirect[1];
  }
  return { file: m[1], fn };
}

// oraclePatches returns the patch file names of ts/tools/oracle/patches (sorted) with their purpose from test/oracle/README.md.
export function oraclePatches(root = tsRoot) {
  const dir = path.join(root, "tools", "oracle", "patches");
  const names = readdirSync(dir).filter((n) => n.endsWith(".patch")).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const readme = readFileSync(path.join(root, "test", "oracle", "README.md"), "utf8").replace(/\r/g, "").replace(/\s+/g, " ");
  return names.map((name) => {
    const at = readme.indexOf("Patch `" + name + "`: ");
    let purpose = "(no purpose line in test/oracle/README.md)";
    if (at >= 0) {
      const rest = readme.slice(at + ("Patch `" + name + "`: ").length);
      const end = rest.indexOf(". ");
      purpose = (end < 0 ? rest : rest.slice(0, end + 1)).trim();
    }
    return { name, purpose };
  });
}

// buildDepartures returns the text of ts/DEPARTURES.md.
export function buildDepartures(root = tsRoot) {
  const notes = collectNotes(root);
  const pin = readFileSync(path.join(root, "UPSTREAM_PIN"), "utf8").trim();
  const out = [];
  out.push("# Departures from the Go source");
  out.push("");
  out.push("Generated by `ts/tools/departures/build.mjs` (`npm run departures`). Do not edit by hand; `ts/test/departures.test.ts` fails when this file is out of date.");
  out.push("");
  out.push(`Upstream pin: \`${pin}\`. Rows are the \`PORT-NOTE\` comments of \`ts/src\` (test files excluded), in path and line order. The Go file and function are the first ones the note names.`);
  out.push("");
  out.push(`## Notes (${notes.length})`);
  out.push("");
  out.push("| File | Line | Kind | Go file | Go function | Note |");
  out.push("|---|---|---|---|---|---|");
  for (const n of notes) {
    const cell = (s) => s.replace(/\|/g, "\\|");
    out.push(
      `| \`ts/${n.file}\` | ${n.line} | ${n.kind} | ${n.goFile === "" ? "" : "`" + n.goFile + "`"} | ${n.goFunction === "" ? "" : "`" + n.goFunction + "`"} | ${cell(n.text)} |`,
    );
  }
  out.push("");
  const patches = oraclePatches(root);
  out.push(`## Oracle patches (${patches.length})`);
  out.push("");
  out.push("The patches in `ts/tools/oracle/patches/` that the reference bundle is built with (see `ts/test/oracle/README.md`).");
  out.push("");
  out.push("| Patch | Purpose |");
  out.push("|---|---|");
  for (const p of patches) {
    out.push(`| \`${p.name}\` | ${p.purpose.replace(/\|/g, "\\|")} |`);
  }
  out.push("");
  return out.join("\n");
}

function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    if (name === "testdata" || name === "node_modules") {
      continue;
    }
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, visit);
    } else {
      visit(p);
    }
  }
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const target = path.join(tsRoot, "DEPARTURES.md");
  writeFileSync(target, buildDepartures(tsRoot), "utf8");
  console.log(`wrote ${path.relative(process.cwd(), target)}`);
}

export const tsRootUrl = pathToFileURL(tsRoot).href;

// Corpus for the differential fuzzer: Markdown from the repository's test inputs, converted to Vditor
// DOM by the REFERENCE bundle (the GopherJS build) with its own forward methods, then split into
// top-level children.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { newEngines, REPO_ROOT } from "../../test/e2e/helpers.ts";
import type { Engines, SetterCall } from "../../test/e2e/helpers.ts";
import { splitTopLevel } from "./scan.ts";
import type { Mode } from "./cached.ts";

export interface Config {
  name: string;
  setters: (mode: Mode) => SetterCall[];
  protyle?: boolean; // the config turns ProtyleWYSIWYG on (the fuzzer toggles it from this starting point)
}

const modeFlag = (mode: Mode): SetterCall[] => [[mode === "wysiwyg" ? "SetVditorWYSIWYG" : "SetVditorIR", true]];

// Option sets: Vditor's own setLute.ts defaults plus the mode flag it sets in EditMode.ts; the same
// with ToC, with more optional syntax, and the plain engine defaults.
export const CONFIGS: Config[] = [
  { name: "vditor", setters: (m) => [...modeFlag(m), ["SetAutoSpace", false], ["SetCallout", false], ["SetToC", false], ["SetFootnotes", true], ["SetFixTermTypo", false], ["SetVditorCodeBlockPreview", true], ["SetVditorMathBlockPreview", true], ["SetMark", false], ["SetGFMAutoLink", true]] },
  { name: "vditor+toc+callout", setters: (m) => [...modeFlag(m), ["SetAutoSpace", true], ["SetCallout", true], ["SetToC", true], ["SetFootnotes", true], ["SetFixTermTypo", true], ["SetVditorCodeBlockPreview", true], ["SetVditorMathBlockPreview", true], ["SetVditorHTMLBlockPreview", true], ["SetMark", true], ["SetSup", true], ["SetSub", true], ["SetInlineMath", true]] },
  { name: "protyle+ial+spin", protyle: true, setters: (m) => [...modeFlag(m), ["SetProtyleWYSIWYG", true], ["SetKramdownBlockIAL", true], ["SetKramdownSpanIAL", true], ["SetKramdownIAL", true], ["SetSpin", true], ["SetVditorCodeBlockPreview", true]] },
  { name: "defaults", setters: (m) => [...modeFlag(m)] },
  { name: "no-preview+list-style", setters: (m) => [...modeFlag(m), ["SetVditorCodeBlockPreview", false], ["SetVditorMathBlockPreview", false], ["SetRenderListStyle", true], ["SetChineseParagraphBeginningSpace", true], ["SetSoftBreak2HardBreak", false]] },
];

export function engines(cfg: Config, mode: Mode): Engines {
  return newEngines(cfg.setters(mode));
}

function readRepo(rel: string): string {
  return readFileSync(REPO_ROOT + rel, "utf8");
}

export interface MdDoc {
  name: string;
  md: string;
  real: boolean; // a real document (file of the repository), not a unit-test snippet
}

export function loadMarkdownCorpus(): MdDoc[] {
  const docs: MdDoc[] = [];
  const files = [
    "test/case1.md", "README.md", "README_en_US.md", "test/format-case0.md", "test/format-case1.md",
    "test/format-case2.md", "test/format-case3.md", "test/format-case4.md", "test/format-case5.md",
    "test/format-case6.md", "test/format-case7.md", "benchmark/commonmark-spec.md", "test/commonmark-spec.md",
    "test/gfm-spec.md", "ts/PORTING.md", "tasks/001-analysis.md", "tasks/002-upstream-bugs.md",
    "tasks/003-performance-plan.md", "tasks/004-incremental-and-fast-paths.md",
  ];
  for (const f of files) {
    try {
      docs.push({ name: f, md: readRepo(f).replace(/\r\n?/g, "\n"), real: true });
    } catch {
      // a file that does not exist in this checkout is skipped
    }
  }
  const dir = fileURLToPath(new URL("../../test/go/cases/", import.meta.url));
  for (const f of readdirSync(dir).sort()) {
    const j = JSON.parse(readFileSync(dir + f, "utf8")) as Record<string, unknown>;
    for (const [table, rows] of Object.entries(j)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (Array.isArray(row) && typeof row[1] === "string" && row[1].length > 0 && row[1].length < 6000) {
          docs.push({ name: f + ":" + table + ":" + row[0], md: row[1].replace(/\r\n?/g, "\n"), real: false });
        }
      }
    }
  }
  return docs;
}

// DOM documents written by hand in the Go test tables (vditorDOM2MdTests, vditorIRDOM2MdTests).
export function loadHandWrittenDom(mode: Mode): string[] {
  const dir = fileURLToPath(new URL("../../test/go/cases/", import.meta.url));
  const key = mode === "wysiwyg" ? "vditorDOM2MdTests" : "vditorIRDOM2MdTests";
  const out: string[] = [];
  for (const f of ["v2m_test.json"]) {
    const j = JSON.parse(readFileSync(dir + f, "utf8")) as Record<string, unknown>;
    const rows = j[key];
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (Array.isArray(row) && typeof row[1] === "string") out.push(row[1]);
      }
    }
  }
  return out;
}

export interface DomDoc {
  name: string;
  html: string;
  real: boolean;
  children: string[] | null; // null when the splitter refused the document
  splitReason: string;
}

// Forward conversion by the reference bundle.
export function forward(oracle: Engines["oracle"], mode: Mode, md: string): string {
  return mode === "wysiwyg" ? oracle.Md2VditorDOM(md) : oracle.Md2VditorIRDOM(md);
}

export function buildDomDocs(cfg: Config, mode: Mode, mds: MdDoc[]): DomDoc[] {
  const { oracle } = engines(cfg, mode);
  const out: DomDoc[] = [];
  for (const d of mds) {
    let html: string;
    try {
      html = forward(oracle, mode, d.md);
    } catch {
      continue;
    }
    const sp = splitTopLevel(html);
    out.push({
      name: d.name,
      html,
      real: d.real,
      children: sp.ok ? sp.children.map((c) => html.substring(c.start, c.end)) : null,
      splitReason: sp.ok ? "" : sp.reason,
    });
  }
  return out;
}

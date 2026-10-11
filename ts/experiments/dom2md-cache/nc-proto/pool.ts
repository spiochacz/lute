import { scanTopLevel } from "../../../src/incremental/scanner.ts";
import { auditDocuments } from "../../../test/incremental/corpus_docs.ts";
for (const mode of ["wysiwyg", "ir"] as const) {
  const out: string[] = []; let total = 0; const all = new Set<string>();
  for (const d of auditDocuments()) {
    if (d.mode !== mode) continue;
    const sc = scanTopLevel(d.html); if (!sc.ok) continue;
    for (const c of sc.children) if (!c.opaque) { total++; all.add(d.html.substring(c.start, c.end)); if (out.length < 400) out.push(d.html.substring(c.start, c.end)); }
  }
  const has = (re: RegExp): number => out.filter((h) => re.test(h)).length;
  console.log(mode, "pool", out.length, "of", total, "children,", all.size, "unique;",
    "indented-code p:", has(/^<p[^>]*>‸?\s{4}/), "link-ref:", has(/link-ref-defs-block/), "table:", has(/^<table/), "p+br:", has(/^<p[^>]*>[^<]*<br/), "ul:", has(/^<ul/), "blockquote:", has(/^<blockquote/), "pre div:", has(/^<div/), "unique in pool:", new Set(out).size);
}

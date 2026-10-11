import { writeFileSync } from "node:fs";
import { auditDocuments } from "../../../test/incremental/corpus_docs.ts";
import { scanTopLevel } from "../../../src/incremental/scanner.ts";
const out: { docs: { name: string; mode: string; html: string; kids: string[] }[] } = { docs: [] };
for (const d of auditDocuments()) {
  const sc = scanTopLevel(d.html);
  if (!sc.ok) continue;
  const kids = sc.children.map((c) => d.html.substring(c.start, c.end));
  const opaque = sc.children.some((c) => c.opaque);
  if (opaque) continue;
  out.docs.push({ name: d.name, mode: d.mode, html: d.html, kids });
}
writeFileSync(process.argv[2], JSON.stringify(out));
console.log(out.docs.length);

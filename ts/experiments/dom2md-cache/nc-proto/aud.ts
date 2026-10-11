import { auditDocuments } from "../../../test/incremental/corpus_docs.ts";
const t = Date.now(); const d = auditDocuments(); console.log("auditDocuments", Date.now() - t, "ms", d.length, "docs");
const t2 = Date.now(); auditDocuments(); console.log("second call", Date.now() - t2, "ms");

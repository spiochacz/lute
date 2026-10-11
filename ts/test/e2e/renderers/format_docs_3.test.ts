import { test } from "node:test";
import { runDocs } from "./format_docs.ts";

test("short documents (3 of 6): port equals oracle, formatted output is idempotent", () => {
  runDocs(14, 21);
});

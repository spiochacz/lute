import { test } from "node:test";
import { runDocs } from "./format_docs.ts";

test("short documents (2 of 6): port equals oracle, formatted output is idempotent", () => {
  runDocs(7, 14);
});

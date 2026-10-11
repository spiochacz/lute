import { test } from "node:test";
import { runDocs } from "./format_docs.ts";

test("short documents (1 of 6): port equals oracle, formatted output is idempotent", () => {
  runDocs(0, 7);
});

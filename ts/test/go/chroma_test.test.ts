// Port of test/chroma_test.go: calls the Chroma library directly (github.com/alecthomas/chroma/v2/quick), which the port does not have.
import { test } from "node:test";

test("TestChroma", { skip: "javascript build variant has no syntax highlighting" }, () => {});

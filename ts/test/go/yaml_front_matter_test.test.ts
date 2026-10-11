// Port of test/yaml_front_matter_test.go. Tables are read from cases/yaml_front_matter_test.json (tools/go-tests/extract-tables-s.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import { goTable } from "./go_tables_s.ts";

test("TestYamlFrontMatter", () => {
  const luteEngine = New();
  // YAML Front Matter support is on by default.
  for (const [name, from, to] of goTable("yaml_front_matter_test", "yamlFrontMatterTests", 1)) {
    const html = luteEngine.MarkdownStr(name, from);
    assert.equal(html, to, `test case [${name}] failed, original markdown text ${JSON.stringify(from)}`);
  }
});


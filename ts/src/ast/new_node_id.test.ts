import { test } from "node:test";
import assert from "node:assert/strict";
import * as ast from "./index.ts";

// NewNodeID without testing: format, pattern, and the local time in the first 14 characters (within 2 seconds).
test("NewNodeID without testing has the yyyymmddhhmmss-xxxxxxx form and the current local time", () => {
  for (let i = 0; i < 50; i++) {
    const before = Date.now();
    const id = ast.NewNodeID();
    const after = Date.now();
    assert.equal(id.length, 22);
    assert.equal(ast.IsNodeIDPattern(id), true, id);
    assert.match(id, /^\d{14}-[a-z0-9]{7}$/);

    const t = id.substring(0, 14);
    const parsed = new Date(
      Number(t.substring(0, 4)),
      Number(t.substring(4, 6)) - 1,
      Number(t.substring(6, 8)),
      Number(t.substring(8, 10)),
      Number(t.substring(10, 12)),
      Number(t.substring(12, 14))
    ).getTime();
    // The ID has whole seconds (truncated), so the parsed time can be up to 1 second before the call and never after it.
    assert.ok(Math.abs(parsed - before) <= 2000 && parsed <= after, "time of " + id);
  }
});

test("NewNodeID random part changes between calls", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    seen.add(ast.NewNodeID().substring(15));
  }
  assert.ok(seen.size > 1);
});

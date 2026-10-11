// Port of test/panic_test.go (TestRecover).
//
// Go: a goroutine panics with "test panic" under `defer util.RecoverPanic(&err)`; the native util.RecoverPanic (util/panic.go)
// recovers it and stores an error, the test only logs err and passes. The JavaScript build variant (util/panicjs.go, `+build javascript`)
// is an empty function, and the port implements that variant (src/util/panic.ts): a panic is a thrown exception that propagates.
// So the outcome that differs from native Go is asserted: the exception is NOT swallowed (JS_BUILD_DIFFERENCE).
// There are no goroutines here; the sync.WaitGroup is not applicable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { util } from "../../src/index.ts";

test("TestRecover", () => {
  let err: Error | null = null;
  const body = (): void => {
    try {
      throw new Error("test panic"); // panic("test panic")
    } finally {
      util.RecoverPanic(err); // defer util.RecoverPanic(&err)
    }
  };
  // JS_BUILD_DIFFERENCE: native Go recovers the panic (err != nil, no crash); the javascript build variant does not.
  assert.throws(body, /test panic/);
  // RecoverPanic itself never throws and leaves err untouched in this build variant.
  assert.doesNotThrow(() => util.RecoverPanic(err));
  assert.equal(err, null);
  err = null;
});

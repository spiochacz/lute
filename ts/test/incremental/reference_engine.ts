// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// The reference engine of the differential tests: an engine whose policy is "off", so that its VditorDOM2Md and VditorIRDOM2Md are the normal path.
// A new engine has the policy "auto", which can start the cache by itself for large similar documents; a reference that could start it would be
// compared with the cache, not with the normal path.

import { New, SetIncrementalDom2MdPolicy } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";

export function referenceEngine(): Lute {
  const lute = New();
  SetIncrementalDom2MdPolicy(lute, "off");
  return lute;
}

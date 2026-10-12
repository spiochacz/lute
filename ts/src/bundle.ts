// Entry of the script build (dist/lute.min.js). It does what main() of javascript/main.go does: it sets the global `Lute` object.

// The per-child cache registers its handler when its module is loaded (New in the TypeScript port). The bundle loads it explicitly, so that the
// engine of the bundle has the automatic policy of the cache (src/incremental/policy.ts) in every build.
import "./incremental/index.ts";
import { makeGlobal } from "./index.ts";

(globalThis as unknown as { Lute: unknown }).Lute = makeGlobal();

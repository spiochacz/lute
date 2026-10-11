// Entry of the script build (dist/lute.min.js). It does what main() of javascript/main.go does: it sets the global `Lute` object.

import { makeGlobal } from "./index.ts";

(globalThis as unknown as { Lute: unknown }).Lute = makeGlobal();

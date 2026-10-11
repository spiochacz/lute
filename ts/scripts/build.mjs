// Builds dist/ from src/:
//   dist/lute.min.js   minified IIFE of src/bundle.ts that sets globalThis.Lute (drop-in for javascript/lute.min.js)
//   dist/lute.esm.js   plain ESM build of src/index.ts
//   dist/types/        type declarations of src/index.ts (tsc, tsconfig.build.json)
// Flags: --sourcemap writes dist/lute.min.js.map and dist/lute.esm.js.map; --no-types skips the declarations (the bundle test uses it).
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);

const sourcemap = process.argv.includes("--sourcemap");

mkdirSync("dist", { recursive: true });

const common = {
  bundle: true,
  target: "es2022",
  logLevel: "info",
  sourcemap,
};

await build({
  ...common,
  entryPoints: ["src/bundle.ts"],
  outfile: "dist/lute.min.js",
  format: "iife",
  minifySyntax: true,
  minifyWhitespace: true,
  minifyIdentifiers: true,
});

await build({
  ...common,
  entryPoints: ["src/index.ts"],
  outfile: "dist/lute.esm.js",
  format: "esm",
  minify: false,
});

if (process.argv.includes("--no-types")) {
  process.exit(0);
}
rmSync("dist/types", { recursive: true, force: true });
const tsc = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], { stdio: "inherit" });
if (tsc.status !== 0) {
  console.error("type declaration emit failed");
  process.exit(tsc.status ?? 1);
}

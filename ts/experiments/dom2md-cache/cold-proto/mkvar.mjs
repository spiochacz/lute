import { readFileSync, writeFileSync } from "node:fs";
let s = readFileSync("sandbox_timed.ts", "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing: " + a); s = s.replace(a, b); };
// variant switches via globals
rep("export const T:", "export const SW = { noDomGuard: false, noAstGuard: false, noLastOut: false, sharedOpts: false };\nlet _opts: any = null;\nexport const T:");
rep("  guard(child, \"PrevSibling\"", "  if (!SW.noDomGuard) { guard(child, \"PrevSibling\"");
rep("    return ctx.domNext < 0 ? backing : (barrierStub(\"dom.root.LastChild\") as html.Node);\n  });", "    return ctx.domNext < 0 ? backing : (barrierStub(\"dom.root.LastChild\") as html.Node);\n  }); }");
rep("  const r = newSandboxRenderer(tree, adapter.renderOptions(), lute.ParseOptions);", "  const r = newSandboxRenderer(tree, SW.sharedOpts ? (_opts ??= adapter.renderOptions()) : adapter.renderOptions(), lute.ParseOptions);");
rep("  Object.defineProperty(r, \"LastOut\"", "  if (!SW.noLastOut) Object.defineProperty(r, \"LastOut\"");
rep("  if (tops.length > 0) {\n    const first", "  if (!SW.noAstGuard && tops.length > 0) {\n    const first");
writeFileSync("sandbox_timed.ts", s);

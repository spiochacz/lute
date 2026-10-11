const fs=require("fs");
let s=fs.readFileSync("sandbox_nc.ts","utf8");
s=s.replace("export const GENERATED_ID","const NCG = (): Record<string, boolean> => (((globalThis as any).__NC) ??= {});\nexport const GENERATED_ID");
// NC5
s=s.replace(`    if (!dom.covered) {
      record("domNext", ctx.domNext);
    }
    return ctx.domNext < 0 ? null : domStub(ctx.domNext, ctx.domNextAttrs);`,`    if (!dom.covered && !NCG().nc5) {
      record("domNext", ctx.domNext);
    }
    return ctx.domNext < 0 ? null : domStub(ctx.domNext, ctx.domNextAttrs);`);
// NC15
s=s.replace(`      return value;
    },`,`      return NCG().nc15 && !assigned ? 10 : value;
    },`);
// NC14
s=s.replace("if (text.includes(GENERATED_ID))","if (text.includes(GENERATED_ID) && !NCG().nc14)");
// NC12b: hoist barrier ops
s=s.replace("export function coalesce(ops: RootOp[]): RootOp[] {",`export function coalesce(ops: RootOp[]): RootOp[] {
  if (NCG().nc12b) {
    const out: RootOp[] = [];
    const barrier: RootOp[] = [];
    for (const op of ops) {
      if (op.kind !== "Append") { barrier.push(op); continue; }
      if (op.bytes.length === 0) continue;
      const last = out.length > 0 ? out[out.length - 1] : null;
      if (last !== null && last.kind === "Append" && last.setsLastOut === op.setsLastOut) {
        const m = new Uint8Array(last.bytes.length + op.bytes.length); m.set(last.bytes, 0); m.set(op.bytes, last.bytes.length);
        out[out.length - 1] = { kind: "Append", bytes: m, setsLastOut: op.setsLastOut };
      } else out.push(op);
    }
    return out.concat(barrier);
  }`);
fs.writeFileSync("sandbox_nc.ts",s);
let a=fs.readFileSync("assemble_nc.ts","utf8");
a=a.replace("  closeDocumentWriter(R);",`  if (NC.nc13) { R.trimWriterTo(bytes.Trim(R.Writer.Bytes(), new Uint8Array([32, 9, 10]))); R.WriteByte(10); }
  else if (NC.nc13b) { R.trimWriterTo(bytes.Trim(R.Writer.Bytes(), new Uint8Array([10]))); R.WriteByte(10); }
  else closeDocumentWriter(R);`);
fs.writeFileSync("assemble_nc.ts",a);

const fs=require("fs");
let a=fs.readFileSync("assemble_nc.ts","utf8");
a=a.replace("return v.readKeys.every((k: ReadKey, i: number) => c[k] === v.readVals[i]);","return v.readKeys.every((k: ReadKey, i: number) => (NC as any)[\"skip_\" + k] === true || c[k] === v.readVals[i]);");
fs.writeFileSync("assemble_nc.ts",a);

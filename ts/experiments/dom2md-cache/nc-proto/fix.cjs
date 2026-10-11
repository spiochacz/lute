const fs=require("fs");const B=String.fromCharCode(92);
let a=fs.readFileSync("assemble_nc.ts","utf8").split("\n");
const i=a.findIndex(l=>l.includes("if (NC.nc13)"));
const j=a.findIndex(l=>l.includes("else closeDocumentWriter(R);"));
a.splice(i,j-i+1,
 '  if (NC.nc13) { R.trimWriterTo(bytes.Trim(R.Writer.Bytes(), " '+B+'t'+B+'n")); R.WriteByte(10); }',
 '  else if (NC.nc13b) { R.trimWriterTo(bytes.Trim(R.Writer.Bytes(), "'+B+'n")); R.WriteByte(10); }',
 '  else closeDocumentWriter(R);');
fs.writeFileSync("assemble_nc.ts",a.join("\n"));

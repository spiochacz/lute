import { newEngines } from "../../../test/e2e/helpers.ts";
const { port, oracle } = newEngines([["SetVditorIR", true]]);
const md = "# a\n\n    indented code\n\nparagraph after\n\n## b\n\n- item\n";
const dom = (oracle as any).Md2VditorIRDOM(md);
console.log("IR DOM children (oracle):", dom.length);
console.log("oracle  IR DOM -> MD:", JSON.stringify((oracle as any).VditorIRDOM2Md(dom)));
console.log("port    IR DOM -> MD:", JSON.stringify(port.VditorIRDOM2Md(dom)));
console.log("original MD:         ", JSON.stringify(md));

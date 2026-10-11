// Mechanism check: does defineProperty(accessor) on a node turn it into a dictionary-mode (slow) object? A plain Proxy assignment does not.
import * as ast from "../../../src/ast/index.ts";
import * as html from "../../../src/html/index.ts";
import { guardAst } from "../../../src/incremental/barrier.ts";
import { astStub } from "../../../src/incremental/barrier.ts";
const has = (o: object): boolean => (new Function("o", "return %HasFastProperties(o)"))(o);
const a = new ast.Node(ast.NodeParagraph);
console.log("ast.Node fresh                    fast properties:", has(a));
const b = new ast.Node(ast.NodeParagraph); guardAst(b, "Previous", () => null);
console.log("ast.Node + 1 accessor (guardAst)  fast properties:", has(b));
const c = new ast.Node(ast.NodeParagraph); c.Previous = astStub(1);
console.log("ast.Node + Proxy stub assigned    fast properties:", has(c));
const d = new html.Node(); const e = new html.Node();
Object.defineProperty(d, "NextSibling", { configurable: true, enumerable: true, get: () => null, set: () => {} });
console.log("html.Node fresh / + accessor      fast properties:", has(e), has(d));

// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// The read barrier of the sandbox (section 3.3 and 3.4). Milestone C (C1): the neighbours are linked by plain assignments, so no node
// is reconfigured by an accessor (its properties stay fast); a stub is an object that answers only the fields of its key and throws
// BarrierViolation for anything else.

import * as ast from "../ast/index.ts";
import * as html from "../html/index.ts";
import { BarrierViolation } from "./piece.ts";

// domStub is a stand-in for a DOM sibling of a top-level child. It answers DataAtom and Type; Attr answers attrs dummy attributes when
// attrs is a number, and throws when attrs is null (the previous sibling: nothing may read its attributes, milestone C step C1).
// Any other property read, and every write, throws.
export function domStub(atom: number, attrs: number | null, side: "prev" | "next"): html.Node {
  const target = new html.Node();
  return new Proxy(target, {
    get(_t, prop): unknown {
      if (typeof prop === "symbol") {
        return undefined;
      }
      switch (prop) {
        case "DataAtom":
          return atom;
        case "Type":
          return html.ElementNode;
        case "Attr":
          if (attrs === null) {
            throw new BarrierViolation("dom." + side + ".Attr");
          }
          return Array.from({ length: attrs }, () => ({ Namespace: "", Key: "k", Val: "v" }));
        default:
          throw new BarrierViolation("dom." + side + "." + prop);
      }
    },
    set(_t, prop): boolean {
      throw new BarrierViolation("dom." + side + ".=" + String(prop));
    },
    deleteProperty(_t, prop): boolean {
      throw new BarrierViolation("dom." + side + ".delete " + String(prop));
    },
  }) as html.Node;
}

// astStub is a stand-in for an AST neighbour. It answers Type; methods of ast.Node.prototype are returned as they are (called with the
// stub as this, they read Type through the trap and nothing else); any other property read, and every write, throws.
export function astStub(type: number): ast.Node {
  const target = new ast.Node(type);
  return new Proxy(target, {
    get(_t, prop): unknown {
      if (typeof prop === "symbol") {
        return undefined;
      }
      if (prop === "Type") {
        return type;
      }
      const v = (ast.Node.prototype as unknown as Record<string, unknown>)[prop];
      if (typeof v === "function") {
        return v;
      }
      throw new BarrierViolation("ast.neighbour." + prop);
    },
    set(_t, prop): boolean {
      throw new BarrierViolation("ast.neighbour.=" + String(prop));
    },
    deleteProperty(_t, prop): boolean {
      throw new BarrierViolation("ast.neighbour.delete " + String(prop));
    },
  }) as ast.Node;
}

// barrierStub is a stand-in that throws for every read and write, so that identity tests (a === b) work and anything else fails loudly.
export function barrierStub(site: string): object {
  return new Proxy(
    {},
    {
      get(_t, prop): unknown {
        throw new BarrierViolation(site + "." + String(prop));
      },
      set(_t, prop): boolean {
        throw new BarrierViolation(site + ".=" + String(prop));
      },
    },
  );
}

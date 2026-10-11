// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// The read barrier of the sandbox (section 3.3 and 3.4). A guard replaces a field of the few objects that connect a child to its
// neighbours by an accessor; a stub is an object that answers only the declared fields and throws BarrierViolation for anything else.

import * as ast from "../../../../src/ast/index.ts";
import * as html from "../../../../src/html/index.ts";
import { BarrierViolation } from "./piece.ts";

// guard replaces obj[field] by an accessor. read(backing) gives the value the code sees; the setter stores into the backing variable,
// which starts with the current value.
export function guard<T extends object, K extends keyof T>(obj: T, field: K, read: (backing: T[K]) => T[K]): void {
  let backing: T[K] = obj[field];
  Object.defineProperty(obj, field, {
    configurable: true,
    enumerable: true,
    get: () => read(backing),
    set: (v: T[K]) => {
      backing = v;
    },
  });
}

// guardAst is guard; it is kept under one name in the code of the sandbox (section 3.4).
export const guardAst = guard;

// domStub is a stand-in for a DOM sibling of a top-level child. It answers DataAtom, Type and Attr (an array of attrs dummy attributes);
// any other property read, and every write, throws.
export function domStub(atom: number, attrs: number): html.Node {
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
          return Array.from({ length: attrs }, () => ({ Namespace: "", Key: "k", Val: "v" }));
        default:
          throw new BarrierViolation("dom.next." + prop);
      }
    },
    set(_t, prop): boolean {
      throw new BarrierViolation("dom.next.=" + String(prop));
    },
    deleteProperty(_t, prop): boolean {
      throw new BarrierViolation("dom.next.delete " + String(prop));
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

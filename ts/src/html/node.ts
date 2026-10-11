// Ported from html/node.go @ 8e7896b6
// Copyright 2011 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// PORT-NOTE: insertionMode is declared in parse.ts, as in Go (parse.go), and imported
// here as a type. Go's insertionModeStack in node.go uses it.
//
// PORT-NOTE: Go's nodeStack and insertionModeStack are slice types with pointer-receiver
// methods. Here they are classes whose field `items` is the Go slice; the methods do what
// Go's *s does on that slice.

import type * as atom from "./atom/index.ts";
import type { Attribute } from "./token.ts";
import type { insertionMode } from "./parse.ts";

// A NodeType is the type of a Node.
export type NodeType = number;

export const ErrorNode = 0;
export const TextNode = 1;
export const DocumentNode = 2;
export const ElementNode = 3;
export const CommentNode = 4;
export const DoctypeNode = 5;
export const scopeMarkerNode = 6;

// A Node consists of a NodeType and some Data (tag name for element nodes,
// content for text) and are part of a tree of Nodes. Element nodes may also
// have a Namespace and contain a slice of Attributes. Data is unescaped, so
// that it looks like "a<b" rather than "a&lt;b". For element nodes, DataAtom
// is the atom for Data, or zero if Data is not a known tag name.
//
// An empty Namespace implies a "http://www.w3.org/1999/xhtml" namespace.
// Similarly, "math" is short for "http://www.w3.org/1998/Math/MathML", and
// "svg" is short for "http://www.w3.org/2000/svg".
export class Node {
  Parent: Node | null;
  FirstChild: Node | null;
  LastChild: Node | null;
  PrevSibling: Node | null;
  NextSibling: Node | null;

  Type: NodeType;
  DataAtom: atom.Atom;
  Data: string;
  Namespace: string;
  Attr: Attribute[];

  constructor() {
    this.Parent = null;
    this.FirstChild = null;
    this.LastChild = null;
    this.PrevSibling = null;
    this.NextSibling = null;
    this.Type = ErrorNode;
    this.DataAtom = 0;
    this.Data = "";
    this.Namespace = "";
    this.Attr = [];
  }

  // Unlink removes the node from the tree; the next sibling takes its place.
  Unlink(): void {
    if (this.PrevSibling !== null) {
      this.PrevSibling.NextSibling = this.NextSibling;
    } else if (this.Parent !== null) {
      this.Parent.FirstChild = this.NextSibling;
    }
    if (this.NextSibling !== null) {
      this.NextSibling.PrevSibling = this.PrevSibling;
    } else if (this.Parent !== null) {
      this.Parent.LastChild = this.PrevSibling;
    }
    this.Parent = null;
    this.NextSibling = null;
    this.PrevSibling = null;
  }

  // InsertBefore inserts a sibling before the current node.
  InsertBefore(sibling: Node): void {
    sibling.Unlink();
    sibling.PrevSibling = this.PrevSibling;
    if (sibling.PrevSibling !== null) {
      sibling.PrevSibling.NextSibling = sibling;
    }
    sibling.NextSibling = this;
    this.PrevSibling = sibling;
    sibling.Parent = this.Parent;
    if (sibling.Parent !== null && sibling.PrevSibling === null) {
      sibling.Parent.FirstChild = sibling;
    }
  }

  // InsertAfter inserts a sibling after the current node.
  InsertAfter(sibling: Node): void {
    sibling.Unlink();
    sibling.NextSibling = this.NextSibling;
    if (sibling.NextSibling !== null) {
      sibling.NextSibling.PrevSibling = sibling;
    }
    sibling.PrevSibling = this;
    this.NextSibling = sibling;
    sibling.Parent = this.Parent;
    if (sibling.NextSibling === null && sibling.Parent !== null) {
      sibling.Parent.LastChild = sibling;
    }
  }

  // InsertChildBefore inserts newChild as a child of n, immediately before oldChild
  // in the sequence of n's children. oldChild may be nil, in which case newChild
  // is appended to the end of n's children.
  //
  // It will panic if newChild already has a parent or siblings.
  InsertChildBefore(newChild: Node, oldChild: Node | null): void {
    if (newChild.Parent !== null || newChild.PrevSibling !== null || newChild.NextSibling !== null) {
      // PORT-NOTE: Go panics here.
      throw new Error("html: InsertChildBefore called for an attached child Node");
    }
    let prev: Node | null;
    let next: Node | null;
    if (oldChild !== null) {
      prev = oldChild.PrevSibling;
      next = oldChild;
    } else {
      prev = this.LastChild;
      next = null;
    }
    if (prev !== null) {
      prev.NextSibling = newChild;
    } else {
      this.FirstChild = newChild;
    }
    if (next !== null) {
      next.PrevSibling = newChild;
    } else {
      this.LastChild = newChild;
    }
    newChild.Parent = this;
    newChild.PrevSibling = prev;
    newChild.NextSibling = next;
  }

  // AppendChild adds a node c as a child of n.
  //
  // It will panic if c already has a parent or siblings.
  AppendChild(c: Node): void {
    if (c.Parent !== null || c.PrevSibling !== null || c.NextSibling !== null) {
      // PORT-NOTE: Go panics here.
      throw new Error("html: AppendChild called for an attached child Node");
    }
    const last = this.LastChild;
    if (last !== null) {
      last.NextSibling = c;
    } else {
      this.FirstChild = c;
    }
    this.LastChild = c;
    c.Parent = this;
    c.PrevSibling = last;
  }

  // RemoveChild removes a node c that is a child of n. Afterwards, c will have
  // no parent and no siblings.
  //
  // It will panic if c's parent is not n.
  RemoveChild(c: Node): void {
    if (c.Parent !== this) {
      // PORT-NOTE: Go panics here.
      throw new Error("html: RemoveChild called for a non-child Node");
    }
    if (this.FirstChild === c) {
      this.FirstChild = c.NextSibling;
    }
    if (c.NextSibling !== null) {
      c.NextSibling.PrevSibling = c.PrevSibling;
    }
    if (this.LastChild === c) {
      this.LastChild = c.PrevSibling;
    }
    if (c.PrevSibling !== null) {
      c.PrevSibling.NextSibling = c.NextSibling;
    }
    c.Parent = null;
    c.PrevSibling = null;
    c.NextSibling = null;
  }

  // clone returns a new node with the same type, data and attributes.
  // The clone has no parent, no siblings and no children.
  clone(): Node {
    const m = new Node();
    m.Type = this.Type;
    m.DataAtom = this.DataAtom;
    m.Data = this.Data;
    // Go copies the *Attribute pointers, so the clone shares the Attribute values.
    m.Attr = this.Attr.slice();
    return m;
  }
}

// Section 12.2.4.3 says "The markers are inserted when entering applet,
// object, marquee, template, td, th, and caption elements, and are used
// to prevent formatting from "leaking" into applet, object, marquee,
// template, td, th, and caption elements".
export const scopeMarker = new Node();
scopeMarker.Type = scopeMarkerNode;

// reparentChildren reparents all of src's child nodes to dst.
export function reparentChildren(dst: Node, src: Node): void {
  for (;;) {
    const child = src.FirstChild;
    if (child === null) {
      break;
    }
    src.RemoveChild(child);
    dst.AppendChild(child);
  }
}

// nodeStack is a stack of nodes.
export class nodeStack {
  // items is the Go slice. It can hold nil (null) after a failed insert, as in Go.
  items: (Node | null)[];

  constructor() {
    this.items = [];
  }

  // pop pops the stack. It will panic if s is empty.
  pop(): Node | null {
    const i = this.items.length;
    if (i === 0) {
      // PORT-NOTE: Go panics here (index -1 out of range).
      throw new Error("runtime error: index out of range [-1]");
    }
    const n = this.items[i - 1];
    this.items.length = i - 1;
    return n;
  }

  // top returns the most recently pushed node, or nil if s is empty.
  top(): Node | null {
    const i = this.items.length;
    if (i > 0) {
      return this.items[i - 1];
    }
    return null;
  }

  // index returns the index of the top-most occurrence of n in the stack, or -1
  // if n is not present.
  index(n: Node): number {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i] === n) {
        return i;
      }
    }
    return -1;
  }

  // contains returns whether a is within s.
  contains(a: atom.Atom): boolean {
    for (const n of this.items) {
      if (n === null) {
        // PORT-NOTE: Go dereferences a nil *Node here and panics.
        throw new TypeError("nil pointer dereference");
      }
      if (n.DataAtom === a && n.Namespace === "") {
        return true;
      }
    }
    return false;
  }

  // insert inserts a node at the given index.
  insert(i: number, n: Node): void {
    if (i < 0 || i > this.items.length) {
      // PORT-NOTE: Go appends a nil element before the bounds of the copy are checked, so a
      // bad index leaves a nil element on the stack and then panics.
      this.items.push(null);
      throw new Error("runtime error: slice bounds out of range");
    }
    this.items.splice(i, 0, n);
  }

  // remove removes a node from the stack. It is a no-op if n is not present.
  remove(n: Node): void {
    const i = this.index(n);
    if (i === -1) {
      return;
    }
    this.items.copyWithin(i, i + 1);
    const j = this.items.length - 1;
    this.items.length = j;
  }
}

export class insertionModeStack {
  items: insertionMode[];

  constructor() {
    this.items = [];
  }

  // pop pops the stack. It will panic if s is empty.
  pop(): insertionMode {
    let im: insertionMode;
    const i = this.items.length;
    if (i === 0) {
      // PORT-NOTE: Go panics here (index -1 out of range).
      throw new Error("runtime error: index out of range [-1]");
    }
    im = this.items[i - 1];
    this.items.length = i - 1;
    return im;
  }

  // top returns the most recently pushed insertion mode, or nil if s is empty.
  top(): insertionMode | null {
    const i = this.items.length;
    if (i > 0) {
      return this.items[i - 1];
    }
    return null;
  }
}

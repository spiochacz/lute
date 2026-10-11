// Ported from html/parse.go @ 8e7896b6
// Copyright 2010 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// PORT-NOTE: A TypeScript class holds all the methods of parser in one block, so the methods
// are grouped in the class in Go's order and the free functions (the insertion modes and the
// foreign content rules) follow the class in Go's order. The insertion modes stay plain
// module-level functions, so that `p.im = inBodyIM` and identity checks work as in Go.
//
// PORT-NOTE: Go's nil pointers and nil function values are null here. Go's p.tok and the
// Token values are objects here; a Go value copy (realToken in parseImpliedToken) is a copy
// of the reference, and the code never mutates the copied object.
//
// PORT-NOTE: Go slices of pointers (oe, afe, templateStack) are the items of nodeStack and
// insertionModeStack, so Go's p.oe[i] is p.oe.items[i] here.
//
// PORT-NOTE: Go's composite literals of Node, Token and Attribute are built with the class
// constructor and then field assignments, in the field order of the Go literal. The small
// helpers below (newTextNode, newCommentNode, newDocumentNode, newElementNode, newAttribute)
// take the literal's values as positional arguments and return the node or attribute they
// create, so no temporary object is allocated.
//
import * as atom from "./atom/index.ts";
import * as conv from "../runtime/conv.ts";
import * as strconv from "../runtime/strconv.ts";
import * as strings from "../runtime/strings.ts";
import { EOF } from "../runtime/io.ts";
import {
  CommentNode,
  DocumentNode,
  ElementNode,
  Node,
  TextNode,
  insertionModeStack,
  nodeStack,
  reparentChildren,
  scopeMarker,
  scopeMarkerNode,
} from "./node.ts";
import { isSpecialElement } from "./const.ts";
import {
  Attribute,
  CommentToken,
  DoctypeToken,
  EndTagToken,
  ErrorToken,
  NewTokenizer,
  NewTokenizerFragment,
  SelfClosingTagToken,
  StartTagToken,
  TextToken,
  Token,
  Tokenizer,
} from "./token.ts";
import type { TokenType } from "./token.ts";
import {
  adjustAttributeNames,
  adjustForeignAttributes,
  breakout,
  htmlIntegrationPoint,
  mathMLAttributeAdjustments,
  mathMLTextIntegrationPoint,
  svgAttributeAdjustments,
  svgTagNameAdjustments,
} from "./foreign.ts";
import { parseDoctype } from "./doctype.ts";

// newTextNode returns &Node{Type: TextNode, Data: data}.
function newTextNode(data: string): Node {
  const n = new Node();
  n.Type = TextNode;
  n.Data = data;
  return n;
}

// newCommentNode returns &Node{Type: CommentNode, Data: data}.
function newCommentNode(data: string): Node {
  const n = new Node();
  n.Type = CommentNode;
  n.Data = data;
  return n;
}

// newDocumentNode returns &Node{Type: DocumentNode}.
function newDocumentNode(): Node {
  const n = new Node();
  n.Type = DocumentNode;
  return n;
}

// newElementNode returns &Node{Type: ElementNode, DataAtom: dataAtom, Data: data, Attr: attr}.
function newElementNode(dataAtom: atom.Atom, data: string, attr: Attribute[]): Node {
  const n = new Node();
  n.Type = ElementNode;
  n.DataAtom = dataAtom;
  n.Data = data;
  n.Attr = attr;
  return n;
}

// newAttribute returns &Attribute{Key: key, Val: val}.
function newAttribute(key: string, val: string): Attribute {
  const a = new Attribute();
  a.Key = key;
  a.Val = val;
  return a;
}

// An insertion mode (section 12.2.4.1) is the state transition function from
// a particular state in the HTML5 parser's state machine. It updates the
// parser's fields depending on parser.tok (where ErrorToken means EOF).
// It returns whether the token was consumed.
export type insertionMode = (p: parser) => boolean;

// A parser implements the HTML5 parsing algorithm:
// https://html.spec.whatwg.org/multipage/syntax.html#tree-construction
export class parser {
  // tokenizer provides the tokens for the parser.
  tokenizer: Tokenizer | null;
  // tok is the most recently read token.
  tok: Token;
  // Self-closing tags like <hr/> are treated as start tags, except that
  // hasSelfClosingToken is set while they are being processed.
  hasSelfClosingToken: boolean;
  // doc is the document root element.
  doc: Node | null;
  // The stack of open elements (section 12.2.4.2) and active formatting
  // elements (section 12.2.4.3).
  oe: nodeStack;
  afe: nodeStack;
  // Element pointers (section 12.2.4.4).
  head: Node | null;
  form: Node | null;
  // Other parsing state flags (section 12.2.4.5).
  scripting: boolean;
  framesetOK: boolean;
  // The stack of template insertion modes
  templateStack: insertionModeStack;
  // im is the current insertion mode.
  im: insertionMode | null;
  // originalIM is the insertion mode to go back to after completing a text
  // or inTableText insertion mode.
  originalIM: insertionMode | null;
  // fosterParenting is whether new elements should be inserted according to
  // the foster parenting rules (section 12.2.6.1).
  fosterParenting: boolean;
  // quirks is whether the parser is operating in "quirks mode."
  quirks: boolean;
  // fragment is whether the parser is parsing an HTML fragment.
  fragment: boolean;
  // context is the context element when parsing an HTML fragment
  // (section 12.4).
  context: Node | null;

  constructor() {
    this.tokenizer = null;
    this.tok = new Token();
    this.hasSelfClosingToken = false;
    this.doc = null;
    this.oe = new nodeStack();
    this.afe = new nodeStack();
    this.head = null;
    this.form = null;
    this.scripting = false;
    this.framesetOK = false;
    this.templateStack = new insertionModeStack();
    this.im = null;
    this.originalIM = null;
    this.fosterParenting = false;
    this.quirks = false;
    this.fragment = false;
    this.context = null;
  }

  top(): Node {
    const n = this.oe.top();
    if (n !== null) {
      return n;
    }
    return this.doc!;
  }

  // popUntil pops the stack of open elements at the highest element whose tag
  // is in matchTags, provided there is no higher element in the scope's stop
  // tags (as defined in section 12.2.4.2). It returns whether or not there was
  // such an element. If there was not, popUntil leaves the stack unchanged.
  //
  // For example, the set of stop tags for table scope is: "html", "table". If
  // the stack was:
  // ["html", "body", "font", "table", "b", "i", "u"]
  // then popUntil(tableScope, "font") would return false, but
  // popUntil(tableScope, "i") would return true and the stack would become:
  // ["html", "body", "font", "table", "b"]
  //
  // If an element's tag is in both the stop tags and matchTags, then the stack
  // will be popped and the function returns true (provided, of course, there was
  // no higher element in the stack that was also in the stop tags). For example,
  // popUntil(tableScope, "table") returns true and leaves:
  // ["html", "body", "font"]
  popUntil(s: scope, ...matchTags: atom.Atom[]): boolean {
    const i = this.indexOfElementInScope(s, ...matchTags);
    if (i !== -1) {
      this.oe.items.length = i;
      return true;
    }
    return false;
  }

  // indexOfElementInScope returns the index in p.oe of the highest element whose
  // tag is in matchTags that is in scope. If no matching element is in scope, it
  // returns -1.
  indexOfElementInScope(s: scope, ...matchTags: atom.Atom[]): number {
    for (let i = this.oe.items.length - 1; i >= 0; i--) {
      const tagAtom = this.oe.items[i]!.DataAtom;
      if (this.oe.items[i]!.Namespace === "") {
        for (const t of matchTags) {
          if (t === tagAtom) {
            return i;
          }
        }
        switch (s) {
          case defaultScope:
            // No-op.
            break;
          case listItemScope:
            if (tagAtom === atom.Ol || tagAtom === atom.Ul) {
              return -1;
            }
            break;
          case buttonScope:
            if (tagAtom === atom.Button) {
              return -1;
            }
            break;
          case tableScope:
            if (tagAtom === atom.Html || tagAtom === atom.Table || tagAtom === atom.Template) {
              return -1;
            }
            break;
          case selectScope:
            if (tagAtom !== atom.Optgroup && tagAtom !== atom.Option) {
              return -1;
            }
            break;
          default:
            // PORT-NOTE: Go panics here.
            throw new Error("unreachable");
        }
      }
      switch (s) {
        case defaultScope:
        case listItemScope:
        case buttonScope:
          for (const t of defaultScopeStopTags.get(this.oe.items[i]!.Namespace) ?? []) {
            if (t === tagAtom) {
              return -1;
            }
          }
          break;
      }
    }
    return -1;
  }

  // elementInScope is like popUntil, except that it doesn't modify the stack of
  // open elements.
  elementInScope(s: scope, ...matchTags: atom.Atom[]): boolean {
    return this.indexOfElementInScope(s, ...matchTags) !== -1;
  }

  // clearStackToContext pops elements off the stack of open elements until a
  // scope-defined element is found.
  clearStackToContext(s: scope): void {
    for (let i = this.oe.items.length - 1; i >= 0; i--) {
      const tagAtom = this.oe.items[i]!.DataAtom;
      switch (s) {
        case tableScope:
          if (tagAtom === atom.Html || tagAtom === atom.Table || tagAtom === atom.Template) {
            this.oe.items.length = i + 1;
            return;
          }
          break;
        case tableRowScope:
          if (tagAtom === atom.Html || tagAtom === atom.Tr || tagAtom === atom.Template) {
            this.oe.items.length = i + 1;
            return;
          }
          break;
        case tableBodyScope:
          if (
            tagAtom === atom.Html ||
            tagAtom === atom.Tbody ||
            tagAtom === atom.Tfoot ||
            tagAtom === atom.Thead ||
            tagAtom === atom.Template
          ) {
            this.oe.items.length = i + 1;
            return;
          }
          break;
        default:
          // PORT-NOTE: Go panics here.
          throw new Error("unreachable");
      }
    }
  }

  // generateImpliedEndTags pops nodes off the stack of open elements as long as
  // the top node has a tag name of dd, dt, li, optgroup, option, p, rb, rp, rt or rtc.
  // If exceptions are specified, nodes with that name will not be popped off.
  generateImpliedEndTags(...exceptions: string[]): void {
    let i: number;
    loop: for (i = this.oe.items.length - 1; i >= 0; i--) {
      const n = this.oe.items[i]!;
      if (n.Type === ElementNode) {
        switch (n.DataAtom) {
          case atom.Dd:
          case atom.Dt:
          case atom.Li:
          case atom.Optgroup:
          case atom.Option:
          case atom.P:
          case atom.Rb:
          case atom.Rp:
          case atom.Rt:
          case atom.Rtc:
            for (const except of exceptions) {
              if (n.Data === except) {
                break loop;
              }
            }
            continue;
        }
      }
      break;
    }

    this.oe.items.length = i + 1;
  }

  // addChild adds a child node n to the top element, and pushes n onto the stack
  // of open elements if it is an element node.
  addChild(n: Node): void {
    if (this.shouldFosterParent()) {
      this.fosterParent(n);
    } else {
      this.top().AppendChild(n);
    }

    if (n.Type === ElementNode) {
      this.oe.items.push(n);
    }
  }

  // shouldFosterParent returns whether the next node to be added should be
  // foster parented.
  shouldFosterParent(): boolean {
    if (this.fosterParenting) {
      switch (this.top().DataAtom) {
        case atom.Table:
        case atom.Tbody:
        case atom.Tfoot:
        case atom.Thead:
        case atom.Tr:
          return true;
      }
    }
    return false;
  }

  // fosterParent adds a child node according to the foster parenting rules.
  // Section 12.2.6.1, "foster parenting".
  fosterParent(n: Node): void {
    let table: Node | null = null;
    let parent: Node | null = null;
    let prev: Node | null = null;
    let template: Node | null = null;
    let i: number;
    for (i = this.oe.items.length - 1; i >= 0; i--) {
      if (this.oe.items[i]!.DataAtom === atom.Table) {
        table = this.oe.items[i]!;
        break;
      }
    }

    let j: number;
    for (j = this.oe.items.length - 1; j >= 0; j--) {
      if (this.oe.items[j]!.DataAtom === atom.Template) {
        template = this.oe.items[j]!;
        break;
      }
    }

    if (template !== null && (table === null || j > i)) {
      template.AppendChild(n);
      return;
    }

    if (table === null) {
      // The foster parent is the html element.
      parent = this.oe.items[0]!;
    } else {
      parent = table.Parent;
    }
    if (parent === null) {
      parent = this.oe.items[i - 1]!;
    }

    if (table !== null) {
      prev = table.PrevSibling;
    } else {
      prev = parent.LastChild;
    }
    if (prev !== null && prev.Type === TextNode && n.Type === TextNode) {
      prev.Data += n.Data;
      return;
    }

    parent.InsertChildBefore(n, table);
  }

  // addText adds text to the preceding node if it is a text node, or else it
  // calls addChild with a new text node.
  addText(text: string): void {
    if (text === "") {
      return;
    }

    if (this.shouldFosterParent()) {
      this.fosterParent(newTextNode(text));
      return;
    }

    const t = this.top();
    const n = t.LastChild;
    if (n !== null && n.Type === TextNode) {
      n.Data += text;
      return;
    }
    this.addChild(newTextNode(text));
  }

  // addElement adds a child element based on the current token.
  addElement(): void {
    this.addChild(newElementNode(this.tok.DataAtom, this.tok.Data, this.tok.Attr));
  }

  // Section 12.2.4.3.
  addFormattingElement(): void {
    const tagAtom = this.tok.DataAtom;
    const attr = this.tok.Attr;
    this.addElement();

    // Implement the Noah's Ark clause, but with three per family instead of two.
    let identicalElements = 0;
    findIdenticalElements: for (let i = this.afe.items.length - 1; i >= 0; i--) {
      const n = this.afe.items[i]!;
      if (n.Type === scopeMarkerNode) {
        break;
      }
      if (n.Type !== ElementNode) {
        continue;
      }
      if (n.Namespace !== "") {
        continue;
      }
      if (n.DataAtom !== tagAtom) {
        continue;
      }
      if (n.Attr.length !== attr.length) {
        continue;
      }
      compareAttributes: for (const t0 of n.Attr) {
        for (const t1 of attr) {
          if (t0.Key === t1.Key && t0.Namespace === t1.Namespace && t0.Val === t1.Val) {
            // Found a match for this attribute, continue with the next attribute.
            continue compareAttributes;
          }
        }
        // If we get here, there is no attribute that matches a.
        // Therefore the element is not identical to the new one.
        continue findIdenticalElements;
      }

      identicalElements++;
      if (identicalElements >= 3) {
        this.afe.remove(n);
      }
    }

    this.afe.items.push(this.top());
  }

  // Section 12.2.4.3.
  clearActiveFormattingElements(): void {
    for (;;) {
      const n = this.afe.pop();
      if (this.afe.items.length === 0 || n!.Type === scopeMarkerNode) {
        return;
      }
    }
  }

  // Section 12.2.4.3.
  reconstructActiveFormattingElements(): void {
    let n = this.afe.top();
    if (n === null) {
      return;
    }
    if (n.Type === scopeMarkerNode || this.oe.index(n) !== -1) {
      return;
    }
    let i = this.afe.items.length - 1;
    while (n.Type !== scopeMarkerNode && this.oe.index(n) === -1) {
      if (i === 0) {
        i = -1;
        break;
      }
      i--;
      n = this.afe.items[i]!;
    }
    for (;;) {
      i++;
      const clone = this.afe.items[i]!.clone();
      this.addChild(clone);
      this.afe.items[i] = clone;
      if (i === this.afe.items.length - 1) {
        break;
      }
    }
  }

  // Section 12.2.5.
  acknowledgeSelfClosingTag(): void {
    this.hasSelfClosingToken = false;
  }

  // setOriginalIM sets the insertion mode to return to after completing a text or
  // inTableText insertion mode.
  // Section 12.2.4.1, "using the rules for".
  setOriginalIM(): void {
    if (this.originalIM !== null) {
      // PORT-NOTE: Go panics here.
      throw new Error("html: bad parser state: originalIM was set twice");
    }
    this.originalIM = this.im;
  }

  // Section 12.2.4.1, "reset the insertion mode".
  resetInsertionMode(): void {
    for (let i = this.oe.items.length - 1; i >= 0; i--) {
      let n: Node = this.oe.items[i]!;
      const last = i === 0;
      if (last && this.context !== null) {
        n = this.context;
      }

      switch (n.DataAtom) {
        case atom.Select:
          if (!last) {
            let ancestor: Node | null = n;
            const first = this.oe.items[0]!;
            while (ancestor !== first) {
              ancestor = this.oe.items[this.oe.index(ancestor!) - 1]!;
              switch (ancestor.DataAtom) {
                case atom.Template:
                  this.im = inSelectIM;
                  return;
                case atom.Table:
                  this.im = inSelectInTableIM;
                  return;
              }
            }
          }
          this.im = inSelectIM;
          break;
        case atom.Td:
        case atom.Th:
          // remove this divergence from the HTML5 spec.
          //
          // See https://bugs.chromium.org/p/chromium/issues/detail?id=829668
          this.im = inCellIM;
          break;
        case atom.Tr:
          this.im = inRowIM;
          break;
        case atom.Tbody:
        case atom.Thead:
        case atom.Tfoot:
          this.im = inTableBodyIM;
          break;
        case atom.Caption:
          this.im = inCaptionIM;
          break;
        case atom.Colgroup:
          this.im = inColumnGroupIM;
          break;
        case atom.Table:
          this.im = inTableIM;
          break;
        case atom.Template:
          // remove this divergence from the HTML5 spec.
          if (n.Namespace !== "") {
            continue;
          }
          this.im = this.templateStack.top();
          break;
        case atom.Head:
          // remove this divergence from the HTML5 spec.
          //
          // See https://bugs.chromium.org/p/chromium/issues/detail?id=829668
          this.im = inHeadIM;
          break;
        case atom.Body:
          this.im = inBodyIM;
          break;
        case atom.Frameset:
          this.im = inFramesetIM;
          break;
        case atom.Html:
          if (this.head === null) {
            this.im = beforeHeadIM;
          } else {
            this.im = afterHeadIM;
          }
          break;
        default:
          if (last) {
            this.im = inBodyIM;
            return;
          }
          continue;
      }
      return;
    }
  }

  // This is the "adoption agency" algorithm, described at
  // https://html.spec.whatwg.org/multipage/syntax.html#adoptionAgency
  inBodyEndTagFormatting(tagAtom: atom.Atom, tagName: string): void {
    // this is a fairly literal line-by-line translation of that algorithm.
    // Once the code successfully parses the comprehensive test suite, we should
    // refactor this code to be more idiomatic.

    // Steps 1-4. The outer loop.
    for (let i = 0; i < 8; i++) {
      // Step 5. Find the formatting element.
      let formattingElement: Node | null = null;
      for (let j = this.afe.items.length - 1; j >= 0; j--) {
        if (this.afe.items[j]!.Type === scopeMarkerNode) {
          break;
        }
        if (this.afe.items[j]!.DataAtom === tagAtom) {
          formattingElement = this.afe.items[j]!;
          break;
        }
      }
      if (formattingElement === null) {
        this.inBodyEndTagOther(tagAtom, tagName);
        return;
      }
      const feIndex = this.oe.index(formattingElement);
      if (feIndex === -1) {
        this.afe.remove(formattingElement);
        return;
      }
      if (!this.elementInScope(defaultScope, tagAtom)) {
        // Ignore the tag.
        return;
      }
      // Steps 9-10. Find the furthest block.
      let furthestBlock: Node | null = null;
      for (const e of this.oe.items.slice(feIndex)) {
        if (isSpecialElement(e!)) {
          furthestBlock = e!;
          break;
        }
      }
      if (furthestBlock === null) {
        let e: Node | null = this.oe.pop();
        while (e !== formattingElement) {
          e = this.oe.pop();
        }
        this.afe.remove(e!);
        return;
      }

      // Steps 11-12. Find the common ancestor and bookmark node.
      const commonAncestor = this.oe.items[feIndex - 1]!;
      let bookmark = this.afe.index(formattingElement);

      // Step 13. The inner loop. Find the lastNode to reparent.
      let lastNode: Node = furthestBlock;
      let node: Node = furthestBlock;
      let x = this.oe.index(node);
      // Steps 13.1-13.2
      for (let j = 0; j < 3; j++) {
        // Step 13.3.
        x--;
        node = this.oe.items[x]!;
        // Step 13.4 - 13.5.
        if (this.afe.index(node) === -1) {
          this.oe.remove(node);
          continue;
        }
        // Step 13.6.
        if (node === formattingElement) {
          break;
        }
        // Step 13.7.
        const clone = node.clone();
        this.afe.items[this.afe.index(node)] = clone;
        this.oe.items[this.oe.index(node)] = clone;
        node = clone;
        // Step 13.8.
        if (lastNode === furthestBlock) {
          bookmark = this.afe.index(node) + 1;
        }
        // Step 13.9.
        if (lastNode.Parent !== null) {
          lastNode.Parent.RemoveChild(lastNode);
        }
        node.AppendChild(lastNode);
        // Step 13.10.
        lastNode = node;
      }

      // Step 14. Reparent lastNode to the common ancestor,
      // or for misnested table nodes, to the foster parent.
      if (lastNode.Parent !== null) {
        lastNode.Parent.RemoveChild(lastNode);
      }
      switch (commonAncestor.DataAtom) {
        case atom.Table:
        case atom.Tbody:
        case atom.Tfoot:
        case atom.Thead:
        case atom.Tr:
          this.fosterParent(lastNode);
          break;
        default:
          commonAncestor.AppendChild(lastNode);
      }

      // Steps 15-17. Reparent nodes from the furthest block's children
      // to a clone of the formatting element.
      const clone = formattingElement.clone();
      reparentChildren(clone, furthestBlock);
      furthestBlock.AppendChild(clone);

      // Step 18. Fix up the list of active formatting elements.
      const oldLoc = this.afe.index(formattingElement);
      if (oldLoc !== -1 && oldLoc < bookmark) {
        // Move the bookmark with the rest of the list.
        bookmark--;
      }
      this.afe.remove(formattingElement);
      this.afe.insert(bookmark, clone);

      // Step 19. Fix up the stack of open elements.
      this.oe.remove(formattingElement);
      this.oe.insert(this.oe.index(furthestBlock) + 1, clone);
    }
  }

  // inBodyEndTagOther performs the "any other end tag" algorithm for inBodyIM.
  // "Any other end tag" handling from 12.2.6.5 The rules for parsing tokens in foreign content
  // https://html.spec.whatwg.org/multipage/syntax.html#parsing-main-inforeign
  inBodyEndTagOther(tagAtom: atom.Atom, tagName: string): void {
    for (let i = this.oe.items.length - 1; i >= 0; i--) {
      // Two element nodes have the same tag if they have the same Data (a
      // string-typed field). As an optimization, for common HTML tags, each
      // Data string is assigned a unique, non-zero DataAtom (a uint32-typed
      // field), since integer comparison is faster than string comparison.
      // Uncommon (custom) tags get a zero DataAtom.
      //
      // The if condition here is equivalent to (p.oe[i].Data == tagName).
      if (this.oe.items[i]!.DataAtom === tagAtom && (tagAtom !== 0 || this.oe.items[i]!.Data === tagName)) {
        this.oe.items.length = i;
        break;
      }
      if (isSpecialElement(this.oe.items[i]!)) {
        break;
      }
    }
  }

  // Section 12.2.6.
  inForeignContent(): boolean {
    if (this.oe.items.length === 0) {
      return false;
    }
    const n = this.oe.items[this.oe.items.length - 1]!;
    if (n.Namespace === "") {
      return false;
    }
    if (mathMLTextIntegrationPoint(n)) {
      if (this.tok.Type === StartTagToken && this.tok.DataAtom !== atom.Mglyph && this.tok.DataAtom !== atom.Malignmark) {
        return false;
      }
      if (this.tok.Type === TextToken) {
        return false;
      }
    }
    if (n.Namespace === "math" && n.DataAtom === atom.AnnotationXml && this.tok.Type === StartTagToken && this.tok.DataAtom === atom.Svg) {
      return false;
    }
    if (htmlIntegrationPoint(n) && (this.tok.Type === StartTagToken || this.tok.Type === TextToken)) {
      return false;
    }
    if (this.tok.Type === ErrorToken) {
      return false;
    }
    return true;
  }

  // parseImpliedToken parses a token as though it had appeared in the parser's
  // input.
  parseImpliedToken(t: TokenType, dataAtom: atom.Atom, data: string): void {
    const realToken = this.tok;
    const selfClosing = this.hasSelfClosingToken;
    const tok = new Token();
    tok.Type = t;
    tok.DataAtom = dataAtom;
    tok.Data = data;
    this.tok = tok;
    this.hasSelfClosingToken = false;
    this.parseCurrentToken();
    this.tok = realToken;
    this.hasSelfClosingToken = selfClosing;
  }

  // parseCurrentToken runs the current token through the parsing routines
  // until it is consumed.
  parseCurrentToken(): void {
    if (this.tok.Type === SelfClosingTagToken) {
      this.hasSelfClosingToken = true;
      this.tok.Type = StartTagToken;
    }

    let consumed = false;
    while (!consumed) {
      if (this.inForeignContent()) {
        consumed = parseForeignContent(this);
      } else {
        consumed = this.im!(this);
      }
    }

    if (this.hasSelfClosingToken) {
      // This is a parse error, but ignore it.
      this.hasSelfClosingToken = false;
    }
  }

  parse(): Error | null {
    // Iterate until EOF. Any other error will cause an early return.
    let err: Error | null = null;
    while (err !== EOF) {
      // CDATA sections are allowed only in foreign content.
      const n = this.oe.top();
      this.tokenizer!.AllowCDATA(n !== null && n.Namespace !== "");
      // Read and parse the next token.
      this.tokenizer!.Next();
      this.tok = this.tokenizer!.Token();
      if (this.tok.Type === ErrorToken) {
        err = this.tokenizer!.Err();
        if (err !== null && err !== EOF) {
          return err;
        }
      }

      this.parseCurrentToken();
    }
    return null;
  }
}

// Stop tags for use in popUntil. These come from section 12.2.4.2.
const defaultScopeStopTags: Map<string, atom.Atom[]> = new Map<string, atom.Atom[]>([
  [
    "",
    [
      atom.Applet,
      atom.Caption,
      atom.Html,
      atom.Table,
      atom.Td,
      atom.Th,
      atom.Marquee,
      atom.Object,
      atom.Template,
    ],
  ],
  ["math", [atom.AnnotationXml, atom.Mi, atom.Mn, atom.Mo, atom.Ms, atom.Mtext]],
  ["svg", [atom.Desc, atom.ForeignObject, atom.Title]],
]);

type scope = number;

const defaultScope: scope = 0;
const listItemScope: scope = 1;
const buttonScope: scope = 2;
const tableScope: scope = 3;
const tableRowScope: scope = 4;
const tableBodyScope: scope = 5;
const selectScope: scope = 6;

export const whitespace = " \t\r\n\f";

// Section 12.2.6.4.1.
function initialIM(p: parser): boolean {
  switch (p.tok.Type) {
    case TextToken:
      p.tok.Data = strings.TrimLeft(p.tok.Data, whitespace);
      if (p.tok.Data.length === 0) {
        // It was all whitespace, so ignore it.
        return true;
      }
      break;
    case CommentToken:
      p.doc!.AppendChild(newCommentNode(p.tok.Data));
      return true;
    case DoctypeToken: {
      const [n, quirks] = parseDoctype(p.tok.Data);
      p.doc!.AppendChild(n);
      p.quirks = quirks;
      p.im = beforeHTMLIM;
      return true;
    }
  }
  p.quirks = true;
  p.im = beforeHTMLIM;
  return false;
}

// Section 12.2.6.4.2.
function beforeHTMLIM(p: parser): boolean {
  switch (p.tok.Type) {
    case DoctypeToken:
      // Ignore the token.
      return true;
    case TextToken:
      p.tok.Data = strings.TrimLeft(p.tok.Data, whitespace);
      if (p.tok.Data.length === 0) {
        // It was all whitespace, so ignore it.
        return true;
      }
      break;
    case StartTagToken:
      if (p.tok.DataAtom === atom.Html) {
        p.addElement();
        p.im = beforeHeadIM;
        return true;
      }
      break;
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Head:
        case atom.Body:
        case atom.Html:
        case atom.Br:
          p.parseImpliedToken(StartTagToken, atom.Html, atom.AtomString(atom.Html));
          return false;
        default:
          // Ignore the token.
          return true;
      }
    case CommentToken:
      p.doc!.AppendChild(newCommentNode(p.tok.Data));
      return true;
  }
  p.parseImpliedToken(StartTagToken, atom.Html, atom.AtomString(atom.Html));
  return false;
}

// Section 12.2.6.4.3.
function beforeHeadIM(p: parser): boolean {
  switch (p.tok.Type) {
    case TextToken:
      p.tok.Data = strings.TrimLeft(p.tok.Data, whitespace);
      if (p.tok.Data.length === 0) {
        // It was all whitespace, so ignore it.
        return true;
      }
      break;
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Head:
          p.addElement();
          p.head = p.top();
          p.im = inHeadIM;
          return true;
        case atom.Html:
          return inBodyIM(p);
      }
      break;
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Head:
        case atom.Body:
        case atom.Html:
        case atom.Br:
          p.parseImpliedToken(StartTagToken, atom.Head, atom.AtomString(atom.Head));
          return false;
        default:
          // Ignore the token.
          return true;
      }
    case CommentToken:
      p.addChild(newCommentNode(p.tok.Data));
      return true;
    case DoctypeToken:
      // Ignore the token.
      return true;
  }

  p.parseImpliedToken(StartTagToken, atom.Head, atom.AtomString(atom.Head));
  return false;
}

// Section 12.2.6.4.4.
function inHeadIM(p: parser): boolean {
  switch (p.tok.Type) {
    case TextToken: {
      const s = strings.TrimLeft(p.tok.Data, whitespace);
      if (s.length < p.tok.Data.length) {
        // Add the initial whitespace to the current node.
        // PORT-NOTE: byte offset. The trimmed characters are ASCII whitespace, so the UTF-16
        // length difference is the byte length difference.
        p.addText(p.tok.Data.slice(0, p.tok.Data.length - s.length));
        if (s === "") {
          return true;
        }
        p.tok.Data = s;
      }
      break;
    }
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Html:
          return inBodyIM(p);
        case atom.Base:
        case atom.Basefont:
        case atom.Bgsound:
        case atom.Command:
        case atom.Link:
        case atom.Meta:
          p.addElement();
          p.oe.pop();
          p.acknowledgeSelfClosingTag();
          return true;
        case atom.Noscript:
          p.addElement();
          if (p.scripting) {
            p.setOriginalIM();
            p.im = textIM;
          } else {
            p.im = inHeadNoscriptIM;
          }
          return true;
        case atom.Script:
        case atom.Title:
        case atom.Noframes:
        case atom.Style:
          p.addElement();
          p.setOriginalIM();
          p.im = textIM;
          return true;
        case atom.Head:
          // Ignore the token.
          return true;
        case atom.Template:
          p.addElement();
          p.afe.items.push(scopeMarker);
          p.framesetOK = false;
          p.im = inTemplateIM;
          p.templateStack.items.push(inTemplateIM);
          return true;
      }
      break;
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Head:
          p.oe.pop();
          p.im = afterHeadIM;
          return true;
        case atom.Body:
        case atom.Html:
        case atom.Br:
          p.parseImpliedToken(EndTagToken, atom.Head, atom.AtomString(atom.Head));
          return false;
        case atom.Template:
          if (!p.oe.contains(atom.Template)) {
            return true;
          }
          // remove this divergence from the HTML5 spec.
          //
          // See https://bugs.chromium.org/p/chromium/issues/detail?id=829668
          p.generateImpliedEndTags();
          for (let i = p.oe.items.length - 1; i >= 0; i--) {
            const n = p.oe.items[i]!;
            if (n.Namespace === "" && n.DataAtom === atom.Template) {
              p.oe.items.length = i;
              break;
            }
          }
          p.clearActiveFormattingElements();
          p.templateStack.pop();
          p.resetInsertionMode();
          return true;
        default:
          // Ignore the token.
          return true;
      }
    case CommentToken:
      p.addChild(newCommentNode(p.tok.Data));
      return true;
    case DoctypeToken:
      // Ignore the token.
      return true;
  }

  p.parseImpliedToken(EndTagToken, atom.Head, atom.AtomString(atom.Head));
  return false;
}

// 12.2.6.4.5.
function inHeadNoscriptIM(p: parser): boolean {
  switch (p.tok.Type) {
    case DoctypeToken:
      // Ignore the token.
      return true;
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Html:
          return inBodyIM(p);
        case atom.Basefont:
        case atom.Bgsound:
        case atom.Link:
        case atom.Meta:
        case atom.Noframes:
        case atom.Style:
          return inHeadIM(p);
        case atom.Head:
        case atom.Noscript:
          // Ignore the token.
          return true;
      }
      break;
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Noscript:
        case atom.Br:
          break;
        default:
          // Ignore the token.
          return true;
      }
      break;
    case TextToken: {
      const s = strings.TrimLeft(p.tok.Data, whitespace);
      if (s.length === 0) {
        // It was all whitespace.
        return inHeadIM(p);
      }
      break;
    }
    case CommentToken:
      return inHeadIM(p);
  }
  p.oe.pop();
  if (p.top().DataAtom !== atom.Head) {
    // PORT-NOTE: Go panics here.
    throw new Error("html: the new current node will be a head element.");
  }
  p.im = inHeadIM;
  if (p.tok.DataAtom === atom.Noscript) {
    return true;
  }
  return false;
}

// Section 12.2.6.4.6.
function afterHeadIM(p: parser): boolean {
  switch (p.tok.Type) {
    case TextToken: {
      const s = strings.TrimLeft(p.tok.Data, whitespace);
      if (s.length < p.tok.Data.length) {
        // Add the initial whitespace to the current node.
        // PORT-NOTE: byte offset. The trimmed characters are ASCII whitespace, so the UTF-16
        // length difference is the byte length difference.
        p.addText(p.tok.Data.slice(0, p.tok.Data.length - s.length));
        if (s === "") {
          return true;
        }
        p.tok.Data = s;
      }
      break;
    }
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Html:
          return inBodyIM(p);
        case atom.Body:
          p.addElement();
          p.framesetOK = false;
          p.im = inBodyIM;
          return true;
        case atom.Frameset:
          p.addElement();
          p.im = inFramesetIM;
          return true;
        case atom.Base:
        case atom.Basefont:
        case atom.Bgsound:
        case atom.Link:
        case atom.Meta:
        case atom.Noframes:
        case atom.Script:
        case atom.Style:
        case atom.Template:
        case atom.Title: {
          p.oe.items.push(p.head);
          const head = p.head;
          try {
            return inHeadIM(p);
          } finally {
            // PORT-NOTE: Go passes a possibly nil pointer to remove. index finds a nil entry
            // as Go does.
            p.oe.remove(head!);
          }
        }
        case atom.Head:
          // Ignore the token.
          return true;
      }
      break;
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Body:
        case atom.Html:
        case atom.Br:
          // Drop down to creating an implied <body> tag.
          break;
        case atom.Template:
          return inHeadIM(p);
        default:
          // Ignore the token.
          return true;
      }
      break;
    case CommentToken:
      p.addChild(newCommentNode(p.tok.Data));
      return true;
    case DoctypeToken:
      // Ignore the token.
      return true;
  }

  p.parseImpliedToken(StartTagToken, atom.Body, atom.AtomString(atom.Body));
  p.framesetOK = true;
  return false;
}

// copyAttributes copies attributes of src not found on dst to dst.
function copyAttributes(dst: Node, src: Token): void {
  if (src.Attr.length === 0) {
    return;
  }
  const attr = new Map<string, string>();
  for (const t of dst.Attr) {
    attr.set(t.Key, t.Val);
  }
  for (const t of src.Attr) {
    if (!attr.has(t.Key)) {
      dst.Attr.push(t);
      attr.set(t.Key, t.Val);
    }
  }
}

// Section 12.2.6.4.7.
function inBodyIM(p: parser): boolean {
  switch (p.tok.Type) {
    case TextToken: {
      let d = p.tok.Data;
      const n = p.oe.top()!;
      switch (n.DataAtom) {
        case atom.Pre:
        case atom.Listing:
          if (n.FirstChild === null) {
            // Ignore a newline at the start of a <pre> block.
            // PORT-NOTE: byte offset. Removes one ASCII byte, which is one UTF-16 unit.
            if (d !== "" && d.charCodeAt(0) === 0x0d /* \r */) {
              d = d.slice(1);
            }
            if (d !== "" && d.charCodeAt(0) === 0x0a /* \n */) {
              d = d.slice(1);
            }
          }
          break;
      }
      d = strings.Replace(d, "\x00", "", -1);
      if (d === "") {
        return true;
      }
      p.reconstructActiveFormattingElements();
      p.addText(d);
      if (p.framesetOK && strings.TrimLeft(d, whitespace) !== "") {
        // There were non-whitespace characters inserted.
        p.framesetOK = false;
      }
      break;
    }
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Html:
          if (p.oe.contains(atom.Template)) {
            return true;
          }
          copyAttributes(p.oe.items[0]!, p.tok);
          break;
        case atom.Base:
        case atom.Basefont:
        case atom.Bgsound:
        case atom.Command:
        case atom.Link:
        case atom.Meta:
        case atom.Noframes:
        case atom.Script:
        case atom.Style:
        case atom.Template:
        case atom.Title:
          return inHeadIM(p);
        case atom.Body:
          if (p.oe.contains(atom.Template)) {
            return true;
          }
          if (p.oe.items.length >= 2) {
            const body = p.oe.items[1]!;
            if (body.Type === ElementNode && body.DataAtom === atom.Body) {
              p.framesetOK = false;
              copyAttributes(body, p.tok);
            }
          }
          break;
        case atom.Frameset: {
          if (!p.framesetOK || p.oe.items.length < 2 || p.oe.items[1]!.DataAtom !== atom.Body) {
            // Ignore the token.
            return true;
          }
          const body = p.oe.items[1]!;
          if (body.Parent !== null) {
            body.Parent.RemoveChild(body);
          }
          p.oe.items.length = 1;
          p.addElement();
          p.im = inFramesetIM;
          return true;
        }
        case atom.Address:
        case atom.Article:
        case atom.Aside:
        case atom.Blockquote:
        case atom.Center:
        case atom.Details:
        case atom.Dir:
        case atom.Div:
        case atom.Dl:
        case atom.Fieldset:
        case atom.Figcaption:
        case atom.Figure:
        case atom.Footer:
        case atom.Header:
        case atom.Hgroup:
        case atom.Menu:
        case atom.Nav:
        case atom.Ol:
        case atom.P:
        case atom.Section:
        case atom.Summary:
        case atom.Ul:
          p.popUntil(buttonScope, atom.P);
          p.addElement();
          break;
        case atom.H1:
        case atom.H2:
        case atom.H3:
        case atom.H4:
        case atom.H5:
        case atom.H6: {
          p.popUntil(buttonScope, atom.P);
          const n = p.top();
          switch (n.DataAtom) {
            case atom.H1:
            case atom.H2:
            case atom.H3:
            case atom.H4:
            case atom.H5:
            case atom.H6:
              p.oe.pop();
              break;
          }
          p.addElement();
          break;
        }
        case atom.Pre:
        case atom.Listing:
          p.popUntil(buttonScope, atom.P);
          p.addElement();
          // The newline, if any, will be dealt with by the TextToken case.
          p.framesetOK = false;
          break;
        case atom.Form:
          if (p.form !== null && !p.oe.contains(atom.Template)) {
            // Ignore the token
            return true;
          }
          p.popUntil(buttonScope, atom.P);
          p.addElement();
          if (!p.oe.contains(atom.Template)) {
            p.form = p.top();
          }
          break;
        case atom.Li: {
          p.framesetOK = false;
          liLoop: for (let i = p.oe.items.length - 1; i >= 0; i--) {
            const node = p.oe.items[i]!;
            switch (node.DataAtom) {
              case atom.Li:
                p.oe.items.length = i;
                break liLoop;
              case atom.Address:
              case atom.Div:
              case atom.P:
                continue liLoop;
              default:
                if (!isSpecialElement(node)) {
                  continue liLoop;
                }
                break liLoop;
            }
          }
          p.popUntil(buttonScope, atom.P);
          p.addElement();
          break;
        }
        case atom.Dd:
        case atom.Dt: {
          p.framesetOK = false;
          ddLoop: for (let i = p.oe.items.length - 1; i >= 0; i--) {
            const node = p.oe.items[i]!;
            switch (node.DataAtom) {
              case atom.Dd:
              case atom.Dt:
                p.oe.items.length = i;
                break ddLoop;
              case atom.Address:
              case atom.Div:
              case atom.P:
                continue ddLoop;
              default:
                if (!isSpecialElement(node)) {
                  continue ddLoop;
                }
                break ddLoop;
            }
          }
          p.popUntil(buttonScope, atom.P);
          p.addElement();
          break;
        }
        case atom.Plaintext:
          p.popUntil(buttonScope, atom.P);
          p.addElement();
          break;
        case atom.Button:
          p.popUntil(defaultScope, atom.Button);
          p.reconstructActiveFormattingElements();
          p.addElement();
          p.framesetOK = false;
          break;
        case atom.A: {
          for (let i = p.afe.items.length - 1; i >= 0 && p.afe.items[i]!.Type !== scopeMarkerNode; i--) {
            const n = p.afe.items[i]!;
            if (n.Type === ElementNode && n.DataAtom === atom.A) {
              p.inBodyEndTagFormatting(atom.A, "a");
              p.oe.remove(n);
              p.afe.remove(n);
              break;
            }
          }
          p.reconstructActiveFormattingElements();
          p.addFormattingElement();
          break;
        }
        case atom.B:
        case atom.Big:
        case atom.Code:
        case atom.Em:
        case atom.Font:
        case atom.I:
        case atom.S:
        case atom.Small:
        case atom.Strike:
        case atom.Strong:
        case atom.Tt:
        case atom.U:
          p.reconstructActiveFormattingElements();
          p.addFormattingElement();
          break;
        case atom.Nobr:
          p.reconstructActiveFormattingElements();
          if (p.elementInScope(defaultScope, atom.Nobr)) {
            p.inBodyEndTagFormatting(atom.Nobr, "nobr");
            p.reconstructActiveFormattingElements();
          }
          p.addFormattingElement();
          break;
        case atom.Applet:
        case atom.Marquee:
        case atom.Object:
          p.reconstructActiveFormattingElements();
          p.addElement();
          p.afe.items.push(scopeMarker);
          p.framesetOK = false;
          break;
        case atom.Table:
          if (!p.quirks) {
            p.popUntil(buttonScope, atom.P);
          }
          p.addElement();
          p.framesetOK = false;
          p.im = inTableIM;
          return true;
        case atom.Area:
        case atom.Br:
        case atom.Embed:
        case atom.Img:
        case atom.Input:
        case atom.Keygen:
        case atom.Wbr:
          p.reconstructActiveFormattingElements();
          p.addElement();
          p.oe.pop();
          p.acknowledgeSelfClosingTag();
          if (p.tok.DataAtom === atom.Input) {
            for (const t of p.tok.Attr) {
              if (t.Key === "type") {
                if (strings.ToLower(t.Val) === "hidden") {
                  // Skip setting framesetOK = false
                  return true;
                }
              }
            }
          }
          p.framesetOK = false;
          break;
        case atom.Param:
        case atom.Source:
        case atom.Track:
          p.addElement();
          p.oe.pop();
          p.acknowledgeSelfClosingTag();
          break;
        case atom.Hr:
          p.popUntil(buttonScope, atom.P);
          p.addElement();
          p.oe.pop();
          p.acknowledgeSelfClosingTag();
          p.framesetOK = false;
          break;
        case atom.Image:
          p.tok.DataAtom = atom.Img;
          p.tok.Data = atom.AtomString(atom.Img);
          return false;
        case atom.Isindex: {
          if (p.form !== null) {
            // Ignore the token.
            return true;
          }
          let action = "";
          let prompt = "This is a searchable index. Enter search keywords: ";
          const attr: Attribute[] = [newAttribute("name", "isindex")];
          for (const t of p.tok.Attr) {
            switch (t.Key) {
              case "action":
                action = t.Val;
                break;
              case "name":
                // Ignore the attribute.
                break;
              case "prompt":
                prompt = t.Val;
                break;
              default:
                attr.push(t);
            }
          }
          p.acknowledgeSelfClosingTag();
          p.popUntil(buttonScope, atom.P);
          p.parseImpliedToken(StartTagToken, atom.Form, atom.AtomString(atom.Form));
          // PORT-NOTE: parseImpliedToken sets p.form. TypeScript keeps the null narrowing from the
          // check above, so the field is read through a cast here.
          if ((p.form as Node | null) === null) {
            // NOTE: The 'isindex' element has been removed,
            // and the 'template' element has not been designed to be
            // collaborative with the index element.
            //
            // Ignore the token.
            return true;
          }
          if (action !== "") {
            (p.form as Node | null)!.Attr = [newAttribute("action", action)];
          }
          p.parseImpliedToken(StartTagToken, atom.Hr, atom.AtomString(atom.Hr));
          p.parseImpliedToken(StartTagToken, atom.Label, atom.AtomString(atom.Label));
          p.addText(prompt);
          p.addChild(newElementNode(atom.Input, atom.AtomString(atom.Input), attr));
          p.oe.pop();
          p.parseImpliedToken(EndTagToken, atom.Label, atom.AtomString(atom.Label));
          p.parseImpliedToken(StartTagToken, atom.Hr, atom.AtomString(atom.Hr));
          p.parseImpliedToken(EndTagToken, atom.Form, atom.AtomString(atom.Form));
          break;
        }
        case atom.Textarea:
          p.addElement();
          p.setOriginalIM();
          p.framesetOK = false;
          p.im = textIM;
          break;
        case atom.Xmp:
          p.popUntil(buttonScope, atom.P);
          p.reconstructActiveFormattingElements();
          p.framesetOK = false;
          p.addElement();
          p.setOriginalIM();
          p.im = textIM;
          break;
        case atom.Iframe:
          p.framesetOK = false;
          p.addElement();
          p.setOriginalIM();
          p.im = textIM;
          break;
        case atom.Noembed:
        case atom.Noscript:
          p.addElement();
          p.setOriginalIM();
          p.im = textIM;
          break;
        case atom.Select:
          p.reconstructActiveFormattingElements();
          p.addElement();
          p.framesetOK = false;
          p.im = inSelectIM;
          return true;
        case atom.Optgroup:
        case atom.Option:
          if (p.top().DataAtom === atom.Option) {
            p.oe.pop();
          }
          p.reconstructActiveFormattingElements();
          p.addElement();
          break;
        case atom.Rb:
        case atom.Rtc:
          if (p.elementInScope(defaultScope, atom.Ruby)) {
            p.generateImpliedEndTags();
          }
          p.addElement();
          break;
        case atom.Rp:
        case atom.Rt:
          if (p.elementInScope(defaultScope, atom.Ruby)) {
            p.generateImpliedEndTags("rtc");
          }
          p.addElement();
          break;
        case atom.Math:
        case atom.Svg:
          p.reconstructActiveFormattingElements();
          if (p.tok.DataAtom === atom.Math) {
            adjustAttributeNames(p.tok.Attr, mathMLAttributeAdjustments);
          } else {
            adjustAttributeNames(p.tok.Attr, svgAttributeAdjustments);
          }
          adjustForeignAttributes(p.tok.Attr);
          p.addElement();
          p.top().Namespace = p.tok.Data;
          if (p.hasSelfClosingToken) {
            p.oe.pop();
            p.acknowledgeSelfClosingTag();
          }
          return true;
        case atom.Caption:
        case atom.Col:
        case atom.Colgroup:
        case atom.Frame:
        case atom.Head:
        case atom.Tbody:
        case atom.Td:
        case atom.Tfoot:
        case atom.Th:
        case atom.Thead:
        case atom.Tr:
          // Ignore the token.
          break;
        default:
          p.reconstructActiveFormattingElements();
          p.addElement();
      }
      break;
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Body:
          if (p.elementInScope(defaultScope, atom.Body)) {
            p.im = afterBodyIM;
          }
          break;
        case atom.Html:
          if (p.elementInScope(defaultScope, atom.Body)) {
            p.parseImpliedToken(EndTagToken, atom.Body, atom.AtomString(atom.Body));
            return false;
          }
          return true;
        case atom.Address:
        case atom.Article:
        case atom.Aside:
        case atom.Blockquote:
        case atom.Button:
        case atom.Center:
        case atom.Details:
        case atom.Dir:
        case atom.Div:
        case atom.Dl:
        case atom.Fieldset:
        case atom.Figcaption:
        case atom.Figure:
        case atom.Footer:
        case atom.Header:
        case atom.Hgroup:
        case atom.Listing:
        case atom.Menu:
        case atom.Nav:
        case atom.Ol:
        case atom.Pre:
        case atom.Section:
        case atom.Summary:
        case atom.Ul:
          p.popUntil(defaultScope, p.tok.DataAtom);
          break;
        case atom.Form:
          if (p.oe.contains(atom.Template)) {
            const i = p.indexOfElementInScope(defaultScope, atom.Form);
            if (i === -1) {
              // Ignore the token.
              return true;
            }
            p.generateImpliedEndTags();
            if (p.oe.items[i]!.DataAtom !== atom.Form) {
              // Ignore the token.
              return true;
            }
            p.popUntil(defaultScope, atom.Form);
          } else {
            const node = p.form;
            p.form = null;
            const i = p.indexOfElementInScope(defaultScope, atom.Form);
            if (node === null || i === -1 || p.oe.items[i] !== node) {
              // Ignore the token.
              return true;
            }
            p.generateImpliedEndTags();
            p.oe.remove(node);
          }
          break;
        case atom.P:
          if (!p.elementInScope(buttonScope, atom.P)) {
            p.parseImpliedToken(StartTagToken, atom.P, atom.AtomString(atom.P));
          }
          p.popUntil(buttonScope, atom.P);
          break;
        case atom.Li:
          p.popUntil(listItemScope, atom.Li);
          break;
        case atom.Dd:
        case atom.Dt:
          p.popUntil(defaultScope, p.tok.DataAtom);
          break;
        case atom.H1:
        case atom.H2:
        case atom.H3:
        case atom.H4:
        case atom.H5:
        case atom.H6:
          p.popUntil(defaultScope, atom.H1, atom.H2, atom.H3, atom.H4, atom.H5, atom.H6);
          break;
        case atom.A:
        case atom.B:
        case atom.Big:
        case atom.Code:
        case atom.Em:
        case atom.Font:
        case atom.I:
        case atom.Nobr:
        case atom.S:
        case atom.Small:
        case atom.Strike:
        case atom.Strong:
        case atom.Tt:
        case atom.U:
          p.inBodyEndTagFormatting(p.tok.DataAtom, p.tok.Data);
          break;
        case atom.Applet:
        case atom.Marquee:
        case atom.Object:
          if (p.popUntil(defaultScope, p.tok.DataAtom)) {
            p.clearActiveFormattingElements();
          }
          break;
        case atom.Br:
          p.tok.Type = StartTagToken;
          return false;
        case atom.Template:
          return inHeadIM(p);
        default:
          p.inBodyEndTagOther(p.tok.DataAtom, p.tok.Data);
      }
      break;
    case CommentToken:
      p.addChild(newCommentNode(p.tok.Data));
      break;
    case ErrorToken:
      // remove this divergence from the HTML5 spec.
      if (p.templateStack.items.length > 0) {
        p.im = inTemplateIM;
        return false;
      } else {
        for (const e of p.oe.items) {
          switch (e!.DataAtom) {
            case atom.Dd:
            case atom.Dt:
            case atom.Li:
            case atom.Optgroup:
            case atom.Option:
            case atom.P:
            case atom.Rb:
            case atom.Rp:
            case atom.Rt:
            case atom.Rtc:
            case atom.Tbody:
            case atom.Td:
            case atom.Tfoot:
            case atom.Th:
            case atom.Thead:
            case atom.Tr:
            case atom.Body:
            case atom.Html:
              break;
            default:
              return true;
          }
        }
      }
      break;
  }

  return true;
}

// Section 12.2.6.4.8.
function textIM(p: parser): boolean {
  switch (p.tok.Type) {
    case ErrorToken:
      p.oe.pop();
      break;
    case TextToken: {
      let d = p.tok.Data;
      const n = p.oe.top()!;
      if (n.DataAtom === atom.Textarea && n.FirstChild === null) {
        // Ignore a newline at the start of a <textarea> block.
        // PORT-NOTE: byte offset. Removes one ASCII byte, which is one UTF-16 unit.
        if (d !== "" && d.charCodeAt(0) === 0x0d /* \r */) {
          d = d.slice(1);
        }
        if (d !== "" && d.charCodeAt(0) === 0x0a /* \n */) {
          d = d.slice(1);
        }
      }
      if (d === "") {
        return true;
      }
      p.addText(d);
      return true;
    }
    case EndTagToken:
      p.oe.pop();
      break;
  }
  // PORT-NOTE: Go assigns p.originalIM (nil when not set) to p.im. Here a null originalIM is
  // assigned as null, and a later call through p.im fails as the nil call does in Go.
  p.im = p.originalIM;
  p.originalIM = null;
  return p.tok.Type === EndTagToken;
}

// Section 12.2.6.4.9.
function inTableIM(p: parser): boolean {
  switch (p.tok.Type) {
    case TextToken:
      p.tok.Data = strings.Replace(p.tok.Data, "\x00", "", -1);
      switch (p.oe.top()!.DataAtom) {
        case atom.Table:
        case atom.Tbody:
        case atom.Tfoot:
        case atom.Thead:
        case atom.Tr:
          if (strings.Trim(p.tok.Data, whitespace) === "") {
            p.addText(p.tok.Data);
            return true;
          }
      }
      break;
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Caption:
          p.clearStackToContext(tableScope);
          p.afe.items.push(scopeMarker);
          p.addElement();
          p.im = inCaptionIM;
          return true;
        case atom.Colgroup:
          p.clearStackToContext(tableScope);
          p.addElement();
          p.im = inColumnGroupIM;
          return true;
        case atom.Col:
          p.parseImpliedToken(StartTagToken, atom.Colgroup, atom.AtomString(atom.Colgroup));
          return false;
        case atom.Tbody:
        case atom.Tfoot:
        case atom.Thead:
          p.clearStackToContext(tableScope);
          p.addElement();
          p.im = inTableBodyIM;
          return true;
        case atom.Td:
        case atom.Th:
        case atom.Tr:
          p.parseImpliedToken(StartTagToken, atom.Tbody, atom.AtomString(atom.Tbody));
          return false;
        case atom.Table:
          if (p.popUntil(tableScope, atom.Table)) {
            p.resetInsertionMode();
            return false;
          }
          // Ignore the token.
          return true;
        case atom.Style:
        case atom.Script:
        case atom.Template:
          return inHeadIM(p);
        case atom.Input:
          for (const t of p.tok.Attr) {
            if (t.Key === "type" && strings.ToLower(t.Val) === "hidden") {
              p.addElement();
              p.oe.pop();
              return true;
            }
          }
          // Otherwise drop down to the default action.
          break;
        case atom.Form:
          if (p.oe.contains(atom.Template) || p.form !== null) {
            // Ignore the token.
            return true;
          }
          p.addElement();
          p.form = p.oe.pop();
          break;
        case atom.Select:
          p.reconstructActiveFormattingElements();
          switch (p.top().DataAtom) {
            case atom.Table:
            case atom.Tbody:
            case atom.Tfoot:
            case atom.Thead:
            case atom.Tr:
              p.fosterParenting = true;
          }
          p.addElement();
          p.fosterParenting = false;
          p.framesetOK = false;
          p.im = inSelectInTableIM;
          return true;
      }
      break;
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Table:
          if (p.popUntil(tableScope, atom.Table)) {
            p.resetInsertionMode();
            return true;
          }
          // Ignore the token.
          return true;
        case atom.Body:
        case atom.Caption:
        case atom.Col:
        case atom.Colgroup:
        case atom.Html:
        case atom.Tbody:
        case atom.Td:
        case atom.Tfoot:
        case atom.Th:
        case atom.Thead:
        case atom.Tr:
          // Ignore the token.
          return true;
        case atom.Template:
          return inHeadIM(p);
      }
      break;
    case CommentToken:
      p.addChild(newCommentNode(p.tok.Data));
      return true;
    case DoctypeToken:
      // Ignore the token.
      return true;
    case ErrorToken:
      return inBodyIM(p);
  }

  p.fosterParenting = true;
  try {
    return inBodyIM(p);
  } finally {
    p.fosterParenting = false;
  }
}

// Section 12.2.6.4.11.
function inCaptionIM(p: parser): boolean {
  switch (p.tok.Type) {
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Caption:
        case atom.Col:
        case atom.Colgroup:
        case atom.Tbody:
        case atom.Td:
        case atom.Tfoot:
        case atom.Thead:
        case atom.Tr:
          if (p.popUntil(tableScope, atom.Caption)) {
            p.clearActiveFormattingElements();
            p.im = inTableIM;
            return false;
          } else {
            // Ignore the token.
            return true;
          }
        case atom.Select:
          p.reconstructActiveFormattingElements();
          p.addElement();
          p.framesetOK = false;
          p.im = inSelectInTableIM;
          return true;
      }
      break;
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Caption:
          if (p.popUntil(tableScope, atom.Caption)) {
            p.clearActiveFormattingElements();
            p.im = inTableIM;
          }
          return true;
        case atom.Table:
          if (p.popUntil(tableScope, atom.Caption)) {
            p.clearActiveFormattingElements();
            p.im = inTableIM;
            return false;
          } else {
            // Ignore the token.
            return true;
          }
        case atom.Body:
        case atom.Col:
        case atom.Colgroup:
        case atom.Html:
        case atom.Tbody:
        case atom.Td:
        case atom.Tfoot:
        case atom.Th:
        case atom.Thead:
        case atom.Tr:
          // Ignore the token.
          return true;
      }
      break;
  }
  return inBodyIM(p);
}

// Section 12.2.6.4.12.
function inColumnGroupIM(p: parser): boolean {
  switch (p.tok.Type) {
    case TextToken: {
      const s = strings.TrimLeft(p.tok.Data, whitespace);
      if (s.length < p.tok.Data.length) {
        // Add the initial whitespace to the current node.
        // PORT-NOTE: byte offset. The trimmed characters are ASCII whitespace, so the UTF-16
        // length difference is the byte length difference.
        p.addText(p.tok.Data.slice(0, p.tok.Data.length - s.length));
        if (s === "") {
          return true;
        }
        p.tok.Data = s;
      }
      break;
    }
    case CommentToken:
      p.addChild(newCommentNode(p.tok.Data));
      return true;
    case DoctypeToken:
      // Ignore the token.
      return true;
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Html:
          return inBodyIM(p);
        case atom.Col:
          p.addElement();
          p.oe.pop();
          p.acknowledgeSelfClosingTag();
          return true;
        case atom.Template:
          return inHeadIM(p);
      }
      break;
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Colgroup:
          if (p.oe.top()!.DataAtom === atom.Colgroup) {
            p.oe.pop();
            p.im = inTableIM;
          }
          return true;
        case atom.Col:
          // Ignore the token.
          return true;
        case atom.Template:
          return inHeadIM(p);
      }
      break;
    case ErrorToken:
      return inBodyIM(p);
  }
  if (p.oe.top()!.DataAtom !== atom.Colgroup) {
    return true;
  }
  p.oe.pop();
  p.im = inTableIM;
  return false;
}

// Section 12.2.6.4.13.
function inTableBodyIM(p: parser): boolean {
  switch (p.tok.Type) {
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Tr:
          p.clearStackToContext(tableBodyScope);
          p.addElement();
          p.im = inRowIM;
          return true;
        case atom.Td:
        case atom.Th:
          p.parseImpliedToken(StartTagToken, atom.Tr, atom.AtomString(atom.Tr));
          return false;
        case atom.Caption:
        case atom.Col:
        case atom.Colgroup:
        case atom.Tbody:
        case atom.Tfoot:
        case atom.Thead:
          if (p.popUntil(tableScope, atom.Tbody, atom.Thead, atom.Tfoot)) {
            p.im = inTableIM;
            return false;
          }
          // Ignore the token.
          return true;
      }
      break;
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Tbody:
        case atom.Tfoot:
        case atom.Thead:
          if (p.elementInScope(tableScope, p.tok.DataAtom)) {
            p.clearStackToContext(tableBodyScope);
            p.oe.pop();
            p.im = inTableIM;
          }
          return true;
        case atom.Table:
          if (p.popUntil(tableScope, atom.Tbody, atom.Thead, atom.Tfoot)) {
            p.im = inTableIM;
            return false;
          }
          // Ignore the token.
          return true;
        case atom.Body:
        case atom.Caption:
        case atom.Col:
        case atom.Colgroup:
        case atom.Html:
        case atom.Td:
        case atom.Th:
        case atom.Tr:
          // Ignore the token.
          return true;
      }
      break;
    case CommentToken:
      p.addChild(newCommentNode(p.tok.Data));
      return true;
  }

  return inTableIM(p);
}

// Section 12.2.6.4.14.
function inRowIM(p: parser): boolean {
  switch (p.tok.Type) {
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Td:
        case atom.Th:
          p.clearStackToContext(tableRowScope);
          p.addElement();
          p.afe.items.push(scopeMarker);
          p.im = inCellIM;
          return true;
        case atom.Caption:
        case atom.Col:
        case atom.Colgroup:
        case atom.Tbody:
        case atom.Tfoot:
        case atom.Thead:
        case atom.Tr:
          if (p.popUntil(tableScope, atom.Tr)) {
            p.im = inTableBodyIM;
            return false;
          }
          // Ignore the token.
          return true;
      }
      break;
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Tr:
          if (p.popUntil(tableScope, atom.Tr)) {
            p.im = inTableBodyIM;
            return true;
          }
          // Ignore the token.
          return true;
        case atom.Table:
          if (p.popUntil(tableScope, atom.Tr)) {
            p.im = inTableBodyIM;
            return false;
          }
          // Ignore the token.
          return true;
        case atom.Tbody:
        case atom.Tfoot:
        case atom.Thead:
          if (p.elementInScope(tableScope, p.tok.DataAtom)) {
            p.parseImpliedToken(EndTagToken, atom.Tr, atom.AtomString(atom.Tr));
            return false;
          }
          // Ignore the token.
          return true;
        case atom.Body:
        case atom.Caption:
        case atom.Col:
        case atom.Colgroup:
        case atom.Html:
        case atom.Td:
        case atom.Th:
          // Ignore the token.
          return true;
      }
      break;
  }

  return inTableIM(p);
}

// Section 12.2.6.4.15.
function inCellIM(p: parser): boolean {
  switch (p.tok.Type) {
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Caption:
        case atom.Col:
        case atom.Colgroup:
        case atom.Tbody:
        case atom.Td:
        case atom.Tfoot:
        case atom.Th:
        case atom.Thead:
        case atom.Tr:
          if (p.popUntil(tableScope, atom.Td, atom.Th)) {
            // Close the cell and reprocess.
            p.clearActiveFormattingElements();
            p.im = inRowIM;
            return false;
          }
          // Ignore the token.
          return true;
        case atom.Select:
          p.reconstructActiveFormattingElements();
          p.addElement();
          p.framesetOK = false;
          p.im = inSelectInTableIM;
          return true;
      }
      break;
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Td:
        case atom.Th:
          if (!p.popUntil(tableScope, p.tok.DataAtom)) {
            // Ignore the token.
            return true;
          }
          p.clearActiveFormattingElements();
          p.im = inRowIM;
          return true;
        case atom.Body:
        case atom.Caption:
        case atom.Col:
        case atom.Colgroup:
        case atom.Html:
          // Ignore the token.
          return true;
        case atom.Table:
        case atom.Tbody:
        case atom.Tfoot:
        case atom.Thead:
        case atom.Tr:
          if (!p.elementInScope(tableScope, p.tok.DataAtom)) {
            // Ignore the token.
            return true;
          }
          // Close the cell and reprocess.
          if (p.popUntil(tableScope, atom.Td, atom.Th)) {
            p.clearActiveFormattingElements();
          }
          p.im = inRowIM;
          return false;
      }
      break;
  }
  return inBodyIM(p);
}

// Section 12.2.6.4.16.
function inSelectIM(p: parser): boolean {
  switch (p.tok.Type) {
    case TextToken:
      p.addText(strings.Replace(p.tok.Data, "\x00", "", -1));
      break;
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Html:
          return inBodyIM(p);
        case atom.Option:
          if (p.top().DataAtom === atom.Option) {
            p.oe.pop();
          }
          p.addElement();
          break;
        case atom.Optgroup:
          if (p.top().DataAtom === atom.Option) {
            p.oe.pop();
          }
          if (p.top().DataAtom === atom.Optgroup) {
            p.oe.pop();
          }
          p.addElement();
          break;
        case atom.Select:
          if (p.popUntil(selectScope, atom.Select)) {
            p.resetInsertionMode();
          } else {
            // Ignore the token.
            return true;
          }
          break;
        case atom.Input:
        case atom.Keygen:
        case atom.Textarea:
          if (p.elementInScope(selectScope, atom.Select)) {
            p.parseImpliedToken(EndTagToken, atom.Select, atom.AtomString(atom.Select));
            return false;
          }
          // In order to properly ignore <textarea>, we need to change the tokenizer mode.
          p.tokenizer!.NextIsNotRawText();
          // Ignore the token.
          return true;
        case atom.Script:
        case atom.Template:
          return inHeadIM(p);
      }
      break;
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Option:
          if (p.top().DataAtom === atom.Option) {
            p.oe.pop();
          }
          break;
        case atom.Optgroup: {
          let i = p.oe.items.length - 1;
          if (p.oe.items[i]!.DataAtom === atom.Option) {
            i--;
          }
          if (p.oe.items[i]!.DataAtom === atom.Optgroup) {
            p.oe.items.length = i;
          }
          break;
        }
        case atom.Select:
          if (p.popUntil(selectScope, atom.Select)) {
            p.resetInsertionMode();
          } else {
            // Ignore the token.
            return true;
          }
          break;
        case atom.Template:
          return inHeadIM(p);
      }
      break;
    case CommentToken:
      p.addChild(newCommentNode(p.tok.Data));
      break;
    case DoctypeToken:
      // Ignore the token.
      return true;
    case ErrorToken:
      return inBodyIM(p);
  }

  return true;
}

// Section 12.2.6.4.17.
function inSelectInTableIM(p: parser): boolean {
  switch (p.tok.Type) {
    case StartTagToken:
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Caption:
        case atom.Table:
        case atom.Tbody:
        case atom.Tfoot:
        case atom.Thead:
        case atom.Tr:
        case atom.Td:
        case atom.Th:
          if (p.tok.Type === EndTagToken && !p.elementInScope(tableScope, p.tok.DataAtom)) {
            // Ignore the token.
            return true;
          }
          // This is like p.popUntil(selectScope, a.Select), but it also
          // matches <math select>, not just <select>. Matching the MathML
          // tag is arguably incorrect (conceptually), but it mimics what
          // Chromium does.
          for (let i = p.oe.items.length - 1; i >= 0; i--) {
            const n = p.oe.items[i]!;
            if (n.DataAtom === atom.Select) {
              p.oe.items.length = i;
              break;
            }
          }
          p.resetInsertionMode();
          return false;
      }
      break;
  }
  return inSelectIM(p);
}

// Section 12.2.6.4.18.
function inTemplateIM(p: parser): boolean {
  switch (p.tok.Type) {
    case TextToken:
    case CommentToken:
    case DoctypeToken:
      return inBodyIM(p);
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Base:
        case atom.Basefont:
        case atom.Bgsound:
        case atom.Link:
        case atom.Meta:
        case atom.Noframes:
        case atom.Script:
        case atom.Style:
        case atom.Template:
        case atom.Title:
          return inHeadIM(p);
        case atom.Caption:
        case atom.Colgroup:
        case atom.Tbody:
        case atom.Tfoot:
        case atom.Thead:
          p.templateStack.pop();
          p.templateStack.items.push(inTableIM);
          p.im = inTableIM;
          return false;
        case atom.Col:
          p.templateStack.pop();
          p.templateStack.items.push(inColumnGroupIM);
          p.im = inColumnGroupIM;
          return false;
        case atom.Tr:
          p.templateStack.pop();
          p.templateStack.items.push(inTableBodyIM);
          p.im = inTableBodyIM;
          return false;
        case atom.Td:
        case atom.Th:
          p.templateStack.pop();
          p.templateStack.items.push(inRowIM);
          p.im = inRowIM;
          return false;
        default:
          p.templateStack.pop();
          p.templateStack.items.push(inBodyIM);
          p.im = inBodyIM;
          return false;
      }
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Template:
          return inHeadIM(p);
        default:
          // Ignore the token.
          return true;
      }
    case ErrorToken:
      if (!p.oe.contains(atom.Template)) {
        // Ignore the token.
        return true;
      }
      // remove this divergence from the HTML5 spec.
      //
      // See https://bugs.chromium.org/p/chromium/issues/detail?id=829668
      p.generateImpliedEndTags();
      for (let i = p.oe.items.length - 1; i >= 0; i--) {
        const n = p.oe.items[i]!;
        if (n.Namespace === "" && n.DataAtom === atom.Template) {
          p.oe.items.length = i;
          break;
        }
      }
      p.clearActiveFormattingElements();
      p.templateStack.pop();
      p.resetInsertionMode();
      return false;
  }
  return false;
}

// Section 12.2.6.4.19.
function afterBodyIM(p: parser): boolean {
  switch (p.tok.Type) {
    case ErrorToken:
      // Stop parsing.
      return true;
    case TextToken: {
      const s = strings.TrimLeft(p.tok.Data, whitespace);
      if (s.length === 0) {
        // It was all whitespace.
        return inBodyIM(p);
      }
      break;
    }
    case StartTagToken:
      if (p.tok.DataAtom === atom.Html) {
        return inBodyIM(p);
      }
      break;
    case EndTagToken:
      if (p.tok.DataAtom === atom.Html) {
        if (!p.fragment) {
          p.im = afterAfterBodyIM;
        }
        return true;
      }
      break;
    case CommentToken:
      // The comment is attached to the <html> element.
      if (p.oe.items.length < 1 || p.oe.items[0]!.DataAtom !== atom.Html) {
        // PORT-NOTE: Go panics here.
        throw new Error("html: bad parser state: <html> element not found, in the after-body insertion mode");
      }
      p.oe.items[0]!.AppendChild(newCommentNode(p.tok.Data));
      return true;
  }
  p.im = inBodyIM;
  return false;
}

// Section 12.2.6.4.20.
function inFramesetIM(p: parser): boolean {
  switch (p.tok.Type) {
    case CommentToken:
      p.addChild(newCommentNode(p.tok.Data));
      break;
    case TextToken: {
      // Ignore all text but whitespace.
      const s = strings.Map((c: number): number => {
        switch (c) {
          case 0x20: // ' '
          case 0x09: // '\t'
          case 0x0a: // '\n'
          case 0x0c: // '\f'
          case 0x0d: // '\r'
            return c;
        }
        return -1;
      }, p.tok.Data);
      if (s !== "") {
        p.addText(s);
      }
      break;
    }
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Html:
          return inBodyIM(p);
        case atom.Frameset:
          p.addElement();
          break;
        case atom.Frame:
          p.addElement();
          p.oe.pop();
          p.acknowledgeSelfClosingTag();
          break;
        case atom.Noframes:
          return inHeadIM(p);
      }
      break;
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Frameset:
          if (p.oe.top()!.DataAtom !== atom.Html) {
            p.oe.pop();
            if (p.oe.top()!.DataAtom !== atom.Frameset) {
              p.im = afterFramesetIM;
              return true;
            }
          }
          break;
      }
      break;
    default:
    // Ignore the token.
  }
  return true;
}

// Section 12.2.6.4.21.
function afterFramesetIM(p: parser): boolean {
  switch (p.tok.Type) {
    case CommentToken:
      p.addChild(newCommentNode(p.tok.Data));
      break;
    case TextToken: {
      // Ignore all text but whitespace.
      const s = strings.Map((c: number): number => {
        switch (c) {
          case 0x20: // ' '
          case 0x09: // '\t'
          case 0x0a: // '\n'
          case 0x0c: // '\f'
          case 0x0d: // '\r'
            return c;
        }
        return -1;
      }, p.tok.Data);
      if (s !== "") {
        p.addText(s);
      }
      break;
    }
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Html:
          return inBodyIM(p);
        case atom.Noframes:
          return inHeadIM(p);
      }
      break;
    case EndTagToken:
      switch (p.tok.DataAtom) {
        case atom.Html:
          p.im = afterAfterFramesetIM;
          return true;
      }
      break;
    default:
    // Ignore the token.
  }
  return true;
}

// Section 12.2.6.4.22.
function afterAfterBodyIM(p: parser): boolean {
  switch (p.tok.Type) {
    case ErrorToken:
      // Stop parsing.
      return true;
    case TextToken: {
      const s = strings.TrimLeft(p.tok.Data, whitespace);
      if (s.length === 0) {
        // It was all whitespace.
        return inBodyIM(p);
      }
      break;
    }
    case StartTagToken:
      if (p.tok.DataAtom === atom.Html) {
        return inBodyIM(p);
      }
      break;
    case CommentToken:
      p.doc!.AppendChild(newCommentNode(p.tok.Data));
      return true;
    case DoctypeToken:
      return inBodyIM(p);
  }
  p.im = inBodyIM;
  return false;
}

// Section 12.2.6.4.23.
function afterAfterFramesetIM(p: parser): boolean {
  switch (p.tok.Type) {
    case CommentToken:
      p.doc!.AppendChild(newCommentNode(p.tok.Data));
      break;
    case TextToken: {
      // Ignore all text but whitespace.
      const s = strings.Map((c: number): number => {
        switch (c) {
          case 0x20: // ' '
          case 0x09: // '\t'
          case 0x0a: // '\n'
          case 0x0c: // '\f'
          case 0x0d: // '\r'
            return c;
        }
        return -1;
      }, p.tok.Data);
      if (s !== "") {
        p.tok.Data = s;
        return inBodyIM(p);
      }
      break;
    }
    case StartTagToken:
      switch (p.tok.DataAtom) {
        case atom.Html:
          return inBodyIM(p);
        case atom.Noframes:
          return inHeadIM(p);
      }
      break;
    case DoctypeToken:
      return inBodyIM(p);
    default:
    // Ignore the token.
  }
  return true;
}

const whitespaceOrNUL = whitespace + "\x00";

// Section 12.2.6.5
function parseForeignContent(p: parser): boolean {
  switch (p.tok.Type) {
    case TextToken:
      if (p.framesetOK) {
        p.framesetOK = strings.TrimLeft(p.tok.Data, whitespaceOrNUL) === "";
      }
      p.tok.Data = strings.Replace(p.tok.Data, "\x00", "�", -1);
      p.addText(p.tok.Data);
      break;
    case CommentToken:
      p.addChild(newCommentNode(p.tok.Data));
      break;
    case StartTagToken: {
      let b = breakout.get(p.tok.Data) === true;
      if (p.tok.DataAtom === atom.Font) {
        loop: for (const attr of p.tok.Attr) {
          switch (attr.Key) {
            case "color":
            case "face":
            case "size":
              b = true;
              break loop;
          }
        }
      }
      if (b) {
        for (let i = p.oe.items.length - 1; i >= 0; i--) {
          const n = p.oe.items[i]!;
          if (n.Namespace === "" || htmlIntegrationPoint(n) || mathMLTextIntegrationPoint(n)) {
            p.oe.items.length = i + 1;
            break;
          }
        }
        return false;
      }
      switch (p.top().Namespace) {
        case "math":
          adjustAttributeNames(p.tok.Attr, mathMLAttributeAdjustments);
          break;
        case "svg": {
          // Adjust SVG tag names. The tokenizer lower-cases tag names, but
          // SVG wants e.g. "foreignObject" with a capital second "O".
          const x = svgTagNameAdjustments.get(p.tok.Data) ?? "";
          if (x !== "") {
            p.tok.DataAtom = atom.Lookup(conv.BytesFromString(x));
            p.tok.Data = x;
          }
          adjustAttributeNames(p.tok.Attr, svgAttributeAdjustments);
          break;
        }
        default:
          // PORT-NOTE: Go panics here.
          throw new Error("html: bad parser state: unexpected namespace");
      }
      adjustForeignAttributes(p.tok.Attr);
      const namespace = p.top().Namespace;
      p.addElement();
      p.top().Namespace = namespace;
      if (namespace !== "") {
        // Don't let the tokenizer go into raw text mode in foreign content
        // (e.g. in an SVG <title> tag).
        p.tokenizer!.NextIsNotRawText();
      }
      if (p.hasSelfClosingToken) {
        p.oe.pop();
        p.acknowledgeSelfClosingTag();
      }
      break;
    }
    case EndTagToken:
      for (let i = p.oe.items.length - 1; i >= 0; i--) {
        if (p.oe.items[i]!.Namespace === "") {
          return p.im!(p);
        }
        if (strings.EqualFold(p.oe.items[i]!.Data, p.tok.Data)) {
          p.oe.items.length = i;
          break;
        }
      }
      return true;
    default:
    // Ignore the token.
  }
  return true;
}

// Parse returns the parse tree for the HTML from the given input.
//
// It implements the HTML5 parsing algorithm
// (https://html.spec.whatwg.org/multipage/syntax.html#tree-construction),
// which is very complicated. The resultant tree can contain implicitly created
// nodes that have no explicit <tag> listed in r's data, and nodes' parents can
// differ from the nesting implied by a naive processing of start and end
// <tag>s. Conversely, explicit <tag>s in r's data can be silently dropped,
// with no corresponding node in the resulting tree.
//
// The input is assumed to be UTF-8 encoded.
//
// PORT-NOTE: The input is a Uint8Array, not an io.Reader (see the note at the top of
// token.ts). It returns [node, error] as a tuple.
export function Parse(buf: Uint8Array): [Node | null, Error | null] {
  return ParseWithOptions(buf);
}

// ParseFragment parses a fragment of HTML and returns the nodes that were
// found. If the fragment is the InnerHTML for an existing element, pass that
// element in context.
//
// It has the same intricacies as Parse.
export function ParseFragment(buf: Uint8Array, context: Node | null): [Node[], Error | null] {
  return ParseFragmentWithOptions(buf, context);
}

// ParseOption configures a parser.
export type ParseOption = (p: parser) => void;

// ParseOptionEnableScripting configures the scripting flag.
// https://html.spec.whatwg.org/multipage/webappapis.html#enabling-and-disabling-scripting
//
// By default, scripting is enabled.
export function ParseOptionEnableScripting(enable: boolean): ParseOption {
  return (p: parser): void => {
    p.scripting = enable;
  };
}

// ParseWithOptions is like Parse, with options.
export function ParseWithOptions(buf: Uint8Array, ...opts: ParseOption[]): [Node | null, Error | null] {
  const p = new parser();
  p.tokenizer = NewTokenizer(buf);
  p.doc = newDocumentNode();
  p.scripting = true;
  p.framesetOK = true;
  p.im = initialIM;

  for (const f of opts) {
    f(p);
  }

  const err = p.parse();
  if (err !== null) {
    return [null, err];
  }
  return [p.doc, null];
}

// ParseFragmentWithOptions is like ParseFragment, with options.
export function ParseFragmentWithOptions(
  buf: Uint8Array,
  context: Node | null,
  ...opts: ParseOption[]
): [Node[], Error | null] {
  let contextTag = "";
  if (context !== null) {
    if (context.Type !== ElementNode) {
      return [[], new Error("html: ParseFragment of non-element Node")];
    }
    // The next check isn't just context.DataAtom.String() == context.Data because
    // it is valid to pass an element whose tag isn't a known atom. For example,
    // DataAtom == 0 and Data = "tagfromthefuture" is perfectly consistent.
    if (context.DataAtom !== atom.Lookup(conv.BytesFromString(context.Data))) {
      return [
        [],
        new Error("html: inconsistent Node: DataAtom=" + strconv.Itoa(context.DataAtom) + ", Data=" + context.Data),
      ];
    }
    contextTag = atom.AtomString(context.DataAtom);
  }
  const p = new parser();
  p.tokenizer = NewTokenizerFragment(buf, contextTag);
  p.doc = newDocumentNode();
  p.scripting = true;
  p.fragment = true;
  p.context = context;

  for (const f of opts) {
    f(p);
  }

  const root = new Node();
  root.Type = ElementNode;
  root.DataAtom = atom.Html;
  root.Data = atom.AtomString(atom.Html);
  p.doc!.AppendChild(root);
  p.oe.items = [root];
  if (context !== null && context.DataAtom === atom.Template) {
    p.templateStack.items.push(inTemplateIM);
  }
  p.resetInsertionMode();

  for (let n: Node | null = context; n !== null; n = n.Parent) {
    if (n.Type === ElementNode && n.DataAtom === atom.Form) {
      p.form = n;
      break;
    }
  }

  const err = p.parse();
  if (err !== null) {
    return [[], err];
  }

  let parent = p.doc!;
  if (context !== null) {
    parent = root;
  }

  const result: Node[] = [];
  for (let c: Node | null = parent.FirstChild; c !== null; ) {
    const next = c.NextSibling;
    parent.RemoveChild(c);
    result.push(c);
    c = next;
  }
  return [result, null];
}

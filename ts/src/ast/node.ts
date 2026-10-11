// Ported from ast/node.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";
import * as slices from "../runtime/slices.ts";
import * as sort from "../runtime/sort.ts";
import * as strings from "../runtime/strings.ts";
import * as url from "../runtime/url.ts";
import * as utf8 from "../runtime/utf8.ts";
import * as editor from "../editor/index.ts";
import * as html from "../html/index.ts";
import * as lex from "../lex/index.ts";
import * as util from "../util/index.ts";
import { Walk, WalkContinue } from "./walk.ts";
import type { WalkStatus } from "./walk.ts";
import { NodeTypeString } from "./nodetype_string.ts";
import { TabTitleBlockOf, IsTabTitleBlockOf } from "./tabs.ts";
import type { TableCellRich } from "./table_rich.ts";

// PORT-NOTE: a nil []byte is null only where Go compares it with nil (Tokens, CodeBlockCloseFence). Elsewhere a Go nil slice is an empty Uint8Array.
// emptyBytes stands in for a nil Tokens in read-only code, and is the shared value of the byte fields that Go leaves as nil or empty
// (CodeBlockOpenFence, CodeBlockInfo, LinkRefLabel, FootnotesRefLabel, HtmlEntityTokens). It is never written through: it has no
// elements and no capacity (Cap is 0), so slices.Append always allocates a new array for it, and every write is a no-op as on a fresh array.
const emptyBytes: Uint8Array = new Uint8Array(0);

// Node describes the node structure.
// Why this is a single struct and not an interface:
//   1. Changing the node type is cheap: only the Type field changes
//   2. Extensibility is traded for speed
//
// PORT-NOTE: `Node` has all of Go's fields. Only Properties is an accessor (lazily created map); there is no hot/cold split.
export class Node {
  // Why this is a single struct and not an interface:
  // 1. Changing the node type is cheap: only the Type field changes
  // 2. Extensibility is traded for speed

  // Basic node structure

  ID: string; // Unique node identifier
  Box: string; // Container (box)
  Path: string; // Path
  Spec: string; // Spec version number

  Type: NodeType; // Node type
  Parent: Node | null; // Parent node
  Previous: Node | null; // Previous sibling
  Next: Node | null; // Next sibling
  FirstChild: Node | null; // First child
  LastChild: Node | null; // Last child
  Children: Node[]; // All child nodes
  Tokens: Uint8Array | null; // Lexer tokens; the parser keeps operating on these tokens
  TypeStr: string; // Type string
  Data: string; // Tokens as a string

  // Parsing flags

  Close: boolean; // Whether the node is closed
  LastLineBlank: boolean; // Whether the last line is blank
  LastLineChecked: boolean; // Whether the last line has been checked

  // Code

  CodeMarkerLen: number; // Number of backticks, 1 or 2

  // Code block

  IsFencedCodeBlock: boolean;
  CodeBlockFenceChar: number;

  CodeBlockFenceLen: number;
  CodeBlockFenceOffset: number;
  CodeBlockOpenFence: Uint8Array;
  CodeBlockInfo: Uint8Array;
  CodeBlockCloseFence: Uint8Array | null;

  // HTML block

  HtmlBlockType: number; // HTML block type defined by the spec (1-7)

  // Lists and list items

  ListData: ListData | null;

  // Task list item [ ], [x] or [X]

  TaskListItemChecked: boolean; // Whether checked
  TaskListItemMarker: number; // Raw character inside the brackets: ' ', 'x', '-', '/', '>', '!', and so on

  // Table

  TableAligns: number[]; // Alignment of each table cell, left to right: 0 default, 1 left, 2 center, 3 right
  TableCellAlign: number; // Table cell alignment
  TableCellContentWidth: number; // Table cell content width (bytes)
  TableCellContentMaxWidth: number; // Maximum table cell content width
  TableCellRich: TableCellRich | null; // Rich text source of the cell; child nodes hold the inline projection

  // Link

  LinkType: number; // Link type: 0 inline link [foo](/bar), 1 link reference definition [foo]: /bar, 2 autolink, 3 link reference [foo]
  LinkRefLabel: Uint8Array; // Link reference label: [label] or [text][label]; for [label] the text and the label are the same

  // Heading

  HeadingLevel: number; // 1 to 6
  HeadingSetext: boolean; // Whether the heading is Setext
  HeadingNormalizedID: string; // Normalized ID

  // Math block

  MathBlockDollarOffset: number;

  // Footnotes

  FootnotesRefLabel: Uint8Array; // Footnote reference label [^label]
  FootnotesRefId: string; // Footnote ID
  FootnotesRefs: Node[]; // Footnote references

  // HTML entity

  HtmlEntityTokens: Uint8Array; // Tokens of the entity as written in the input, for example &amp;

  // Attributes

  KramdownIAL: string[][] | null; // Kramdown inline attribute list
  // PORT-NOTE: perf, departs from 1:1 (ast/node.go:123): the Properties map is created on first access (see the Properties accessor below); the field holds null until then.
  propertiesMap: Map<string, string> | null; // Attributes, created on first access

  // Text mark

  TextMarkType: string; // Text mark type
  TextMarkAHref: string; // Text mark link data-href attribute
  TextMarkATitle: string; // Text mark link data-title attribute
  TextMarkInlineMathContent: string; // Text mark inline math content (data-content attribute)
  TextMarkInlineMemoContent: string; // Text mark inline memo content (data-inline-memo-content attribute)
  TextMarkBlockRefID: string; // Text mark block reference ID (data-id attribute)
  TextMarkBlockRefSubtype: string; // Text mark block reference subtype, static or dynamic anchor text (data-subtype attribute)
  TextMarkFileAnnotationRefID: string; // Text mark file annotation reference ID (data-id attribute)
  TextMarkFlashcardOcclusionID: string; // Text mark flashcard occlusion ID (data-occlusion-id attribute)
  TextMarkTextContent: string; // Text mark text content

  // Attribute view https://github.com/siyuan-note/siyuan/issues/7535

  AttributeViewID: string; // Attribute view ID (data-av-id attribute)
  AttributeViewType: string; // Attribute view type (data-av-type attribute)

  // Custom block https://github.com/siyuan-note/siyuan/issues/8418

  CustomBlockFenceOffset: number; // Start offset of the custom block fence
  CustomBlockInfo: string; // Custom block info

  // Callout block https://github.com/88250/lute/issues/203 > [!Type] Title
  CalloutType: string; // Callout type
  CalloutTitle: string; // Callout title
  CalloutTitleExplicit: boolean; // Whether the callout title is set explicitly
  TabItemTitle: string; // Tab item title, kept as inline Markdown
  CalloutIcon: string; // Callout icon
  CalloutIconType: number; // Callout icon type: 0 Emoji Unicode, 1 custom icon

  constructor(type: NodeType = 0, tokens: Uint8Array | null = null) {
    this.ID = "";
    this.Box = "";
    this.Path = "";
    this.Spec = "";
    this.Type = type;
    this.Parent = null;
    this.Previous = null;
    this.Next = null;
    this.FirstChild = null;
    this.LastChild = null;
    this.Children = [];
    this.Tokens = tokens;
    this.TypeStr = "";
    this.Data = "";
    this.Close = false;
    this.LastLineBlank = false;
    this.LastLineChecked = false;
    this.CodeMarkerLen = 0;
    this.IsFencedCodeBlock = false;
    this.CodeBlockFenceChar = 0;
    this.CodeBlockFenceLen = 0;
    this.CodeBlockFenceOffset = 0;
    // PORT-NOTE: perf, departs from 1:1 (ast/node.go:Node constructor): the five byte fields below share emptyBytes instead of a new empty array each; no field is written through (see emptyBytes).
    this.CodeBlockOpenFence = emptyBytes;
    this.CodeBlockInfo = emptyBytes;
    this.CodeBlockCloseFence = null;
    this.HtmlBlockType = 0;
    this.ListData = null;
    this.TaskListItemChecked = false;
    this.TaskListItemMarker = 0;
    this.TableAligns = [];
    this.TableCellAlign = 0;
    this.TableCellContentWidth = 0;
    this.TableCellContentMaxWidth = 0;
    this.TableCellRich = null;
    this.LinkType = 0;
    // PORT-NOTE: perf, departs from 1:1 (ast/node.go:Node constructor): shared emptyBytes, see CodeBlockOpenFence.
    this.LinkRefLabel = emptyBytes;
    this.HeadingLevel = 0;
    this.HeadingSetext = false;
    this.HeadingNormalizedID = "";
    this.MathBlockDollarOffset = 0;
    // PORT-NOTE: perf, departs from 1:1 (ast/node.go:Node constructor): shared emptyBytes, see CodeBlockOpenFence.
    this.FootnotesRefLabel = emptyBytes;
    this.FootnotesRefId = "";
    this.FootnotesRefs = [];
    // PORT-NOTE: perf, departs from 1:1 (ast/node.go:Node constructor): shared emptyBytes, see CodeBlockOpenFence.
    this.HtmlEntityTokens = emptyBytes;
    this.KramdownIAL = null;
    this.propertiesMap = null;
    this.TextMarkType = "";
    this.TextMarkAHref = "";
    this.TextMarkATitle = "";
    this.TextMarkInlineMathContent = "";
    this.TextMarkInlineMemoContent = "";
    this.TextMarkBlockRefID = "";
    this.TextMarkBlockRefSubtype = "";
    this.TextMarkFileAnnotationRefID = "";
    this.TextMarkFlashcardOcclusionID = "";
    this.TextMarkTextContent = "";
    this.AttributeViewID = "";
    this.AttributeViewType = "";
    this.CustomBlockFenceOffset = 0;
    this.CustomBlockInfo = "";
    this.CalloutType = "";
    this.CalloutTitle = "";
    this.CalloutTitleExplicit = false;
    this.TabItemTitle = "";
    this.CalloutIcon = "";
    this.CalloutIconType = 0;
  }

  // PORT-NOTE: perf, departs from 1:1 (ast/node.go:123): Properties is an accessor over propertiesMap, and the map is created by the first read or write, so a node that never touches its attributes allocates none. Readers see an empty map, as in Go.
  // Properties is Go's Properties map.
  // A reader gets the same empty map Go gives a new node; a write through the setter replaces the map as an assignment does in Go.
  get Properties(): Map<string, string> {
    let m = this.propertiesMap;
    if (null === m) {
      m = new Map<string, string>();
      this.propertiesMap = m;
    }
    return m;
  }

  set Properties(m: Map<string, string>) {
    this.propertiesMap = m;
  }

  // EffectiveTaskListItemMarker returns the effective task list item marker character, escaped for use in an HTML attribute value.
  // New data is stored in TaskListItemMarker; old data falls back to the TaskListItemChecked boolean.
  // A lower-case x is normalized to upper-case X.
  EffectiveTaskListItemMarker(): string {
    if (this.TaskListItemMarker !== 0) {
      if (this.TaskListItemMarker === 0x78 /* x */) {
        return "X";
      }
      return html.EscapeHTMLStr(conv.StringFromRune(this.TaskListItemMarker));
    }
    if (this.TaskListItemChecked) {
      return "X";
    }
    return " ";
  }

  // ReviveFromMarker sets TaskListItemMarker and TaskListItemChecked from the raw marker character.
  // Any non-blank character inside the brackets counts as done; this is the only place task list item state is assigned.
  ReviveFromMarker(marker: number): void {
    this.TaskListItemMarker = marker;
    this.TaskListItemChecked = marker !== 0x20 /* space */ && marker !== 0;
  }

  // ReviveFromDataTask derives the marker character from the data-task attribute value and the checked state, then calls ReviveFromMarker.
  // Used on the HTML to AST path.
  ReviveFromDataTask(dataTask: string, checked: boolean): void {
    let marker = 0;
    if (1 === utf8.ByteLen(dataTask)) {
      marker = dataTask.charCodeAt(0);
    } else if (checked) {
      marker = 0x58 /* X */;
    } else {
      marker = 0x20 /* space */;
    }
    this.ReviveFromMarker(marker);
  }

  // Marker returns the marker text of a marker node: "#" "*" "_" and so on when entering, "" otherwise.
  Marker(entering: boolean): string {
    switch (this.Type) {
      case NodeTagOpenMarker:
      case NodeTagCloseMarker:
        if (entering) {
          return "#";
        }
        break;
      case NodeEmA6kOpenMarker:
      case NodeEmA6kCloseMarker:
        if (entering) {
          return "*";
        }
        break;
      case NodeEmU8eOpenMarker:
      case NodeEmU8eCloseMarker:
        if (entering) {
          return "_";
        }
        break;
      case NodeStrongA6kOpenMarker:
      case NodeStrongA6kCloseMarker:
        if (entering) {
          return "**";
        }
        break;
      case NodeStrongU8eOpenMarker:
      case NodeStrongU8eCloseMarker:
        if (entering) {
          return "__";
        }
        break;
      case NodeStrikethrough2OpenMarker:
      case NodeStrikethrough2CloseMarker:
        if (entering) {
          return "~~";
        }
        break;
      case NodeSupOpenMarker:
      case NodeSupCloseMarker:
        if (entering) {
          return "^";
        }
        break;
      case NodeSubOpenMarker:
      case NodeSubCloseMarker:
        if (entering) {
          return "~";
        }
        break;
      case NodeInlineMathOpenMarker:
      case NodeInlineMathCloseMarker:
        if (entering) {
          return "$";
        }
        break;
      case NodeKbdOpenMarker:
        if (entering) {
          return "<kbd>";
        }
        break;
      case NodeKbdCloseMarker:
        if (entering) {
          return "</kbd>";
        }
        break;
      case NodeUnderlineOpenMarker:
        if (entering) {
          return "<u>";
        }
        break;
      case NodeUnderlineCloseMarker:
        if (entering) {
          return "</u>";
        }
        break;
      case NodeMark2OpenMarker:
      case NodeMark2CloseMarker:
        if (entering) {
          return "==";
        }
        break;
      case NodeBang:
        if (entering) {
          return "!";
        }
        break;
      case NodeOpenBracket:
        if (entering) {
          return "[";
        }
        break;
      case NodeCloseBracket:
        if (entering) {
          return "]";
        }
        break;
      case NodeOpenParen:
        if (entering) {
          return "(";
        }
        break;
      case NodeCloseParen:
        if (entering) {
          return ")";
        }
        break;
    }
    return "";
  }

  ContainTextMarkTypes(...types: string[]): boolean {
    const nodeTypes = strings.Split(this.TextMarkType, " ");
    for (const typ of types) {
      for (const nodeType of nodeTypes) {
        if (typ === nodeType) {
          return true;
        }
      }
    }
    return false;
  }

  IsTextMarkType(typ: string): boolean {
    const types = strings.Split(this.TextMarkType, " ");
    for (const t of types) {
      if (typ === t) {
        return true;
      }
    }
    return false;
  }

  IsNextSameInlineMemo(): boolean {
    // PORT-NOTE: Go's `if nil == n` receiver check is not written here: `this` is never null in a class method.
    let nextInlineMemo: Node | null = null;
    for (let node = this.Next; node !== null; node = node.Next) {
      // UPSTREAM-BUG: `nil == n.Next` tests the receiver, not node; inside the loop it is always false (the loop starts from a non-nil n.Next), so that clause is dead. The next clause already checks node.Next.
      if (null === this.Next || NodeKramdownSpanIAL === node.Type || null === node.Next || NodeKramdownSpanIAL === node.Next.Type) {
        continue;
      }

      if (NodeTextMark === node.Type && node.IsTextMarkType("inline-memo")) {
        nextInlineMemo = node;
        break;
      }
    }

    if (null !== nextInlineMemo && this.TextMarkInlineMemoContent === nextInlineMemo.TextMarkInlineMemoContent) {
      return true;
    }
    return false;
  }

  IsSameTextMarkType(node: Node): boolean {
    if ("" === this.TextMarkType || "" === node.TextMarkType) {
      return false;
    }
    if (this.TextMarkFlashcardOcclusionID !== node.TextMarkFlashcardOcclusionID) {
      return false;
    }

    const a = strings.Split(this.TextMarkType, " ");
    const b = strings.Split(node.TextMarkType, " ");
    if (a.length !== b.length) {
      return false;
    }
    sort.Strings(a);
    sort.Strings(b);
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }

      switch (a[i]) {
        case "block-ref":
          if (this.TextMarkBlockRefID !== node.TextMarkBlockRefID) {
            return false;
          }
          break;
        case "a":
          // UPSTREAM-BUG: compares node.TextMarkATitle with itself; the receiver's TextMarkATitle is never compared. Should be this.TextMarkATitle != node.TextMarkATitle.
          if (this.TextMarkAHref !== node.TextMarkAHref || node.TextMarkATitle !== node.TextMarkATitle) {
            return false;
          }
          break;
        case "inline-memo":
          if (this.TextMarkInlineMemoContent !== node.TextMarkInlineMemoContent) {
            return false;
          }
          break;
      }
    }
    return true;
  }

  SortTextMarkDataTypes(): void {
    if ("" === this.TextMarkTextContent) {
      return;
    }

    const dataTypes = strings.Split(this.TextMarkType, " ");
    sort.Strings(dataTypes);
    this.TextMarkType = strings.Join(dataTypes, " ");
  }

  RemoveIALAttr(name: string): void {
    // PORT-NOTE: Go's `tmp := n.KramdownIAL[:0]` filters in place. A nil KramdownIAL stays nil, so there is nothing to do.
    const ial = this.KramdownIAL;
    if (null === ial) {
      return;
    }
    let w = 0;
    for (let i = 0; i < ial.length; i++) {
      const kv = ial[i];
      if (name !== kv[0]) {
        ial[w] = kv;
        w++;
      }
    }
    ial.length = w;
  }

  RemoveIALAttrsByPrefix(prefix: string): void {
    // PORT-NOTE: same in-place filter as RemoveIALAttr; a nil KramdownIAL stays nil.
    const ial = this.KramdownIAL;
    if (null === ial) {
      return;
    }
    let w = 0;
    for (let i = 0; i < ial.length; i++) {
      const kv = ial[i];
      if (!strings.HasPrefix(kv[0], prefix)) {
        ial[w] = kv;
        w++;
      }
    }
    ial.length = w;
  }

  SetIALAttr(name: string, value: string): void {
    value = html.EscapeAttrVal(value);
    if (null !== this.KramdownIAL) {
      for (const kv of this.KramdownIAL) {
        if (name === kv[0]) {
          kv[1] = value;
          return;
        }
      }
    }
    let ial = this.KramdownIAL;
    if (null === ial) {
      ial = [];
      this.KramdownIAL = ial;
    }
    ial.push([name, value]);
  }

  IALAttr(name: string): string {
    if (null !== this.KramdownIAL) {
      for (const kv of this.KramdownIAL) {
        if (name === kv[0]) {
          return html.UnescapeAttrVal(kv[1]);
        }
      }
    }
    return "";
  }

  IsEmptyBlockIAL(): boolean {
    if (NodeKramdownBlockIAL !== this.Type) {
      return false;
    }

    if (util.IsDocIAL(this.Tokens ?? emptyBytes)) {
      return false;
    }

    if (null !== this.Previous) {
      if (NodeKramdownBlockIAL === this.Previous.Type) {
        return true;
      }
      return false;
    }

    // An empty block IAL can only sit directly under a container block (document, list, list item, block quote, ...).
    // If the IAL sits inside a leaf block (paragraph, heading, ...), it is that block's attribute marker, not an empty block placeholder.
    // https://github.com/siyuan-note/siyuan/issues/18169
    if (null !== this.Parent && !this.Parent.IsContainerBlock()) {
      return false;
    }
    return true;
  }

  // TokensStr returns the Tokens of this node as a string.
  TokensStr(): string {
    return util.BytesToStr(this.Tokens ?? emptyBytes);
  }

  // LastDeepestChild returns the deepest last child of this node.
  LastDeepestChild(): Node {
    if (null === this.LastChild) {
      return this;
    }
    return this.LastChild.LastDeepestChild();
  }

  // FirstDeepestChild returns the deepest first child of this node.
  FirstDeepestChild(): Node {
    if (null === this.FirstChild) {
      return this;
    }
    return this.FirstChild.FirstDeepestChild();
  }

  // ChildByType returns the first child of this node whose type is childType.
  ChildByType(childType: NodeType): Node | null {
    for (let c = this.FirstChild; null !== c; c = c.Next) {
      if (c.Type === childType) {
        return c;
      }
    }
    return null;
  }

  // ChildrenByType returns all nodes under this node whose type is childType.
  ChildrenByType(childType: NodeType): Node[] {
    const ret: Node[] = [];
    Walk(this, (n: Node, entering: boolean): WalkStatus => {
      if (childType === n.Type && entering) {
        ret.push(n);
      }
      return WalkContinue;
    });
    return ret;
  }

  // Text returns the text value of this node and its text children.
  Text(): string {
    const buf = new bytes.Buffer();
    Walk(this, (n: Node, entering: boolean): WalkStatus => {
      if (!entering) {
        return WalkContinue;
      }
      switch (n.Type) {
        case NodeText:
        case NodeLinkText:
        case NodeBlockRefText:
        case NodeBlockRefDynamicText:
        case NodeFileAnnotationRefText:
        case NodeFootnotesRef:
          buf.Write(n.Tokens ?? emptyBytes);
          break;
        case NodeTextMark:
          buf.WriteString(n.TextMarkTextContent);
          break;
      }
      return WalkContinue;
    });
    return buf.String();
  }

  // TextLen returns the accumulated length, in runes, of this node and its text children.
  TextLen(): number {
    let ret = 0;
    let buf: Uint8Array = new Uint8Array(0);
    Walk(this, (n: Node, entering: boolean): WalkStatus => {
      if (!entering) {
        return WalkContinue;
      }
      switch (n.Type) {
        case NodeText:
        case NodeLinkText:
        case NodeBlockRefText:
        case NodeBlockRefDynamicText:
        case NodeFileAnnotationRefText:
        case NodeFootnotesRef:
          buf = slices.Append(buf, n.Tokens ?? emptyBytes);
          break;
        case NodeTextMark:
          buf = slices.AppendString(buf, n.TextMarkTextContent);
          break;
      }
      return WalkContinue;
    });
    ret = utf8.RuneCount(buf);
    return ret;
  }

  // Content returns the text value of this node and all its content children. Block-level nodes are separated by newlines.
  Content(): string {
    const buf = new bytes.Buffer();
    Walk(this, (n: Node, entering: boolean): WalkStatus => {
      if (!entering) {
        if (null !== n.Next && null !== n.Next.Next && 1 < buf.Len() && n.IsBlock() && buf.Bytes()[buf.Len() - 1] !== 0x0a /* \n */) {
          // Separate multiple block-level nodes with a newline https://github.com/siyuan-note/siyuan/issues/8114
          buf.WriteByte(0x0a /* \n */);
        }
        return WalkContinue;
      }

      switch (n.Type) {
        case NodeText:
        case NodeLinkText:
        case NodeBlockRefText:
        case NodeBlockRefDynamicText:
        case NodeFileAnnotationRefText:
        case NodeFootnotesRef:
        case NodeCodeSpanContent:
        case NodeCodeBlockCode:
        case NodeInlineMathContent:
        case NodeMathBlockContent:
        case NodeHTMLEntity:
        case NodeEmojiAlias:
        case NodeEmojiUnicode:
        case NodeBackslashContent:
        case NodeYamlFrontMatterContent:
        case NodeGitConflictContent:
          buf.Write(n.Tokens ?? emptyBytes);
          break;
        case NodeTextMark:
          if ("" !== n.TextMarkTextContent) {
            // The text of every text mark is stored as HTML entities; decode it exactly once when extracting plain text.
            buf.WriteString(html.UnescapeString(n.TextMarkTextContent));
          } else if ("" !== n.TextMarkInlineMathContent) {
            let content = n.TextMarkInlineMathContent;
            content = strings.ReplaceAll(content, editor.IALValEscNewLine, " ");
            buf.WriteString(content);
          }
          if ("" !== n.TextMarkInlineMemoContent) {
            let content = n.TextMarkInlineMemoContent;
            content = strings.ReplaceAll(content, editor.IALValEscNewLine, " ");
            buf.WriteString(content);
          }
          break;
      }
      return WalkContinue;
    });

    return buf.String();
  }

  // EscapeMarkerContent returns the text value of this node and all its content children, with Protyle markers escaped. Block-level nodes are separated by newlines.
  EscapeMarkerContent(): string {
    let ret = this.Content();
    ret = conv.StringFromBytes(lex.EscapeProtyleMarkers(conv.BytesFromString(ret)));
    return ret;
  }

  Stat(): [number, number, number, number, number] {
    let runeCnt = 0;
    let wordCnt = 0;
    let linkCnt = 0;
    let imgCnt = 0;
    let refCnt = 0;
    let buf: Uint8Array = new Uint8Array(0);
    Walk(this, (n: Node, entering: boolean): WalkStatus => {
      if (!entering) {
        return WalkContinue;
      }

      switch (n.Type) {
        case NodeText:
        case NodeLinkText:
        case NodeBlockRefText:
        case NodeBlockRefDynamicText:
        case NodeFileAnnotationRefText:
        case NodeFootnotesRef:
        case NodeCodeSpanContent:
        case NodeCodeBlockCode:
        case NodeInlineMathContent:
        case NodeMathBlockContent:
        case NodeHTMLEntity:
        case NodeEmojiAlias:
        case NodeEmojiUnicode:
        case NodeBackslashContent:
        case NodeYamlFrontMatterContent:
        case NodeGitConflictContent:
          buf = slices.Append(buf, n.Tokens ?? emptyBytes);
          break;
        case NodeTextMark:
          // PORT-NOTE: the Go length tests (0 < len) only check for emptiness, so JS string length gives the same answer.
          if (0 < n.TextMarkTextContent.length) {
            buf = slices.AppendString(buf, n.TextMarkTextContent);
          } else if (0 < n.TextMarkInlineMathContent.length) {
            let content = n.TextMarkInlineMathContent;
            content = strings.ReplaceAll(content, editor.IALValEscNewLine, " ");
            buf = slices.AppendString(buf, content);
          } else if ("" !== n.TextMarkInlineMemoContent) {
            let content = n.TextMarkInlineMemoContent;
            content = strings.ReplaceAll(content, editor.IALValEscNewLine, " ");
            buf = slices.AppendString(buf, content);
          }

          if (n.IsTextMarkType("a")) {
            linkCnt++;
          }
          if (n.IsTextMarkType("block-ref") || n.IsTextMarkType("file-annotation-ref")) {
            refCnt++;
          }
          break;
        case NodeLink:
          linkCnt++;
          break;
        case NodeImage:
          imgCnt++;
          break;
        case NodeBlockRef:
          refCnt++;
          break;
      }
      if (n.IsBlock()) {
        buf = slices.AppendByte(buf, 0x20 /* space */);
      }
      return WalkContinue;
    });

    buf = bytes.TrimSpace(buf);
    [runeCnt, wordCnt] = util.WordCount(util.BytesToStr(buf));
    return [runeCnt, wordCnt, linkCnt, imgCnt, refCnt];
  }

  // TokenLen returns the accumulated Tokens length of this node and its children.
  TokenLen(): number {
    let ret = 0;
    Walk(this, (n: Node, entering: boolean): WalkStatus => {
      if (!entering) {
        return WalkContinue;
      }
      ret += lex.BytesShowLength(n.Tokens ?? emptyBytes);
      return WalkContinue;
    });
    return ret;
  }

  // DocChild returns the ancestor of this node (or the node itself) that is a direct child of the document.
  DocChild(): Node | null {
    let ret: Node | null = this;
    for (let p: Node | null = this; null !== p; p = p.Parent) {
      if (NodeDocument === p.Type) {
        return ret;
      }
      ret = p;
    }
    return ret;
  }

  // IsChildBlockOf reports whether the parent of this block node is parent. depth selects the level; 0 means any level.
  // If this node is not a block node, it returns false.
  IsChildBlockOf(parent: Node | null, depth: number): boolean {
    if ("" === this.ID || !this.IsBlock()) {
      return false;
    }

    if (depth === 0) {
      // At any level: this node is a child of parent if parent is one of its ancestors.
      for (let p = this.Parent; null !== p; p = p.Parent) {
        if (p === parent) {
          return true;
        }
      }
      return false;
    }

    // Match the parent only at the given level.
    let nodeParent: Node | null = this.Parent;
    for (let i = 1; i < depth; i++) {
      if (null === nodeParent) {
        break;
      }
      nodeParent = nodeParent.Parent;
    }
    if (parent !== nodeParent) {
      return false;
    }
    return true;
  }

  NextNodeText(): string {
    if (null === this.Next) {
      return "";
    }
    return this.Next.Text();
  }

  PreviousNodeText(): string {
    let prev = this.Previous;
    if (null === prev) {
      return "";
    }
    if (NodeKramdownSpanIAL === prev.Type) {
      prev = prev.Previous;
    }
    if (null === prev) {
      return "";
    }
    return prev.Text();
  }

  // Unlink removes this node from the tree. The next sibling takes its place.
  Unlink(): void {
    if (null !== this.Previous) {
      this.Previous.Next = this.Next;
    } else if (null !== this.Parent) {
      this.Parent.FirstChild = this.Next;
    }
    if (null !== this.Next) {
      this.Next.Previous = this.Previous;
    } else if (null !== this.Parent) {
      this.Parent.LastChild = this.Previous;
    }
    this.Parent = null;
    this.Next = null;
    this.Previous = null;
  }

  // AppendTokens appends tokens to the end of Tokens.
  AppendTokens(tokens: Uint8Array): void {
    // PORT-NOTE: Go's append(nil, nothing...) stays nil, so a nil Tokens with no tokens to add is left as nil.
    if (null === this.Tokens && 0 === tokens.length) {
      return;
    }
    this.Tokens = slices.Append(this.Tokens ?? emptyBytes, tokens);
  }

  // PrependTokens prepends tokens to the start of Tokens.
  PrependTokens(tokens: Uint8Array): void {
    // PORT-NOTE: as in Go, append(tokens, ...) may write into the caller's buffer when it has spare capacity. A nil tokens argument cannot be passed in TypeScript.
    this.Tokens = slices.Append(tokens, this.Tokens ?? emptyBytes);
  }

  // InsertAfter inserts sibling as the next sibling of this node.
  InsertAfter(sibling: Node): void {
    sibling.Unlink();
    sibling.Next = this.Next;
    if (null !== sibling.Next) {
      sibling.Next.Previous = sibling;
    }
    sibling.Previous = this;
    this.Next = sibling;
    sibling.Parent = this.Parent;
    if (null !== sibling.Parent && null === sibling.Next && null !== sibling.Parent.LastChild) {
      sibling.Parent.LastChild = sibling;
    }
  }

  // InsertBefore inserts sibling as the previous sibling of this node.
  InsertBefore(sibling: Node): void {
    sibling.Unlink();
    sibling.Previous = this.Previous;
    if (null !== sibling.Previous) {
      sibling.Previous.Next = sibling;
    }
    sibling.Next = this;
    this.Previous = sibling;
    sibling.Parent = this.Parent;
    if (null !== sibling.Parent && null === sibling.Previous) {
      sibling.Parent.FirstChild = sibling;
    }
  }

  // AppendChild adds child as the last child of this node.
  AppendChild(child: Node): void {
    child.Unlink();
    child.Parent = this;
    if (null !== this.LastChild) {
      this.LastChild.Next = child;
      child.Previous = this.LastChild;
      this.LastChild = child;
    } else {
      this.FirstChild = child;
      this.LastChild = child;
    }
  }

  // PrependChild adds child as the first child of this node.
  PrependChild(child: Node): void {
    child.Unlink();
    child.Parent = this;
    if (null !== this.FirstChild) {
      this.FirstChild.Previous = child;
      child.Next = this.FirstChild;
      this.FirstChild = child;
    } else {
      this.FirstChild = child;
      this.LastChild = child;
    }
  }

  // List adds this node and all its children to the result list in depth-first order.
  List(): Node[] {
    const ret: Node[] = [];
    Walk(this, (n: Node, entering: boolean): WalkStatus => {
      if (entering) {
        ret.push(n);
      }
      return WalkContinue;
    });
    return ret;
  }

  // BlockIDs returns the IDs of the block-level nodes among this node and all its children.
  BlockIDs(): string[] {
    const ret: string[] = [];
    Walk(this, (n: Node, entering: boolean): WalkStatus => {
      if (entering && n.IsBlock() && "" !== n.ID) {
        ret.push(n.ID);
      }
      return WalkContinue;
    });
    return ret;
  }

  // ParentIs reports whether one of this node's ancestors has a type in nodeType or nodeTypes.
  ParentIs(nodeType: NodeType, ...nodeTypes: NodeType[]): boolean {
    const types = nodeTypes.concat([nodeType]);
    let deep = 0;
    for (let p = this.Parent; null !== p; p = p.Parent) {
      for (const pt of types) {
        if (pt === p.Type) {
          return true;
        }
      }
      deep++;
      if (128 < deep) {
        break;
      }
    }
    return false;
  }

  // IsBlock reports whether this node is a block-level node.
  IsBlock(): boolean {
    switch (this.Type) {
      case NodeDocument:
      case NodeParagraph:
      case NodeHeading:
      case NodeThematicBreak:
      case NodeBlockquote:
      case NodeList:
      case NodeListItem:
      case NodeHTMLBlock:
      case NodeCodeBlock:
      case NodeTable:
      case NodeMathBlock:
      case NodeFootnotesDefBlock:
      case NodeFootnotesDef:
      case NodeToC:
      case NodeYamlFrontMatter:
      case NodeBlockQueryEmbed:
      case NodeKramdownBlockIAL:
      case NodeSuperBlock:
      case NodeGitConflict:
      case NodeAudio:
      case NodeVideo:
      case NodeIFrame:
      case NodeWidget:
      case NodeAttributeView:
      case NodeCustomBlock:
      case NodeCallout:
      case NodeTabs:
      case NodeTabItem:
      case NodeMindmap:
      case NodeMindmapItem:
        return true;
    }
    return false;
  }

  // IsContainerBlock reports whether this node is a container block.
  IsContainerBlock(): boolean {
    switch (this.Type) {
      case NodeDocument:
      case NodeBlockquote:
      case NodeList:
      case NodeListItem:
      case NodeFootnotesDefBlock:
      case NodeFootnotesDef:
      case NodeSuperBlock:
      case NodeCallout:
      case NodeTabs:
      case NodeTabItem:
      case NodeMindmap:
      case NodeMindmapItem:
        return true;
    }
    return false;
  }

  // IsMarker reports whether this node is a marker node.
  IsMarker(): boolean {
    switch (this.Type) {
      case NodeHeadingC8hMarker:
      case NodeBlockquoteMarker:
      case NodeCodeBlockFenceOpenMarker:
      case NodeCodeBlockFenceCloseMarker:
      case NodeCodeBlockFenceInfoMarker:
      case NodeEmA6kOpenMarker:
      case NodeEmA6kCloseMarker:
      case NodeEmU8eOpenMarker:
      case NodeEmU8eCloseMarker:
      case NodeStrongA6kOpenMarker:
      case NodeStrongA6kCloseMarker:
      case NodeStrongU8eOpenMarker:
      case NodeStrongU8eCloseMarker:
      case NodeCodeSpanOpenMarker:
      case NodeCodeSpanCloseMarker:
      case NodeTaskListItemMarker:
      case NodeStrikethrough1OpenMarker:
      case NodeStrikethrough1CloseMarker:
      case NodeStrikethrough2OpenMarker:
      case NodeStrikethrough2CloseMarker:
      case NodeMathBlockOpenMarker:
      case NodeMathBlockCloseMarker:
      case NodeInlineMathOpenMarker:
      case NodeInlineMathCloseMarker:
      case NodeYamlFrontMatterOpenMarker:
      case NodeYamlFrontMatterCloseMarker:
      case NodeMark1OpenMarker:
      case NodeMark1CloseMarker:
      case NodeMark2OpenMarker:
      case NodeMark2CloseMarker:
      case NodeTagOpenMarker:
      case NodeTagCloseMarker:
      case NodeSuperBlockOpenMarker:
      case NodeSuperBlockLayoutMarker:
      case NodeSuperBlockCloseMarker:
      case NodeSupOpenMarker:
      case NodeSupCloseMarker:
      case NodeSubOpenMarker:
      case NodeSubCloseMarker:
        return true;
    }
    return false;
  }

  // IsCloseMarker reports whether this node is a closing marker.
  IsCloseMarker(): boolean {
    switch (this.Type) {
      case NodeHeadingC8hMarker:
      case NodeBlockquoteMarker:
      case NodeCodeBlockFenceCloseMarker:
      case NodeEmA6kCloseMarker:
      case NodeEmU8eCloseMarker:
      case NodeStrongA6kCloseMarker:
      case NodeStrongU8eCloseMarker:
      case NodeCodeSpanCloseMarker:
      case NodeStrikethrough1CloseMarker:
      case NodeStrikethrough2CloseMarker:
      case NodeMathBlockCloseMarker:
      case NodeInlineMathCloseMarker:
      case NodeYamlFrontMatterCloseMarker:
      case NodeMark1CloseMarker:
      case NodeMark2CloseMarker:
      case NodeTagCloseMarker:
      case NodeSuperBlockCloseMarker:
      case NodeSupCloseMarker:
      case NodeSubCloseMarker:
        return true;
    }
    return false;
  }

  // AcceptLines reports whether this node can accept more text lines. HTML blocks, code blocks and paragraphs can.
  AcceptLines(): boolean {
    switch (this.Type) {
      case NodeParagraph:
      case NodeCodeBlock:
      case NodeHTMLBlock:
      case NodeMathBlock:
      case NodeYamlFrontMatter:
      case NodeBlockQueryEmbed:
      case NodeGitConflict:
      case NodeIFrame:
      case NodeWidget:
      case NodeVideo:
      case NodeAudio:
      case NodeAttributeView:
      case NodeCustomBlock:
        return true;
    }
    return false;
  }

  // CanContain reports whether this node can contain a node of type nodeType. For example a list (a block container) can only contain
  // list items; a block quote (a block container) can contain any node; a paragraph (a leaf block) cannot contain any other block.
  CanContain(nodeType: NodeType): boolean {
    if (NodeTabItem === nodeType) {
      return NodeTabs === this.Type;
    }
    if (NodeMindmapItem === nodeType) {
      return NodeMindmap === this.Type;
    }
    switch (this.Type) {
      case NodeTabs:
        return NodeKramdownBlockIAL === nodeType;
      case NodeTabItem:
        return NodeDocument !== nodeType && NodeListItem !== nodeType && NodeFootnotesDef !== nodeType;
      case NodeMindmap:
        return NodeMindmapItem === nodeType;
      case NodeMindmapItem:
        return NodeDocument !== nodeType && NodeList !== nodeType && NodeListItem !== nodeType && NodeFootnotesDef !== nodeType;
      case NodeCodeBlock:
      case NodeHTMLBlock:
      case NodeParagraph:
      case NodeThematicBreak:
      case NodeTable:
      case NodeMathBlock:
      case NodeYamlFrontMatter:
      case NodeGitConflict:
      case NodeIFrame:
      case NodeWidget:
      case NodeVideo:
      case NodeAudio:
      case NodeAttributeView:
      case NodeCustomBlock:
        return false;
      case NodeList:
        return NodeListItem === nodeType;
      case NodeFootnotesDefBlock:
        return NodeFootnotesDef === nodeType;
      case NodeFootnotesDef:
        return NodeFootnotesDef !== nodeType;
      case NodeSuperBlock:
        if (null !== this.LastChild && NodeSuperBlockCloseMarker === this.LastChild.Type) {
          // The super block is already closed.
          return false;
        }
        return true;
    }
    return NodeListItem !== nodeType;
  }

  // TabTitleBlock returns the paragraph saved as the tab title. The paragraph keeps its own block identity.
  TabTitleBlock(): Node | null {
    return TabTitleBlockOf(this);
  }

  // IsTabTitleBlock reports whether this node is the title block of its parent tab item.
  IsTabTitleBlock(): boolean {
    return IsTabTitleBlockOf(this);
  }
}

// EffectiveTaskListItemMarker, ReviveFromMarker and ReviveFromDataTask are Node methods above.

// Callout constants.
export const CalloutTypeNote = "NOTE";
export const CalloutTypeTip = "TIP";
export const CalloutTypeImportant = "IMPORTANT";
export const CalloutTypeWarning = "WARNING";
export const CalloutTypeCaution = "CAUTION";
export const CalloutIconImageAlt = "callout-icon";

// IsValidCalloutImageSrc reports whether the image address of an image-type callout icon is supported.
export function IsValidCalloutImageSrc(src: string): boolean {
  if (strings.HasPrefix(src, "/emojis/") || strings.HasPrefix(src, "api/icon/")) {
    return true;
  }
  const [u, err] = url.Parse(src);
  return null === err && "" !== u!.Host && ("http" === strings.ToLower(u!.Scheme) || "https" === strings.ToLower(u!.Scheme));
}

export function IsBuiltInCalloutType(typ: string): boolean {
  switch (typ) {
    case CalloutTypeNote:
    case CalloutTypeTip:
    case CalloutTypeImportant:
    case CalloutTypeWarning:
    case CalloutTypeCaution:
      return true;
  }
  return false;
}

export function GetCalloutIcon(typ: string): string {
  switch (typ) {
    case CalloutTypeNote:
      return "✏️";
    case CalloutTypeTip:
      return "💡";
    case CalloutTypeImportant:
      return "❗";
    case CalloutTypeWarning:
      return "⚠️";
    case CalloutTypeCaution:
      return "🚨";
  }
  return "";
}

export function GetCalloutTitle(typ: string): string {
  switch (typ) {
    case CalloutTypeNote:
      return "Note";
    case CalloutTypeTip:
      return "Tip";
    case CalloutTypeImportant:
      return "Important";
    case CalloutTypeWarning:
      return "Warning";
    case CalloutTypeCaution:
      return "Caution";
  }
  return "";
}

export class ListData {
  Typ: number; // 0 unordered list, 1 ordered list, 3 task list
  Tight: boolean; // Whether the list is tight
  BulletChar: number; // Bullet character of an unordered list: * - or +
  Start: number; // Start number of an ordered list
  Delimiter: number; // Delimiter of an ordered list: . or )
  Padding: number; // Indentation inside the list in spaces (includes the marker width, W+N in the spec)
  MarkerOffset: number; // Offset in spaces of the marker (* - + or 1 2 3) relative to the indentation
  Checked: boolean; // Whether the task list item is checked
  Marker: Uint8Array; // List marker
  Num: number; // Corrected number of an ordered list item

  constructor() {
    this.Typ = 0;
    this.Tight = false;
    this.BulletChar = 0;
    this.Start = 0;
    this.Delimiter = 0;
    this.Padding = 0;
    this.MarkerOffset = 0;
    this.Checked = false;
    this.Marker = new Uint8Array(0);
    this.Num = 0;
  }
}

// JSON field table for Node: Go field name, JSON key (the Go name when the tag has no name),
// whether json:"-" skips it, whether omitempty is set, and the Go type. Declaration order.
// PORT-NOTE: this is data for the JSON renderer (a later task). Node is not marshalled here.
export type JSONField = {
  goName: string;
  jsonKey: string;
  skipped: boolean;
  omitempty: boolean;
  goType: string;
};

export const NodeJSONFields: JSONField[] = [
  { goName: "ID", jsonKey: "ID", skipped: false, omitempty: true, goType: "string" },
  { goName: "Box", jsonKey: "", skipped: true, omitempty: false, goType: "string" },
  { goName: "Path", jsonKey: "", skipped: true, omitempty: false, goType: "string" },
  { goName: "Spec", jsonKey: "Spec", skipped: false, omitempty: true, goType: "string" },
  { goName: "Type", jsonKey: "", skipped: true, omitempty: false, goType: "NodeType" },
  { goName: "Parent", jsonKey: "", skipped: true, omitempty: false, goType: "*Node" },
  { goName: "Previous", jsonKey: "", skipped: true, omitempty: false, goType: "*Node" },
  { goName: "Next", jsonKey: "", skipped: true, omitempty: false, goType: "*Node" },
  { goName: "FirstChild", jsonKey: "", skipped: true, omitempty: false, goType: "*Node" },
  { goName: "LastChild", jsonKey: "", skipped: true, omitempty: false, goType: "*Node" },
  { goName: "Children", jsonKey: "Children", skipped: false, omitempty: true, goType: "[]*Node" },
  { goName: "Tokens", jsonKey: "", skipped: true, omitempty: false, goType: "[]byte" },
  { goName: "TypeStr", jsonKey: "Type", skipped: false, omitempty: false, goType: "string" },
  { goName: "Data", jsonKey: "Data", skipped: false, omitempty: true, goType: "string" },
  { goName: "Close", jsonKey: "", skipped: true, omitempty: false, goType: "bool" },
  { goName: "LastLineBlank", jsonKey: "", skipped: true, omitempty: false, goType: "bool" },
  { goName: "LastLineChecked", jsonKey: "", skipped: true, omitempty: false, goType: "bool" },
  { goName: "CodeMarkerLen", jsonKey: "CodeMarkerLen", skipped: false, omitempty: true, goType: "int" },
  { goName: "IsFencedCodeBlock", jsonKey: "IsFencedCodeBlock", skipped: false, omitempty: true, goType: "bool" },
  { goName: "CodeBlockFenceChar", jsonKey: "CodeBlockFenceChar", skipped: false, omitempty: true, goType: "byte" },
  { goName: "CodeBlockFenceLen", jsonKey: "CodeBlockFenceLen", skipped: false, omitempty: true, goType: "int" },
  { goName: "CodeBlockFenceOffset", jsonKey: "CodeBlockFenceOffset", skipped: false, omitempty: true, goType: "int" },
  { goName: "CodeBlockOpenFence", jsonKey: "CodeBlockOpenFence", skipped: false, omitempty: true, goType: "[]byte" },
  { goName: "CodeBlockInfo", jsonKey: "CodeBlockInfo", skipped: false, omitempty: true, goType: "[]byte" },
  { goName: "CodeBlockCloseFence", jsonKey: "CodeBlockCloseFence", skipped: false, omitempty: true, goType: "[]byte" },
  { goName: "HtmlBlockType", jsonKey: "HtmlBlockType", skipped: false, omitempty: true, goType: "int" },
  { goName: "ListData", jsonKey: "ListData", skipped: false, omitempty: true, goType: "*ListData" },
  { goName: "TaskListItemChecked", jsonKey: "TaskListItemChecked", skipped: false, omitempty: true, goType: "bool" },
  { goName: "TaskListItemMarker", jsonKey: "TaskListItemMarker", skipped: false, omitempty: true, goType: "byte" },
  { goName: "TableAligns", jsonKey: "TableAligns", skipped: false, omitempty: true, goType: "[]int" },
  { goName: "TableCellAlign", jsonKey: "TableCellAlign", skipped: false, omitempty: true, goType: "int" },
  { goName: "TableCellContentWidth", jsonKey: "TableCellContentWidth", skipped: false, omitempty: true, goType: "int" },
  { goName: "TableCellContentMaxWidth", jsonKey: "TableCellContentMaxWidth", skipped: false, omitempty: true, goType: "int" },
  { goName: "TableCellRich", jsonKey: "TableCellRich", skipped: false, omitempty: true, goType: "*TableCellRich" },
  { goName: "LinkType", jsonKey: "LinkType", skipped: false, omitempty: true, goType: "int" },
  { goName: "LinkRefLabel", jsonKey: "LinkRefLabel", skipped: false, omitempty: true, goType: "[]byte" },
  { goName: "HeadingLevel", jsonKey: "HeadingLevel", skipped: false, omitempty: true, goType: "int" },
  { goName: "HeadingSetext", jsonKey: "HeadingSetext", skipped: false, omitempty: true, goType: "bool" },
  { goName: "HeadingNormalizedID", jsonKey: "HeadingNormalizedID", skipped: false, omitempty: true, goType: "string" },
  { goName: "MathBlockDollarOffset", jsonKey: "MathBlockDollarOffset", skipped: false, omitempty: true, goType: "int" },
  { goName: "FootnotesRefLabel", jsonKey: "FootnotesRefLabel", skipped: false, omitempty: true, goType: "[]byte" },
  { goName: "FootnotesRefId", jsonKey: "FootnotesRefId", skipped: false, omitempty: true, goType: "string" },
  { goName: "FootnotesRefs", jsonKey: "FootnotesRefs", skipped: false, omitempty: true, goType: "[]*Node" },
  { goName: "HtmlEntityTokens", jsonKey: "HtmlEntityTokens", skipped: false, omitempty: true, goType: "[]byte" },
  { goName: "KramdownIAL", jsonKey: "", skipped: true, omitempty: false, goType: "[][]string" },
  { goName: "Properties", jsonKey: "Properties", skipped: false, omitempty: true, goType: "map[string]string" },
  { goName: "TextMarkType", jsonKey: "TextMarkType", skipped: false, omitempty: true, goType: "string" },
  { goName: "TextMarkAHref", jsonKey: "TextMarkAHref", skipped: false, omitempty: true, goType: "string" },
  { goName: "TextMarkATitle", jsonKey: "TextMarkATitle", skipped: false, omitempty: true, goType: "string" },
  { goName: "TextMarkInlineMathContent", jsonKey: "TextMarkInlineMathContent", skipped: false, omitempty: true, goType: "string" },
  { goName: "TextMarkInlineMemoContent", jsonKey: "TextMarkInlineMemoContent", skipped: false, omitempty: true, goType: "string" },
  { goName: "TextMarkBlockRefID", jsonKey: "TextMarkBlockRefID", skipped: false, omitempty: true, goType: "string" },
  { goName: "TextMarkBlockRefSubtype", jsonKey: "TextMarkBlockRefSubtype", skipped: false, omitempty: true, goType: "string" },
  { goName: "TextMarkFileAnnotationRefID", jsonKey: "TextMarkFileAnnotationRefID", skipped: false, omitempty: true, goType: "string" },
  { goName: "TextMarkFlashcardOcclusionID", jsonKey: "TextMarkFlashcardOcclusionID", skipped: false, omitempty: true, goType: "string" },
  { goName: "TextMarkTextContent", jsonKey: "TextMarkTextContent", skipped: false, omitempty: true, goType: "string" },
  { goName: "AttributeViewID", jsonKey: "AttributeViewID", skipped: false, omitempty: true, goType: "string" },
  { goName: "AttributeViewType", jsonKey: "AttributeViewType", skipped: false, omitempty: true, goType: "string" },
  { goName: "CustomBlockFenceOffset", jsonKey: "CustomBlockFenceOffset", skipped: false, omitempty: true, goType: "int" },
  { goName: "CustomBlockInfo", jsonKey: "CustomBlockInfo", skipped: false, omitempty: true, goType: "string" },
  { goName: "CalloutType", jsonKey: "CalloutType", skipped: false, omitempty: true, goType: "string" },
  { goName: "CalloutTitle", jsonKey: "CalloutTitle", skipped: false, omitempty: true, goType: "string" },
  { goName: "CalloutTitleExplicit", jsonKey: "CalloutTitleExplicit", skipped: false, omitempty: true, goType: "bool" },
  { goName: "TabItemTitle", jsonKey: "TabItemTitle", skipped: false, omitempty: true, goType: "string" },
  { goName: "CalloutIcon", jsonKey: "CalloutIcon", skipped: false, omitempty: true, goType: "string" },
  { goName: "CalloutIconType", jsonKey: "CalloutIconType", skipped: false, omitempty: true, goType: "int" },
];

export const ListDataJSONFields: JSONField[] = [
  { goName: "Typ", jsonKey: "Typ", skipped: false, omitempty: true, goType: "int" },
  { goName: "Tight", jsonKey: "Tight", skipped: false, omitempty: true, goType: "bool" },
  { goName: "BulletChar", jsonKey: "BulletChar", skipped: false, omitempty: true, goType: "byte" },
  { goName: "Start", jsonKey: "Start", skipped: false, omitempty: true, goType: "int" },
  { goName: "Delimiter", jsonKey: "Delimiter", skipped: false, omitempty: true, goType: "byte" },
  { goName: "Padding", jsonKey: "Padding", skipped: false, omitempty: true, goType: "int" },
  { goName: "MarkerOffset", jsonKey: "MarkerOffset", skipped: false, omitempty: true, goType: "int" },
  { goName: "Checked", jsonKey: "Checked", skipped: false, omitempty: true, goType: "bool" },
  { goName: "Marker", jsonKey: "Marker", skipped: false, omitempty: true, goType: "[]byte" },
  { goName: "Num", jsonKey: "Num", skipped: false, omitempty: true, goType: "int" },
];

export const TableCellRichJSONFields: JSONField[] = [
  { goName: "Spec", jsonKey: "spec", skipped: false, omitempty: false, goType: "int" },
  { goName: "Format", jsonKey: "format", skipped: false, omitempty: false, goType: "string" },
  { goName: "Content", jsonKey: "content", skipped: false, omitempty: false, goType: "string" },
  { goName: "Raw", jsonKey: "", skipped: true, omitempty: false, goType: "string" },
  { goName: "Invalid", jsonKey: "", skipped: true, omitempty: false, goType: "bool" },
];

// testing reports whether this is a test environment. Go's package variable `Testing` is private here.
let testing = false;

// GetTesting returns the test-environment flag (Go: ast.Testing).
export function GetTesting(): boolean {
  return testing;
}

// SetTesting sets the test-environment flag.
// PORT-NOTE: callers write SetTesting(true) where Go writes ast.Testing = true (ES module exports cannot be assigned from outside).
export function SetTesting(v: boolean): void {
  testing = v;
}

// NewNodeID returns a new node ID: local time as yyyymmddhhmmss, then "-" and 7 random characters a-z0-9.
// With testing on it returns the fixed test ID.
export function NewNodeID(): string {
  if (testing) {
    return "20060102150405-1a2b3c4"; // test environment ID
  }
  const now = new Date();
  return formatNodeIDTime(now) + "-" + randStr(7);
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

function formatNodeIDTime(now: Date): string {
  const year = "" + now.getFullYear();
  return year.padStart(4, "0") + pad2(now.getMonth() + 1) + pad2(now.getDate()) + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
}

// IsNodeIDPattern reports whether str has the node ID form yyyymmddhhmmss-xxxxxxx.
export function IsNodeIDPattern(str: string): boolean {
  // PORT-NOTE: Go compares len(str) (bytes) with the 22-byte ASCII pattern. Here str.length is UTF-16 units. The results agree:
  // a non-ASCII str fails the digit and letter checks below whatever its length, so it is false either way.
  if (22 !== str.length) {
    return false;
  }

  if (1 !== strings.Count(str, "-")) {
    return false;
  }

  const parts = strings.Split(str, "-");
  const idPart = parts[0];
  if (14 !== idPart.length) {
    return false;
  }

  for (let i = 0; i < idPart.length; i++) {
    const c = idPart.charCodeAt(i);
    if (!(0x30 /* 0 */ <= c && 0x39 /* 9 */ >= c)) {
      return false;
    }
  }

  const randPart = parts[1];
  if (7 !== randPart.length) {
    return false;
  }

  for (let i = 0; i < randPart.length; i++) {
    const c = randPart.charCodeAt(i);
    if (!(0x61 /* a */ <= c && 0x7a /* z */ >= c) && !(0x30 /* 0 */ <= c && 0x39 /* 9 */ >= c)) {
      return false;
    }
  }
  return true;
}

// PORT-NOTE: Go's init() calls rand.Seed; Math.random needs no seeding.
const letters = "abcdefghijklmnopqrstuvwxyz0123456789";

function randStr(length: number): string {
  let b = "";
  for (let i = 0; i < length; i++) {
    b += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  return b;
}

// NodeType is the node type. Go's `type NodeType int`; the constants below are plain numbers.
export type NodeType = number;

// strNodeTypeMap maps String() of every value below NodeTypeMaxVal to its value.
// PORT-NOTE: Go builds it in init(); here it is built on first use. The sync.RWMutex is dropped: JS is single-threaded.
let strNodeTypeMap: Map<string, NodeType> | null = null;

function getStrNodeTypeMap(): Map<string, NodeType> {
  if (null === strNodeTypeMap) {
    const m = new Map<string, NodeType>();
    // Go's init() loops t from NodeDocument while t < NodeTypeMaxVal. Values without a constant also get an entry ("NodeType(n)").
    for (let t = 0; t < NodeTypeMaxVal; t++) {
      m.set(NodeTypeString(t), t);
    }
    strNodeTypeMap = m;
  }
  return strNodeTypeMap;
}

export function Str2NodeType(nodeTypeStr: string): NodeType {
  const ret = getStrNodeTypeMap().get(nodeTypeStr);
  if (undefined === ret) {
    return -1;
  }
  return ret;
}

// NodeType constants (declared in Go's order; NodeTypeMaxVal is last).
// CommonMark

export const NodeDocument = 0; // Document (root)
export const NodeParagraph = 1; // Paragraph
export const NodeHeading = 2; // Heading
export const NodeHeadingC8hMarker = 3; // ATX heading marker #
export const NodeThematicBreak = 4; // Thematic break
export const NodeBlockquote = 5; // Block quote
export const NodeBlockquoteMarker = 6; // Block quote marker >
export const NodeList = 7; // List
export const NodeListItem = 8; // List item
export const NodeHTMLBlock = 9; // HTML block
export const NodeInlineHTML = 10; // Inline HTML
export const NodeCodeBlock = 11; // Code block
export const NodeCodeBlockFenceOpenMarker = 12; // Opening code block fence marker
export const NodeCodeBlockFenceCloseMarker = 13; // Closing code block fence marker
export const NodeCodeBlockFenceInfoMarker = 14; // Code block fence info marker (info string)
export const NodeCodeBlockCode = 15; // Code block code
export const NodeText = 16; // Text
export const NodeEmphasis = 17; // Emphasis
export const NodeEmA6kOpenMarker = 18; // Opening emphasis marker *
export const NodeEmA6kCloseMarker = 19; // Closing emphasis marker *
export const NodeEmU8eOpenMarker = 20; // Opening emphasis marker _
export const NodeEmU8eCloseMarker = 21; // Closing emphasis marker _
export const NodeStrong = 22; // Strong
export const NodeStrongA6kOpenMarker = 23; // Opening strong marker **
export const NodeStrongA6kCloseMarker = 24; // Closing strong marker **
export const NodeStrongU8eOpenMarker = 25; // Opening strong marker __
export const NodeStrongU8eCloseMarker = 26; // Closing strong marker __
export const NodeCodeSpan = 27; // Code span
export const NodeCodeSpanOpenMarker = 28; // Opening code span marker
export const NodeCodeSpanContent = 29; // Code span content
export const NodeCodeSpanCloseMarker = 30; // Closing code span marker
export const NodeHardBreak = 31; // Hard line break
export const NodeSoftBreak = 32; // Soft line break
export const NodeLink = 33; // Link
export const NodeImage = 34; // Image
export const NodeBang = 35; // Bang !
export const NodeOpenBracket = 36; // Open bracket [
export const NodeCloseBracket = 37; // Close bracket ]
export const NodeOpenParen = 38; // Open parenthesis (
export const NodeCloseParen = 39; // Close parenthesis )
export const NodeLinkText = 40; // Link text
export const NodeLinkDest = 41; // Link destination
export const NodeLinkTitle = 42; // Link title
export const NodeLinkSpace = 43; // Space between link destination and link title
export const NodeHTMLEntity = 44; // HTML entity
export const NodeLinkRefDefBlock = 45; // Link reference definition block
export const NodeLinkRefDef = 46; // Link reference definition [label]:
export const NodeLess = 47; // Less than <
export const NodeGreater = 48; // Greater than >

// GFM

export const NodeTaskListItemMarker = 100; // Task list item marker
export const NodeStrikethrough = 101; // Strikethrough
export const NodeStrikethrough1OpenMarker = 102; // Opening strikethrough marker ~
export const NodeStrikethrough1CloseMarker = 103; // Closing strikethrough marker ~
export const NodeStrikethrough2OpenMarker = 104; // Opening strikethrough marker ~~
export const NodeStrikethrough2CloseMarker = 105; // Closing strikethrough marker ~~
export const NodeTable = 106; // Table
export const NodeTableHead = 107; // Table head
export const NodeTableRow = 108; // Table row
export const NodeTableCell = 109; // Table cell

// Emoji

export const NodeEmoji = 200; // Emoji
export const NodeEmojiUnicode = 201; // Emoji Unicode
export const NodeEmojiImg = 202; // Emoji image
export const NodeEmojiAlias = 203; // Emoji ASCII alias

// Math

export const NodeMathBlock = 300; // Math block
export const NodeMathBlockOpenMarker = 301; // Opening math block marker $$
export const NodeMathBlockContent = 302; // Math block content
export const NodeMathBlockCloseMarker = 303; // Closing math block marker $$
export const NodeInlineMath = 304; // Inline math
export const NodeInlineMathOpenMarker = 305; // Opening inline math marker $
export const NodeInlineMathContent = 306; // Inline math content
export const NodeInlineMathCloseMarker = 307; // Closing inline math marker $

// Escape

export const NodeBackslash = 400; // Escaped backslash marker
export const NodeBackslashContent = 401; // Content after escaped backslash

// Vditor support

export const NodeVditorCaret = 405; // Vditor caret; some cases use this node to adjust the caret position for insertion

// Footnotes

export const NodeFootnotesDefBlock = 410; // Footnote definition block
export const NodeFootnotesDef = 411; // Footnote definition [^label]:
export const NodeFootnotesRef = 412; // Footnote reference [^label]

// Table of contents

export const NodeToC = 415; // Table of contents [toc]

// Heading

export const NodeHeadingID = 420; // Heading ID # foo {id}

// YAML Front Matter

export const NodeYamlFrontMatter = 425; // YAML front matter (https://jekyllrb.com/docs/front-matter/)
export const NodeYamlFrontMatterOpenMarker = 426; // Opening YAML front matter marker ---
export const NodeYamlFrontMatterContent = 427; // YAML front matter content
export const NodeYamlFrontMatterCloseMarker = 428; // Closing YAML front matter marker ---

// Block reference (Block Reference) https://github.com/88250/lute/issues/82

export const NodeBlockRef = 430; // Block reference node
export const NodeBlockRefID = 431; // ID of the referenced block (definition block)
export const NodeBlockRefSpace = 432; // Space between the referenced block ID and the block reference anchor text
export const NodeBlockRefText = 433; // Block reference anchor text
export const NodeBlockRefDynamicText = 434; // Block reference dynamic anchor text

// ==Mark== mark syntax https://github.com/88250/lute/issues/84

export const NodeMark = 450; // Mark
export const NodeMark1OpenMarker = 451; // Opening mark marker =
export const NodeMark1CloseMarker = 452; // Closing mark marker =
export const NodeMark2OpenMarker = 453; // Opening mark marker ==
export const NodeMark2CloseMarker = 454; // Closing mark marker ==

// kramdown inline attribute list https://github.com/88250/lute/issues/89 and https://github.com/88250/lute/issues/118

export const NodeKramdownBlockIAL = 455; // Block-level kramdown IAL {: name="value"}
export const NodeKramdownSpanIAL = 456; // Inline-level kramdown IAL *foo*{: name="value"}bar

// #Tag# tag syntax https://github.com/88250/lute/issues/92

export const NodeTag = 460; // Tag
export const NodeTagOpenMarker = 461; // Opening tag marker #
export const NodeTagCloseMarker = 462; // Closing tag marker #

// Block query embed syntax https://github.com/88250/lute/issues/96

export const NodeBlockQueryEmbed = 465; // Block query embed
export const NodeOpenBrace = 466; // Open brace {
export const NodeCloseBrace = 467; // Close brace }
export const NodeBlockQueryEmbedScript = 468; // Block query embed script

// Super block syntax https://github.com/88250/lute/issues/111

export const NodeSuperBlock = 475; // Super block node
export const NodeSuperBlockOpenMarker = 476; // Opening super block marker {{{
export const NodeSuperBlockLayoutMarker = 477; // Super block layout row/col
export const NodeSuperBlockCloseMarker = 478; // Closing super block marker }}}

// Superscript and subscript syntax https://github.com/88250/lute/issues/113

export const NodeSup = 485; // Superscript
export const NodeSupOpenMarker = 486; // Opening superscript marker ^
export const NodeSupCloseMarker = 487; // Closing superscript marker ^
export const NodeSub = 490; // Subscript
export const NodeSubOpenMarker = 491; // Opening subscript marker ~
export const NodeSubCloseMarker = 492; // Closing subscript marker ~

// Git conflict marker https://github.com/88250/lute/issues/131

export const NodeGitConflict = 495; // Git conflict marker
export const NodeGitConflictOpenMarker = 496; // Opening Git conflict marker <<<<<<<
export const NodeGitConflictContent = 497; // Git conflict marker content
export const NodeGitConflictCloseMarker = 498; // Closing Git conflict marker >>>>>>>

// <iframe> tag

export const NodeIFrame = 500; // iframe tag

// <audio> tag

export const NodeAudio = 505; // audio tag

// <video> tag

export const NodeVideo = 510; // video tag

// <kbd> tag

export const NodeKbd = 515; // Keyboard key
export const NodeKbdOpenMarker = 516; // Opening kbd marker <kbd>
export const NodeKbdCloseMarker = 517; // Closing kbd marker </kbd>

// <u> tag

export const NodeUnderline = 520; // Underline
export const NodeUnderlineOpenMarker = 521; // Opening underline marker <u>
export const NodeUnderlineCloseMarker = 522; // Closing underline marker </u>

// <br> tag

export const NodeBr = 525; // Line break <br>

// <span data-type="mark">foo</span> generic inline text mark, cannot nest

export const NodeTextMark = 530; // Text mark; text marks do not nest, so there are no open/close markers

// Protyle widget, <iframe data-type="NodeWidget">

export const NodeWidget = 535; // iframe data-type="NodeWidget" data-subtype="widget"

// File annotation reference https://github.com/88250/lute/issues/155

export const NodeFileAnnotationRef = 540; // File annotation reference node
export const NodeFileAnnotationRefID = 541; // ID of the referenced file annotation (file/annotation)
export const NodeFileAnnotationRefSpace = 542; // Space between the referenced file annotation ID and the file annotation reference anchor text
export const NodeFileAnnotationRefText = 543; // File annotation reference anchor text (must not be empty; the ID is rendered when it is)

// Attribute view https://github.com/siyuan-note/siyuan/issues/7535 <div data-type="NodeAttributeView" data-av-type="table" data-av-id="xxx"></div>

export const NodeAttributeView = 550; // Attribute view

// Custom block https://github.com/siyuan-note/siyuan/issues/8418 ;;;info

export const NodeCustomBlock = 560; // Custom block

// HTML tag; used directly when no Markdown marker can express it

export const NodeHTMLTag = 570; // HTML tag
export const NodeHTMLTagOpen = 571; // Opening HTML tag
export const NodeHTMLTagClose = 572; // Closing HTML tag

// Callout block https://github.com/88250/lute/issues/203

export const NodeCallout = 580; // Callout block

export const NodeTabs = 590; // Tabs container
export const NodeTabItem = 591; // Tab item
export const NodeMindmap = 600; // Mindmap container
export const NodeMindmapItem = 601; // Mindmap node

export const NodeTypeMaxVal = 1024; // Maximum node type value

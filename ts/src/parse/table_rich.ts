// Ported from parse/table_rich.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as conv from "../runtime/conv.ts";
import * as strconv from "../runtime/strconv.ts";
import * as strings from "../runtime/strings.ts";
import * as ast from "../ast/index.ts";
import * as html from "../html/index.ts";
import { NewOptions, Options, Parse } from "./parse.ts";
import { protectTableCellRichStyles } from "./table_rich_style.ts";
import { NestedInlines2FlattedSpansHybrid, TextMarks2Inlines } from "./transform.ts";
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    finalParseTableCellRich(): void;
  }
}

// TableCellRichOptions fixes the rich text storage syntax, independent of the Markdown switches of the current editor.
export function TableCellRichOptions(): Options {
  const ret = NewOptions();
  ret.DisableTableCellRich = true;
  ret.ProtyleWYSIWYG = true;
  ret.TextMark = true;
  ret.HTMLTag2TextMark = true;
  ret.BlockRef = true;
  ret.FileAnnotationRef = true;
  ret.KramdownBlockIAL = true;
  ret.KramdownSpanIAL = true;
  ret.Emoji = false;
  ret.SuperBlock = true;
  ret.CustomBlock = true;
  ret.GitConflict = true;
  ret.Callout = true;
  ret.Tabs = true;
  ret.ImgPathAllowSpace = true;
  ret.Sup = true;
  ret.Sub = true;
  ret.Tag = true;
  ret.Mark = true;
  ret.GFMStrikethrough1 = false;
  ret.FullWidthStrikethrough = true;
  ret.InlineMathAllowDigitAfterOpenMarker = true;
  ret.Footnotes = false;
  ret.ToC = false;
  ret.HeadingID = false;
  ret.Setext = false;
  ret.YamlFrontMatter = false;
  ret.LinkRef = false;
  ret.IndentCodeBlock = false;
  ret.ParagraphBeginningSpace = true;
  ret.ArbitraryTaskListItemMarker = true;
  ret.EnsureListItemParagraph = true;
  return ret;
}

// ParseTableCellRich parses the supported fragment; the block identities in the fragment do not enter the document block tree.
export function ParseTableCellRich(rich: ast.TableCellRich | null): [Tree | null, Error | null] {
  let tree: Tree | null = null;
  let err = null as Error | null;
  if (null === rich) {
    return [null, new Error("table cell rich text is missing")];
  }
  err = rich.Validate();
  if (null !== err) {
    return [tree, err];
  }
  const [content, restoreStyles] = protectTableCellRichStyles(rich.Content);
  tree = Parse("", conv.BytesFromString(content), TableCellRichOptions());
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }
    if (n.IsBlock()) {
      switch (n.Type) {
        case ast.NodeDocument:
        case ast.NodeParagraph:
        case ast.NodeHeading:
        case ast.NodeList:
        case ast.NodeListItem:
        case ast.NodeBlockquote:
        case ast.NodeCodeBlock:
        case ast.NodeMathBlock:
        case ast.NodeKramdownBlockIAL:
          break;
        default:
          err = new Error("unsupported table cell rich text block [" + ast.NodeTypeString(n.Type) + "]");
          return ast.WalkStop;
      }
    }
    if (ast.NodeCodeBlock === n.Type) {
      const info = strings.Fields(strings.ToLower(conv.StringFromBytes(n.CodeBlockInfo)));
      if (info.length > 0) {
        switch (info[0]) {
          case "abc":
          case "echarts":
          case "flowchart":
          case "graphviz":
          case "infographic":
          case "mermaid":
          case "mindmap":
          case "plantuml":
            err = new Error("unsupported table cell rich text code language [" + info[0] + "]");
            return ast.WalkStop;
        }
      }
    }
    return ast.WalkContinue;
  });
  if (null !== err) {
    return [null, err];
  }
  TextMarks2Inlines(tree);
  NestedInlines2FlattedSpansHybrid(tree, false);
  restoreStyles(tree);
  return [tree, err];
}

// PORT-NOTE: Go copies a node by value (`clone := *node`). ast.Node has no copy method, so the fields are copied one by one in declaration order (shallow, as in Go: slices, maps and pointers are shared).
function copyNode(node: ast.Node): ast.Node {
  const clone = new ast.Node();
  clone.ID = node.ID;
  clone.Box = node.Box;
  clone.Path = node.Path;
  clone.Spec = node.Spec;
  clone.Type = node.Type;
  clone.Parent = node.Parent;
  clone.Previous = node.Previous;
  clone.Next = node.Next;
  clone.FirstChild = node.FirstChild;
  clone.LastChild = node.LastChild;
  clone.Children = node.Children;
  clone.Tokens = node.Tokens;
  clone.TypeStr = node.TypeStr;
  clone.Data = node.Data;
  clone.Close = node.Close;
  clone.LastLineBlank = node.LastLineBlank;
  clone.LastLineChecked = node.LastLineChecked;
  clone.CodeMarkerLen = node.CodeMarkerLen;
  clone.IsFencedCodeBlock = node.IsFencedCodeBlock;
  clone.CodeBlockFenceChar = node.CodeBlockFenceChar;
  clone.CodeBlockFenceLen = node.CodeBlockFenceLen;
  clone.CodeBlockFenceOffset = node.CodeBlockFenceOffset;
  clone.CodeBlockOpenFence = node.CodeBlockOpenFence;
  clone.CodeBlockInfo = node.CodeBlockInfo;
  clone.CodeBlockCloseFence = node.CodeBlockCloseFence;
  clone.HtmlBlockType = node.HtmlBlockType;
  clone.ListData = node.ListData;
  clone.TaskListItemChecked = node.TaskListItemChecked;
  clone.TaskListItemMarker = node.TaskListItemMarker;
  clone.TableAligns = node.TableAligns;
  clone.TableCellAlign = node.TableCellAlign;
  clone.TableCellContentWidth = node.TableCellContentWidth;
  clone.TableCellContentMaxWidth = node.TableCellContentMaxWidth;
  clone.TableCellRich = node.TableCellRich;
  clone.LinkType = node.LinkType;
  clone.LinkRefLabel = node.LinkRefLabel;
  clone.HeadingLevel = node.HeadingLevel;
  clone.HeadingSetext = node.HeadingSetext;
  clone.HeadingNormalizedID = node.HeadingNormalizedID;
  clone.MathBlockDollarOffset = node.MathBlockDollarOffset;
  clone.FootnotesRefLabel = node.FootnotesRefLabel;
  clone.FootnotesRefId = node.FootnotesRefId;
  clone.FootnotesRefs = node.FootnotesRefs;
  clone.HtmlEntityTokens = node.HtmlEntityTokens;
  clone.KramdownIAL = node.KramdownIAL;
  clone.Properties = node.Properties;
  clone.TextMarkType = node.TextMarkType;
  clone.TextMarkAHref = node.TextMarkAHref;
  clone.TextMarkATitle = node.TextMarkATitle;
  clone.TextMarkInlineMathContent = node.TextMarkInlineMathContent;
  clone.TextMarkInlineMemoContent = node.TextMarkInlineMemoContent;
  clone.TextMarkBlockRefID = node.TextMarkBlockRefID;
  clone.TextMarkBlockRefSubtype = node.TextMarkBlockRefSubtype;
  clone.TextMarkFileAnnotationRefID = node.TextMarkFileAnnotationRefID;
  clone.TextMarkFlashcardOcclusionID = node.TextMarkFlashcardOcclusionID;
  clone.TextMarkTextContent = node.TextMarkTextContent;
  clone.AttributeViewID = node.AttributeViewID;
  clone.AttributeViewType = node.AttributeViewType;
  clone.CustomBlockFenceOffset = node.CustomBlockFenceOffset;
  clone.CustomBlockInfo = node.CustomBlockInfo;
  clone.CalloutType = node.CalloutType;
  clone.CalloutTitle = node.CalloutTitle;
  clone.CalloutTitleExplicit = node.CalloutTitleExplicit;
  clone.TabItemTitle = node.TabItemTitle;
  clone.CalloutIcon = node.CalloutIcon;
  clone.CalloutIconType = node.CalloutIconType;
  return clone;
}

// CloneTableCellInline copies an inline node and its attributes, so the projection and the source tree do not share mutable nodes.
export function CloneTableCellInline(node: ast.Node): ast.Node {
  const clone = copyNode(node);
  clone.Parent = null;
  clone.Previous = null;
  clone.Next = null;
  clone.FirstChild = null;
  clone.LastChild = null;
  clone.Children = [];
  // PORT-NOTE: Go's append([]byte(nil), node.Tokens...) is nil when node.Tokens is empty
  clone.Tokens = null !== node.Tokens && 0 < node.Tokens.length ? node.Tokens.slice() : null;
  clone.KramdownIAL = null;
  for (const ial of node.KramdownIAL ?? []) {
    if (null === clone.KramdownIAL) {
      clone.KramdownIAL = [];
    }
    clone.KramdownIAL.push(ial.slice());
  }
  for (let child = node.FirstChild; null !== child; child = child.Next) {
    clone.AppendChild(CloneTableCellInline(child));
  }
  return clone;
}

// ProjectTableCellRich converts the fragment into inline nodes, keeping images, references, styles and readable list markers.
export function ProjectTableCellRich(tree: Tree): ast.Node {
  const [ret] = ProjectTableCellRichWithSources(tree);
  return ret;
}

// ProjectTableCellRichWithSources also records the source of the inline nodes, so resource and reference rewrites can be synced back to the rich text source.
export function ProjectTableCellRichWithSources(tree: Tree): [ast.Node, Map<ast.Node, ast.Node>] {
  const ret = new ast.Node(ast.NodeTableCell);
  const sources = new Map<ast.Node, ast.Node>();
  const mapSource = (copy: ast.Node, original: ast.Node): void => {
    sources.set(copy, original);
    for (let c = copy.FirstChild, o = original.FirstChild; c !== null && o !== null; c = c.Next, o = o.Next) {
      mapSource(c, o);
    }
  };
  const appendText = (text: string): void => {
    const lines = strings.Split(text, "\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (index > 0) {
        ret.AppendChild(new ast.Node(ast.NodeBr, conv.BytesFromString("<br />")));
      }
      ret.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString(line)));
    }
  };
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }
    switch (n.Type) {
      case ast.NodeParagraph:
      case ast.NodeHeading:
      case ast.NodeCodeBlock:
      case ast.NodeMathBlock:
        break;
      default:
        return ast.WalkContinue;
    }
    if (null !== ret.FirstChild) {
      ret.AppendChild(new ast.Node(ast.NodeBr, conv.BytesFromString("<br />")));
    }
    if (ast.NodeParagraph === n.Type && n.ParentIs(ast.NodeListItem)) {
      let first = n.Parent!.FirstChild!;
      if (ast.NodeTaskListItemMarker === first.Type) {
        first = first.Next!;
      }
      if (first === n) {
        let marker = "- ";
        const task = n.Parent!.ChildByType(ast.NodeTaskListItemMarker);
        if (n.Parent!.ListData !== null && n.Parent!.ListData.Typ === 1) {
          marker = strconv.Itoa(n.Parent!.ListData.Num) + ". ";
        } else if (null !== task) {
          marker = "- [ ] ";
          if (task.TaskListItemChecked) {
            marker = "- [x] ";
          }
        }
        appendText(marker);
      }
    }
    if (ast.NodeCodeBlock === n.Type) {
      const content = n.ChildByType(ast.NodeCodeBlockCode);
      if (null !== content) {
        const code = new ast.Node(ast.NodeTextMark);
        code.TextMarkType = "code";
        code.TextMarkTextContent = html.EscapeHTMLStr(strings.TrimSuffix(content.TokensStr(), "\n"));
        ret.AppendChild(code);
        sources.set(code, content);
      }
    } else if (ast.NodeMathBlock === n.Type) {
      const content = n.ChildByType(ast.NodeMathBlockContent);
      if (null !== content) {
        const math = new ast.Node(ast.NodeTextMark);
        math.TextMarkType = "inline-math";
        math.TextMarkInlineMathContent = html.EscapeHTMLStr(strings.TrimSpace(content.TokensStr()));
        ret.AppendChild(math);
        sources.set(math, content);
      }
    } else {
      for (let child = n.FirstChild; null !== child; child = child.Next) {
        if (ast.NodeHeadingC8hMarker !== child.Type && ast.NodeTaskListItemMarker !== child.Type) {
          const copy = CloneTableCellInline(child);
          ret.AppendChild(copy);
          mapSource(copy, child);
        }
      }
    }
    return ast.WalkSkipChildren;
  });
  return [ret, sources];
}

// ApplyTableCellRichProjection refreshes the derived inline content only after the source was parsed successfully.
export function ApplyTableCellRichProjection(cell: ast.Node): Error | null {
  const [tree, err] = ParseTableCellRich(cell.TableCellRich);
  if (null !== err) {
    return err;
  }
  const projection = ProjectTableCellRich(tree!);
  while (null !== cell.FirstChild) {
    cell.FirstChild.Unlink();
  }
  while (null !== projection.FirstChild) {
    cell.AppendChild(projection.FirstChild);
  }
  return null;
}

Tree.prototype.finalParseTableCellRich = function (this: Tree): void {
  const tree = this;
  if (tree.Context!.ParseOption.DisableTableCellRich) {
    return;
  }
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering || ast.NodeTableCell !== n.Type) {
      return ast.WalkContinue;
    }
    for (const attribute of n.KramdownIAL ?? []) {
      if (attribute[0] !== ast.TableCellRichIAL) {
        continue;
      }
      const encoded = n.IALAttr(ast.TableCellRichIAL);
      n.TableCellRich = ast.DecodeTableCellRich(encoded);
      n.RemoveIALAttr(ast.TableCellRichIAL);
      for (let c = n.FirstChild; null !== c;) {
        const next = c.Next;
        if (ast.NodeKramdownSpanIAL === c.Type) {
          c.Unlink();
        }
        c = next;
      }
      ApplyTableCellRichProjection(n);
      break;
    }
    return ast.WalkSkipChildren;
  });
};

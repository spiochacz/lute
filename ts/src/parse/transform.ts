// Ported from parse/transform.go @ 8e7896b6
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
import * as strings from "../runtime/strings.ts";
import * as ast from "../ast/index.ts";
import * as html from "../html/index.ts";
import { Inline } from "./parse.ts";
import { parseTextMarkDelimiters } from "./text_mark_delimiters.ts";
import type { Tree } from "./types.ts";

// NestedInlines2FlattedSpansHybrid converts nested inline nodes into flat text mark nodes.
// This function does not remove escape nodes.
export function NestedInlines2FlattedSpansHybrid(tree: Tree, isExportMd: boolean): void {
  let unlinks: ast.Node[] = [];
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }

    if (ast.NodeLink === n.Type) {
      const unlinkBackslashes: ast.Node[] = [];
      ast.Walk(n, (c: ast.Node, entering: boolean): ast.WalkStatus => {
        if (!entering) {
          return ast.WalkContinue;
        }

        if (ast.NodeBackslash === c.Type) {
          const cont = c.ChildByType(ast.NodeBackslashContent);
          if (null !== cont) {
            const linkText = new ast.Node(ast.NodeLinkText, cont.Tokens);
            c.InsertBefore(linkText);
          }

          unlinkBackslashes.push(c);
        }
        return ast.WalkContinue;
      });
      for (const backslash of unlinkBackslashes) {
        backslash.Unlink();
      }

      // When an image is nested in a link, move the image child node before the link node
      const img = n.ChildByType(ast.NodeImage);
      if (null === img) {
        return ast.WalkContinue;
      }
      n.InsertBefore(img);
      const linkText = n.ChildByType(ast.NodeLinkText);
      if (null === linkText || 1 > bytes.TrimSpace(linkText.Tokens ?? new Uint8Array(0)).length) {
        const openBracket = n.ChildByType(ast.NodeOpenBracket);
        if (null !== openBracket) {
          const dest = n.ChildByType(ast.NodeLinkDest);
          if (null !== dest) {
            openBracket.InsertAfter(new ast.Node(ast.NodeLinkText, dest.Tokens));
          }
        }
      }
    }
    return ast.WalkContinue;
  });
  for (const n of unlinks) {
    n.Unlink();
  }
  unlinks = [];

  const tags: string[] = [];
  let span: ast.Node | null = null;
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    switch (n.Type) {
      // case ast.NodeBackslash: escape nodes exist during Spin and are nested by themselves, so they must be excluded here
      case ast.NodeCodeSpan:
        processNestedNode(n, "code", tags, unlinks, entering);
        break;
      case ast.NodeTag:
        processNestedNode(n, "tag", tags, unlinks, entering);
        break;
      case ast.NodeInlineMath:
        processNestedNode(n, "inline-math", tags, unlinks, entering);
        break;
      case ast.NodeEmphasis:
        processNestedNode(n, "em", tags, unlinks, entering);
        break;
      case ast.NodeStrong:
        processNestedNode(n, "strong", tags, unlinks, entering);
        break;
      case ast.NodeStrikethrough:
        processNestedNode(n, "s", tags, unlinks, entering);
        break;
      case ast.NodeMark:
        processNestedNode(n, "mark", tags, unlinks, entering);
        break;
      case ast.NodeUnderline:
        processNestedNode(n, "u", tags, unlinks, entering);
        break;
      case ast.NodeSub:
        processNestedNode(n, "sub", tags, unlinks, entering);
        break;
      case ast.NodeSup:
        processNestedNode(n, "sup", tags, unlinks, entering);
        break;
      case ast.NodeKbd:
        processNestedNode(n, "kbd", tags, unlinks, entering);
        break;
      case ast.NodeLink:
        processNestedNode(n, "a", tags, unlinks, entering);
        break;
      case ast.NodeBlockRef:
        processNestedNode(n, "block-ref", tags, unlinks, entering);
        break;
      case ast.NodeText:
      case ast.NodeCodeSpanContent:
      case ast.NodeInlineMathContent:
      case ast.NodeLinkText:
      case ast.NodeBlockRefID:
      case ast.NodeHTMLEntity:
      case ast.NodeBackslash:
        if (1 > tags.length) {
          return ast.WalkContinue;
        }

        if (entering) {
          let content = conv.StringFromBytes(html.EscapeHTML(n.Tokens ?? new Uint8Array(0)));
          content = strings.ReplaceAll(content, "&quot;", "\""); // Double quotes in inline elements are no longer converted to entities when pasting Markdown https://github.com/siyuan-note/siyuan/issues/14503
          span = new ast.Node(ast.NodeTextMark);
          span.TextMarkType = mergeTextMarkTypes(tags);
          span.TextMarkTextContent = content;
          if (ast.NodeInlineMathContent === n.Type) {
            span.TextMarkTextContent = "";
            span.TextMarkInlineMathContent = conv.StringFromBytes(html.EscapeHTML(n.Tokens ?? new Uint8Array(0)));
            if (n.ParentIs(ast.NodeTableCell) && !isExportMd) {
              // Improve the handling of inline-math containing `|` in the table https://github.com/siyuan-note/siyuan/issues/9227
              span.TextMarkInlineMathContent = strings.ReplaceAll(span.TextMarkInlineMathContent, "\\|", "|");
            }
          } else if (ast.NodeBackslash === n.Type) {
            const c = n.ChildByType(ast.NodeBackslashContent);
            if (null !== c) {
              span.TextMarkTextContent = conv.StringFromBytes(html.EscapeHTML(c.Tokens ?? new Uint8Array(0)));
            }
          } else if (ast.NodeBlockRefID === n.Type) {
            span.TextMarkBlockRefSubtype = "s";
            span.TextMarkTextContent = n.TokensStr();

            let refText = n.Parent!.ChildByType(ast.NodeBlockRefText);
            if (null === refText) {
              refText = n.Parent!.ChildByType(ast.NodeBlockRefDynamicText);
              span.TextMarkBlockRefSubtype = "d";
            }
            if (null !== refText) {
              span.TextMarkTextContent = refText.TokensStr();
            }

            span.TextMarkBlockRefID = n.Parent!.ChildByType(ast.NodeBlockRefID)!.TokensStr();
          } else if (n.ParentIs(ast.NodeLink) && !n.ParentIs(ast.NodeImage)) {
            const next = n.Next;
            if (null !== next && ast.NodeLinkText === next.Type) {
              // Merge adjacent link text nodes
              n.Next!.PrependTokens(n.Tokens ?? new Uint8Array(0));
              return ast.WalkContinue;
            }

            let link: ast.Node | null = null;
            for (let p = n.Parent; null !== p; p = p.Parent) {
              if (ast.NodeLink === p.Type) {
                link = p;
                break;
              }
            }
            if (null !== link) {
              const dest = link.ChildByType(ast.NodeLinkDest);
              if (null !== dest) {
                span.TextMarkAHref = conv.StringFromBytes(dest.Tokens ?? new Uint8Array(0));
              }
              const title = link.ChildByType(ast.NodeLinkTitle);
              if (null !== title) {
                span.TextMarkATitle = conv.StringFromBytes(title.Tokens ?? new Uint8Array(0));
              }
            }
          }
        } else {
          const next = n.Next;
          if (null !== next && ast.NodeLinkText === next.Type) {
            return ast.WalkContinue;
          }

          span!.KramdownIAL = n.Parent!.KramdownIAL;
          if (n.IsMarker()) {
            n.Parent!.InsertBefore(span!);
          } else if (null !== n.Parent && ast.NodeHTMLTag === n.Parent.Type && null !== n.Parent.Parent && ast.NodeLink === n.Parent.Parent.Type) { // https://github.com/siyuan-note/siyuan/issues/14788#issuecomment-2882248074
            n.Parent.Parent.InsertBefore(span!);
          } else {
            n.InsertBefore(span!);
            if (ast.NodeText === n.Type) {
              unlinks.push(n);
            }
          }
        }
        break;
      case ast.NodeTextMark:
        if (1 > tags.length) {
          return ast.WalkContinue;
        }

        if (entering) {
          const merged = mergeTextMarkTypes(tags, strings.Split(n.TextMarkType, " "));
          if ("" !== merged) {
            n.TextMarkType = merged;
          }
        }
        return ast.WalkContinue;
    }
    return ast.WalkContinue;
  });

  for (const n of unlinks) {
    n.Unlink();
  }
}

// NestedInlines2FlattedSpans converts nested inline nodes into flat text mark nodes.
// This function removes escape nodes.
export function NestedInlines2FlattedSpans(tree: Tree, isExportMd: boolean): void {
  let unlinks: ast.Node[] = [];
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }

    if (ast.NodeLink === n.Type) {
      // When an image is nested in a link, move the image child node before the link node
      const img = n.ChildByType(ast.NodeImage);
      if (null === img) {
        return ast.WalkContinue;
      }
      n.InsertBefore(img);
      const linkText = n.ChildByType(ast.NodeLinkText);
      if (null === linkText || 1 > bytes.TrimSpace(linkText.Tokens ?? new Uint8Array(0)).length) {
        const openBracket = n.ChildByType(ast.NodeOpenBracket);
        if (null !== openBracket) {
          const dest = n.ChildByType(ast.NodeLinkDest);
          if (null !== dest) {
            openBracket.InsertAfter(new ast.Node(ast.NodeLinkText, dest.Tokens));
          }
        }
      }
    } else if (ast.NodeBackslash === n.Type) {
      if (n.ParentIs(ast.NodeTableCell)) {
        return ast.WalkContinue;
      }

      // The backslash escape node is no longer needed
      const c = n.FirstChild;
      if (null !== c) {
        const tokens = html.UnescapeHTML(c.Tokens ?? new Uint8Array(0));
        let processed = false;
        const previous = n.Previous;
        const next = n.Next;
        if (null !== previous && (ast.NodeText === previous.Type || ast.NodeLinkText === previous.Type)) {
          previous.AppendTokens(tokens);
          processed = true;
        } else if (null !== next && (ast.NodeText === next.Type || ast.NodeLinkText === next.Type)) {
          next.PrependTokens(tokens);
          processed = true;
        }
        if (!processed) {
          const text = new ast.Node(ast.NodeText, tokens);
          n.InsertBefore(text);
        }
        unlinks.push(n);
      }
    }
    return ast.WalkContinue;
  });
  for (const n of unlinks) {
    n.Unlink();
  }
  unlinks = [];

  const tags: string[] = [];
  let span: ast.Node | null = null;
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    switch (n.Type) {
      case ast.NodeBackslash:
        if (!n.ParentIs(ast.NodeTableCell)) {
          unlinks.push(n);
        }
        break;
      case ast.NodeCodeSpan:
        processNestedNode(n, "code", tags, unlinks, entering);
        break;
      case ast.NodeTag:
        processNestedNode(n, "tag", tags, unlinks, entering);
        break;
      case ast.NodeInlineMath:
        processNestedNode(n, "inline-math", tags, unlinks, entering);
        break;
      case ast.NodeEmphasis:
        processNestedNode(n, "em", tags, unlinks, entering);
        break;
      case ast.NodeStrong:
        processNestedNode(n, "strong", tags, unlinks, entering);
        break;
      case ast.NodeStrikethrough:
        processNestedNode(n, "s", tags, unlinks, entering);
        break;
      case ast.NodeMark:
        processNestedNode(n, "mark", tags, unlinks, entering);
        break;
      case ast.NodeUnderline:
        processNestedNode(n, "u", tags, unlinks, entering);
        break;
      case ast.NodeSub:
        processNestedNode(n, "sub", tags, unlinks, entering);
        break;
      case ast.NodeSup:
        processNestedNode(n, "sup", tags, unlinks, entering);
        break;
      case ast.NodeKbd:
        processNestedNode(n, "kbd", tags, unlinks, entering);
        break;
      case ast.NodeLink:
        processNestedNode(n, "a", tags, unlinks, entering);
        break;
      case ast.NodeBlockRef:
        processNestedNode(n, "block-ref", tags, unlinks, entering);
        break;
      case ast.NodeText:
      case ast.NodeCodeSpanContent:
      case ast.NodeInlineMathContent:
      case ast.NodeLinkText:
      case ast.NodeBlockRefID:
      case ast.NodeHTMLEntity:
        if (1 > tags.length) {
          return ast.WalkContinue;
        }

        if (entering) {
          span = new ast.Node(ast.NodeTextMark);
          span.TextMarkType = mergeTextMarkTypes(tags);
          span.TextMarkTextContent = conv.StringFromBytes(html.EscapeHTML(n.Tokens ?? new Uint8Array(0)));
          if (ast.NodeInlineMathContent === n.Type) {
            span.TextMarkTextContent = "";
            span.TextMarkInlineMathContent = conv.StringFromBytes(html.EscapeHTML(n.Tokens ?? new Uint8Array(0)));
            if (n.ParentIs(ast.NodeTableCell) && !isExportMd) {
              // Improve the handling of inline-math containing `|` in the table https://github.com/siyuan-note/siyuan/issues/9227
              span.TextMarkInlineMathContent = strings.ReplaceAll(span.TextMarkInlineMathContent, "\\|", "|");
            }
          } else if (ast.NodeBackslash === (n.Type as ast.NodeType)) { // PORT-NOTE: the cast stops TypeScript from rejecting the comparison, which narrowing proves can never be true
            // UPSTREAM-BUG: unreachable, NodeBackslash is not in this case list (parse/transform.go:303)
            const c = n.ChildByType(ast.NodeBackslashContent);
            if (null !== c) {
              span.TextMarkTextContent = conv.StringFromBytes(html.EscapeHTML(c.Tokens ?? new Uint8Array(0)));
            }
          } else if (ast.NodeBlockRefID === n.Type) {
            span.TextMarkBlockRefSubtype = "s";
            span.TextMarkTextContent = n.TokensStr();

            let refText = n.Parent!.ChildByType(ast.NodeBlockRefText);
            if (null === refText) {
              refText = n.Parent!.ChildByType(ast.NodeBlockRefDynamicText);
              span.TextMarkBlockRefSubtype = "d";
            }
            if (null !== refText) {
              span.TextMarkTextContent = refText.TokensStr();
            }

            span.TextMarkBlockRefID = n.Parent!.ChildByType(ast.NodeBlockRefID)!.TokensStr();
          } else if (n.ParentIs(ast.NodeLink) && !n.ParentIs(ast.NodeImage)) {
            const next = n.Next;
            if (null !== next && ast.NodeLinkText === next.Type) {
              // Merge adjacent link text nodes
              n.Next!.PrependTokens(n.Tokens ?? new Uint8Array(0));
              return ast.WalkContinue;
            }

            let link: ast.Node | null = null;
            for (let p = n.Parent; null !== p; p = p.Parent) {
              if (ast.NodeLink === p.Type) {
                link = p;
                break;
              }
            }
            if (null !== link) {
              const dest = link.ChildByType(ast.NodeLinkDest);
              if (null !== dest) {
                span.TextMarkAHref = conv.StringFromBytes(dest.Tokens ?? new Uint8Array(0));
              }
              const title = link.ChildByType(ast.NodeLinkTitle);
              if (null !== title) {
                span.TextMarkATitle = conv.StringFromBytes(title.Tokens ?? new Uint8Array(0));
              }
            }
          }
        } else {
          const next = n.Next;
          if (null !== next && ast.NodeLinkText === next.Type) {
            return ast.WalkContinue;
          }

          span!.KramdownIAL = n.Parent!.KramdownIAL;
          if (n.IsMarker()) {
            n.Parent!.InsertBefore(span!);
          } else {
            n.InsertBefore(span!);
            if (ast.NodeText === n.Type) {
              unlinks.push(n);
            }
          }
        }
        break;
      case ast.NodeTextMark:
        if (1 > tags.length) {
          return ast.WalkContinue;
        }

        if (entering) {
          const merged = mergeTextMarkTypes(tags, strings.Split(n.TextMarkType, " "));
          if ("" !== merged) {
            n.TextMarkType = merged;
          }
        }
        return ast.WalkContinue;
    }
    return ast.WalkContinue;
  });

  for (const n of unlinks) {
    n.Unlink();
  }
}

// PORT-NOTE: Go passes tags and unlinks as pointers to slices; arrays are references here, so they are mutated in place with push and pop.
export function processNestedNode(n: ast.Node, tag: string, tags: string[], unlinks: ast.Node[], entering: boolean): void {
  if (entering) {
    tags.push(tag);
  } else {
    if (0 < tags.length) {
      tags.pop();
    }

    unlinks.push(n);
    for (let c = n.FirstChild; null !== c;) {
      const next = c.Next;
      if (ast.NodeTextMark === c.Type || ast.NodeText === c.Type || ast.NodeImage === c.Type) {
        n.InsertBefore(c);
        if (c.IALAttr("style") === "") {
          c.KramdownIAL = n.KramdownIAL;
        } else {
          // When flattening nested formats keep the text's own style, and fill in the other attributes of the ancestors.
          for (const attr of n.KramdownIAL ?? []) {
            if (c.IALAttr(attr[0]) === "") {
              c.SetIALAttr(attr[0], attr[1]);
            }
          }
        }
        if (n.Type === ast.NodeLink && c.Type === ast.NodeTextMark) {
          const dest = n.ChildByType(ast.NodeLinkDest);
          if (dest !== null) {
            c.TextMarkAHref = dest.TokensStr();
          }
          const title = n.ChildByType(ast.NodeLinkTitle);
          if (title !== null) {
            c.TextMarkATitle = title.TokensStr();
          }
        }
      } else if (ast.NodeLinkDest === c.Type) {
        if (null !== n.Previous && ast.NodeTextMark === n.Previous.Type) {
          n.Previous.TextMarkAHref = conv.StringFromBytes(c.Tokens ?? new Uint8Array(0));
        }
      }
      c = next;
    }
  }
}

export function mergeTextMarkTypes(...typeGroups: string[][]): string {
  const merged: string[] = [];
  for (const types of typeGroups) {
    for (const typ of types) {
      if ("" === typ || "text" === typ) {
        continue;
      }
      let found = false;
      for (const existing of merged) {
        if (existing === typ) {
          found = true;
          break;
        }
      }
      if (!found) {
        merged.push(typ);
      }
    }
  }
  return strings.Join(merged, " ");
}

export function TextMarks2Inlines(tree: Tree): void {
  textMarks2Inlines(tree, false);
}

// TextMarks2InlinesWithNestedSyntax only converts the text marks that contain flattenable Markdown inline syntax.
export function TextMarks2InlinesWithNestedSyntax(tree: Tree): void {
  parseTextMarkDelimiters(tree);
  textMarks2Inlines(tree, true);
}

export function textMarks2Inlines(tree: Tree, nestedSyntaxOnly: boolean): void {
  const inlines = (content: string): [ast.Node[], boolean, boolean] => {
    const ret: ast.Node[] = [];
    let hasNested = false;
    let canFlatten = true;
    const subTree = Inline("", conv.BytesFromString(content), tree.Context!.ParseOption);
    for (let c = subTree.Root!.FirstChild!.FirstChild; null !== c; c = c.Next) {
      ret.push(c);
      switch (c.Type) {
        case ast.NodeCodeSpan:
        case ast.NodeTag:
        case ast.NodeInlineMath:
        case ast.NodeEmphasis:
        case ast.NodeStrong:
        case ast.NodeStrikethrough:
        case ast.NodeMark:
        case ast.NodeUnderline:
        case ast.NodeSub:
        case ast.NodeSup:
        case ast.NodeKbd:
        case ast.NodeLink:
        case ast.NodeBlockRef:
        case ast.NodeImage:
        case ast.NodeTextMark:
          hasNested = true;
          break;
        case ast.NodeText:
        case ast.NodeHTMLEntity:
        case ast.NodeBackslash:
          break;
        default:
          canFlatten = false;
      }
    }
    return [ret, hasNested, canFlatten];
  };

  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }

    if (ast.NodeTextMark !== n.Type || "" !== n.TextMarkFlashcardOcclusionID) {
      return ast.WalkContinue;
    }

    let nodeType: ast.NodeType = 0;
    let openMarkerType: ast.NodeType = 0;
    let closeMarkerType: ast.NodeType = 0;
    switch (n.TextMarkType) {
      case "sup":
        nodeType = ast.NodeSup; openMarkerType = ast.NodeSupOpenMarker; closeMarkerType = ast.NodeSupCloseMarker;
        break;
      case "sub":
        nodeType = ast.NodeSub; openMarkerType = ast.NodeSubOpenMarker; closeMarkerType = ast.NodeSubCloseMarker;
        break;
      case "em":
        nodeType = ast.NodeEmphasis; openMarkerType = ast.NodeEmA6kOpenMarker; closeMarkerType = ast.NodeEmA6kCloseMarker;
        break;
      case "strong":
        nodeType = ast.NodeStrong; openMarkerType = ast.NodeStrongA6kOpenMarker; closeMarkerType = ast.NodeStrongA6kCloseMarker;
        break;
      case "mark":
        nodeType = ast.NodeMark; openMarkerType = ast.NodeMark2OpenMarker; closeMarkerType = ast.NodeMark2CloseMarker;
        break;
      case "s":
        nodeType = ast.NodeStrikethrough; openMarkerType = ast.NodeStrikethrough2OpenMarker; closeMarkerType = ast.NodeStrikethrough2CloseMarker;
        break;
      default:
        return ast.WalkContinue;
    }

    const [nodes, hasNested, canFlatten] = inlines(n.TextMarkTextContent);
    if (nestedSyntaxOnly && (!hasNested || !canFlatten)) {
      return ast.WalkContinue;
    }
    n.Type = nodeType;
    n.PrependChild(new ast.Node(openMarkerType));
    for (const node of nodes) {
      n.AppendChild(node);
    }
    n.AppendChild(new ast.Node(closeMarkerType));
    return ast.WalkContinue;
  });
}

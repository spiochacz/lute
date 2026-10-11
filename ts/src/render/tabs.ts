// Ported from render/tabs.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

// PORT-NOTE: tabs.go holds methods of four renderers (BaseRenderer, FormatRenderer, ProtyleExportMdRenderer, ProtyleRenderer); all of them are attached here, in Go's declaration order.
// The Go identifiers of the other files of the package (NewFormatRenderer, ...) are imported as functions that are only called at run time, so the import cycles with the renderer files are harmless.

import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";
import * as slices from "../runtime/slices.ts";
import * as strconv from "../runtime/strconv.ts";
import * as strings from "../runtime/strings.ts";
import * as ast from "../ast/index.ts";
import * as editor from "../editor/index.ts";
import * as html from "../html/index.ts";
import * as parse from "../parse/index.ts";
import { BaseRenderer, FormatRenderer, ProtyleExportMdRenderer, ProtyleRenderer } from "./types.ts";
import { calloutInlineTree } from "./callout.ts";
import { NewFormatRenderer } from "./format_renderer.ts";
import { NewHtmlRenderer } from "./html_renderer.ts";
import { NewProtyleExportMdRenderer } from "./protyle_export_md_renderer.ts";
import { NewProtyleRenderer } from "./protyle_renderer.ts";

declare module "./types.ts" {
  interface BaseRenderer {
    renderTabsHTML(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTabsDocx(node: ast.Node, entering: boolean): ast.WalkStatus;
  }
  interface FormatRenderer {
    renderTabs(node: ast.Node, entering: boolean): ast.WalkStatus;
    tabsFenceLength(node: ast.Node): number;
  }
  interface ProtyleExportMdRenderer {
    renderTabs(node: ast.Node, entering: boolean): ast.WalkStatus;
  }
  interface ProtyleRenderer {
    renderTabs(node: ast.Node, entering: boolean): ast.WalkStatus;
  }
}

const newlineBytes: Uint8Array = conv.BytesFromString("\n");
const tabMarkers: string[] = ["@tab", "@tab:active"];

FormatRenderer.prototype.renderTabs = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  r.Newline();
  if (ast.NodeTabs === node.Type) {
    r.WriteString(strings.Repeat(":", r.tabsFenceLength(node)));
    if (entering) {
      r.WriteString(" tabs");
    }
    r.Newline();
    if (!entering && !r.Options.KramdownBlockIAL && "true" === node.IALAttr("tabs-task")) {
      r.WriteString("{: tabs-task=\"true\"}\n");
    }
    return ast.WalkContinue;
  }
  if (!entering) {
    return ast.WalkContinue;
  }

  r.WriteString("@tab");
  if ("" !== node.ID && node.ParentIs(ast.NodeTabs) && node.ID === node.Parent!.IALAttr("tabs-active-id")) {
    r.WriteString(":active");
  }
  if (null === node.TabTitleBlock() && "" !== node.TabItemTitle) {
    r.WriteString(" " + strings.ReplaceAll(strings.ReplaceAll(node.TabItemTitle, "\r", " "), "\n", " "));
  }
  r.Newline();
  if (r.Options.KramdownBlockIAL) {
    if (0 < (node.KramdownIAL ?? []).length) {
      r.Write(parse.IAL2Tokens(node.KramdownIAL));
    } else if (null !== node.Next && ast.NodeKramdownBlockIAL === node.Next.Type) {
      r.Write(node.Next.Tokens ?? new Uint8Array(0));
    }
    r.Newline();
  } else {
    const marker = node.IALAttr("tabs-task");
    if ("" !== marker) {
      r.Write(parse.IAL2Tokens([["tabs-task", html.EscapeAttrVal(marker)]]));
      r.Newline();
    }
  }
  r.WriteByte(0x0a /* \n */);
  return ast.WalkContinue;
};

// tabsFenceLength generates the fence from the number of descendant tab levels, so that every outer fence is longer than the inner one.
FormatRenderer.prototype.tabsFenceLength = function (this: FormatRenderer, node: ast.Node): number {
  const r = this;
  if (null === r.tabsFenceLengths) {
    const tabsFenceLengths = new Map<ast.Node, number>();
    r.tabsFenceLengths = tabsFenceLengths;
    const depths = new Map<ast.Node, number>();
    ast.Walk(r.Tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
      if (entering) {
        return ast.WalkContinue;
      }
      let depth = depths.get(n) ?? 0;
      if (ast.NodeTabs === n.Type) {
        depth++;
        tabsFenceLengths.set(n, depth + 2);
      }
      if (null !== n.Parent && (depths.get(n.Parent) ?? 0) < depth) {
        depths.set(n.Parent, depth);
      }
      return ast.WalkContinue;
    });
  }
  const length = r.tabsFenceLengths.get(node) ?? 0;
  if (3 <= length) {
    return length;
  }
  return 3;
};

// escapeTabsParagraphMarkers keeps literal markers in paragraphs, and a standard export also protects flattened body text and headings.
export function escapeTabsParagraphMarkers(node: ast.Node, tokens: Uint8Array, withinTabsOnly: boolean): Uint8Array {
  if (!node.ParentIs(ast.NodeParagraph) && (withinTabsOnly || !node.ParentIs(ast.NodeDocument))) {
    return tokens;
  }
  if (withinTabsOnly) {
    let tabs: ast.Node | null = null;
    for (let parent = node.Parent!.Parent; null !== parent; parent = parent.Parent) {
      if (ast.NodeTabs === parent.Type) {
        tabs = parent;
        break;
      }
    }
    if (null === tabs) {
      return tokens;
    }
  }

  const lineStart = null === node.Previous || ast.NodeSoftBreak === node.Previous.Type ||
    ast.NodeHardBreak === node.Previous.Type;
  const lines = bytes.Split(tokens, newlineBytes);
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if ((0 < i || lineStart) && isTabsParagraphMarker(line)) {
      const leading = line.length - bytes.TrimLeft(line, " \t").length;
      let escaped: Uint8Array = slices.Append(new Uint8Array(0), line.subarray(0, leading));
      escaped = slices.AppendByte(escaped, 0x5c /* \ */);
      lines[i] = slices.Append(escaped, line.subarray(leading));
      changed = true;
    }
  }
  if (!changed) {
    return tokens;
  }
  return bytes.Join(lines, newlineBytes);
}

export function isTabsParagraphMarker(line: Uint8Array): boolean {
  line = bytes.TrimSpace(line);
  line = bytes.TrimPrefix(line, editor.CaretTokens);
  for (const marker of tabMarkers) {
    if (bytes.Equal(line, conv.BytesFromString(marker)) || bytes.HasPrefix(line, conv.BytesFromString(marker + " ")) ||
      bytes.HasPrefix(line, conv.BytesFromString(marker + "\t"))) {
      return true;
    }
  }
  let count = 0;
  while (count < line.length && 0x3a /* : */ === line[count]) {
    count++;
  }
  if (count < 3) {
    return false;
  }
  if (count === line.length) {
    return true;
  }
  return (0x20 /* space */ === line[count] || 0x09 /* \t */ === line[count]) && "tabs" === conv.StringFromBytes(bytes.TrimSpace(line.subarray(count)));
}

ProtyleExportMdRenderer.prototype.renderTabs = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  r.Newline();
  if (r.Options.TabsMarkdown) {
    if (ast.NodeTabs === node.Type) {
      if (null === r.tabsFormatter) {
        r.tabsFormatter = NewFormatRenderer(r.Tree, r.Options, r.ParseOptions);
      }
      r.WriteString(strings.Repeat(":", r.tabsFormatter.tabsFenceLength(node)));
      if (entering) {
        r.WriteString(" tabs");
      }
      r.WriteString("\n\n");
      if (!entering && "true" === node.IALAttr("tabs-task")) {
        r.WriteString("{: tabs-task=\"true\"}\n\n");
      }
    } else if (entering) {
      r.WriteString("@tab");
      if (node.ParentIs(ast.NodeTabs) && "" !== node.ID && node.ID === node.Parent!.IALAttr("tabs-active-id")) {
        r.WriteString(":active");
      }
      let title = calloutInlineTree(node.TabItemTitle, r.ParseOptions)!;
      const paragraph = node.TabTitleBlock();
      if (null !== paragraph) {
        title = new parse.Tree();
        title.Root = paragraph;
      }
      const text = strings.TrimSpace(conv.StringFromBytes(NewProtyleExportMdRenderer(title, r.Options, r.ParseOptions).Render()));
      if ("" !== text) {
        r.WriteString(" " + strings.ReplaceAll(strings.ReplaceAll(text, "\r", " "), "\n", " "));
      }
      const marker = node.IALAttr("tabs-task");
      if ("" !== marker) {
        r.Newline();
        r.Write(parse.IAL2Tokens([["tabs-task", html.EscapeAttrVal(marker)]]));
      }
      r.WriteString("\n\n");
    }
    return ast.WalkContinue;
  }
  if (entering && ast.NodeTabItem === node.Type && null === node.TabTitleBlock() && "" !== node.TabItemTitle) {
    const title = calloutInlineTree(node.TabItemTitle, r.ParseOptions)!;
    parse.TextMarks2Inlines(title);
    r.Write(NewProtyleExportMdRenderer(title, r.Options, r.ParseOptions).Render());
    r.WriteString("\n\n");
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderTabs = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const attrs: string[][] = [];
    let class_ = "tabs"; // PORT-NOTE: `class` is a reserved word
    if (ast.NodeTabItem === node.Type) {
      class_ = "tab-item";
    }
    r.blockNodeAttrs(node, attrs, class_);
    r.Tag("div", attrs, false);
    if (ast.NodeTabs === node.Type) {
      r.WriteString("<div class=\"tabs-header protyle-action\" contenteditable=\"false\"></div>");
    } else {
      const title = node.TabTitleBlock();
      if (null !== title) {
        r.WriteString("<div class=\"tab-item-info callout-info\" contenteditable=\"false\">");
        const tree = new parse.Tree();
        tree.Root = title;
        r.Write(NewProtyleRenderer(tree, r.Options, r.ParseOptions).Render());
        r.WriteString("</div><div class=\"tab-item-content\">");
      } else {
        r.WriteString("<div class=\"tab-item-info callout-info\" contenteditable=\"false\"><span class=\"tab-item-title callout-title\" contenteditable=\"true\" spellcheck=\"");
        r.WriteString(strconv.FormatBool(r.Options.Spellcheck));
        r.WriteString("\">");
        r.Write(NewProtyleRenderer(calloutInlineTree(node.TabItemTitle, r.ParseOptions)!, r.Options, r.ParseOptions).Render());
        r.WriteString("</span></div><div class=\"tab-item-content\">");
      }
    }
  } else {
    if (ast.NodeTabItem === node.Type) {
      r.WriteString("</div>");
    }
    r.renderIAL(node);
    r.WriteString("</div>");
  }
  return ast.WalkContinue;
};

// renderTabsHTML outputs all the content first, and hides the body of unselected tabs only after the interaction is initialized successfully.
BaseRenderer.prototype.renderTabsHTML = function (this: BaseRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let class_ = "tabs"; // PORT-NOTE: `class` is a reserved word
    if (ast.NodeTabItem === node.Type) {
      class_ = "tab-item";
    }
    const attrs: string[][] = [["class", class_], ["data-type", ast.NodeTypeString(node.Type)]];
    if ("" !== node.ID) {
      attrs.push(["data-node-id", node.ID], ["id", node.ID]);
    }
    for (const name of ["tabs-active-id", "tabs-position", "tabs-task"]) {
      const value = node.IALAttr(name);
      if ("" !== value) {
        attrs.push([name, html.EscapeAttrVal(value)]);
      }
    }
    r.Tag("div", attrs, false);
    if (ast.NodeTabs === node.Type) {
      BaseRenderer.prototype.WriteString.call(r, "<div class=\"tabs-header protyle-action\"></div>"); // PORT-NOTE: Go embedding, base method
    } else {
      const title = node.TabTitleBlock();
      if (null !== title) {
        BaseRenderer.prototype.WriteString.call(r, "<div class=\"tab-item-info callout-info\"><div class=\"tab-item-title callout-title\">"); // PORT-NOTE: Go embedding, base method
        const tree = new parse.Tree();
        tree.Root = title;
        BaseRenderer.prototype.Write.call(r, NewHtmlRenderer(tree, r.Options, r.ParseOptions).Render()); // PORT-NOTE: Go embedding, base method
        BaseRenderer.prototype.WriteString.call(r, "</div></div><div class=\"tab-item-content\">"); // PORT-NOTE: Go embedding, base method
      } else {
        BaseRenderer.prototype.WriteString.call(r, "<div class=\"tab-item-info callout-info\"><span class=\"tab-item-title callout-title\">"); // PORT-NOTE: Go embedding, base method
        BaseRenderer.prototype.Write.call(r, NewHtmlRenderer(calloutInlineTree(node.TabItemTitle, r.ParseOptions)!, r.Options, r.ParseOptions).Render()); // PORT-NOTE: Go embedding, base method
        BaseRenderer.prototype.WriteString.call(r, "</span></div><div class=\"tab-item-content\">"); // PORT-NOTE: Go embedding, base method
      }
    }
  } else {
    if (ast.NodeTabItem === node.Type) {
      BaseRenderer.prototype.WriteString.call(r, "</div>"); // PORT-NOTE: Go embedding, base method
    }
    BaseRenderer.prototype.WriteString.call(r, "</div>"); // PORT-NOTE: Go embedding, base method
    BaseRenderer.prototype.Newline.call(r); // PORT-NOTE: Go embedding, base method
  }
  return ast.WalkContinue;
};

BaseRenderer.prototype.renderTabsDocx = function (this: BaseRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  BaseRenderer.prototype.Newline.call(r); // PORT-NOTE: Go embedding, base method
  if (entering && ast.NodeTabItem === node.Type && null === node.TabTitleBlock() && "" !== node.TabItemTitle) {
    BaseRenderer.prototype.WriteString.call(r, "<p>"); // PORT-NOTE: Go embedding, base method
    BaseRenderer.prototype.Write.call(r, NewHtmlRenderer(calloutInlineTree(node.TabItemTitle, r.ParseOptions)!, r.Options, r.ParseOptions).Render()); // PORT-NOTE: Go embedding, base method
    BaseRenderer.prototype.WriteString.call(r, "</p>\n"); // PORT-NOTE: Go embedding, base method
  }
  return ast.WalkContinue;
};

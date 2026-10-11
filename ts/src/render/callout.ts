// Ported from render/callout.go @ 8e7896b6
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
import * as strings from "../runtime/strings.ts";
import * as ast from "../ast/index.ts";
import * as html from "../html/index.ts";
import * as parse from "../parse/index.ts";

export function calloutTitle(node: ast.Node): string {
  if (ast.IsBuiltInCalloutType(node.CalloutType) &&
    (!node.CalloutTitleExplicit && "" === node.CalloutTitle ||
      node.CalloutTitle === ast.GetCalloutTitle(node.CalloutType)) &&
    node.CalloutIcon === ast.GetCalloutIcon(node.CalloutType)) {
    return "";
  }

  let icon = node.CalloutIcon;
  if (1 === node.CalloutIconType) {
    if (ast.IsValidCalloutImageSrc(icon)) {
      icon = "![" + ast.CalloutIconImageAlt + "](<" + conv.StringFromBytes(html.EncodeDestination(conv.BytesFromString(icon))) + ">)";
    } else {
      icon = "";
    }
  }
  return strings.TrimSpace(icon + " " + node.CalloutTitle);
}

export function calloutDisplayTitle(node: ast.Node): string {
  let title = node.CalloutTitle;
  if ("" === title && !node.CalloutTitleExplicit) {
    title = ast.GetCalloutTitle(node.CalloutType);
  }
  if ("" === title && !node.CalloutTitleExplicit) {
    title = node.CalloutType;
  }
  return title;
}

export function calloutEditableIcon(node: ast.Node): string {
  let icon = node.CalloutIcon;
  if (1 === node.CalloutIconType) {
    if (ast.IsValidCalloutImageSrc(icon)) {
      icon = "![" + ast.CalloutIconImageAlt + "](<" + conv.StringFromBytes(html.EncodeDestination(conv.BytesFromString(icon))) + ">)";
    } else {
      icon = "";
    }
  }
  return icon;
}

export function calloutEditableInfo(node: ast.Node): string {
  return strings.TrimSpace(calloutEditableIcon(node) + " " + calloutDisplayTitle(node));
}

// PORT-NOTE: Go returns *parse.Tree, so the type is nullable; parse.Inline never returns nil, which is why the callers that pass the tree on without a nil check use `!`.
export function calloutInlineTree(markdown: string, options: parse.Options): parse.Tree | null {
  const tree = parse.Inline("", conv.BytesFromString(markdown), options);
  if (null === tree || null === tree.Root || null === tree.Root.FirstChild) {
    return tree;
  }

  const inlines: ast.Node[] = [];
  for (let child = tree.Root.FirstChild.FirstChild; null !== child; child = child.Next) {
    inlines.push(child);
  }
  tree.Root.FirstChild.Unlink();
  for (const inline of inlines) {
    tree.Root.AppendChild(inline);
  }
  return tree;
}

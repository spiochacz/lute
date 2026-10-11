// Helpers shared by the tests of the render package. Not part of the port.
//
// buildNode mirrors buildNode in ts/tools/gen-render-vectors/spec.go: a NodeSpec is a JSON description of a hand-built ast.Node tree,
// written by the Go generator and rebuilt here, so both sides run on the same tree.

import * as conv from "../runtime/conv.ts";
import * as ast from "../ast/index.ts";
import type { Options } from "./renderer.ts";

export interface NodeSpec {
  type: string;
  tokens?: string;
  props?: Record<string, unknown>;
  children?: NodeSpec[];
}

export function buildNode(spec: NodeSpec): ast.Node {
  const typ = ast.Str2NodeType(spec.type);
  if (0 > typ) {
    throw new Error("unknown node type " + spec.type);
  }
  const n = new ast.Node(typ);
  if (undefined !== spec.tokens) {
    n.Tokens = conv.BytesFromString(spec.tokens);
  }
  for (const [k, v] of Object.entries(spec.props ?? {})) {
    switch (k) {
      case "ID":
        n.ID = v as string;
        break;
      case "HeadingLevel":
        n.HeadingLevel = v as number;
        break;
      case "HeadingNormalizedID":
        n.HeadingNormalizedID = v as string;
        break;
      case "IsFencedCodeBlock":
        n.IsFencedCodeBlock = v as boolean;
        break;
      case "CodeBlockInfo":
        n.CodeBlockInfo = conv.BytesFromString(v as string);
        break;
      case "TaskListItemChecked":
        n.TaskListItemChecked = v as boolean;
        break;
      case "TaskListItemMarker":
        n.TaskListItemMarker = v as number;
        break;
      case "LinkType":
        n.LinkType = v as number;
        break;
      case "LinkRefLabel":
        n.LinkRefLabel = conv.BytesFromString(v as string);
        break;
      case "ListData": {
        const m = v as Record<string, unknown>;
        const ld = new ast.ListData();
        for (const [lk, lv] of Object.entries(m)) {
          switch (lk) {
            case "Typ":
              ld.Typ = lv as number;
              break;
            case "Tight":
              ld.Tight = lv as boolean;
              break;
            case "BulletChar":
              ld.BulletChar = lv as number;
              break;
            case "Start":
              ld.Start = lv as number;
              break;
            case "Delimiter":
              ld.Delimiter = lv as number;
              break;
            case "Marker":
              ld.Marker = conv.BytesFromString(lv as string);
              break;
            case "Num":
              ld.Num = lv as number;
              break;
            default:
              throw new Error("unknown ListData prop " + lk);
          }
        }
        n.ListData = ld;
        break;
      }
      case "KramdownIAL": {
        const ial: string[][] = [];
        for (const kv of v as string[][]) {
          ial.push([kv[0], kv[1]]);
        }
        n.KramdownIAL = ial;
        break;
      }
      case "TextMarkType":
        n.TextMarkType = v as string;
        break;
      case "TextMarkTextContent":
        n.TextMarkTextContent = v as string;
        break;
      case "TextMarkAHref":
        n.TextMarkAHref = v as string;
        break;
      case "TextMarkATitle":
        n.TextMarkATitle = v as string;
        break;
      case "TextMarkInlineMathContent":
        n.TextMarkInlineMathContent = v as string;
        break;
      case "TextMarkInlineMemoContent":
        n.TextMarkInlineMemoContent = v as string;
        break;
      case "TextMarkBlockRefID":
        n.TextMarkBlockRefID = v as string;
        break;
      case "TextMarkBlockRefSubtype":
        n.TextMarkBlockRefSubtype = v as string;
        break;
      case "TextMarkFileAnnotationRefID":
        n.TextMarkFileAnnotationRefID = v as string;
        break;
      case "CalloutType":
        n.CalloutType = v as string;
        break;
      case "CalloutTitle":
        n.CalloutTitle = v as string;
        break;
      case "CalloutTitleExplicit":
        n.CalloutTitleExplicit = v as boolean;
        break;
      case "CalloutIcon":
        n.CalloutIcon = v as string;
        break;
      case "CalloutIconType":
        n.CalloutIconType = v as number;
        break;
      case "CustomBlockInfo":
        n.CustomBlockInfo = v as string;
        break;
      case "AttributeViewID":
        n.AttributeViewID = v as string;
        break;
      case "AttributeViewType":
        n.AttributeViewType = v as string;
        break;
      case "TableCellAlign":
        n.TableCellAlign = v as number;
        break;
      case "FootnotesRefId":
        n.FootnotesRefId = v as string;
        break;
      case "TabItemTitle":
        n.TabItemTitle = v as string;
        break;
      default:
        throw new Error("unknown prop " + k);
    }
  }
  for (const c of spec.children ?? []) {
    n.AppendChild(buildNode(c));
  }
  return n;
}

// nodeAt returns the node reached by following the child indexes path from root.
export function nodeAt(root: ast.Node, path: number[]): ast.Node {
  let n = root;
  for (let i of path) {
    let c = n.FirstChild!;
    for (; 0 < i; i--) {
      c = c.Next!;
    }
    n = c;
  }
  return n;
}

// applyOptions sets the render options named in set; the generator applies the same set with reflection.
export function applyOptions(o: Options, set: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(set)) {
    if (!Reflect.has(o, k)) {
      throw new Error("unknown option " + k);
    }
    Reflect.set(o, k, v);
  }
}

export type RenderModule = typeof import("./index.ts");
export type ParseModule = typeof import("../parse/index.ts");

export interface Loaded {
  render: RenderModule | null;
  parse: ParseModule | null;
  // skip is false when ./index.ts and ../parse/index.ts could be imported, otherwise the reason the tests that need them are skipped.
  skip: string | false;
}

// load imports the render package. It fails while the parse package is unfinished (a file of parse imports a symbol that does not exist yet),
// and then the tests that need the package are skipped with the reason, so they start running as soon as parse is complete.
export async function load(): Promise<Loaded> {
  try {
    const parse = await import("../parse/index.ts");
    const render = await import("./index.ts");
    return { render, parse, skip: false };
  } catch (e) {
    return { render: null, parse: null, skip: "render package not importable yet: " + (e as Error).message };
  }
}

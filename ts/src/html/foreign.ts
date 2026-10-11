// Ported from html/foreign.go @ 8e7896b6
// Copyright 2011 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// PORT-NOTE: The Go map literals below are converted to Map literals with a script that
// copies the entries of html/foreign.go one per line, in the same order. The entries are
// not changed. Go's map[string]bool becomes Map<string, boolean> with true values.

import * as strings from "../runtime/strings.ts";
import { ElementNode } from "./node.ts";
import type { Node } from "./node.ts";
import type { Attribute } from "./token.ts";

export function adjustAttributeNames(aa: Attribute[], nameMap: Map<string, string>): void {
  for (let i = 0; i < aa.length; i++) {
    const newName = nameMap.get(aa[i].Key);
    if (newName !== undefined) {
      aa[i].Key = newName;
    }
  }
}

export function adjustForeignAttributes(aa: Attribute[]): void {
  for (let i = 0; i < aa.length; i++) {
    const a = aa[i];
    if (a.Key === "" || a.Key.charCodeAt(0) !== 0x78 /* x */) {
      continue;
    }
    switch (a.Key) {
      case "xlink:actuate":
      case "xlink:arcrole":
      case "xlink:href":
      case "xlink:role":
      case "xlink:show":
      case "xlink:title":
      case "xlink:type":
      case "xml:base":
      case "xml:lang":
      case "xml:space":
      case "xmlns:xlink": {
        // The key is ASCII, so the index is the same in bytes and UTF-16 units.
        // PORT-NOTE: byte offset (ASCII key)
        const j = strings.Index(a.Key, ":");
        aa[i].Namespace = a.Key.slice(0, j);
        aa[i].Key = a.Key.slice(j + 1);
        break;
      }
    }
  }
}

export function htmlIntegrationPoint(n: Node): boolean {
  if (n.Type !== ElementNode) {
    return false;
  }
  switch (n.Namespace) {
    case "math":
      if (n.Data === "annotation-xml") {
        for (const a of n.Attr) {
          if (a.Key === "encoding") {
            const val = strings.ToLower(a.Val);
            if (val === "text/html" || val === "application/xhtml+xml") {
              return true;
            }
          }
        }
      }
      break;
    case "svg":
      switch (n.Data) {
        case "desc":
        case "foreignObject":
        case "title":
          return true;
      }
      break;
  }
  return false;
}

export function mathMLTextIntegrationPoint(n: Node): boolean {
  if (n.Namespace !== "math") {
    return false;
  }
  switch (n.Data) {
    case "mi":
    case "mo":
    case "mn":
    case "ms":
    case "mtext":
      return true;
  }
  return false;
}

// Section 12.2.6.5.
export const breakout: Map<string, boolean> = new Map<string, boolean>([
  ["b", true],
  ["big", true],
  ["blockquote", true],
  ["body", true],
  ["br", true],
  ["center", true],
  ["code", true],
  ["dd", true],
  ["div", true],
  ["dl", true],
  ["dt", true],
  ["em", true],
  ["embed", true],
  ["h1", true],
  ["h2", true],
  ["h3", true],
  ["h4", true],
  ["h5", true],
  ["h6", true],
  ["head", true],
  ["hr", true],
  ["i", true],
  ["img", true],
  ["li", true],
  ["listing", true],
  ["menu", true],
  ["meta", true],
  ["nobr", true],
  ["ol", true],
  ["p", true],
  ["pre", true],
  ["ruby", true],
  ["s", true],
  ["small", true],
  ["span", true],
  ["strong", true],
  ["strike", true],
  ["sub", true],
  ["sup", true],
  ["table", true],
  ["tt", true],
  ["u", true],
  ["ul", true],
  ["var", true],
]);

// Section 12.2.6.5.
export const svgTagNameAdjustments: Map<string, string> = new Map<string, string>([
  ["altglyph", "altGlyph"],
  ["altglyphdef", "altGlyphDef"],
  ["altglyphitem", "altGlyphItem"],
  ["animatecolor", "animateColor"],
  ["animatemotion", "animateMotion"],
  ["animatetransform", "animateTransform"],
  ["clippath", "clipPath"],
  ["feblend", "feBlend"],
  ["fecolormatrix", "feColorMatrix"],
  ["fecomponenttransfer", "feComponentTransfer"],
  ["fecomposite", "feComposite"],
  ["feconvolvematrix", "feConvolveMatrix"],
  ["fediffuselighting", "feDiffuseLighting"],
  ["fedisplacementmap", "feDisplacementMap"],
  ["fedistantlight", "feDistantLight"],
  ["feflood", "feFlood"],
  ["fefunca", "feFuncA"],
  ["fefuncb", "feFuncB"],
  ["fefuncg", "feFuncG"],
  ["fefuncr", "feFuncR"],
  ["fegaussianblur", "feGaussianBlur"],
  ["feimage", "feImage"],
  ["femerge", "feMerge"],
  ["femergenode", "feMergeNode"],
  ["femorphology", "feMorphology"],
  ["feoffset", "feOffset"],
  ["fepointlight", "fePointLight"],
  ["fespecularlighting", "feSpecularLighting"],
  ["fespotlight", "feSpotLight"],
  ["fetile", "feTile"],
  ["feturbulence", "feTurbulence"],
  ["foreignobject", "foreignObject"],
  ["glyphref", "glyphRef"],
  ["lineargradient", "linearGradient"],
  ["radialgradient", "radialGradient"],
  ["textpath", "textPath"],
]);

// Section 12.2.6.1
export const mathMLAttributeAdjustments: Map<string, string> = new Map<string, string>([
  ["definitionurl", "definitionURL"],
]);

export const svgAttributeAdjustments: Map<string, string> = new Map<string, string>([
  ["attributename", "attributeName"],
  ["attributetype", "attributeType"],
  ["basefrequency", "baseFrequency"],
  ["baseprofile", "baseProfile"],
  ["calcmode", "calcMode"],
  ["clippathunits", "clipPathUnits"],
  ["contentscripttype", "contentScriptType"],
  ["contentstyletype", "contentStyleType"],
  ["diffuseconstant", "diffuseConstant"],
  ["edgemode", "edgeMode"],
  ["externalresourcesrequired", "externalResourcesRequired"],
  ["filterres", "filterRes"],
  ["filterunits", "filterUnits"],
  ["glyphref", "glyphRef"],
  ["gradienttransform", "gradientTransform"],
  ["gradientunits", "gradientUnits"],
  ["kernelmatrix", "kernelMatrix"],
  ["kernelunitlength", "kernelUnitLength"],
  ["keypoints", "keyPoints"],
  ["keysplines", "keySplines"],
  ["keytimes", "keyTimes"],
  ["lengthadjust", "lengthAdjust"],
  ["limitingconeangle", "limitingConeAngle"],
  ["markerheight", "markerHeight"],
  ["markerunits", "markerUnits"],
  ["markerwidth", "markerWidth"],
  ["maskcontentunits", "maskContentUnits"],
  ["maskunits", "maskUnits"],
  ["numoctaves", "numOctaves"],
  ["pathlength", "pathLength"],
  ["patterncontentunits", "patternContentUnits"],
  ["patterntransform", "patternTransform"],
  ["patternunits", "patternUnits"],
  ["pointsatx", "pointsAtX"],
  ["pointsaty", "pointsAtY"],
  ["pointsatz", "pointsAtZ"],
  ["preservealpha", "preserveAlpha"],
  ["preserveaspectratio", "preserveAspectRatio"],
  ["primitiveunits", "primitiveUnits"],
  ["refx", "refX"],
  ["refy", "refY"],
  ["repeatcount", "repeatCount"],
  ["repeatdur", "repeatDur"],
  ["requiredextensions", "requiredExtensions"],
  ["requiredfeatures", "requiredFeatures"],
  ["specularconstant", "specularConstant"],
  ["specularexponent", "specularExponent"],
  ["spreadmethod", "spreadMethod"],
  ["startoffset", "startOffset"],
  ["stddeviation", "stdDeviation"],
  ["stitchtiles", "stitchTiles"],
  ["surfacescale", "surfaceScale"],
  ["systemlanguage", "systemLanguage"],
  ["tablevalues", "tableValues"],
  ["targetx", "targetX"],
  ["targety", "targetY"],
  ["textlength", "textLength"],
  ["viewbox", "viewBox"],
  ["viewtarget", "viewTarget"],
  ["xchannelselector", "xChannelSelector"],
  ["ychannelselector", "yChannelSelector"],
  ["zoomandpan", "zoomAndPan"],
]);

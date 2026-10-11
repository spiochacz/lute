// Ported from h2m_code_banner.go @ 8e7896b6

// PORT-NOTE: h2m_code_banner.go has no license header in Go.
// PORT-NOTE: domClassContains is declared in h2m.go and imported from h2m.ts; the two files import each other, which is safe because both only use function declarations at call time.

import * as strings from "./runtime/strings.ts";
import * as utf8 from "./runtime/utf8.ts";
import * as html from "./html/index.ts";
import * as atom from "./html/atom/index.ts";
import * as util from "./util/index.ts";
import { domClassContains } from "./h2m.ts";

// normalizeCodeBlockBanner 在转换子节点前提取代码横幅中的语言，避免横幅生成普通段落。
// Extracts the language from the code banner before the child nodes are converted, so that the banner does not produce an ordinary paragraph.
export function normalizeCodeBlockBanner(n: html.Node): void {
  if (atom.Div !== n.DataAtom || !domClassContains(n, "md-code-block")) {
    return;
  }
  let banner: html.Node | null = null;
  let pre: html.Node | null = null;
  for (let child = n.FirstChild; null !== child; child = child.NextSibling) {
    if (domClassContains(child, "md-code-block-banner")) {
      if (null !== banner) {
        return;
      }
      banner = child;
    } else if (atom.Pre === child.DataAtom) {
      if (null !== pre) {
        return;
      }
      pre = child;
    }
  }
  if (null === banner || null === pre) {
    return;
  }
  const text = new strings.Builder();
  codeBannerText(banner, text);
  const language = strings.TrimSpace(text.String());
  if (!isCodeBannerLanguage(language)) {
    return;
  }

  const codes = util.DomChildrenByType(pre, atom.Code);
  if (1 < codes.length) {
    return;
  }
  let code: html.Node;
  if (1 === codes.length) {
    code = codes[0];
  } else {
    code = new html.Node();
    code.Type = html.ElementNode;
    code.DataAtom = atom.Code;
    code.Data = "code";
    while (null !== pre.FirstChild) {
      const child = pre.FirstChild;
      child.Unlink();
      code.AppendChild(child);
    }
    pre.AppendChild(code);
  }
  // 已有语言由原有代码块解析逻辑处理，横幅只补充缺失的信息。
  // An existing language is handled by the original code block parsing logic; the banner only supplies missing information.
  const preClass = util.DomAttrValue(pre, "class");
  const hasPreLanguage =
    strings.Contains(preClass, "language-") ||
    "" !== util.DomAttrValue(pre, "data-language") ||
    ("" !== preClass && !strings.ContainsAny(preClass, " \t\r\n-_") && "fallback" !== preClass && "chroma" !== preClass);
  if ("" === util.DomAttrValue(code, "class") && !hasPreLanguage) {
    util.SetDomAttrValue(code, "class", "language-" + language);
  }
  banner.Unlink();
}

// codeBannerText 排除横幅中的交互控件和图标，保留语言标签文本。
// Leaves out the interactive controls and icons of the banner and keeps the text of the language label.
function codeBannerText(n: html.Node, text: strings.Builder): void {
  if (
    atom.Button === n.DataAtom ||
    atom.A === n.DataAtom ||
    atom.Svg === n.DataAtom ||
    "button" === util.DomAttrValue(n, "role") ||
    "true" === util.DomAttrValue(n, "aria-hidden") ||
    domClassContains(n, "ds-icon-button")
  ) {
    return;
  }
  if (html.TextNode === n.Type) {
    text.WriteString(n.Data);
    text.WriteByte(0x20 /* space */);
  }
  for (let child = n.FirstChild; null !== child; child = child.NextSibling) {
    codeBannerText(child, text);
  }
}

function isCodeBannerLanguage(language: string): boolean {
  // PORT-NOTE: len(language) is a byte count in Go, hence ByteLen.
  if ("" === language || utf8.ByteLen(language) > 64) {
    return false;
  }
  // PORT-NOTE: Go ranges over runes with the byte offset i; only `i > 0` is used, which is the same as "not the first rune".
  let first = true;
  for (let k = 0; k < language.length; ) {
    const [c, size] = utf8.DecodeRuneInString(language, k);
    k += size;
    const i = first ? 0 : 1;
    first = false;
    if (
      (c >= 0x61 /* a */ && c <= 0x7a /* z */) ||
      (c >= 0x41 /* A */ && c <= 0x5a /* Z */) ||
      (i > 0 && ((c >= 0x30 /* 0 */ && c <= 0x39) /* 9 */ || strings.ContainsRune("#+.", c)))
    ) {
      continue;
    }
    return false;
  }
  switch (strings.ToLower(language)) {
    case "copy":
    case "copied":
    case "expand":
    case "collapse":
    case "download":
    case "run":
      return false;
  }
  return true;
}

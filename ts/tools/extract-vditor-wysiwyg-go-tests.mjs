// Extracts the test tables of the Go tests that exercise the WYSIWYG methods of vditor_wysiwyg.go mechanically
// (Go string literals are decoded here) into test/e2e/root/vditor_wysiwyg_go_cases.json.
// Run from ts/: node tools/extract-vditor-wysiwyg-go-tests.mjs
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../test/", import.meta.url);

function decodeInterpreted(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const d = s[++i];
    switch (d) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case "\\": out += "\\"; break;
      case "\"": out += "\""; break;
      case "'": out += "'"; break;
      case "a": out += "\x07"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "v": out += "\v"; break;
      case "u": out += String.fromCodePoint(parseInt(s.slice(i + 1, i + 5), 16)); i += 4; break;
      case "U": out += String.fromCodePoint(parseInt(s.slice(i + 1, i + 9), 16)); i += 8; break;
      case "x": out += String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; break;
      default: throw new Error("unsupported escape \\" + d);
    }
  }
  return out;
}

// Index of the character after the Go literal (string, raw string, rune or comment) that starts at i, or -1 when none starts there.
function skipLiteral(text, i) {
  const c = text[i];
  if (c === "\"") {
    let j = i + 1;
    while (text[j] !== "\"") {
      if (text[j] === "\\") j++;
      j++;
    }
    return j + 1;
  }
  if (c === "`") return text.indexOf("`", i + 1) + 1;
  if (c === "/" && text[i + 1] === "/") {
    const j = text.indexOf("\n", i);
    return j < 0 ? text.length : j;
  }
  return -1;
}

// String literals of a text, in order, decoded.
function strings(body) {
  const out = [];
  for (let i = 0; i < body.length;) {
    const c = body[i];
    const next = skipLiteral(body, i);
    if (next < 0) {
      i++;
      continue;
    }
    if (c === "\"") out.push(decodeInterpreted(body.slice(i + 1, next - 1)));
    else if (c === "`") out.push(body.slice(i + 1, next - 1));
    i = next;
  }
  return out;
}

// Text between the braces of the composite literal whose opening brace is at `open`.
function literalBody(src, open) {
  let depth = 0;
  for (let i = open; i < src.length;) {
    const next = skipLiteral(src, i);
    if (next >= 0) {
      i = next;
      continue;
    }
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
    i++;
  }
  throw new Error("unbalanced literal");
}

// Top-level `{...}` elements of the text of a slice literal, each as the list of its string literals.
function elements(body) {
  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length;) {
    const next = skipLiteral(body, i);
    if (next >= 0) {
      i = next;
      continue;
    }
    if (body[i] === "{") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (body[i] === "}") {
      depth--;
      if (depth === 0) out.push(strings(body.slice(start, i)));
    }
    i++;
  }
  return out;
}

function table(src, header, from = 0) {
  const at = src.indexOf(header, from);
  if (at < 0) throw new Error("table not found: " + header);
  return elements(literalBody(src, src.indexOf("{", at + header.length - 1)));
}

function read(name) {
  return readFileSync(new URL(name, root), "utf8");
}

const spin = read("spin_wysiwyg_test.go");
const sanitizer = read("sanitizer_test.go");
const listStyle = read("render_list_style_test.go");
const callout = read("vditor_callout_test.go");

const result = {
  spinVditorDOMTests: table(spin, "var spinVditorDOMTests = []*parseTest{"),
  spinVditorDOMTableInListTests: table(spin, "tests := []*parseTest{", spin.indexOf("func TestSpinVditorDOMTableInList")),
  vditorDOM2MdTests: table(read("v2m_test.go"), "var vditorDOM2MdTests = []parseTest{"),
  md2VditorDOMTests: table(read("m2v_test.go"), "var md2VditorDOMTests = []parseTest{"),
  html2VditorDOMTests: table(read("h2v_test.go"), "var html2VditorDOMTests = []parseTest{"),
  sanitizerVditorTests: table(sanitizer, "var sanitizerVditorTests = []parseTest{"),
  renderListStyleVditorTests: table(listStyle, "var renderListStyleVditorTests = []parseTest{"),
  calloutMarkdowns: strings(literalBody(callout, callout.indexOf("{", callout.indexOf("markdowns := []string{") + 21))),
};
writeFileSync(new URL("../test/e2e/root/vditor_wysiwyg_go_cases.json", import.meta.url), JSON.stringify(result));
console.log(Object.entries(result).map(([k, v]) => k + ": " + v.length).join("\n"));

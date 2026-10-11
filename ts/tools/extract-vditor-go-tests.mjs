// Extracts the test tables of test/spin_ir_test.go, test/spin_sv_test.go and test/vditor_table_br_test.go
// mechanically (Go string literals are decoded here) into test/e2e/root/vditor_go_cases.json.
// Run from ts/: node tools/extract-vditor-go-tests.mjs
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
      case "u": out += String.fromCodePoint(parseInt(s.slice(i + 1, i + 5), 16)); i += 4; break;
      case "U": out += String.fromCodePoint(parseInt(s.slice(i + 1, i + 9), 16)); i += 8; break;
      default: throw new Error("unsupported escape \\" + d);
    }
  }
  return out;
}

// Returns the index of the end of the string, raw string or comment that starts at i, or -1 when none starts there.
function skipLiteral(text, i) {
  const c = text[i];
  if (c === "\"") {
    let j = i + 1;
    while (text[j] !== "\"") {
      if (text[j] === "\\") j++;
      j++;
    }
    return j;
  }
  if (c === "`") {
    return text.indexOf("`", i + 1);
  }
  if (c === "/" && text[i + 1] === "/") {
    return text.indexOf("\n", i);
  }
  return -1;
}

// The strings and integers of one table element.
function tokens(body) {
  const out = [];
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    const end = skipLiteral(body, i);
    if (end >= 0 && c === "\"") {
      out.push(decodeInterpreted(body.slice(i + 1, end)));
      i = end + 1;
    } else if (end >= 0 && c === "`") {
      out.push(body.slice(i + 1, end));
      i = end + 1;
    } else if (end >= 0) {
      i = end + 1;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (/[0-9]/.test(body[j])) j++;
      out.push(Number(body.slice(i, j)));
      i = j;
    } else {
      i++;
    }
  }
  return out;
}

// The top-level {...} elements of the text between the braces of a slice literal.
function elements(inner) {
  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < inner.length; i++) {
    const end = skipLiteral(inner, i);
    if (end >= 0) {
      i = end;
    } else if (inner[i] === "{") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (inner[i] === "}") {
      depth--;
      if (depth === 0) out.push(inner.slice(start, i));
    }
  }
  return out;
}

// header ends with the opening brace of the slice literal.
function tableOf(src, header) {
  const at = src.indexOf(header);
  if (at < 0) throw new Error("table not found: " + header);
  const open = at + header.length - 1;
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    const end = skipLiteral(src, i);
    if (end >= 0) {
      i = end;
    } else if (src[i] === "{") {
      depth++;
    } else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return elements(src.slice(open + 1, i)).map(tokens);
}

function read(name) {
  return readFileSync(new URL(name, root), "utf8").replace(/\r\n/g, "\n");
}

const br = read("vditor_table_br_test.go");
const result = {
  spinVditorIRDOMTests: tableOf(read("spin_ir_test.go"), "var spinVditorIRDOMTests = []*parseTest{"),
  spinVditorSVDOMTests: tableOf(read("spin_sv_test.go"), "var spinVditorSVDOMTests = []*parseTest{"),
  tableCellBrRoundTripTests: tableOf(br.slice(br.indexOf("func TestVditorTableCellBrRoundTrip")), "markdownBrCount int\n\t}{"),
  spinTableCellBrTests: tableOf(br.slice(br.indexOf("func TestSpinVditorTableCellBr")), "markdownBrCount int\n\t}{"),
};
writeFileSync(new URL("../test/e2e/root/vditor_go_cases.json", import.meta.url), JSON.stringify(result));
console.log(Object.entries(result).map(([k, v]) => k + ": " + v.length).join("\n"));

// Extracts the string-literal tables of the Go tests that exercise HTML2Md / HTML2Markdown into
// ts/test/e2e/root/h2m_go_cases.json, so that the cases are not transcribed by hand.
// Usage (from ts/): node tools/h2m-go-tests/extract.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));

// Reads the Go string literal that starts at src[i]; returns [value, nextIndex].
function readLiteral(src, i) {
  if (src[i] === "`") {
    const end = src.indexOf("`", i + 1);
    return [src.slice(i + 1, end).replace(/\r/g, ""), end + 1];
  }
  if (src[i] !== '"') {
    throw new Error("not a string literal at " + i + ": " + src.slice(i, i + 40));
  }
  let out = "";
  let j = i + 1;
  while (src[j] !== '"') {
    const c = src[j];
    if (c === "\\") {
      const d = src[j + 1];
      j += 2;
      switch (d) {
        case "n": out += "\n"; break;
        case "t": out += "\t"; break;
        case "r": out += "\r"; break;
        case "\\": out += "\\"; break;
        case '"': out += '"'; break;
        case "'": out += "'"; break;
        case "a": out += "\x07"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "v": out += "\v"; break;
        case "u": out += String.fromCodePoint(parseInt(src.slice(j, j + 4), 16)); j += 4; break;
        case "U": out += String.fromCodePoint(parseInt(src.slice(j, j + 8), 16)); j += 8; break;
        case "x": out += String.fromCharCode(parseInt(src.slice(j, j + 2), 16)); j += 2; break;
        default: throw new Error("unsupported escape \\" + d);
      }
    } else {
      out += c;
      j++;
    }
  }
  return [out, j + 1];
}

function skipSpace(src, i) {
  for (;;) {
    while (/\s/.test(src[i])) i++;
    if (src.startsWith("//", i)) {
      while (src[i] !== "\n") i++;
      continue;
    }
    return i;
  }
}

// Parses an operand: literal ("+" literal)*.
function readOperand(src, i) {
  let [v, j] = readLiteral(src, i);
  for (;;) {
    j = skipSpace(src, j);
    if (src[j] !== "+") return [v, j];
    j = skipSpace(src, j + 1);
    let w;
    [w, j] = readLiteral(src, j);
    v += w;
  }
}

// Finds `anchor` in the file and parses the composite literal that follows: entries `{lit, lit, ...}` or bare `lit,`.
function table(file, anchor) {
  const src = readFileSync(root + file, "utf8").split("\r\n").join("\n");
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error("anchor not found: " + anchor);
  let i = src.indexOf("{", at + anchor.length - 1);
  // anchor ends right before "{"
  i = skipSpace(src, i + 1);
  const rows = [];
  while (src[i] !== "}") {
    if (src[i] === "{") {
      i = skipSpace(src, i + 1);
      const row = [];
      while (src[i] !== "}") {
        if (src[i] === "`" || src[i] === '"') {
          let v;
          [v, i] = readOperand(src, i);
          row.push(v);
        } else {
          // an identifier or a bool: skip to the next comma
          while (src[i] !== "," && src[i] !== "}") i++;
        }
        i = skipSpace(src, i);
        if (src[i] === ",") i = skipSpace(src, i + 1);
      }
      i = skipSpace(src, i + 1);
      rows.push(row);
    } else {
      let v;
      [v, i] = readOperand(src, i);
      rows.push([v]);
      i = skipSpace(src, i);
    }
    if (src[i] === ",") i = skipSpace(src, i + 1);
  }
  return rows;
}

const out = {
  html2MdTests: table("test/h2m_test.go", "var html2MdTests = []parseTest{"),
  html2MdLanguageMathRoundTrip: table("test/h2m_test.go", "roundTripTests := []parseTest{"),
  html2MdLanguageMathHTML: table("test/h2m_test.go", "htmlTests := []parseTest{"),
  html2MdDisableSyntaxTests: table("test/h2m_test.go", "var html2MdDisableSyntaxTests = []parseTest{"),
  codeBanner: table("test/h2m_code_banner_test.go", "tests := []struct {\n\t\tname, html, markdown string\n\t}{"),
  codeBannerPreserves: table("test/h2m_code_banner_test.go", "for _, body := range []string{"),
  calloutHTML2Md: table("test/callout_test.go", "tests := []parseTest{"),
  escapedMarkdown: table("test/html_escape_test.go", "for _, test := range []struct{ name, source, expected string }{"),
};
writeFileSync(fileURLToPath(new URL("../../test/e2e/root/h2m_go_cases.json", import.meta.url)), JSON.stringify(out));
for (const [k, v] of Object.entries(out)) console.log(k, v.length, v.every((r) => r.length === v[0].length));

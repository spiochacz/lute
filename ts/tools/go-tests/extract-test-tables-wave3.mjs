// Extracts the table-driven Go tests of test/*_test.go mechanically: every `var X = []parseTest{...}` (rows of three string
// expressions) and every `var X = []string{...}` becomes an entry of ts/test/go/cases/<file>.json: { X: [[name, from, to], ...] } or
// { X: ["...", ...] }. A string expression is Go string literals (interpreted or raw) joined by `+`, or one of the constants
// editor.Caret, editor.Zwsp, editor.WordJoiner, util.Caret. Anything else fails loudly.
// Run from ts/: node tools/go-tests/extract-test-tables-wave3.mjs <go test file name without directory> ...
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const root = new URL("../../../test/", import.meta.url);
const outDir = new URL("../../test/go/cases/", import.meta.url);
const CONSTANTS = { "editor.Caret": "‸", "editor.Zwsp": "​", "editor.WordJoiner": "⁠", "util.Caret": "‸" };

function decodeInterpreted(s) {
  let out = "";
  const bytes = [];
  const flush = () => {
    if (bytes.length > 0) {
      out += Buffer.from(bytes).toString("utf8");
      bytes.length = 0;
    }
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") {
      flush();
      out += c;
      continue;
    }
    const d = s[++i];
    switch (d) {
      case "n": flush(); out += "\n"; break;
      case "t": flush(); out += "\t"; break;
      case "r": flush(); out += "\r"; break;
      case "\\": flush(); out += "\\"; break;
      case "\"": flush(); out += "\""; break;
      case "'": flush(); out += "'"; break;
      case "a": flush(); out += "\x07"; break;
      case "b": flush(); out += "\b"; break;
      case "f": flush(); out += "\f"; break;
      case "v": flush(); out += "\v"; break;
      case "u": flush(); out += String.fromCodePoint(parseInt(s.slice(i + 1, i + 5), 16)); i += 4; break;
      case "U": flush(); out += String.fromCodePoint(parseInt(s.slice(i + 1, i + 9), 16)); i += 8; break;
      case "x": bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; break;
      default: throw new Error("unsupported escape \\" + d);
    }
  }
  flush();
  return out;
}

// End index of the literal or comment starting at i, or -1.
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
  if (c === "'" && (text[i + 1] === "\\" || text[i + 2] === "'")) {
    let j = i + 1;
    while (text[j] !== "'") {
      if (text[j] === "\\") j++;
      j++;
    }
    return j + 1;
  }
  if (c === "/" && text[i + 1] === "/") {
    const j = text.indexOf("\n", i);
    return j < 0 ? text.length : j;
  }
  return -1;
}

function literalBody(src, open) {
  let depth = 0;
  for (let i = open; i < src.length;) {
    const next = skipLiteral(src, i);
    if (next >= 0) { i = next; continue; }
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
    i++;
  }
  throw new Error("unbalanced literal");
}

// Splits at top-level commas (outside literals, comments and brackets); comments are dropped.
function splitTop(body) {
  const parts = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < body.length;) {
    const c = body[i];
    if (c === "/" && body[i + 1] === "/") {
      i = skipLiteral(body, i);
      continue;
    }
    const next = skipLiteral(body, i);
    if (next >= 0) { cur += body.slice(i, next); i = next; continue; }
    if (c === "{" || c === "(") depth++;
    if (c === "}" || c === ")") depth--;
    if (c === "," && depth === 0) { parts.push(cur); cur = ""; i++; continue; }
    cur += c;
    i++;
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts.map((p) => p.trim());
}

function evalExpr(expr) {
  let out = "";
  let i = 0;
  let expectOperand = true;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) { i++; continue; }
    if (!expectOperand) {
      if (c !== "+") throw new Error("expected + in " + expr);
      expectOperand = true;
      i++;
      continue;
    }
    if (c === "\"" || c === "`") {
      const next = skipLiteral(expr, i);
      const inner = expr.slice(i + 1, next - 1);
      out += c === "`" ? inner : decodeInterpreted(inner);
      i = next;
    } else {
      const m = /^[A-Za-z_.]+/.exec(expr.slice(i));
      if (!m || !(m[0] in CONSTANTS)) throw new Error("unsupported expression: " + expr);
      out += CONSTANTS[m[0]];
      i += m[0].length;
    }
    expectOperand = false;
  }
  return out;
}

function elements(body) {
  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length;) {
    const next = skipLiteral(body, i);
    if (next >= 0) { i = next; continue; }
    if (body[i] === "{") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (body[i] === "}") {
      depth--;
      if (depth === 0) out.push(body.slice(start, i));
    }
    i++;
  }
  return out;
}

mkdirSync(outDir, { recursive: true });
for (const file of process.argv.slice(2)) {
  const src = readFileSync(new URL(file, root), "utf8").replace(/\r\n/g, "\n");
  const result = {};
  const re = /^var (\w+) = \[\](parseTest|string)\{/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    const body = literalBody(src, open);
    if (m[2] === "string") {
      result[m[1]] = splitTop(body).map(evalExpr);
    } else {
      result[m[1]] = elements(body).map((el) => {
        const fields = splitTop(el).map(evalExpr);
        if (fields.length !== 3) throw new Error(`${file} ${m[1]}: row with ${fields.length} fields`);
        return fields;
      });
    }
  }
  const outName = file.replace(/\.go$/, ".json");
  writeFileSync(new URL(outName, outDir), JSON.stringify(result, null, 1) + "\n");
  console.log(outName, Object.entries(result).map(([k, v]) => `${k}=${v.length}`).join(" "));
}

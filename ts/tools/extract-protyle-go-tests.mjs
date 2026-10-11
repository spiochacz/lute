// Extracts the table-driven Go tests that exercise the methods of protyle.go mechanically (Go string literals are decoded here)
// into test/e2e/root/protyle_go_cases.json: for each Test function the setter calls, the method called on `test.from` and the table.
// Test functions of another shape are listed under "skipped" with the reason.
// Run from ts/: node tools/extract-protyle-go-tests.mjs
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

// Top-level elements: the string literals and what else the element contains (other).
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
      if (depth === 0) {
        const inner = body.slice(start, i);
        let rest = "";
        for (let j = 0; j < inner.length;) {
          const n2 = skipLiteral(inner, j);
          if (n2 >= 0) {
            j = n2;
            continue;
          }
          rest += inner[j];
          j++;
        }
        out.push({ strings: strings(inner), other: rest.replace(/[\s,]/g, "") });
      }
    }
    i++;
  }
  return out;
}

function parseArg(a) {
  a = a.trim();
  if (a === "true") return true;
  if (a === "false") return false;
  if (/^-?\d+$/.test(a)) return Number(a);
  if (a.startsWith("[]string{")) return strings(a);
  if (a.startsWith("\"") || a.startsWith("`")) return strings(a)[0];
  return { unsupported: a };
}

function splitArgs(s) {
  const out = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < s.length;) {
    const n = skipLiteral(s, i);
    if (n >= 0) {
      cur += s.slice(i, n);
      i = n;
      continue;
    }
    if (s[i] === "{") depth++;
    if (s[i] === "}") depth--;
    if (s[i] === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += s[i];
    i++;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

const FILES = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [
  "spin_block", "p2p", "h2p", "p2h", "block_type_conversion", "recursive_list_conversion", "list_item_nested", "custom_block", "flashcard_occlusion",
  "file_annotation_ref", "image_title_data_attribute", "span_ial_entity", "super_block", "block_ref", "tag_protyle_punctuation", "protyle_media_controls",
  "protyle_merged_table_backslash", "protyle_mindmap_code", "protyle_placeholder", "mindmap_block", "html_block", "data_task", "callout_backtick", "callout_icon",
  "link_base_prefix", "table_alignment_style", "table_body", "table_rich", "tabs_export", "tabs_task", "tabs", "tabs_title_block", "tabs_whitespace",
  "text_mark_delimiters", "text_mark_escape_roundtrip", "strikethrough", "html_text_style", "wps_text_style", "vditor_callout", "h2m_code_banner",
];

const result = { tests: [], skipped: [] };
for (const f of FILES) {
  const src = readFileSync(new URL(f + "_test.go", root), "utf8").replace(/\r/g, "");
  const funcs = [...src.matchAll(/^func (Test\w+)\(t \*testing\.T\) \{\n([\s\S]*?)\n\}\n/gm)];
  for (const m of funcs) {
    const name = m[1];
    const body = m[2];
    const rangeM = body.match(/for _, (\w+) := range (\w+|\[\]\*?parseTest\{)/);
    const callM = rangeM && body.match(new RegExp("\\b(?:luteEngine|engine)\\.(\\w+)\\(" + rangeM[1] + "\\.from((?:, [^)]*)?)\\)"));
    if (!rangeM || !callM) {
      result.skipped.push({ file: f, test: name, reason: !rangeM ? "no table loop" : "no call on test.from" });
      continue;
    }
    let tableBody = null;
    if (rangeM[2].startsWith("[]")) {
      const at = body.indexOf(rangeM[2]);
      tableBody = literalBody(body, at + rangeM[2].length - 1);
    } else {
      const at = src.search(new RegExp("var " + rangeM[2] + " = \\[\\]\\*?\\w+\\{"));
      if (at >= 0) {
        tableBody = literalBody(src, src.indexOf("{", src.indexOf("= []", at) + 4));
      } else {
        const lm = body.match(new RegExp(rangeM[2] + " :?= \\[\\]\\*?\\w+\\{"));
        if (lm) tableBody = literalBody(body, body.indexOf("{", lm.index + lm[0].length - 1));
      }
    }
    if (tableBody === null) {
      result.skipped.push({ file: f, test: name, reason: "table not found: " + rangeM[2] });
      continue;
    }
    const els = elements(tableBody);
    const bad = els.filter((e) => e.other !== "" || e.strings.length !== 3);
    const setters = [];
    const unsupported = [];
    const pre = body.slice(0, body.indexOf(rangeM[0]));
    for (const line of pre.split("\n")) {
      const t = line.trim();
      let mm;
      if ((mm = t.match(/^(?:luteEngine|engine)\.(Set\w+)\((.*)\)$/))) {
        setters.push({ call: mm[1], args: splitArgs(mm[2]).map(parseArg) });
      } else if ((mm = t.match(/^(?:luteEngine|engine)\.(ParseOptions|RenderOptions)\.(\w+) = (.*)$/))) {
        setters.push({ field: mm[1], name: mm[2], value: parseArg(mm[3]) });
      } else if (/^ast\.Testing = true$/.test(t) || /^ast\.SetTesting\(true\)$/.test(t)) {
        setters.push({ testing: true });
      } else if (/^(luteEngine|engine) := lute\.New\(\)$/.test(t) || t === "" || t.startsWith("//") || /^ast\.(Testing|SetTesting)/.test(t)) {
        // fine
      } else {
        unsupported.push(t);
      }
    }
    const extra = callM[2] ? splitArgs(callM[2].slice(1)).map(parseArg) : [];
    result.tests.push({
      file: f, test: name, method: callM[1], extra, setters, unsupported,
      cases: els.filter((e) => e.other === "" && e.strings.length === 3).map((e) => e.strings),
      badRows: bad.length,
    });
  }
}
writeFileSync(new URL("../test/e2e/root/protyle_go_cases.json", import.meta.url), JSON.stringify(result));
for (const t of result.tests) console.log(t.file, t.test, t.method, JSON.stringify(t.extra), "cases", t.cases.length, "bad", t.badRows, t.unsupported.length ? "UNSUPPORTED " + JSON.stringify(t.unsupported) : "");
console.log("skipped:\n  " + result.skipped.map((s) => s.file + "." + s.test + " (" + s.reason + ")").join("\n  "));

// All string literals of the Go test files (inputs and expected values of the tests that are not table-driven), for the literal harvest test.
const literals = new Set();
for (const f of FILES) {
  const src = readFileSync(new URL(f + "_test.go", root), "utf8").replace(/\r/g, "");
  for (const s of strings(src)) {
    if (s.length >= 2 && s.length < 6000 && !/^(test case|expected|got|original)/.test(s)) literals.add(s);
  }
}
writeFileSync(new URL("../test/e2e/root/protyle_go_literals.json", import.meta.url), JSON.stringify([...literals]));
console.log("literals", literals.size);

// Extracts the string-literal tables of the Go test files of wave A (autolink ... html_text_style) into
// ts/test/go/cases/<go file>.json, so that no case is transcribed by hand.
// Usage (from ts/): node tools/go-tests/extract-wave-a.mjs
// A table is {anchor in the Go source -> rows}. A row is a Go composite literal {a, b, c}; a field is an
// interpreted or raw string literal (joined with +), an optional `key:` prefix is ignored, `[]string{...}` becomes an
// array, any other token (true, 1, nil) is kept as its source text.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function readLiteral(src, i) {
  if (src[i] === "`") {
    const end = src.indexOf("`", i + 1);
    return [src.slice(i + 1, end).replace(/\r/g, ""), end + 1];
  }
  if (src[i] !== '"') throw new Error("not a string literal at " + i + ": " + src.slice(i, i + 40));
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
    if (src.startsWith("/*", i)) {
      i = src.indexOf("*/", i) + 2;
      continue;
    }
    return i;
  }
}

// Operand terms are string literals or names of `const name = "..."` declarations of the same Go file.
function readTerm(src, i) {
  const id = /^[A-Za-z_]\w*/.exec(src.slice(i, i + 64));
  if (id) {
    const m = new RegExp("const " + id[0] + " = ").exec(src);
    if (!m) throw new Error("unknown constant " + id[0]);
    const [v] = readLiteral(src, m.index + m[0].length);
    return [v, i + id[0].length];
  }
  return readLiteral(src, i);
}

function readOperand(src, i) {
  let [v, j] = readTerm(src, i);
  for (;;) {
    j = skipSpace(src, j);
    if (src[j] !== "+") return [v, j];
    j = skipSpace(src, j + 1);
    let w;
    [w, j] = readTerm(src, j);
    v += w;
  }
}

function readField(src, i) {
  const key = /^[A-Za-z_]\w*\s*:(?!=)/.exec(src.slice(i, i + 64));
  if (key) i = skipSpace(src, i + key[0].length);
  if (src[i] === "`" || src[i] === '"') return readOperand(src, i);
  if (src.startsWith("[]string{", i)) {
    i = skipSpace(src, i + "[]string{".length);
    const list = [];
    while (src[i] !== "}") {
      let v;
      [v, i] = readOperand(src, i);
      list.push(v);
      i = skipSpace(src, i);
      if (src[i] === ",") i = skipSpace(src, i + 1);
    }
    return [list, i + 1];
  }
  const start = i;
  while (src[i] !== "," && src[i] !== "}") i++;
  return [src.slice(start, i).trim(), i];
}

function load(file) {
  return readFileSync(root + "test/" + file, "utf8").split("\r\n").join("\n");
}

function table(file, anchor) {
  const src = load(file);
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error("anchor not found: " + anchor);
  let i = src.indexOf("{", at + anchor.length - 1);
  i = skipSpace(src, i + 1);
  const rows = [];
  while (src[i] !== "}") {
    if (src[i] !== "{") throw new Error("row expected in " + file + " at " + src.slice(i, i + 40));
    i = skipSpace(src, i + 1);
    const row = [];
    while (src[i] !== "}") {
      let v;
      [v, i] = readField(src, i);
      row.push(v);
      i = skipSpace(src, i);
      if (src[i] === ",") i = skipSpace(src, i + 1);
    }
    i = skipSpace(src, i + 1);
    rows.push(row);
    if (src[i] === ",") i = skipSpace(src, i + 1);
  }
  return rows;
}

// "for _, body := range []string{" holds bare literals: they become one-field rows.
function bareList(file, anchor) {
  const src = load(file);
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error("anchor not found: " + anchor);
  let i = skipSpace(src, at + anchor.length);
  const rows = [];
  while (src[i] !== "}") {
    let v;
    [v, i] = readOperand(src, i);
    rows.push([v]);
    i = skipSpace(src, i);
    if (src[i] === ",") i = skipSpace(src, i + 1);
  }
  return rows;
}

// A single string literal: the first `anchor` after the first `after`; the literal follows the anchor.
function single(file, after, anchor) {
  const src = load(file);
  const a = src.indexOf(after);
  if (a < 0) throw new Error("after not found: " + after);
  const at = src.indexOf(anchor, a);
  if (at < 0) throw new Error("anchor not found: " + anchor);
  return readOperand(src, at + anchor.length)[0];
}

const singles = {
  "h2p_test.go": {
    tableCaptionFrom: ["func TestHTML2BlockDOMTableCaption", "from := "],
    tableCaptionExpected: ["func TestHTML2BlockDOMTableCaption", "expected := "],
  },
  "html_block_test.go": {
    blockDOM: ["func TestHTMLBlockDataContentRoundTrip", "blockDOM := "],
    content: ["func TestHTMLBlockDataContentRoundTrip", "const content = "],
  },
  "flashcard_occlusion_test.go": {
    blockDOM: ["func TestFlashcardOcclusionIDRoundTrip", "blockDOM := "],
  },
  "h2v_test.go": {
    tocFrom: ["func TestHTML2VditorDOMToC", "from := "],
    tocExpected: ["func TestHTML2VditorDOMToC", "expected := "],
  },
};

const P = (name) => `var ${name} = []parseTest{`;
const specs = {
  "autolink_test.go": { autoLinkTests: P("autoLinkTests") },
  "block_query_embed_test.go": { blockQueryEmbedTests: P("blockQueryEmbedTests") },
  "block_ref_test.go": { blockRefTests: P("blockRefTests") },
  "chinese_paragraph_beginning_space_test.go": { chineseParagraphBeginningSpaceTests: P("chineseParagraphBeginningSpaceTests") },
  "callout_test.go": { calloutTests: P("calloutTests"), html2MdCalloutTests: "tests := []parseTest{" },
  "callout_icon_test.go": {
    imageIconParse: "tests := []struct {\n\t\tname  string\n\t\ticon  string\n\t\ttitle string\n\t}{",
    imageIconNotConsumed: "tests := []struct {\n\t\tname  string\n\t\ttitle string\n\t}{",
  },
  "callout_backtick_test.go": { backtick: "range []struct{ title, want string }{" },
  "data_task_test.go": {
    dataTaskHTMLTests: P("dataTaskHTMLTests"),
    dataTaskDisabledHTMLTests: P("dataTaskDisabledHTMLTests"),
    dataTaskMd2BlockDOMTests: P("dataTaskMd2BlockDOMTests"),
    dataTaskNoClassHTMLTests: P("dataTaskNoClassHTMLTests"),
    dataTaskCustomMarkerTests: P("dataTaskCustomMarkerTests"),
  },
  "code_block_html_renderjs_test.go": { jsCodeBlockTests: P("jsCodeBlockTests") },
  "code_syntax_highlight_test.go": {
    codeSyntaxHighlightDetectLang1Tests: P("codeSyntaxHighlightDetectLang1Tests"),
    codeSyntaxHighlightOffTests: P("codeSyntaxHighlightOffTests"),
  },
  "dataimage_test.go": { dataImageTests: P("dataImageTests") },
  "debug_test.go": { debugTests: P("debugTests") },
  "disable_indent_code_block_test.go": { disableIndentCodeBlockTests: P("disableIndentCodeBlockTests") },
  "emoji_test.go": { emojiTests: P("emojiTests") },
  "file_annotation_ref_test.go": { fileAnnotationRefTests: P("fileAnnotationRefTests") },
  "footnotes_test.go": { fnTests: P("fnTests"), labelScenarios: "range []struct{ source, paragraph string }{" },
  "gfm_spec_test.go": { gfmSpecTests: P("gfmSpecTests") },
  "gitconflict_test.go": { gitConflictTests: P("gitConflictTests") },
  "h2m_code_banner_test.go": {
    banner: "tests := []struct {\n\t\tname, html, markdown string\n\t}{",
    preserves: "for _, body := range []string{",
  },
  "h2p_test.go": { html2BlockDOMTests: P("html2BlockDOMTests") },
  "h2v_test.go": { html2VditorDOMTests: P("html2VditorDOMTests") },
  "headingid_test.go": {
    headingIDTests: P("headingIDTests"),
    headingIDRaw: "tests := []struct {\n\t\tmarkdown string\n\t\texpected string\n\t}{",
    headingAnchorTests: P("headingAnchorTests"),
    headingIDDisableTests: P("headingIDDisableTests"),
  },
  "html_block_test.go": { openTag: "tests := []struct {\n\t\tname     string\n\t\tmarkdown string\n\t\thtml     string\n\t}{" },
  "flashcard_occlusion_test.go": {},
  "html_entity_test.go": { htmlEntityTests: P("htmlEntityTests") },
  "html_text_style_test.go": {
    textStyle: "range []struct {\n\t\tname, input string\n\t\texpected    []string\n\t}{",
  },
};

for (const [file, tables] of Object.entries(specs)) {
  const out = {};
  for (const [key, anchor] of Object.entries(tables)) {
    out[key] = anchor.endsWith("range []string{") ? bareList(file, anchor) : table(file, anchor);
  }
  for (const [key, [after, anchor]] of Object.entries(singles[file] ?? {})) out[key] = [[single(file, after, anchor)]];
  writeFileSync(fileURLToPath(new URL("../../test/go/cases/" + file.replace(/\.go$/, ".json"), import.meta.url)), JSON.stringify(out));
  console.log(file, Object.entries(out).map(([k, v]) => `${k}=${v.length}`).join(" "));
}

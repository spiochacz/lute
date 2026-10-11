package main

// Parse vectors: the real Go tree construction (html/parse.go, with html/render.go,
// html/doctype.go and html/foreign.go) run on a fixed corpus. The TypeScript port in
// ts/src/html/ is asserted against the file written by "go run . parse".
//
// For each document there is:
//   parse:    Parse(input). The tree is the list [document node].
//   frag:     ParseFragment(input, context) for each context of parseContexts. Documents up to
//             parseFullLimit bytes get all contexts; larger documents get body and div only.
//   noscript: ParseWithOptions(input, ParseOptionEnableScripting(false)), for documents whose
//             lower-cased text contains "noscript".
// Each run records the canonical dump of its node list, the rendered bytes of the nodes
// (Render of each node, concatenated) and the error text (or null). Render errors are recorded
// in renderErr. Documents up to parseFullLimit bytes record the tree (nested arrays, see
// README.md) and the rendered string in full; larger documents record the SHA-256 and the
// length of the canonical dump and of the rendered bytes.
//
// Invalid UTF-8 cannot be represented in a JSON string, and the TypeScript port works on
// JS strings. Every string that Go puts in a dump or in the rendered output is therefore
// passed through lossy() first (one U+FFFD per invalid byte, the rule of conv.StringFromBytes),
// so the stored values are the lossy Go output. Inputs that are not valid UTF-8 are stored
// as {"hex": "..."} with the raw bytes.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/88250/lute/html"
	a "github.com/88250/lute/html/atom"
)

// parseFullLimit is the input size in bytes up to which a document is stored in full.
const parseFullLimit = 2048

// parseResult is the record of one run (Parse or one ParseFragment). See asRecord for the
// stored form.
type parseResult struct {
	Full      bool
	Tree      any    // full mode: nested node arrays (README.md); nil in hash mode
	TreeSha   string // hash mode: SHA-256 hex of the canonical dump
	TreeLen   int    // byte length of the canonical dump
	Render    string // full mode: the rendered bytes
	RenderSha string // hash mode: SHA-256 hex of the rendered bytes
	RenderLen int    // byte length of the rendered bytes
	RenderErr any    // error text of Render, or nil
	Err       any    // error text of the parse, or nil
	Panic     any    // text of a Go panic, or nil
}

// parseDocOut is one document of the parse vectors. Parse, Frag and NoScript are indexes
// into the record table (parseFile.Records). Frag has one entry per context of
// parseFile.Contexts; the entry is null when that context is not run for the document.
type parseDocOut struct {
	Name     string `json:"name"`
	Valid    bool   `json:"valid"`
	Input    any    `json:"input"`
	Mode     string `json:"mode"` // "full" or "hash"
	Parse    int    `json:"parse"`
	Frag     []any  `json:"frag"`
	NoScript *int   `json:"noscript"`
}

// parseFile is the whole parse vectors file.
type parseFile struct {
	GoVersion string        `json:"goVersion"`
	Corpus    int           `json:"corpus"`
	Contexts  []string      `json:"contexts"`
	Records   []any         `json:"records"`
	Docs      []parseDocOut `json:"docs"`
}

// parseContext is one context element of the fragment runs.
type parseContext struct {
	name string
	atom a.Atom
	ns   string
}

// parseContexts are the context elements of the fragment runs.
var parseContexts = []parseContext{
	{"body", a.Body, ""},
	{"div", a.Div, ""},
	{"p", a.P, ""},
	{"table", a.Table, ""},
	{"tbody", a.Tbody, ""},
	{"tr", a.Tr, ""},
	{"td", a.Td, ""},
	{"select", a.Select, ""},
	{"ul", a.Ul, ""},
	{"script", a.Script, ""},
	{"textarea", a.Textarea, ""},
	{"title", a.Title, ""},
	{"svg", a.Svg, "svg"},
	{"math", a.Math, "math"},
	{"template", a.Template, ""},
	{"html", a.Html, ""},
	{"head", a.Head, ""},
	{"frameset", a.Frameset, ""},
}

// lossy returns s with each invalid byte replaced by U+FFFD, as conv.StringFromBytes does.
// A range loop over a string yields RuneError with width 1 for each invalid byte.
func lossy(s string) string {
	if utf8.ValidString(s) {
		return s
	}
	var b strings.Builder
	for _, r := range s {
		b.WriteRune(r)
	}
	return b.String()
}

// lossyBytes is lossy on bytes.
func lossyBytes(p []byte) []byte {
	return []byte(lossy(string(p)))
}

// canonStr writes s, a valid UTF-8 string, as a JSON string. Only '"', '\' and the control
// characters below 0x20 are escaped; a control character is written as \u00xx in lowercase hex.
func canonStr(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch {
		case r == '"':
			b.WriteString(`\"`)
		case r == '\\':
			b.WriteString(`\\`)
		case r < 0x20:
			fmt.Fprintf(b, `\u%04x`, r)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
}

// canonNode writes the canonical dump of n (see README.md).
func canonNode(b *strings.Builder, n *html.Node) {
	b.WriteString(`{"t":`)
	b.WriteString(strconv.Itoa(int(n.Type)))
	b.WriteString(`,"d":`)
	canonStr(b, lossy(n.Data))
	b.WriteString(`,"a":`)
	b.WriteString(strconv.Itoa(int(n.DataAtom)))
	b.WriteString(`,"n":`)
	canonStr(b, lossy(n.Namespace))
	b.WriteString(`,"at":[`)
	for i, at := range n.Attr {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteByte('[')
		canonStr(b, lossy(at.Namespace))
		b.WriteByte(',')
		canonStr(b, lossy(at.Key))
		b.WriteByte(',')
		canonStr(b, lossy(at.Val))
		b.WriteByte(']')
	}
	b.WriteString(`],"c":[`)
	first := true
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if !first {
			b.WriteByte(',')
		}
		first = false
		canonNode(b, c)
	}
	b.WriteString("]}")
}

// canonList writes the canonical dump of a node list.
func canonList(nodes []*html.Node) string {
	var b strings.Builder
	b.WriteByte('[')
	for i, n := range nodes {
		if i > 0 {
			b.WriteByte(',')
		}
		canonNode(&b, n)
	}
	b.WriteByte(']')
	return b.String()
}

// nodeVal returns the nested-array form of n: [type, data, dataAtom, namespace, [[ns, key, val]...], [children...]].
func nodeVal(n *html.Node) []any {
	attrs := [][]any{}
	for _, at := range n.Attr {
		attrs = append(attrs, []any{lossy(at.Namespace), lossy(at.Key), lossy(at.Val)})
	}
	children := []any{}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		children = append(children, nodeVal(c))
	}
	return []any{int(n.Type), lossy(n.Data), int(n.DataAtom), lossy(n.Namespace), attrs, children}
}

// sha256Hex returns the SHA-256 of s in lowercase hex.
func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// renderNodes renders the nodes in order into one buffer. It stops at the first error and
// returns the bytes written so far and the error text (nil if none).
func renderNodes(nodes []*html.Node) ([]byte, any) {
	var buf bytes.Buffer
	for _, n := range nodes {
		if err := html.Render(&buf, n); err != nil {
			return buf.Bytes(), err.Error()
		}
	}
	return buf.Bytes(), nil
}

// resultOf builds the record of one run from its node list and errors.
func resultOf(nodes []*html.Node, perr error, full bool) parseResult {
	var r parseResult
	r.Full = full
	if perr != nil {
		r.Err = perr.Error()
	}
	treeStr := canonList(nodes)
	r.TreeLen = len(treeStr)
	if full {
		vals := []any{}
		for _, n := range nodes {
			vals = append(vals, nodeVal(n))
		}
		r.Tree = vals
	} else {
		r.TreeSha = sha256Hex(treeStr)
	}

	rb, rerr := renderNodes(nodes)
	rb = lossyBytes(rb)
	r.RenderLen = len(rb)
	if full {
		r.Render = string(rb)
	} else {
		r.RenderSha = sha256Hex(string(rb))
	}
	r.RenderErr = rerr
	return r
}

// asRecord returns the stored form of a run (see README.md): ["f", tree, render] in full mode,
// ["h", treeSha, treeLen, renderSha, renderLen] in hash mode, and ["p", panic] for a Go panic.
// When Err or RenderErr is not null, both are appended to the record.
func (r parseResult) asRecord() []any {
	if r.Panic != nil {
		return []any{"p", r.Panic}
	}
	var rec []any
	if r.Full {
		rec = []any{"f", r.Tree, r.Render}
	} else {
		rec = []any{"h", r.TreeSha, r.TreeLen, r.RenderSha, r.RenderLen}
	}
	if r.Err != nil || r.RenderErr != nil {
		rec = append(rec, r.Err, r.RenderErr)
	}
	return rec
}

// runGuarded runs one parse and returns its record. A Go panic in the parser is recorded in
// Panic (Go itself panics on some inputs, for example inFramesetIM on an empty stack), so the
// TypeScript port must throw for the same input.
func runGuarded(full bool, run func() ([]*html.Node, error)) (r parseResult) {
	defer func() {
		if e := recover(); e != nil {
			r = parseResult{Panic: fmt.Sprint(e)}
		}
	}()
	nodes, perr := run()
	return resultOf(nodes, perr, full)
}

// recordTable is the table of the distinct run records of the file.
type recordTable struct {
	recs  []any
	index map[string]int
}

// add returns the index of rec in the table, adding rec when it is new.
func (t *recordTable) add(rec []any) int {
	key, err := json.Marshal(rec)
	if err != nil {
		panic(err)
	}
	if i, ok := t.index[string(key)]; ok {
		return i
	}
	t.recs = append(t.recs, rec)
	t.index[string(key)] = len(t.recs) - 1
	return len(t.recs) - 1
}

// parseDoc runs the parser on one document and returns its record. Documents up to
// parseFullLimit bytes run all contexts in full mode; larger documents run body and div in
// hash mode.
func parseDoc(name string, input []byte, t *recordTable) parseDocOut {
	full := len(input) <= parseFullLimit
	d := parseDocOut{Name: name, Valid: utf8.Valid(input), Frag: make([]any, len(parseContexts))}
	if d.Valid {
		d.Input = string(input)
	} else {
		d.Input = map[string]string{"hex": hex.EncodeToString(input)}
	}
	d.Mode = "hash"
	if full {
		d.Mode = "full"
	}

	d.Parse = t.add(runGuarded(full, func() ([]*html.Node, error) {
		doc, perr := html.Parse(bytes.NewReader(input))
		var nodes []*html.Node
		if doc != nil {
			nodes = []*html.Node{doc}
		}
		return nodes, perr
	}).asRecord())

	for i, pc := range parseContexts {
		if !full && pc.name != "body" && pc.name != "div" {
			continue
		}
		ctx := &html.Node{Type: html.ElementNode, DataAtom: pc.atom, Data: pc.name, Namespace: pc.ns}
		d.Frag[i] = t.add(runGuarded(full, func() ([]*html.Node, error) {
			return html.ParseFragment(bytes.NewReader(input), ctx)
		}).asRecord())
	}

	if strings.Contains(strings.ToLower(string(input)), "noscript") {
		idx := t.add(runGuarded(full, func() ([]*html.Node, error) {
			sdoc, serr := html.ParseWithOptions(bytes.NewReader(input), html.ParseOptionEnableScripting(false))
			var snodes []*html.Node
			if sdoc != nil {
				snodes = []*html.Node{sdoc}
			}
			return snodes, serr
		}).asRecord())
		d.NoScript = &idx
	}
	return d
}

// parseTreeCases are hand-written tree-construction documents, grouped by the topics the
// tree-construction algorithm needs. Some documents are invalid UTF-8 on purpose.
var parseTreeCases = []string{
	// Missing html, head and body.
	"<p>x</p>", "x", "<title>t</title>", "<meta charset=utf-8><p>x", "<link rel=stylesheet><div>x</div>",
	"<head>", "<body>", "</body>", "</html>", "<html>", "<head><body>", "<frameset>", "<noframes>x</noframes>",
	"<style>p{}</style>", "<script>x</script>", "<base href=/>", "<body class=a><p>x", "text only",
	"<!DOCTYPE html>text", "<body></html>x", "</head><p>x", "</p>x", "<html></body></html>",
	// Text before <html>, and whitespace before the elements.
	"hello<html><body>x", "text<html lang=en><head><title>a</title></head><body>b</body></html>",
	"<!--c-->text<html>", "  \n <html>", "a<html>b<body>c", "  <!-- x --> \n <head>", "\n\n<p>x",
	// Implicit end tags.
	"<p>a<p>b", "<p>a<div>b</div>", "<li>a<li>b<li>c", "<ul><li>a<li>b</ul>", "<dl><dd>a<dt>b<dd>c</dl>",
	"<dd>a<dt>b", "<option>a<option>b", "<select><option>a<option>b</select>",
	"<select><optgroup><option>a<optgroup><option>b</select>", "<p><p>", "<h1>a<h2>b", "<h1><h2>x</h2></h1>",
	"<table><p>x</table>", "<p>a<hr>b", "<ruby>a<rb>b<rt>c</ruby>", "<ruby>a<rp>(</rp><rt>x</rt><rp>)</rp></ruby>",
	"<ruby><rtc>x</ruby>", "<li>x</li></li>", "<p>x</p></p>", "<dd>x</dl>", "<option>x</select>", "<li><div>a<li>b</div>",
	"<p><button>a<p>b</button>", "<p><ul><li>a</ul>b", "<p><li>x", "<p><dd>x", "<p><table></table>y",
	// Misnested formatting elements and the adoption agency.
	"<b><i>x</b>y</i>", "<a><a>", "<a>1<a>2</a>3", "<b><p>x</b>y", "<b>1<p>2</b>3</p>", "<nobr>a<nobr>b",
	"<nobr>a</nobr>b", "<b>a<table><b>c</b></table>d</b>", "<font color=red>a<p>b</font>c",
	"<a href=x><div>a</a>b</div>", "<b><i><u><s>x</b>y</i>z</u>w</s>", "<a>1<b>2<a>3</b>4</a>",
	"<b><b><b><b>x</b></b>y", "<i>a<i>b<i>c<i>d</i>e</i>f</i>g</i>", "<p><b>x<p>y</b>z",
	"<b><table><td><b>x</b></td></table>y</b>", "<a><table><a>x</a></table></a>", "<em><p>a</em>b</p>",
	"<strike>a<div>b</strike>c</div>", "<big><small>x</big>y</small>", "<tt>a<pre>b</tt>c</pre>",
	"<code>x<ul><li>y</code>z</ul>", "<s><object>x</s>y</object>", "<a><marquee><a>x</a></marquee></a>",
	"<a><object><a>x</a></object></a>", "<b><applet><b>x</b></applet></b>", "<span><b>x</span></b>",
	"<u>a</b>b</u>", "<b></b></b>x", "</a>x", "<a>x</a></a>",
	// Tables: foster parenting, missing tbody and tr, captions and column groups.
	"<table>text</table>", "<table><b>x</b></table>", "<table><tr><td>a</td></tr></table>",
	"<table><tr>a<td>b</td></tr></table>", "<table><tr><td>1</td></tr><tr><td>2</td></tr></table>",
	"<table><td>x</td></table>", "<table><tr><td>x</table>", "<tr><td>x</td></tr>", "<td>x</td>", "<th>x</th>",
	"<caption>c</caption><tr><td>x</td></tr>", "<table><caption>c<tr><td>x</caption></table>",
	"<table><colgroup><col span=2><col></colgroup><tr><td>x</td></tr></table>", "<table><col><col>",
	"<colgroup><col></colgroup>x", "<table><form><input type=hidden name=a></form></table>",
	"<table><input type=text></table>", "<table><input type=hidden><p>x</table>",
	"<table><table><tr><td>a</td></tr></table></table>x",
	"<table><tr><td><table><tr><td>n</td></tr></table>m</td></tr></table>",
	"<table> \n <tr> \n <td>x</td> \n </tr> \n </table>", "<table>\t<tbody>\n</tbody></table>",
	"<table><tbody><tr><td>x</td></tbody></table>",
	"<table><thead><tr><th>h</th></thead><tbody><tr><td>b</td></tbody><tfoot><tr><td>f</td></tr></tfoot></table>",
	"<table><select><option>a</select></table>", "<table><tr><select><option>x</select></tr></table>",
	"<table><tr><td><select><option>a</option></select></td></tr></table>", "<table><a href=x>link</a></table>",
	"<table><b>bold</b> text<tr><td>x</td></tr></table>", "<table><tr><td>a</td>text</tr></table>",
	"<p><table><a>x</a></table>", "<p><table><p>x</table>", "<table>&amp;</table>", "<table>x\x00y</table>",
	"<table><tr><td>a</td></tr>  </table>", "<table><style>td{}</style><tr><td>x</td></tr></table>",
	"<table><script>x</script></table>", "<table><template><td>x</td></template></table>",
	"<table><tr><td>a</td><!--c--></tr></table>", "<table><tr><td>a</td></tr><form></form></table>",
	"<table><frameset></frameset></table>", "<table><image></table>", "<table><tr><td>a</td></tr>x</table>y",
	"<table> <tr> <td>x</td> </tr> </table>", "<table>\n\t<tbody>\r\n<tr><td>x</td></tr>\f</tbody></table>",
	"<table>  </table>", "<table> a </table>", "<table><tr> <td>a</td></tr> </table>", "<table> <caption> </caption></table>",
	"<table><caption></caption><colgroup></colgroup><thead></thead><tbody></tbody><tfoot></tfoot></table>",
	"<table><tr><th>a<th>b<tr><td>c<td>d</table>", "<table><tr><td>a<tr><td>b</td></table>",
	"<table><tbody><tr><td>x</td></tr></tbody><tr><td>y</td></tr></table>", "<table><col></colgroup></table>",
	"<table><caption><table><tr><td>x</td></tr></table></caption></table>", "<table><tr></tr>x</table>",
	"<table><td><td>x</table>", "<table><tr><tr>x</table>", "<tbody><td>x</td></tbody>", "<table><tr><td>a</td></tr></tbody></table>",
	"<table><thead><tr><td>a</td></thead></table>", "<table><input type=HIDDEN name=x></table>",
	"<table><input type=hidden><input type=hidden></table>", "<table><form><form></form></table>",
	"<table><div>x</div><span>y</span></table>", "<table><hr>x</table>", "<table><br></table>",
	"<table><textarea>x</textarea></table>", "<table><iframe>x</iframe></table>", "<table><svg><g></g></svg></table>",
	"<table><math><mi>x</mi></math></table>", "<table><noscript>n</noscript></table>", "<table><title>t</title></table>",
	// select, optgroup, option.
	"<select><option>a<option>b</select>", "<select><select>x</select>", "<select><input>x</select>",
	"<select><textarea>x</textarea></select>", "<select><script>x</script></select>", "<select><hr>x</select>",
	"<select><optgroup label=a><option>x</optgroup></select>", "<select>x<option>y", "<select><div>x</div></select>",
	"<select><option><b>x</b></option></select>", "<select><template><option>t</option></template></select>",
	"<select><option>a</select>b", "<select><keygen>k</select>", "<select><optgroup><optgroup>x</select>",
	"<select><option>a</optgroup>b</option></select>", "<select><input type=hidden>x</select>",
	"<select><img src=x>y</select>", "<select><svg><path></path></svg></select>", "<select></option></select>",
	"<select><option>a<select>b</select>c</select>", "<select><optgroup><option>x</select></optgroup>",
	"<select>\n<option>a</option>\n</select>", "<select><option><select>x</select></option></select>",
	"<select><table><tr><td>x</td></tr></table></select>", "<select><frameset></frameset></select>",
	// template in several positions.
	"<template>x</template>", "<template><td>x</td></template>", "<template><tr><td>x</td></tr></template>",
	"<template><col></template>", "<template><caption>c</caption></template>", "<template><div>a</template>b",
	"<template><template><p>x</template></template>", "<table><template><tr><td>x</td></tr></template></table>",
	"<head><template><title>t</title></template></head>", "<template></span>", "<template>a<b></template>",
	"<template><option>o</option></template>", "<template></template></template>", "<template><frameset></template>",
	"<template><html>x</template>", "<template><body>x</body></template>", "</template>",
	"<template><p>a</p><p>b</p>", "<template><table></table>x</template>", "<template><tr>x</template>",
	"<template><col><col>x</template>", "<template><th>a<th>b</template>", "<template><select><option>x</template>",
	"<template><a><a>x</template>", "<template><b>x</template>y", "<template>\x00</template>", "<body><template>x</template>",
	"<template><head>x</head></template>", "<template><noscript>x</noscript></template>",
	"<template><script>x</script></template>", "<template><style>x</style></template>",
	"<template><table><table>x</table></table></template>", "<template><tbody>x</template><tr>y",
	"<p><template><p>x</p></template></p>", "<template><textarea>x</textarea></template>",
	"<template><plaintext>x</template>y", "<template><svg><circle/></svg></template>",
	"<template><math><mi>x</mi></math></template>", "<template><isindex></template>",
	"<template><caption>c</caption><tr><td>x</td></template>", "<template><form><input></form></template>",
	// frameset, frame and noframes.
	"<frameset><frame src=a><frame src=b></frameset>", "<frameset><frame><noframes>x</noframes></frameset>",
	"<body><frameset></frameset>", "<html><frameset>x</frameset>", "<frameset cols=1><frame></frameset><noframes>x</noframes>",
	"<html><head></head><frameset></frameset></html>", "<frame>x", "<noframes>x</noframes><p>y",
	"<frameset>a<frame>b</frameset>c", "<body>x<frameset>y", "<frameset></frameset><frameset></frameset>",
	"<frameset></frameset></html>x", "<frameset>\n <frame>\t<frame>\r\n</frameset>", "<frameset><p>x</p></frameset>",
	"<frameset><frame></frameset><frame>", "<frameset><noframes><p>x</p></noframes></frameset>", "<body><p>a</p><frameset>x",
	"<frameset><div>x</div><frame></frameset>", "<frameset></frameset>x<p>y", "<html><frameset></frameset><body>x</body></html>",
	// noscript in head and body.
	"<noscript><p>x</p></noscript>", "<head><noscript><link rel=x></noscript></head>",
	"<head><noscript><meta charset=a></noscript><title>t</title></head>", "<head><noscript><p>x</head>",
	"<head><noscript></noscript></head>", "<noscript>a</noscript>", "<body><noscript><img src=x></noscript>",
	"<noscript><script>a</script></noscript>", "<head><noscript>text</noscript></head>",
	"<noscript><noscript>x</noscript></noscript>", "<head><noscript><title>x</title></noscript></head>",
	"<body><noscript><table><tr><td>x</td></tr></table></noscript>", "<head><noscript><html>x</noscript></head>",
	"<head><noscript><body>b</noscript></head>", "<noscript><b>x</b>", "<head><noscript><head></noscript></head>",
	"<head><noscript><style>p{}</style></noscript></head>", "<head><noscript>  </noscript>x", "<noscript><frameset></frameset></noscript>",
	"<head><noscript><noframes>x</noframes></noscript></head>", "<head><noscript><base href=x></noscript></head>",
	"<body><p>a<noscript>b</noscript>c</p>", "<head><noscript><!--c--></noscript></head>",
	// svg and math with foreign attributes, tag-name adjustments and breakout tags.
	"<svg><circle r=1/></svg>", "<svg viewBox='0 0 1 1' preserveAspectRatio=x xlink:href=y><g></g></svg>",
	"<svg><foreignObject><div>x</div></foreignObject></svg>", "<svg><desc><p>x</p></desc></svg>",
	"<svg><title><b>x</b></title></svg>", "<svg><clipPath id=c></clipPath></svg>",
	"<svg><linearGradient></linearGradient></svg>", "<svg><textpath>x</textpath></svg>",
	"<svg><font color=red>x</font></svg>", "<svg><b>x</b></svg>", "<svg><p>x<div>y</div></svg>", "<svg><p>x</p>",
	"<svg><image></svg>", "<math><mi>x</mi></math>", "<math><mo>+</mo><mi>a</mi></math>",
	"<math><annotation-xml encoding='text/html'><p>x</p></annotation-xml></math>",
	"<math><annotation-xml encoding=text/xml><p>x</p></annotation-xml></math>", "<math><mtext><b>x</b></mtext></math>",
	"<math><mi><mglyph/></mi></math>", "<math><mi><malignmark/></mi></math>", "<math definitionURL=x><mi>a</mi></math>",
	"<math><mi><svg><circle/></svg></mi></math>", "<math><annotation-xml><svg><desc>x</desc></svg></annotation-xml></math>",
	"<svg><![CDATA[x<y]]></svg>", "<math><![CDATA[x]]></math>", "<svg><![CDATA[x]]><p>y", "<svg><script>x</script></svg>",
	"<svg><style>x</style></svg>", "<svg>\x00</svg>", "<svg><a xlink:href=x xml:lang=en xmlns:xlink=y>x</a></svg>",
	"<svg xlink:href=x></svg>", "<svg><br></svg>", "<svg><table></svg>", "<svg><td>x</td></svg>", "<svg><h1>x</h1></svg>",
	"<svg><span>x</span></svg>", "<svg></svg></p>", "<svg><g><p>x</p></g></svg>", "<svg><foreignobject>x</foreignobject></svg>",
	"<svg><desc>x</desc><p>y</p></svg>", "<svg><animateTransform></animateTransform></svg>", "<svg><feMorphology/></svg>",
	"<svg><glyphRef/></svg>", "<svg><textpath/>", "<svg><foreignObject><svg><circle/></svg></foreignObject></svg>",
	"<math><annotation-xml encoding=text/html></annotation-xml></math>", "<math><mi><b>x</b></mi></math>",
	"<math><ms>x</ms></math>", "<math><mn>1</mn><br></math>", "<math><mo>x</mo><mtable/></math>",
	"<svg><altGlyph>x</altGlyph><altglyphdef/></svg>", "<svg><feGaussianBlur stdDeviation=2/></svg>",
	"<svg><radialGradient gradientUnits=x></radialGradient></svg>", "<svg><mpath/></svg>",
	"<svg><font-face></font-face></svg>", "<svg><metadata>m</metadata></svg>", "<svg><switch><g/></switch></svg>",
	"<svg><p><b>x</b></p></svg>", "<svg><code>x</code></svg>", "<svg><ruby>x</ruby></svg>", "<svg><a><b>x</b></a></svg>",
	"<svg><svg><svg>x</svg></svg></svg>", "<svg><script>a</script><script>b</script></svg>", "<svg><!--c--></svg>",
	"<math><mi><table></table></mi></math>", "<math><mi><mglyph>x</mglyph></mi></math>", "<math><mi><malignmark/><b>x</b></mi></math>",
	"<math><annotation-xml><math><mi>x</mi></math></annotation-xml></math>", "<math><math>x</math></math>",
	"<math><mi><img src=x></mi></math>", "<svg><foreignObject><p>a<math><mi>b</mi></math>c</p></foreignObject></svg>",
	"<svg><title>x<p>y</title></svg>", "<svg><desc><svg><desc>x</desc></svg></desc></svg>",
	"<svg><div a=1 viewBox=2>x</div></svg>", "<svg><A HREF=x>y</A></svg>", "<svg><circle CX=1/></svg>",
	"<math><mi DEFINITIONURL=x>a</mi></math>", "<svg><g xml:space=preserve>x</g></svg>",
	// Headings nested in headings.
	"<h1><h2>a</h2></h1>", "<h1>a<h1>b", "<h2>a</h1>b", "<h3><div>x</h3>y", "<h1><p>x</h2></h1>",
	"<h1>x<h3>y</h3>z</h1>", "<h4><h5><h6>x", "<h1><h1><h1>x</h1>", "<h6><table><h2>x</h2></table>y</h6>",
	// body and html repeated, with attributes.
	"<body a=1><body b=2>x", "<html a=1><body><html b=2><body c=3>x", "<html><html lang=x>y",
	"<body><body>x</body></body>", "<body x=1><div y=2></div><body z=3>", "<html a=1><head></head><body>",
	"<body><p>x</p></body><body>y", "<html><body><div></div></body></html><div>after</div>",
	"<html><head><title>a</title><head>b</head></html>", "<head><head>x", "<body><html k=v>x", "<html><body>a</html>b</body>",
	// br, </br> and </p> on their own.
	"<br>", "</br>", "a</br>b", "<br/>x", "</p>", "</p>x", "<p></p>", "<p>x</br>", "</br></br>", "<div></br></div>",
	"<br></p></br>", "<body></br>x", "</br class=x>",
	// image, isindex.
	"<image src=x>", "<image>", "<table><image></table>", "<image/>x", "<image><image>",
	"<isindex>", "<isindex prompt=ask name=q action=/s x=1>", "<form><isindex></form>", "<isindex prompt='p'><isindex>",
	"<table><isindex></table>", "<isindex action=x>", "<isindex prompt=a prompt=b>", "<body><isindex name=n>x",
	// textarea, pre and listing that start with a newline.
	"<textarea>\nx</textarea>", "<textarea>\n\nx</textarea>", "<textarea>\r\nx</textarea>", "<textarea>x\n</textarea>",
	"<pre>\nx</pre>", "<pre>\n\nx</pre>", "<pre>\r\n\rx</pre>", "<listing>\nx</listing>", "<pre>x\ny</pre>",
	"<textarea></textarea>", "<pre></pre>", "<p><pre>\nx</pre>", "<pre>\n<pre>\nx", "<textarea><p>x</p></textarea>",
	"<textarea>&amp;\n</textarea>", "<pre>\n</pre>", "<pre>\r</pre>", "<textarea>\r</textarea>", "<pre>\n\r</pre>",
	"<pre>\x00\nx</pre>", "<textarea>\x00\nx</textarea>", "<pre>x</pre>\n<pre>\ny</pre>",
	// plaintext.
	"<plaintext>x<b>y", "<plaintext>", "<p>a<plaintext>b</plaintext>c", "<plaintext><p>x</plaintext>",
	"<table><plaintext>x", "<plaintext>\nx", "<body><plaintext>a\x00b", "<plaintext><plaintext>",
	// Comments in every position.
	"<!--a--><!DOCTYPE html><p>x", "<!DOCTYPE html><!--a--><html><!--b--><head><!--c--></head><!--d--><body><!--e--></body><!--f--></html><!--g-->",
	"<html></html><!--after-->", "<body></body><!--after body-->", "<!--x-->", "<!--a--><!--b-->",
	"<html><body></body></html>tail<!--c-->", "<table><!--x--><tr><td>1</td></tr></table>", "<select><!--x--></select>",
	"<frameset><!--x--></frameset>", "<frameset></frameset><!--x-->", "<head><!--x--></head>", "<svg><!--x--></svg>",
	"<p><!--x--></p>", "<!-- --><p>a", "<body></body><!--x--></html><!--y-->", "<!DOCTYPE html><!--a-->x",
	"<!--a--><html><!--b--><body></body><!--c--></html>", "<template><!--x--></template>", "<head></head><!--x--><body>",
	"<!DOCTYPE html><!--a--><!--b-->", "<noscript><!--x--></noscript>", "<html><!--x--><head>", "<!--a-->x<!--b-->",
	// Doctypes: quirks mode, public and system identifiers.
	"<!DOCTYPE html>", "<!doctype html public '-//W3C//DTD HTML 4.01//EN'>",
	"<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3.org/TR/html4/loose.dtd\">",
	"<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Frameset//EN\">", "<!DOCTYPE HTML PUBLIC \"-//W3C//DTD HTML 3.2//EN\">",
	"<!DOCTYPE html SYSTEM 'about:legacy-compat'>", "<!DOCTYPE html PUBLIC 'x' 'y'>", "<!DOCTYPE html PUBLIC>",
	"<!DOCTYPE html SYSTEM>", "<!DOCTYPE html PUBLIC \"a\"", "<!DOCTYPE html PUBLIC 'it\"s'>",
	"<!DOCTYPE html PUBLIC \"-//IETF//DTD HTML 2.0//EN\">", "<!DOCTYPE foo>", "<!DOCTYPE>",
	"<!DOCTYPE html public \"-//W3O//DTD W3 HTML Strict 3.0//EN//\">",
	"<!DOCTYPE html SYSTEM \"http://www.ibm.com/data/dtd/v11/ibmxhtml1-transitional.dtd\">",
	"<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Frameset//EN\" \"x\">",
	"<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.0 Transitional//EN\">",
	"<!DOCTYPE html PUBLIC \"-//SQ//DTD HTML 2.0 HoTMetaL + extensions//EN\">", "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01//EN\">x",
	"<!DOCTYPE html><!DOCTYPE html>",
	"<!DOCTYPE HTML PUBLIC \"-//W3C//DTD XHTML 1.0 Strict//EN\" \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd\">",
	"<!DOCTYPE html PUBLIC '-//W3C//DTD HTML 4.01 Transitional//EN' ''>", "<!DOCTYPE html PUBLIC '' 'x'>",
	"<!DOCTYPE html PUBLIC '-//W3C//DTD HTML 4.01 Transitional//EN' 'y'>x", "<!DOCTYPE html\n>",
	"<!DOCTYPE HTML SYSTEM 'x'>", "<!DOCTYPE html PUBLIC '-//W3C//DTD HTML 3 1995-03-24//'>",
	"<!DOCTYPE html PUBLIC '-//W3C//DTD HTML 4.01 Transitional//EN' 'http://x'>", "<!doctype HTML>x",
	"<!DOCTYPE html PUBLIC '-//W3C//DTD HTML 4.01 Frameset//EN' 'x'>", "<!DOCTYPE html PUBLIC 'a' 'b' 'c'>",
	"<!DOCTYPE html PUBLIC  \"x\"  >", "<!DOCTYPE html system \"x\" >",
	// End tags with attributes.
	"<p>x</p class=a>", "<div>x</div id=y>", "</div a=b>x", "<br class=x></br class=y>", "<body>x</body class=q>",
	"<html>x</html lang=en>", "<p class=q>x</p class=r>", "<table></table x=1>", "<ul></ul id=u><li>x",
	// Unknown tags.
	"<foo>x</foo>", "<foo-bar>x</foo-bar>", "<x:y>z</x:y>", "<custom attr=1>c</custom>", "</unknown>",
	"<p><unknown>x</p>", "<unknown><p>x</unknown>y", "<a:b c:d=e>x</a:b>", "<my-element><p>x</my-element>",
	"<font-face>x</font-face>", "<unknown><table><unknown>x</unknown></table></unknown>",
	// NUL characters in each mode.
	"\x00", "a\x00b", "<p>a\x00b</p>", "<table>\x00<tr>", "<select>\x00</select>", "<textarea>\x00</textarea>",
	"<svg>\x00</svg>", "<title>\x00</title>", "<script>\x00</script>", "<!--\x00-->", "<!DOCTYPE\x00 html>",
	"<frameset>\x00</frameset>", "<noframes>\x00</noframes>", "<body>\x00", "<head>\x00</head>",
	"<template>\x00</template>", "<p>\x00</p>x", "<math>\x00</math>", "<table><tr><td>\x00</td></tr></table>",
	"<option>\x00", "<select><option>a\x00</select>", "<plaintext>\x00", "<frameset>\x00<frame>\x00</frameset>",
	"\x00<html>\x00<body>\x00", "<table><tr>\x00<td>x</td></tr></table>", "<caption>\x00</caption>",
	"<colgroup>\x00</colgroup>", "<tbody>\x00</tbody>", "<tr>\x00</tr>", "<select><table>\x00</table></select>",
	"<xmp>\x00</xmp>", "<style>\x00</style>", "<iframe>\x00</iframe>", "<noscript>\x00</noscript>",
	"<image>\x00", "<p><svg><g>\x00</g></svg></p>", "<frame>\x00", "<head><noscript>\x00</noscript></head>",
	// Whitespace-only text between table elements.
	"<table>\n<tr>\n<td>a</td>\n</tr>\n</table>", "<table>\t<caption>\t</caption>\n<tr>\n</tr></table>",
	"<table><colgroup> <col> </colgroup> </table>", "<table> <thead> <tr> <th> </th> </tr> </thead> </table>",
	"<table>\r\n<tbody>\r\n</tbody>\r\n</table>", "<table> \f <tr> </table>", "<table> <tfoot> </tfoot> </table>",
	// The editor caret.
	"<p>‸</p>", "‸", "<a href='‸'>x</a>", "<div data-x=‸>a</div>", "<p>a‸b</p>", "<table>‸</table>",
	"<select><option>‸</option></select>", "<svg‸>x</svg>", "<p>‸<b>x</b></p>", "<math>‸</math>", "<textarea>‸</textarea>",
	"<pre>\n‸</pre>", "<template>‸</template>", "<frameset>‸</frameset>", "<!--‸-->", "<!DOCTYPE html‸>",
	"<table><tr><td>‸</td></tr></table>", "<ul><li>‸<li>x</ul>", "<h1>‸</h1>", "<a href=x>‸</a><a>‸</a>",
	// CJK and emoji.
	"中文<p>文本</p>", "<table>中文</table>", "<p>😀<b>emoji</b></p>", "<ruby>漢<rt>kan</rt></ruby>",
	"<svg><text>日本語</text></svg>", "<select><option>选项</option></select>", "<p class='中文'>x</p>",
	"<a title='😀'>b</a>", "<math><mi>π</mi></math>", "<table><tr><td>é</td></tr></table>", "<p>a b</p>",
	"<p> </p>", "<table><tr><td>😀</td></tr></table>", "<p>中</p><table>文</table>", "<svg><g>😀</g></svg>",
	// Invalid UTF-8 (the invalid group).
	"<p>\xff</p>", "<a x=\xc3>y", "<table>\xff</table>", "<select>\xe4\xb8</select>", "<svg>\xff</svg>",
	"\xed\xa0\x80<p>x", "<p>\xf0\x9f</p>", "<pre>\n\xff</pre>", "<textarea>\xc3</textarea>", "<a href=\xff>x</a>",
}

// parseTreeDocs returns the tree-construction documents: parseTreeCases and generated
// documents that go deeper than the adoption agency and foster parenting limits.
func parseTreeDocs() []string {
	out := append([]string{}, parseTreeCases...)
	for n := 1; n <= 12; n++ {
		out = append(out, strings.Repeat("<b>", n)+"<p>x</b>y</p>")
	}
	for n := 1; n <= 40; n += 3 {
		out = append(out, strings.Repeat("<div>", n)+"x", strings.Repeat("<a>", n)+"x")
	}
	for n := 1; n <= 20; n++ {
		out = append(out, strings.Repeat("<table><tr><td>", n)+"x")
	}
	for n := 1; n <= 10; n++ {
		out = append(out, strings.Repeat("<i>", n)+"<table>x</i>y</table>")
	}
	return out
}

// parseCorpusInputs returns the parse corpus: the 680 tokenizer documents of the token
// vectors (the same inputs as writeTokenVectors), then the tree-construction documents.
func parseCorpusInputs() (names []string, inputs [][]byte) {
	add := func(name string, input string) {
		names = append(names, name)
		inputs = append(inputs, []byte(input))
	}
	n := 0
	for _, s := range handDocs {
		add(fmt.Sprintf("tok/hand-%d", n), s)
		n++
	}
	for i, s := range attrDocs() {
		add(fmt.Sprintf("tok/attr-%d", i), s)
	}
	for i, s := range rawDocs() {
		add(fmt.Sprintf("tok/raw-%d", i), s)
	}
	for i, s := range randomFuzzDocs(150) {
		add(fmt.Sprintf("tok/fuzz-%d", i), s)
	}
	bigNames, bigInputs, err := bigDocs()
	if err != nil {
		panic(err)
	}
	for i, s := range bigInputs {
		add("tok/"+bigNames[i], s)
	}
	for i, s := range parseTreeDocs() {
		add(fmt.Sprintf("tree-%d", i), s)
	}
	return names, inputs
}

// writeParseVectors writes the parse vectors to stdout.
func writeParseVectors() {
	names, inputs := parseCorpusInputs()
	t := &recordTable{index: map[string]int{}}
	var docs []parseDocOut
	for i, in := range inputs {
		docs = append(docs, parseDoc(names[i], in, t))
	}
	var ctxNames []string
	for _, pc := range parseContexts {
		ctxNames = append(ctxNames, pc.name)
	}
	out := parseFile{GoVersion: runtime.Version(), Corpus: len(docs), Contexts: ctxNames, Records: t.recs, Docs: docs}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(out); err != nil {
		panic(err)
	}
}

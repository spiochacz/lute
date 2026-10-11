// The html subcommand of gen-util-vectors calls the real Go functions of util/html.go on
// a fixed corpus of DOM documents and writes the results as JSON to stdout. The output is
// the oracle for ts/src/util/util_html.vectors.test.ts.
//
// Encoding. A document lists its elements in document order. Each element records the
// results of every helper that takes a node. A helper result that is the zero value of its
// type (null, "", false, an empty list) is left out of the element record, so the test
// reads a missing field as the zero value. A string longer than strMax bytes is stored as
// {"sha256": ..., "len": ...} of its UTF-8 bytes.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/html/atom"
	"github.com/88250/lute/util"
)

// htmlDocs are hand-written documents: plain and nested elements, attributes with
// entities, empty values, duplicate and upper-case keys, data-* and custom-* attributes,
// class lists, text with &nbsp;, zero-width spaces, the caret, CJK and emoji, line breaks,
// comments, inline formatting, tables, task lists and editor-like markup.
var htmlDocs = []string{
	``,
	`plain text only`,
	`<p>hello</p>`,
	`<p>hello <b>bold</b> <i>it</i></p>`,
	`<div><span>a</span></div>`,
	`<div><div><div><span>deep</span></div></div></div>`,
	`<span>x</span><span>y</span>`,
	`<strong><em>nested inline</em></strong>`,
	`<span data-type="search-mark">mark</span> text`,
	`<span data-type="virtual-block-ref">vref</span>`,
	`<span data-type="search-mark"><b>b</b> inside</span>`,
	`<span data-type="other" data-id="20200813131152-0wk5akh" data-subtype="d">ref</span>`,
	`<span data-type="block-ref" data-id="20200813131152-0wk5akh">ref</span>`,
	`<span data-type="block-ref" data-id="20200813131152-0wk5akh" data-subtype="s">ref s</span>`,
	`<a href="a&amp;b" title="&lt;x&gt;">amp</a>`,
	`<a data-href="x&lt;y" data-title="a&amp;lt;b&amp;gt;">link</a>`,
	`<a data-href="https://ex.com/?a=1&amp;b=2" data-title="t&quot;q&quot;">link2</a>`,
	`<span data-x="">empty value</span>`,
	`<span data-x>no value</span>`,
	`<span a="1" a="2">dup</span>`,
	`<span DATA-ID="X" Class="c" ID="i">upper</span>`,
	`<span data-a="1" data-b="2" data-c="3">data attrs</span>`,
	`<span custom-a="1" custom-b="2">custom</span>`,
	`<span custom-a="1"><span custom-z="9">nested custom</span></span>`,
	`<span class="a b katex-mathml">katex</span>`,
	`<span class="katex-display"><span class="MathJax_SVG_Display">math</span></span>`,
	`<span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">a_1^{2}</annotation></semantics></math></span></span>`,
	`<span data-tex="\frac{a}{b}"></span>`,
	`<span data-tex="  x + y  "></span>`,
	`<img src="a.png" alt="x" data-tex="a_b">`,
	`<img src="a.png" alt="x &amp; y">`,
	`<img data-type="x" src="b.png">`,
	`<span data-render="1">rendered</span>`,
	`<span data-render="2"><b>r2</b></span>`,
	`<span data-render="0">r0</span>`,
	`<svg><text>svgtext</text></svg>`,
	`<p>a&nbsp;b&nbsp;c</p>`,
	`<p>zero&#8203;width</p>`,
	"<p>zero​width ​ZWSP</p>",
	`<p>caret ‸ here</p>`,
	`<p>‸</p>`,
	`<p>中文 字符 测试</p>`,
	`<p>emoji 😀 👨‍👩‍👧 end</p>`,
	`<p>line<br>break<br/>again</p>`,
	`<p>word<wbr>break</p>`,
	`<!-- comment --><p>after comment</p>`,
	`<p>before<!-- inside -->after</p>`,
	`<p>x<sup>2</sup> and H<sub>2</sub>O</p>`,
	`<sup>only sup</sup>`,
	`<sub>only sub</sub>`,
	`<span><sup>a</sup><sub>b</sub><sup><sub>c</sub></sup></span>`,
	`<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c1</td><td>c2</td></tr></tbody></table>`,
	`<ul><li><input type="checkbox" checked="">task done</li><li><input type="checkbox">open</li></ul>`,
	`<pre><code class="language-go">fmt.Println()</code></pre>`,
	`<code>inline code</code>`,
	`<span class="a b">x</span><span class="ab">y</span><span class="ba c">z</span><span class="">w</span>`,
	`<div class="list p"><p class="x">a</p></div>`,
	`<p>text &amp; &lt;tag&gt; &quot;q&quot; &#39;s&#39;</p>`,
	`<p>&copy; &hellip; &#x1F600;</p>`,
	`<html><head><title>t</title></head><body><p>in body</p></body></html>`,
	`<!DOCTYPE html><html><body><p>doctype</p></body></html>`,
	`<!DOCTYPE html><p>doctype only</p>`,
	`<div data-node-id="20200813131152-0wk5akh" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="false"><span data-type="strong">x</span></div></div>`,
	`<span data-type="inline-math" data-subtype="math-inline" data-content="a_b^{2}&#10;x" class="katex">math</span>`,
	`<span data-type="inline-memo" data-inline-memo-content="memo&#10;line&amp;lt;&#8203;">memo</span>`,
	`<span data-type="tag">#t#</span>`,
	`<span data-type="file-annotation-ref" data-id="20200813131152-0wk5akh">fa</span>`,
	`<span data-type="a" data-href="u" data-title="t"> a</span>`,
	`<span data-type="text" style="color: red">styled</span>`,
	`<p data-custom="1">nodes &amp; attrs</p>`,
	`<script>var x = 1 < 2;</script><p>after script</p>`,
	`<style>p{color:red}</style>`,
	`<textarea>a&lt;b</textarea>`,
	`<select><option>one</option></select>`,
	`<math><mi>x</mi></math>`,
	`<div><span data-type="search-mark" class="s">found</span> rest <span data-type="search-mark">two</span></div>`,
	`<p>  leading and trailing spaces  </p>`,
	"<p>\n\npara\n\n</p>",
	"<p>a\n\n\n\nb</p>",
	`<span data-type="text">line one<br>line two</span>`,
	"<div>\n<p>one</p>\n<p>two</p>\n</div>",
	`<img src="a.png" alt="alt">text after`,
	`<p><img src="x.png"/><img src="y.png" data-tex="z"/></p>`,
	`<span data-id="" data-subtype="">empty id</span>`,
	`<span data-type="block-ref" data-id="20200813131152-0wk5akh" data-subtype="">blank subtype</span>`,
	"<p>tabs\tand  spaces</p>",
}

// markdownSnippets are short Markdown documents, each turned into a document by
// Md2BlockDOM and by Md2VditorDOM.
var markdownSnippets = []string{
	"*a*",
	"**b**",
	"_c_",
	"***d***",
	"~~e~~",
	"==f==",
	"`code`",
	"[link](http://a.com/b?c=d&e=f \"title\")",
	"[plain](http://a.com)",
	"![img](a.png \"t\")",
	"![alt](a.png)",
	"$a^2+b_1$",
	"$$\\frac{a}{b}$$",
	"inline $x$ math",
	"((20200813131152-0wk5akh \"text\"))",
	"((20200813131152-0wk5akh 'dyn'))",
	"see ((20200813131152-0wk5akh))",
	"#t#",
	"#tag with space#",
	"| a | b |\n| - | - |\n| 1 | 2 |",
	"- [ ] todo\n- [x] done",
	"1. one\n2. two",
	"> quote",
	"# heading",
	"## heading with *em*",
	"```go\nfmt.Println()\n```",
	"x<sup>2</sup>",
	"H~2~O",
	"a‸b",
	"中文 **粗体** 中文",
	"emoji 😀 *em*",
	"line\\\nbreak",
	"auto <http://x.com>",
	"text &amp; &lt;",
	"<span data-type=\"search-mark\">mark</span>",
	"a<br>b",
	"<kbd>Ctrl</kbd>+<kbd>C</kbd>",
	"footnote[^1]\n\n[^1]: note",
	"---",
	"- a\n\n  b",
	"`` `a` ``",
	"a  \nb",
	"\"quoted\" 'single'",
	"<img src=\"a.png\" alt=\"x\" />",
	"![](b.png)",
	"* item one\n* item two\n  * nested",
	"Term\n: definition",
	"***bold and italic*** and `c`",
	"[ref link][r]\n\n[r]: http://r.com \"R\"",
	"<div>block html</div>",
	"\\*escaped\\* text",
	"a 🙂 b 👍 c",
	"Lorem ipsum *dolor* **sit** `amet` [link](u) ![i](p.png) $m$ #t#",
	"$a$ and $b$ and $c_{d}$",
	"((20200813131152-0wk5akh \"a\" ))",
	"text ‸ caret",
}

// prefixes, classQueries, atomNames and existQueries are the arguments of the helpers
// that take extra arguments. They hold names that occur in the corpus and names that do not.
var prefixes = []string{"data-", "custom-", "data-v-", "data-node-", "nope-", "class", ""}

type classQuery struct {
	Atom    string   `json:"atom"`
	Classes []string `json:"classes"`
}

var classQueries = []classQuery{
	{"span", []string{"katex-mathml"}},
	{"span", []string{"katex-display", "MathJax_SVG_Display"}},
	{"div", []string{"p", "b"}},
	{"a", []string{"nope-class"}},
	{"img", []string{"a"}},
	{"input", []string{"checkbox"}},
	{"code", nil},
	{"span", []string{""}},
	{"p", []string{"x", "list"}},
	{"span", []string{"search-mark", "katex"}},
}

var atomNames = []string{"span", "div", "img", "a", "code", "input", "p", "sup", "sub", "br", "li", "strong"}

var existQueries = [][]string{
	{"span"}, {"div"}, {"img"}, {"a"}, {"code"}, {"input"}, {"p"}, {"sup"}, {"sub"}, {"br"}, {"li"}, {"strong"},
	{"span", "img"}, {},
}

// strMax is the longest string stored as it is. A longer string is stored as the SHA-256
// of its UTF-8 bytes and its length, to keep the file small.
const strMax = 200

// setValue is the value that SetDomAttrValue sets on a new attribute, and setFirstValue the
// value it sets on the first attribute of an element.
const setValue = "a&b<c\"d‸"
const setFirstValue = "over&<'"

func sv(s string) any {
	if len(s) <= strMax {
		return s
	}
	sum := sha256.Sum256([]byte(s))
	return map[string]any{"sha256": hex.EncodeToString(sum[:]), "len": len(s)}
}

func render(n *html.Node) string {
	buf := &bytes.Buffer{}
	html.Render(buf, n)
	return buf.String()
}

type tmRec struct {
	TDWC   any `json:"tdwc"`
	TD     any `json:"td"`
	IMD    any `json:"imd"`
	AHref  any `json:"ahref"`
	ATitle any `json:"atitle"`
	IMath  any `json:"imath"`
	BID    any `json:"bid"`
	BSub   any `json:"bsub"`
	FA     any `json:"fa"`
	FO     any `json:"fo"`
	TX     any `json:"tx"`
}

type cbcRec struct {
	Q int    `json:"q"`
	R string `json:"r"`
}

type cbtRec struct {
	Q int      `json:"q"`
	P []string `json:"p"`
}

type mutRec struct {
	Op   string `json:"op"`
	Name string `json:"name,omitempty"`
	Val  string `json:"val,omitempty"`
	HTML any    `json:"html"`
}

type elemRec struct {
	P      string                       `json:"p"`
	HTML   any                          `json:"html"`
	Attr   map[string]string            `json:"attr,omitempty"`
	Ex     []string                     `json:"ex,omitempty"`
	Custom map[string]string            `json:"custom,omitempty"`
	Prefix map[string]map[string]string `json:"prefix,omitempty"`
	CBC    []cbcRec                     `json:"cbc,omitempty"`
	CBT    []cbtRec                     `json:"cbt,omitempty"`
	EXQ    []int                        `json:"exq,omitempty"`
	TMS    bool                         `json:"tms,omitempty"`
	Text   any                          `json:"text,omitempty"`
	TM     *tmRec                       `json:"tm,omitempty"`
	Mut    []mutRec                     `json:"mut,omitempty"`
}

type docRec struct {
	Kind  string    `json:"kind"`
	Src   string    `json:"src"`
	Root  any       `json:"root"`
	Elems []elemRec `json:"elems"`
}

type htmlOutput struct {
	GoVersion    string       `json:"goVersion"`
	AttrNames    []string     `json:"attrNames"`
	Prefixes     []string     `json:"prefixes"`
	ClassQueries []classQuery `json:"classQueries"`
	AtomNames    []string     `json:"atomNames"`
	ExistQueries [][]string   `json:"existQueries"`
	Docs         []docRec     `json:"docs"`
}

type htmlSource struct {
	kind string
	src  string
}

// safeRender runs an engine call. A snippet that makes the Go engine panic is skipped and
// reported on stderr, so the corpus only holds the documents that the engine renders.
func safeRender(f func() string) (out string, ok bool) {
	defer func() {
		if r := recover(); r != nil {
			os.Stderr.WriteString("skipped snippet: engine panic\n")
			ok = false
		}
	}()
	return f(), true
}

// newEngine returns a Lute engine with the options that the snippets need.
func newEngine() *lute.Lute {
	e := lute.New()
	e.SetInlineMath(true)
	e.SetBlockRef(true)
	e.SetTag(true)
	e.SetFileAnnotationRef(true)
	e.SetSup(true)
	e.SetSub(true)
	e.SetMark(true)
	return e
}

func htmlSources() []htmlSource {
	var out []htmlSource
	for _, s := range htmlDocs {
		out = append(out, htmlSource{"hand", s})
	}
	for _, md := range markdownSnippets {
		if block, ok := safeRender(func() string { return newEngine().Md2BlockDOM(md, false) }); ok {
			out = append(out, htmlSource{"block", block})
		}
		if vditor, ok := safeRender(func() string { return newEngine().Md2VditorDOM(md) }); ok {
			out = append(out, htmlSource{"vditor", vditor})
		}
	}
	data, err := os.ReadFile("../../../benchmark/commonmark-spec.md")
	if err != nil {
		panic(err)
	}
	lines := strings.SplitN(string(data), "\n", 151)
	md := strings.Join(lines[:150], "\n")
	out = append(out, htmlSource{"spec", newEngine().Md2BlockDOM(md, false)})
	out = append(out, htmlSource{"spec", newEngine().Md2VditorDOM(md)})
	return out
}

// walkPaths records the path of every node: the root is "", and the child with index i of
// a node with path p has the path p/i (or i for a child of the root). elems gets the element
// nodes in document order.
func walkPaths(n *html.Node, path string, paths map[*html.Node]string, elems *[]*html.Node) {
	paths[n] = path
	if html.ElementNode == n.Type {
		*elems = append(*elems, n)
	}
	i := 0
	for c := n.FirstChild; nil != c; c = c.NextSibling {
		childPath := strconv.Itoa(i)
		if "" != path {
			childPath = path + "/" + childPath
		}
		walkPaths(c, childPath, paths, elems)
		i++
	}
}

// findByPath returns the node with the path that walkPaths gives.
func findByPath(root *html.Node, path string) *html.Node {
	n := root
	if "" == path {
		return n
	}
	for _, part := range strings.Split(path, "/") {
		idx, _ := strconv.Atoi(part)
		c := n.FirstChild
		for k := 0; k < idx; k++ {
			c = c.NextSibling
		}
		n = c
	}
	return n
}

func writeHTMLVectors() {
	ast.Testing = true

	sources := htmlSources()

	// The attribute names: every attribute key of the corpus, sorted, plus two that do not occur.
	attrSet := map[string]bool{"data-nope": true, "NOPE": true}
	roots := make([]*html.Node, len(sources))
	for i, s := range sources {
		roots[i] = util.ParseHTML(s.src)
		if nil == roots[i] {
			continue
		}
		paths := map[*html.Node]string{}
		var elems []*html.Node
		walkPaths(roots[i], "", paths, &elems)
		for _, e := range elems {
			for _, a := range e.Attr {
				attrSet[a.Key] = true
			}
		}
	}
	var attrNames []string
	for k := range attrSet {
		attrNames = append(attrNames, k)
	}
	sort.Strings(attrNames)

	out := htmlOutput{
		GoVersion:    runtime.Version(),
		AttrNames:    attrNames,
		Prefixes:     prefixes,
		ClassQueries: classQueries,
		AtomNames:    atomNames,
		ExistQueries: existQueries,
	}

	for i, s := range sources {
		root := roots[i]
		doc := docRec{Kind: s.kind, Src: s.src, Root: nil, Elems: []elemRec{}}
		if nil != root {
			doc.Root = sv(render(root))
			paths := map[*html.Node]string{}
			var elems []*html.Node
			walkPaths(root, "", paths, &elems)
			for _, n := range elems {
				doc.Elems = append(doc.Elems, elemFor(s.src, attrNames, n, paths))
			}
		}
		out.Docs = append(out.Docs, doc)
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(out); err != nil {
		panic(err)
	}
}

// elemFor records the results of every helper of util/html.go that takes a node, for the
// element n of a tree parsed from src. paths gives the path of every node of that tree.
func elemFor(src string, attrNames []string, n *html.Node, paths map[*html.Node]string) elemRec {
	rec := elemRec{P: paths[n], HTML: sv(string(util.DomHTML(n)))}
	attrs := map[string]string{}
	for _, name := range attrNames {
		v := util.DomAttrValue(n, name)
		if util.ExistDomAttr(n, name) {
			attrs[name] = v
			rec.Ex = append(rec.Ex, name)
		} else if "" != v {
			panic("DomAttrValue of an absent attribute is not empty: " + name)
		}
	}
	if 0 < len(attrs) {
		rec.Attr = attrs
	}
	if m := util.DomCustomAttrs(n); nil != m {
		rec.Custom = m
	}
	for _, pfx := range prefixes {
		if m := util.DomAttrValuesWithPrefix(n, pfx); nil != m {
			if nil == rec.Prefix {
				rec.Prefix = map[string]map[string]string{}
			}
			rec.Prefix[pfx] = m
		}
	}
	for qi, q := range classQueries {
		if r := util.DomChildByTypeAndClass(n, atom.Lookup([]byte(q.Atom)), q.Classes...); nil != r {
			rec.CBC = append(rec.CBC, cbcRec{Q: qi, R: paths[r]})
		}
	}
	for ai, name := range atomNames {
		list := util.DomChildrenByType(n, atom.Lookup([]byte(name)))
		if 0 < len(list) {
			var ps []string
			for _, c := range list {
				ps = append(ps, paths[c])
			}
			rec.CBT = append(rec.CBT, cbtRec{Q: ai, P: ps})
		}
	}
	for qi, set := range existQueries {
		var atoms []atom.Atom
		for _, name := range set {
			atoms = append(atoms, atom.Lookup([]byte(name)))
		}
		if util.DomExistChildByType(n, atoms...) {
			rec.EXQ = append(rec.EXQ, qi)
		}
	}
	rec.TMS = util.IsTempMarkSpan(n)
	if t := util.DomText(n); "" != t {
		rec.Text = sv(t)
	}
	if n.DataAtom == atom.Span || n.DataAtom == atom.Img {
		href, title := util.GetTextMarkAData(n)
		bid, bsub := util.GetTextMarkBlockRefData(n)
		rec.TM = &tmRec{
			TDWC:   sv(util.GetTextMarkTextDataWithoutEscapeQuote(n)),
			TD:     sv(util.GetTextMarkTextData(n)),
			IMD:    sv(util.GetTextMarkInlineMemoData(n)),
			AHref:  sv(href),
			ATitle: sv(title),
			IMath:  sv(util.GetTextMarkInlineMathData(n)),
			BID:    sv(bid),
			BSub:   sv(bsub),
			FA:     sv(util.GetTextMarkFileAnnotationRefData(n)),
			FO:     sv(util.GetFormula(n)),
			TX:     sv(util.DomTexhtml(n)),
		}
	}

	// SetDomAttrValue and RemoveDomAttrs change the node, so each change is made on a fresh
	// parse of src, and the rendered node is recorded.
	firstKey := ""
	if 0 < len(n.Attr) {
		firstKey = n.Attr[0].Key
	}
	type mut struct {
		op, name, val string
		apply         func(t *html.Node)
	}
	muts := []mut{
		{"setNew", "data-new-attr", setValue, func(t *html.Node) {
			util.SetDomAttrValue(t, "data-new-attr", setValue)
		}},
		{"removeAll", "", "", func(t *html.Node) {
			util.RemoveDomAttrs(t)
		}},
	}
	if "" != firstKey {
		muts = append(muts,
			mut{"setFirst", firstKey, setFirstValue, func(t *html.Node) {
				util.SetDomAttrValue(t, firstKey, setFirstValue)
			}},
			mut{"removeFirst", firstKey, "", func(t *html.Node) {
				util.RemoveDomAttr(t, firstKey)
			}},
		)
	}
	for _, m := range muts {
		t := findByPath(util.ParseHTML(src), rec.P)
		m.apply(t)
		rec.Mut = append(rec.Mut, mutRec{Op: m.op, Name: m.name, Val: m.val, HTML: sv(render(t))})
	}
	return rec
}

package main

// Token vectors: the real Go tokenizer (html/token.go) run on a fixed corpus.
//
// Each document is tokenized three ways, on a fresh copy of the input every time
// (the Go tokenizer changes its buffer in place, see the PORT-NOTE in token.ts):
//
//	high: Next, Raw (copied before Token), Token. Records type, DataAtom, Data,
//	      every attribute (namespace, key, value), Raw and Token.String().
//	low:  Next, Raw, then Text for text-like tokens, or TagName followed by TagAttr
//	      while it reports more attributes. Records every returned byte and boolean.
//	frag: NewTokenizerFragment with each context tag. Records the type and
//	      Token.String() of every token (String includes the attributes).
//
// Byte values (enc) are the bytes of the Go string: a JSON string when the bytes are
// valid UTF-8, and {"hex": "..."} (lowercase hex) when they are not, so that invalid
// UTF-8 is kept exactly. The error after the loop is the text of z.Err(), or null.

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"regexp"
	"runtime"
	"strings"
	"unicode/utf8"

	"github.com/88250/lute"
	"github.com/88250/lute/html"
)

// tokenDoc is one document of the token vectors.
type tokenDoc struct {
	Name   string         `json:"name"`
	Input  any            `json:"input"`
	High   []any          `json:"high"`
	HighEr any            `json:"highErr"`
	Low    []any          `json:"low"`
	LowEr  any            `json:"lowErr"`
	Frag   map[string]any `json:"frag"`
}

type tokenVectors struct {
	GoVersion string      `json:"goVersion"`
	Corpus    int         `json:"corpus"`
	Docs      []tokenDoc  `json:"docs"`
}

// fragContexts are the context tags of NewTokenizerFragment that are recorded.
var fragContexts = []string{"script", "style", "textarea", "title", "plaintext", "iframe", "noscript", "xmp", "div"}

// enc encodes the bytes of a Go string. See the comment at the top of this file.
func enc(b []byte) any {
	if utf8.Valid(b) {
		return string(b)
	}
	return map[string]string{"hex": hex.EncodeToString(b)}
}

// cp returns a copy of b (nil stays nil), so that the Go buffer changes are not seen
// by the next run.
func cp(b []byte) []byte {
	return append([]byte(nil), b...)
}

func errText(err error) any {
	if err == nil {
		return nil
	}
	return err.Error()
}

// highRun tokenizes input with Next, Raw and Token.
func highRun(input []byte) ([]any, any) {
	z := html.NewTokenizer(bytes.NewReader(cp(input)))
	toks := []any{}
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		raw := enc(cp(z.Raw()))
		t := z.Token()
		attrs := []any{}
		for _, a := range t.Attr {
			attrs = append(attrs, []any{a.Namespace, enc([]byte(a.Key)), enc([]byte(a.Val))})
		}
		toks = append(toks, []any{int(t.Type), int(t.DataAtom), enc([]byte(t.Data)), attrs, raw, enc([]byte(t.String()))})
	}
	return toks, errText(z.Err())
}

// lowRun tokenizes input with Next, Raw, Text, TagName and TagAttr.
func lowRun(input []byte) ([]any, any) {
	z := html.NewTokenizer(bytes.NewReader(cp(input)))
	out := []any{}
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		raw := enc(cp(z.Raw()))
		switch tt {
		case html.TextToken, html.CommentToken, html.DoctypeToken:
			out = append(out, []any{int(tt), raw, enc(cp(z.Text()))})
		case html.StartTagToken, html.SelfClosingTagToken, html.EndTagToken:
			name, hasAttr := z.TagName()
			entry := []any{int(tt), raw, enc(cp(name)), hasAttr}
			attrs := []any{}
			more := hasAttr
			for more {
				k, v, m := z.TagAttr()
				attrs = append(attrs, []any{enc(cp(k)), enc(cp(v)), m})
				more = m
			}
			out = append(out, append(entry, attrs))
		}
	}
	return out, errText(z.Err())
}

// fragRun tokenizes input as an InnerHTML fragment of the context tag.
func fragRun(input []byte, ctx string) []any {
	z := html.NewTokenizerFragment(bytes.NewReader(cp(input)), ctx)
	toks := []any{}
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		t := z.Token()
		toks = append(toks, []any{int(t.Type), enc([]byte(t.String()))})
	}
	return []any{toks, errText(z.Err())}
}

// tokenDocFor builds the record of one document. withFrag selects the fragment runs.
func tokenDocFor(name string, input []byte, withFrag bool) tokenDoc {
	d := tokenDoc{Name: name, Input: enc(input)}
	d.High, d.HighEr = highRun(input)
	d.Low, d.LowEr = lowRun(input)
	if withFrag {
		d.Frag = map[string]any{}
		for _, ctx := range fragContexts {
			d.Frag[ctx] = fragRun(input, ctx)
		}
	}
	return d
}

// handDocs are the hand-written documents: plain text, tags, attributes, comments,
// doctypes, CDATA, processing instructions, raw text, NUL, CR/LF, CJK, emoji, invalid
// UTF-8 and the editor caret.
var handDocs = []string{
	"", "a", "plain text", "中文 текст", "😀 emoji", "\n", "\r\n", "a\rb", "\r", "a\x00b", "\x00",
	"a&amp;b", "&lt;&gt;", "a<b", "a < b", "a << b", "</", "</>", "<", "<<", "<!", "<?",
	"<!-", "<!--", "<!---", "<!-->", "<!--->", "<!--a", "<!--a-", "<!--a--", "<!--a--!>",
	"<!--a-->", "<!---->", "<!-- a -- b -->", "<!-- a --> b", "<!DOCTYPE html>", "<!doctype html>",
	"<!DOCTYPE", "<!DOCTYPE html", "<!DOCTYPE\n html >", "<!a bogus>", "<![CDATA[x]]>",
	"<![CDATA[a]b]]>", "<![CDATA[x", "<![CDATA[x]]", "<?xml version=\"1.0\"?>", "<?x?>", "<?x",
	"<br/>", "<br>", "<img src=\"a.png\" />", "<a href=x>y</a>", "<A HREF=\"X\">Y</A>",
	"<div><p>nested <b>tags</b></p></div>", "<input disabled>", "<a b c=d e='f' g=\"h\">",
	"<a b=>", "<a b= >", "<a =b>", "<a b=c=d>", "<a b='c>d'>", "<a b=\"c>d\">", "<a b=c>d",
	"<a b=\"c", "<a b='c", "<a b", "<a", "<a ", "<a/", "<a/>", "<a / >", "<a x=&amp;y>",
	"<a x=&lt;>", "<a x='&quot;'>", "<a x=\"a&#65;b\">", "<a x=a&b>", "<a a=1 a=2>", "<a A=1 a=2>",
	"<a\nb=\"x\"\n>", "<a\tb=c\r>", "<a\x0cb=c>", "<p>‸</p>", "<p>a‸b</p>", "<‸>", "<a‸b>",
	"<a x=‸>", "<a x=\"‸\">", "<a‸>text</a‸>", "</‸>", "text‸", "‸", "<a x='‸'>",
	"<a caretreplacement=1>", "<a x=\"a\nb\">", "<a x=\"a\r\nb\">", "a\r\nb\r\n",
	"<textarea>a\r\nb</textarea>", "&amp;", "&#65;&#x42;", "&unknown;", "<title>a&amp;b</title>",
	"<script>a<b</script>", "<script>var a = '<!--';</script>", "<script><!--<script></script>--></script>",
	"<script>x</SCRIPT>", "<script>x</script >", "<script>x</scriptx>", "<style>a{}</style>",
	"<textarea>&amp;<b></textarea>", "<title><b>x</b></title>", "<plaintext><b>x", "<xmp><b>x</xmp>",
	"<iframe><b>x</iframe>", "<noscript><b>x</noscript>", "<noembed>x</noembed>", "<noframes>x</noframes>",
	"<xmp>", "<script>", "<script", "<style>a", "<textarea>", "<title>", "</script>", "</style>",
	"</ title>", "<script>a</script", "<script>a</sc", "<script><!--", "<script><!-- <script>",
	"<script><!-- <script> </script> --></script>", "<script><!--x--!></script>", "<script><!-->x</script>",
	"<script>a<!-</script>", "<script>a<!-x</script>", "<script>a</</script>",
	"<script><!-- </script>x", "<script><!--<s</script>", "<script><!--<script/></script>",
	"<script><!--<script\t></script>x</script>", "<script>\x00</script>", "<textarea>\x00</textarea>",
	"<p>\x00</p>", "<!--\x00-->", "<!DOCTYPE \x00>", "\xff", "a\xffb", "<a x=\xff>", "<a \xff=1>",
	"<a x='\xc3'>y", "<!--\xe4\xb8-->", "&\xff", "<a x=\"&amp\xff\">",
}

// attrForms are attribute spellings put in tags by attrDocs.
var attrForms = []string{
	"x=1", "x='1'", "x=\"1\"", "x", "x=", "x=a&amp;b", "x=\"a>b\"", "x=a>b", "X=Y", "x=1 x=2",
	"x = \"spaced\"", "data-x=é", "x=\"\n\"", "x=‸",
}

// tagForms are the tags attrDocs puts the attributes on.
var tagForms = []string{"a", "DIV", "img", "br", "input"}

// wrapForms are the contexts attrDocs puts the tags in.
var wrapForms = []string{"%s", "text %s more", "<p>%s</p>"}

// rawPrefixes and rawBodies are the raw text elements and their contents for rawDocs.
var rawPrefixes = []string{"<script>", "<SCRIPT>", "<style>", "<textarea>", "<title>", "<plaintext>",
	"<xmp>", "<iframe>", "<noscript>", "<noembed>", "<noframes>"}

var rawBodies = []string{"a<b", "</script>", "<!--", "<!--<script>", "--></script>",
	"<!--<script></script>--></script>", "</SCRIPT >", "</style>", "&amp;", "</textarea>",
	"<!-- <script> </script> -->", "<script><!--", "</sc", "</scriptx>x", "\r\n</script>"}

// fuzzTokens is the alphabet of randomFuzzDocs.
var fuzzTokens = []string{"<", ">", "/", "!", "-", "?", "[", "]", "\"", "'", "=", "&", " ", "\n", "\r",
	"\t", "\x0c", "a", "A", "b", "script", "SCRIPT", "style", "<script>", "</script>", "<!--", "-->",
	"<![CDATA[", "]]>", "DOCTYPE", "<a ", "</a>", "x=", "‸", "é", "😀", "\x00", "\xff", "\xc3", "\x28", "&amp;"}

// attrDocs returns the tags with each attribute spelling in each context.
func attrDocs() []string {
	var out []string
	for _, tag := range tagForms {
		for _, attr := range attrForms {
			for _, wrap := range wrapForms {
				out = append(out, strings.Replace(wrap, "%s", "<"+tag+" "+attr+">", 1))
			}
		}
	}
	return out
}

// rawDocs returns each raw text element with each body.
func rawDocs() []string {
	var out []string
	for _, p := range rawPrefixes {
		for _, b := range rawBodies {
			out = append(out, p+b)
		}
	}
	return out
}

// randomFuzzDocs returns n documents made of random tokens of fuzzTokens (fixed seed).
func randomFuzzDocs(n int) []string {
	rng := rand.New(rand.NewSource(20260510))
	var out []string
	for i := 0; i < n; i++ {
		k := 1 + rng.Intn(40)
		var b strings.Builder
		for j := 0; j < k; j++ {
			b.WriteString(fuzzTokens[rng.Intn(len(fuzzTokens))])
		}
		out = append(out, b.String())
	}
	return out
}

// blockID matches the block IDs that Lute writes into the HTML.
var blockID = regexp.MustCompile(`\d{14}-[0-9a-z]{7}`)

// bigDocs runs the Lute engine on the first 300 lines of the CommonMark spec and returns
// the three HTML documents: MarkdownStr, Md2BlockDOM and Md2VditorDOM.
func bigDocs() (names []string, docs []string, err error) {
	data, err := os.ReadFile("../../../benchmark/commonmark-spec.md")
	if err != nil {
		return nil, nil, err
	}
	lines := strings.SplitAfter(string(data), "\n")
	if len(lines) > 300 {
		lines = lines[:300]
	}
	md := strings.Join(lines, "")
	engine := lute.New()
	names = []string{"lute MarkdownStr(first 300 lines of commonmark-spec.md)", "lute Md2BlockDOM(first 300 lines)", "lute Md2VditorDOM(first 300 lines)"}
	docs = []string{engine.MarkdownStr("", md), lute.New().Md2BlockDOM(md, false), lute.New().Md2VditorDOM(md)}
	// Block IDs (data-node-id, "yyyyMMddHHmmss-xxxxxxx") are made from the current time,
	// so they are replaced by a fixed ID of the same length. The output is then the same
	// on every run.
	for i := range docs {
		docs[i] = blockID.ReplaceAllString(docs[i], "20000101000000-0000000")
	}
	return names, docs, nil
}

// writeTokenVectors writes the token vectors to stdout.
func writeTokenVectors() {
	var docs []tokenDoc
	add := func(name string, input string, withFrag bool) {
		docs = append(docs, tokenDocFor(name, []byte(input), withFrag))
	}
	n := 0
	for _, s := range handDocs {
		add(fmt.Sprintf("hand-%d", n), s, true)
		n++
	}
	for i, s := range attrDocs() {
		add(fmt.Sprintf("attr-%d", i), s, true)
	}
	for i, s := range rawDocs() {
		add(fmt.Sprintf("raw-%d", i), s, true)
	}
	for i, s := range randomFuzzDocs(150) {
		add(fmt.Sprintf("fuzz-%d", i), s, true)
	}
	bigNames, bigInputs, err := bigDocs()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	for i, s := range bigInputs {
		// The fragment runs on the large documents use only the div context (see README).
		d := tokenDocFor(bigNames[i], []byte(s), false)
		d.Frag = map[string]any{"div": fragRun([]byte(s), "div")}
		docs = append(docs, d)
	}
	out := tokenVectors{GoVersion: runtime.Version(), Corpus: len(docs), Docs: docs}
	jenc := json.NewEncoder(os.Stdout)
	jenc.SetEscapeHTML(false)
	if err := jenc.Encode(out); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

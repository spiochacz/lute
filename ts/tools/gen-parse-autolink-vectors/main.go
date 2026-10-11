// Command gen-parse-autolink-vectors runs the real Go parse package (parse/auto_link.go,
// parse/inline_html.go, parse/html_text_style.go and parse/html_text_style_inline.go)
// on a fixed corpus and writes the results as JSON. The TypeScript port in ts/src/parse/
// is asserted against this file by autolink_pure.vectors.test.ts (functions that need no
// full parse) and autolink_inline.vectors.test.ts (whole inline parses).
//
// Unexported functions and methods are reached through the linknames in linkname.go.
//
// Usage (from this directory):
//
//	go run -tags javascript . > ../../src/parse/testdata/autolink_vectors.json
package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/html/atom"
	"github.com/88250/lute/parse"
)

// hx writes a byte slice as lowercase hex.
func hx(b []byte) string { return hex.EncodeToString(b) }

// exact returns a copy of b whose capacity equals its length, as the TypeScript side has.
func exact(b []byte) []byte {
	c := make([]byte, len(b))
	copy(c, b)
	return c[:len(c):len(c)]
}

// try runs f and reports whether it panicked.
func try(f func() any) (ret any, panicked bool) {
	defer func() {
		if r := recover(); r != nil {
			ret, panicked = nil, true
		}
	}()
	return f(), false
}

// vec is [args, ret] or [args, null, true] when Go panicked.
func vec(args []any, f func() any) []any {
	ret, p := try(f)
	if p {
		return []any{args, nil, true}
	}
	return []any{args, ret}
}

func newTree(o *parse.Options) *parse.Tree {
	return &parse.Tree{Context: &parse.Context{ParseOption: o}}
}

// optionsByName builds the option sets shared with the TypeScript test.
func optionsByName(name string) *parse.Options {
	o := parse.NewOptions()
	switch name {
	case "default":
	case "gfm":
		o.GFMAutoLink = true
	case "protyle":
		o.GFMAutoLink = true
		o.ProtyleWYSIWYG = true
		o.ProtyleWYSIWYGAutoLink = true
		o.HTMLTag2TextMark = true
		o.KramdownSpanIAL = true
	case "protyle-keep":
		o.ProtyleWYSIWYG = true
		o.HTMLTag2TextMark = true
		o.KramdownSpanIAL = true
		o.KeepEscaped = true
	case "vditor":
		o.VditorWYSIWYG = true
		o.GFMAutoLink = true
	case "ir":
		o.VditorIR = true
	}
	return o
}

// dumpNode writes a node as [type, tokens hex, linkType, textMarkType, aHref, aTitle, textContent, ial, entity hex, children].
// A nil and an empty Tokens are both "".
func dumpNode(n *ast.Node) []any {
	var ial []string
	for _, kv := range n.KramdownIAL {
		ial = append(ial, kv[0]+"="+kv[1])
	}
	children := []any{}
	for c := n.FirstChild; c != nil; c = c.Next {
		children = append(children, dumpNode(c))
	}
	return []any{int(n.Type), hx(n.Tokens), n.LinkType, n.TextMarkType, n.TextMarkAHref, n.TextMarkATitle, n.TextMarkTextContent, strings.Join(ial, "\x1f"), hx(n.HtmlEntityTokens), children}
}

func dumpChildren(p *ast.Node) []any {
	ret := []any{}
	for c := p.FirstChild; c != nil; c = c.Next {
		ret = append(ret, dumpNode(c))
	}
	return ret
}

func sortedKeys(m map[string]bool) []string {
	ret := make([]string, 0, len(m))
	for k := range m {
		ret = append(ret, k)
	}
	sort.Strings(ret)
	return ret
}

func main() {
	out := map[string]any{}

	genTLD(out)
	genIsValidDomain(out)
	genEmailSegments(out)
	genHTMLStyle(out)
	genInlineHTMLHelpers(out)
	genTreeLinks(out)
	genInline(out)
	genAddSuffix(out) // must be last: it changes the global table

	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(out); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// ---- TLD table ----

func mixedCase(s string) string {
	b := []byte(s)
	for i := range b {
		if i%2 == 1 && b[i] >= 'a' && b[i] <= 'z' {
			b[i] -= 32
		}
	}
	return string(b)
}

func genTLD(out map[string]any) {
	table := linkGetValidDomainSuffixFromStr()
	entries := sortedKeys(table)
	// The package-level table must be the same set.
	same := len(linkValidAutoLinkDomainSuffix) == len(table)
	for k := range table {
		if !linkValidAutoLinkDomainSuffix[k] {
			same = false
		}
	}
	if !same {
		panic("package table differs from getValidDomainSuffixFromStr")
	}

	var probes []string
	for i, e := range entries {
		if i%6 != 0 {
			continue
		}
		probes = append(probes, e, strings.ToUpper(e), strings.ToUpper(e[:1])+e[1:], mixedCase(e), e+"x", e[:len(e)-1], e+".", "."+e, " "+e, e+" ", e+"\x00", "x"+e)
	}
	probes = append(probes, "", "com", "COM", "Com", "cOm", "xn--p1ai", "XN--P1AI", "xn--fiqs8s", "xn--", "中国", "ｃｏｍ", "co.uk", "uk", "invalid", "x", "123", "1a", "a1", "_", "-", "com-", "-com", "co\x00m", "é", "ſ", "K", "İ", "ı", "test", "example", "localhost", "local", "onion", "internal", "lan", "home", "corp", "ai", "io", "dev", "app", "zip", "mov", "新加坡", "рф", "бг", "संगठन")
	res := make([]any, 0, len(probes))
	for _, s := range probes {
		inTable := linkValidAutoLinkDomainSuffix[s]
		viaDomain := linkIsValidDomain(newTree(optionsByName("default")), []byte("http://"), []byte("example."+s))
		res = append(res, []any{s, inTable, viaDomain})
	}
	out["tld"] = map[string]any{"count": len(entries), "entries": entries, "allTLDs": linkAllTLDs, "probes": res}
}

// ---- isValidDomain ----

func genIsValidDomain(out map[string]any) {
	protocols := []string{"", "http://", "https://", "ftp://", "foo://", "HTTP://", "git+ssh://"}
	domains := []string{
		"example.com", "www.example.com", "a.b.c.d.com", "example.COM", "Example.Com", "EXAMPLE.COM", "example.com.", "example.", "..", "a..com", ".com", "com", ".", "", "a.b", "a.b.",
		"1.2.3.4", "1.2.3.4.", "256.256.256.256", "1.2.3", "1.2.3.com", "0.0.0.0", "1.2.3.4.5", "1.2.3.a", "12.34", "1.1",
		"a_b.example.com", "example_.com", "a.b_c.com", "_a.b.com", "a.b.c_d.com", "a.b.c.d_e.com", "a.b_.c.com", "a.b.c_.com", "a_.b.c.com", "a.b.c.d_.com", "a.b.c.d.e_f.com", "x.y_z.com", "x.y.z_.com",
		"x._y.z.com", "a.b.c.d.e.f_g", "a_b.com", "a.b_c", "a.b.c_d",
		"example.xn--p1ai", "xn--fiq02ib9d179b.xn--fiqs8s", "xn--fiq02ib9d179b.com", "中国移动.中国", "例え.jp", "a.b.c.中国", "中文.com", "a.中国", "é.com", "a.é", "ex ample.com", "example.com:80", "example.com/", "example.com?x", "example.com#x",
		"ex-ample.com", "-example.com", "example-.com", "ex--ample.com", "a-.b-.com", "-.-.com", "a.-b.com", "--.com", "a.--",
		"localhost", "localhost.localdomain", "a.co", "a.io", "a.ai", "a.dev", "a.app", "a.zip", "a.mov", "a.xyz", "a.test", "a.example", "a.invalid", "a.local", "a.b.xn--abc", "a.123", "a.1a", "a.a1", "a.0", "a.00",
		"a.com\x7f", "a.\x00", "a.com\x00", "\x00.com", "a.co m", "a.c\tom", "a.com\n", "a,b.com", "a+b.com", "a~b.com", "a!b.com", "a@b.com", "a%41.com", "a&b.com", "a(b).com", "a'b.com", "a*b.com", "a;b.com", "a=b.com", "a$b.com",
		strings.Repeat("a", 62) + ".com", strings.Repeat("a", 63) + ".com", strings.Repeat("a", 64) + ".com", strings.Repeat("a", 300) + ".com", "x." + strings.Repeat("b", 64), strings.Repeat("a.", 100) + "com", strings.Repeat("a.", 100) + "invalidtld", strings.Repeat("a_", 10) + ".com",
		"a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.v.w.x.y.z.com",
		"github.com", "GitHub.com", "gitee.com", "www.baidu.com", "ld246.com", "b3log.org", "88250.github.io", "a.b.co.uk", "a.b.com.cn", "co.uk", "com.cn", "a.b.c.org", "my_site.example.org", "sub_domain.example.org", "example.org_", "example_.org",
		"EXAMPLE.xn--P1AI", "Example.XN--p1ai", "example.cOm", "example.nEt", "example.ORG", "example.Io",
	}
	tlds := sortedKeys(linkGetValidDomainSuffixFromStr())
	for i, e := range tlds {
		if i%12 == 0 {
			domains = append(domains, "example."+e, "a.b."+e, "www.example."+e+".", "EX_AMPLE."+strings.ToUpper(e), "a.b.c_."+e)
		}
	}
	res := []any{}
	for _, p := range protocols {
		for i, d := range domains {
			// the full cross product for the standard protocols and a sample for the others
			if p != "" && p != "http://" && i%7 != 0 {
				continue
			}
			pb, db := []byte(p), []byte(d)
			res = append(res, []any{hx(pb), hx(db), linkIsValidDomain(newTree(optionsByName("default")), pb, db)})
		}
	}
	out["isValidDomain"] = res
}

func genEmailSegments(out map[string]any) {
	res := []any{}
	t := newTree(optionsByName("default"))
	for b := 0; b < 256; b++ {
		res = append(res, []any{b, linkIsValidEmailSegment1(t, byte(b)), linkIsValidEmailSegment2(t, byte(b))})
	}
	out["emailSegments"] = res
}

func genAddSuffix(out map[string]any) {
	t := newTree(optionsByName("default"))
	probe := []string{"zzzcustom", "Zzzcustom", "ZZZCUSTOM", "zzz-custom2", "com"}
	before := []any{}
	for _, s := range probe {
		before = append(before, linkIsValidDomain(t, []byte("http://"), []byte("a."+s)))
	}
	parse.AddAutoLinkDomainSuffix("zzzcustom")
	parse.AddAutoLinkDomainSuffix("ZZZ-custom2")
	after := []any{}
	for _, s := range probe {
		after = append(after, linkIsValidDomain(t, []byte("http://"), []byte("a."+s)))
	}
	out["addSuffix"] = map[string]any{"probe": probe, "before": before, "after": after, "added": []string{"zzzcustom", "ZZZ-custom2"}}
}

// ---- HTML text styles ----

type textStyle = parse.HTMLTextStyle

func styleArr(s textStyle) []any {
	return []any{s.Color, s.Background, s.Family, s.Size, s.SizeUnit}
}


func lookupAtom(name string) atom.Atom { return atom.Lookup([]byte(name)) }

func domNode(tag string, attrs [][2]string) *html.Node {
	n := &html.Node{Type: html.ElementNode, Data: tag, DataAtom: lookupAtom(tag)}
	for _, kv := range attrs {
		n.Attr = append(n.Attr, &html.Attribute{Key: kv[0], Val: kv[1]})
	}
	return n
}

func styleCorpus() []string {
	var ret []string
	add := func(s ...string) { ret = append(ret, s...) }

	colors := []string{"#fff", "#FFFF", "#ffffff", "#FFFFFFFF", "#ff", "#fffff", "#fffffff", "#fffffffff", "#ggg", "#GGGGGG", "# fff", "#", "red", "RED", "Red", "rEd", "transparent", "currentColor", "CURRENTCOLOR", "currentcolor", "inherit", "initial", "unset", "revert", "revert-layer", "INHERIT", "Initial",
		"rgb(1,2,3)", "rgba(1,2,3,.5)", "RGB(255 0 0 / 50%)", "rgb(1, 2, 3)", "rgb(100%,0%,0%)", "hsl(120, 100%, 50%)", "hsla(120,100%,50%,.3)", "HSL(120deg 100% 50%)", "rgb(1,2,3", "rgb()", "rgb(a)", "rgb(1,2,3);", "rgb(+1,-2,3.5)", "rgb(1 2 3)", "color(srgb 1 0 0)", "lab(50% 40 59.5)", "rgbx(1,2,3)",
		"url(x)", "url(https://example.com)", "var(--x)", "calc(1px)", "expression(alert(1))", "red blue", "red;blue", "#12", "ſ", "K", "ſſ", "Kelvin", "ｒｅｄ", "红色", "red1", "r3d", "-red", "red!", "\"red\"", "'red'", "red\\", "\\red", "rgb(1,2,3)x", "xrgb(1,2,3)", " red ", "\tred\n"}
	for _, c := range colors {
		add("color:"+c, "background-color:"+c, "background:"+c, "color: "+c+" !important")
	}
	sizes := []string{"12px", "12PX", "12 px", "1.5em", ".5em", "5.", "-1px", "+1px", "0px", "0", "0.0em", "1e3px", "10000px", "10001px", "10000.5px", "9999.99px", "99999999999999999999px", "12pt", "12PT", "1pc", "1in", "1cm", "1mm", "1rem", "1REM", "50%", "100%", "150%", "0%", "10000%", "10001%", "1.5rem", "00012px", "0.00001px",
		"x-small", "xx-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large", "XX-LARGE", "X-Small", "smaller", "larger", "SMALLER", "Larger", "initial", "inherit", "unset", "revert", "revert-layer", "calc(1px + 2px)", "12", "px", "12px12", "12ex", "12ch", "12vw", "12vh", "12q", "12 em", "1,5em", "1.2.3em", "1/2em", "١٢px", "12px;", "12px !important", "12 px !important", "normal", "none", "", "12ᵖˣ"}
	for _, s := range sizes {
		add("font-size:"+s, "font-size: "+s+" ;", "font-size:"+s+";color:red")
	}
	families := []string{"Arial", "'Noto Sans', serif", "\"Microsoft YaHei\"", "'Noto Sans', \"Microsoft YaHei\", sans-serif", "a;b", "url(x)", "a\\b", "'unbalanced", "\"unbalanced", "'a\"b'", "\"a'b\"", "''", "\"\"", "宋体", "微软雅黑, 宋体", "Arial Black", "Times New Roman", "monospace", "system-ui", "-apple-system", "_x", "a.b", "a/b", "a:b", "a#b", "a(b)", "inherit", "initial", "unset", "revert", "currentcolor", strings.Repeat("a", 1024), strings.Repeat("a", 1025), strings.Repeat("宋", 400), strings.Repeat("宋", 342), "😀", "a😀", "ａｒｉａｌ", "arial1", "1arial", "a  b", "a\tb", "a\u00a0b", "a\u3000b", "a,b,c", "a, ,b", ",", "-", "a-b_c"}
	for _, f := range families {
		add("font-family:"+f, "font-family: "+f+" !important")
	}
	add("",
		";", ";;;", "color", ":red", "color:", "color:;", ":", "::", "color:red:blue", "color:red;color:blue", "color:red !important;color:blue", "color:red;color:blue !important", "color:red !important;color:blue !important", "color : red ; background-color : blue",
		"COLOR: blue !important;color: green;background-color:currentColor", "color:red ! important", "color:red !IMPORTANT", "color:red!important", "color:red ! IMPORTANT ;", "color:red!important!important", "color:red!", "color:!important", "color:red!imp", "color:red !important x",
		"font-family:\"A;B\";color:rgb(1, 2, 3); COLOR:blue ! important;color:red;", "font-family:'x\\';y';color:red", "font-family:\"a\\\";b\";color:red", "color:red\\;blue", "color:rgb(1;2;3)", "color:rgb(1;2;3;color:blue", "color:red);background:blue", "color:(red", "background:url(a;b);color:red",
		"background-color:red;background:blue", "background:blue;background-color:red", "background:blue!important;background-color:red", "background-color:red!important;background:blue", "background:rgb(255,165,61)", "background:url(https://example.com/image.png)", "background: #fff url(x) no-repeat", "background:red;background:url(x)",
		"Color:red", "COLOR:RED", "cOlOr:red", " color : red ", "\tcolor:\tred\n", "color:red\n;background-color:blue\n", "position:fixed;color:red", "font-size:calc(1px + 2px)", "position:fixed;top:0;left:0;color:red;font-size:12px",
		"font-weight:bold", "font-style:italic", "text-decoration:underline", "color:red;font-size:12px;font-family:Arial;background-color:blue;font-weight:bold", "COLOR:RED;FONT-SIZE:LARGE", "font-size:smaller;font-size:larger", "font-size:12px;font-size:bogus", "font-size:bogus;font-size:12px",
		"color:\u00e9", "颜色:red", "color:红", "ключ:значение", "color:red;;;background-color:blue;;", ";color:red;", ";;color:red", "a:b;c:d;e:f", "a", "a:", "a:b:c:d", "key with space:value", "a:\"b;c\";d:e", "a:'b;c';d:e", "a:(b;c);d:e", "a:b\\", "a:b\\;c:d", "\\", "\\\\", "\"", "'", "(", ")", "((", "))", ")(", "a:(b", "a:b)", "a:b);c:d", "a:(b));c:d")
	// colors in every position with other declarations
	for _, c := range []string{"red", "#abc", "rgb(1,2,3)", "currentColor"} {
		add("background-color:"+c+";color:"+c, "color:"+c+";background-color:currentColor", "color:blue;color:"+c+" !important;color:green")
	}
	return ret
}

func genHTMLStyle(out map[string]any) {
	styles := styleCorpus()

	// HTMLStyleDeclarations
	decl := []any{}
	for _, s := range styles {
		m := parse.HTMLStyleDeclarations(s)
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		pairs := []any{}
		for _, k := range keys {
			pairs = append(pairs, []string{k, m[k]})
		}
		decl = append(decl, []any{s, pairs})
	}
	out["styleDecl"] = decl

	// ResolveHTMLTextStyle and CSS
	parents := []textStyle{
		{},
		{Color: "red", Family: "Arial", Size: 24, SizeUnit: "px"},
		{Size: 2, SizeUnit: "em", Background: "blue"},
		{Size: 1.5, SizeUnit: "rem", Color: "#fff"},
		{Size: 13.333333, SizeUnit: "px"},
	}
	resolve := []any{}
	tags := []struct {
		tag   string
		attrs [][2]string
	}{
		{"span", nil},
		{"small", nil},
		{"strong", nil},
		{"font", [][2]string{{"color", "red"}, {"face", "Arial"}, {"size", "3"}}},
	}
	for si, s := range styles {
		for ti, tg := range tags {
			if ti > 0 && si%15 != 0 {
				continue
			}
			for pi, p := range parents {
				if (pi > 1 && si%13 != 0) || (pi == 0 && si%2 == 1) {
					continue
				}
				attrs := append([][2]string{{"style", s}}, tg.attrs...)
				n := domNode(tg.tag, attrs)
				got := parse.ResolveHTMLTextStyle(n, p)
				resolve = append(resolve, []any{tg.tag, attrs, styleArr(p), styleArr(got), got.CSS()})
			}
		}
	}
	// font attributes
	for _, fc := range []string{"", "red", "#abc", "bad value", "inherit", "currentColor", "RED"} {
		for _, ff := range []string{"", "Arial", "a;b", "'Noto Sans'"} {
			for _, fs := range []string{"", "1", "2", "3", "4", "5", "6", "7", "0", "8", "-1", "x", "3.5", "+3", " 3"} {
				attrs := [][2]string{{"color", fc}, {"face", ff}, {"size", fs}}
				if fs == "3" && ff == "" {
					attrs = append(attrs, [2]string{"style", "font-size:20px"})
				}
				n := domNode("font", attrs)
				got := parse.ResolveHTMLTextStyle(n, parents[1])
				resolve = append(resolve, []any{"font", attrs, styleArr(parents[1]), styleArr(got), got.CSS()})
			}
		}
	}
	out["styleResolve"] = resolve

	// CSS on arbitrary values
	css := []any{}
	for _, size := range []float64{0, 1, 1.5, 0.000001, 0.0000004, 0.0000005, 0.0000015, 12.3456785, 12.3456795, 1e-7, 100, 1234567.891, 4.5e15, 37.795275590551185, 3.7795275590551185, 1.3333333333333333, 24 / 1.2, 13.333333 * 1.2, 0.888889, 1e21, 5e-324, 1e22} {
		for _, unit := range []string{"", "px", "em", "rem"} {
			s := textStyle{Color: "red", Background: "", Family: "Arial", Size: size, SizeUnit: unit}
			css = append(css, []any{styleArr(s), s.CSS()})
		}
	}
	css = append(css, []any{styleArr(textStyle{}), textStyle{}.CSS()}, []any{styleArr(textStyle{Background: "blue"}), textStyle{Background: "blue"}.CSS()})
	out["styleCSS"] = css

	// safeHTMLFontFamily
	ff := []any{}
	for _, s := range styles {
		if strings.HasPrefix(s, "font-family:") {
			v := strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(s, "font-family:"), " "), " !important")
			ff = append(ff, []any{v, linkSafeHTMLFontFamily(v)})
		}
	}
	out["fontFamily"] = ff

	// ApplyHTMLTextSemantics
	semStyles := [][]string{
		{"font-weight:bold"}, {"font-weight:BOLD"}, {"font-weight:bolder"}, {"font-weight:lighter"}, {"font-weight:normal"}, {"font-weight:600"}, {"font-weight:599"}, {"font-weight:700"}, {"font-weight:900"}, {"font-weight:1000"}, {"font-weight:100"}, {"font-weight:99999999999999999999"}, {"font-weight:-600"}, {"font-weight:+600"}, {"font-weight:600.5"}, {"font-weight:6e2"}, {"font-weight: 600 "}, {"font-weight:0600"}, {"font-weight:600px"},
		{"font-style:italic"}, {"font-style:ITALIC"}, {"font-style:oblique"}, {"font-style:oblique 10deg"}, {"font-style:normal"}, {"font-style:Oblique"},
		{"text-decoration:underline"}, {"text-decoration:line-through"}, {"text-decoration:underline line-through"}, {"text-decoration-line:underline"}, {"text-decoration-line:line-through"}, {"text-decoration:none"}, {"text-decoration:UNDERLINE"}, {"text-decoration:overline"}, {"text-decoration:underline dotted red"},
		{"font-weight:bold;font-style:italic;text-decoration:underline line-through"},
		{"", "font-weight:bold"}, {"font-weight:normal", "font-weight:bold"}, {"font-weight:bold", "font-weight:normal"}, {"font-style:italic", "text-decoration:underline"}, {"text-decoration:underline", "text-decoration:line-through", "font-weight:700"},
		{"color:red"}, {""}, {"font-weight:", "font-weight:900"},
	}
	sem := []any{}
	for _, chain := range semStyles {
		for _, initial := range []string{"text", "strong", "u", "em", "s", "strong em", ""} {
			var dom *html.Node
			for _, st := range chain {
				n := domNode("span", [][2]string{{"style", st}})
				n.Parent = dom
				dom = n
			}
			node := &ast.Node{Type: ast.NodeTextMark, TextMarkType: initial}
			parse.ApplyHTMLTextSemantics(node, dom)
			sem = append(sem, []any{chain, initial, node.TextMarkType})
		}
	}
	out["styleSemantics"] = sem

	// HTMLNodeTextStyle over parent chains
	chains := [][][2]string{
		{{"span", "color:red"}},
		{{"span", "color:red"}, {"span", "font-size:2em"}},
		{{"div", "font-size:12px"}, {"small", ""}, {"span", "font-size:larger"}},
		{{"font", ""}, {"span", "font-size:50%"}},
		{{"span", "font-size:20px"}, {"small", ""}, {"small", ""}, {"span", "font-size:1.5em;color:blue"}},
		{{"span", "background:red"}, {"span", "background:inherit"}, {"span", "background-color:currentColor"}},
		{{"span", "font-size:12pt"}, {"span", "font-size:2em"}},
		{{"span", "font-size:xx-large"}, {"span", "font-size:smaller"}},
		{{"strong", "color:#ff0000"}, {"a", "color:inherit"}, {"em", "color:initial"}},
		{{"span", "font-family:Arial"}, {"span", "font-family:bad;url(x)"}, {"span", "font-family:inherit"}},
		{},
	}
	nts := []any{}
	for _, ch := range chains {
		var dom *html.Node
		args := [][2]string{}
		for _, st := range ch {
			n := domNode(st[0], [][2]string{{"style", st[1]}})
			n.Parent = dom
			dom = n
			args = append(args, st)
		}
		if dom == nil {
			nts = append(nts, []any{args, nil})
			continue
		}
		got := parse.HTMLNodeTextStyle(dom)
		nts = append(nts, []any{args, styleArr(got), got.CSS()})
	}
	out["nodeTextStyle"] = nts

	// StyleValue, startEndBlank, ContainTextMark
	sv := []any{}
	for _, s := range []string{"", " ", "a", " a ", "a  b", "a\tb", "a\nb", "a \n b", "  width:  10px ;\n height : 20px ", "\n\n", "a\r\nb", "a\u00a0b", "a\u3000b", "color:red;\n\tfont-size:12px;", "中文  样式"} {
		sv = append(sv, []any{s, parse.StyleValue(s)})
	}
	out["styleValue"] = sv
	seb := []any{}
	for _, s := range []string{"", " ", "  ", "a", " a", "a ", " a ", "\t\na\n\t", "　a　", "　", "a b", " a b ", "\u00a0a\u00a0", "  中文  ", "\n", "x\n\n", "\r a \r", "\u2003a"} {
		a, b := linkStartEndBlank(s)
		seb = append(seb, []any{s, a, b})
	}
	out["startEndBlank"] = seb
	ctm := []any{}
	for _, tt := range []string{"", "a", "strong", "strong em", "a strong", "text", "inline-memo", "code kbd", "code  kbd", " code", "code "} {
		for _, q := range [][]string{{"strong"}, {"code", "kbd"}, {"a"}, {"text"}, {""}, {}, {"em", "inline-math"}, {"kbd", "tag", "block-ref"}} {
			n := &ast.Node{TextMarkType: tt}
			ctm = append(ctm, []any{tt, q, parse.ContainTextMark(n, q...)})
		}
	}
	out["containTextMark"] = ctm
}

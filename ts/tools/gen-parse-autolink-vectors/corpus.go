package main

import (
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

// ---- inline HTML helpers on bytes ----

func helperCorpus() []string {
	ret := []string{
		// CDATA
		"![CDATA[x]]>", "![CDATA[]]>", "![CDATA[ ]]>x", "![CDATA[x]]", "![CDATA[x]>", "![CDATA[x", "![CDATA[", "![cdata[x]]>", "![CDATA x]]>", "!CDATA[x]]>", "![CDATA[a]]>b]]>", "![CDATA[中]]>", "![CDATA[]]]>", "![CDATA[x]]]>", "![CDATA[x]]>]]>", "![CDATA[\n]]>", "![CDATA[<a>]]>rest",
		// declarations
		"!DOCTYPE html>", "!DOCTYPE>", "!DOCTYPE", "!doctype html>", "!A b>", "!AB>", "!A>", "!", "!1>", "!DOCTYPE html", "!ELEMENT br EMPTY>", "!ATTLIST x>", "!DOC TYPE>", "!DOCTYPEhtml>", "!DOCTYPE html>x", "!AB c>d>", "!A\n>", "!A", "!A ", "!AB", "!aB>", "!Ab c>", "!中>",
		// processing instructions
		"?php echo 1; ?>", "?>", "?", "??>", "?x", "?x?", "?x?>", "?xml version=\"1.0\"?>rest", "?a>b?>", "x", "?\n?>", "?a?b?>c", "?中?>",
		// comments
		"!-- x -->", "!---->", "!-->", "!--", "!-- x --", "!-- x ->", "!-- a -- b -->", "!--->", "!--a-->b", "!-", "!--  --->", "!-- 中 -->", "!--\n-->", "!-- --> -->", "!----->", "!--a--->",
		// tag names
		"a", "a1", "a-b", "A", "a b", "1a", "-a", "a>", "a/>", "br/>", "中", "a中", "a_b", "a.b", "a:b", "ABC-def9", "h1", "x-y-z>",
		// attributes
		" href=\"x\"", " href='x'", " href=x", " href=xy", " href = \"x\"", " a", " a b", "  a  ", " a=\"\"", " a=''", " a=", " a= ", " a=\"x", " a='x", " a=x>", " a=xy>", " a=x y", " a=x\"y", " a=x'y", " a=x=y", " a=x<y", " a=x`y", " data-x.y_z:w=\"1\"", " _a", " :a", " 1a", " -a", "", " ", "\t", " \n a=\"b\"", ">", " >", "/>", " /", " a/>", " a=b/>", " a=\"b\"c", " a=\"b\" c=\"d\"", " a=\"中\"", " 中=\"x\"", " a=\"b\"\"c\"", " a=\"\n\"", "=\"x\"", " ==", " a=\"x\"=", " a=\"", " a='", " a=\"\"\"", " a=\"b\" ", " a=b ", " a=b\t", " a = b", " a =b", " a= b", " a=b c", " a=bc d=ef", " a=b>c", " a=b>", " a=bb>", " a=\"b\">", " a = 'b' c", " a\n=\n\"b\"", "\ta=\"b\"", " a=\"b\"\n", " a=\"b\\\"", " a=\"b\\\"c\"", " ab", " a1-b_c.d:e", " a==b", " a=\"=\"", " a='\"'", " a=\"'\"", " a= \"b\"", " a=\t'b'", "  \t ", "a=\"b\"", "=x", "= x", "=xy", "=x>", "= \"x\"", "  =  'x'  ", "=\"\"", "='", "=\"", "=", "= ", "=  ", "x", "x=", "x y", "b", ">x", "\"x\"", "'x'", "a", "ab", "abc", "-", "_", ":", ".",
		" id=\"a\" class=\"b\" style=\"c:d\"", " id=\"a\"class=\"b\"", " id=a class=b", " src=\"http://x/y?a=b&c=d\" alt=\"中文\"", "{: id=\"20200101-abc\" updated=\"20200101\"}",
	}
	// every single byte and every pair from a small alphabet
	alphabet := []string{"a", "1", " ", "	", "=", "\"", "'", ">", "<", "/", "?", "!", "-", "_", "中"}
	for _, a := range alphabet {
		ret = append(ret, a)
		for _, b := range alphabet {
			ret = append(ret, a+b)
		}
	}
	for _, a := range []string{" ", "="} {
		for _, b := range []string{"a", "a=", "a=b", "a=\"b\"", "a='b'", "a=\"b", "a=b>", "ab>"} {
			ret = append(ret, a+b, a+b+" ", a+b+" c")
		}
	}
	return ret
}

func genInlineHTMLHelpers(out map[string]any) {
	corpus := helperCorpus()
	t := newTree(optionsByName("default"))

	three := func(f func(*parse.Tree, []byte) (bool, []byte, []byte)) []any {
		res := []any{}
		for _, s := range corpus {
			b := []byte(s)
			res = append(res, vec([]any{hx(b)}, func() any {
				v, r, c := f(t, exact(b))
				return []any{v, hx(r), hx(c)}
			}))
		}
		return res
	}
	out["parseCDATA"] = three(linkParseCDATA)
	out["parseDeclaration"] = three(linkParseDeclaration)
	out["parseProcessingInstruction"] = three(linkParseProcessingInstruction)
	out["parseHTMLComment"] = three(linkParseHTMLComment)

	pn := []any{}
	for _, s := range corpus {
		b := []byte(s)
		pn = append(pn, vec([]any{hx(b)}, func() any {
			r, n := linkParseTagName(t, exact(b))
			return []any{hx(r), hx(n)}
		}))
	}
	out["parseTagName"] = pn

	ta := []any{}
	for _, s := range corpus {
		b := []byte(s)
		ta = append(ta, vec([]any{hx(b)}, func() any {
			v, r, a, n, val := parse.TagAttr(exact(b))
			return []any{v, hx(r), hx(a), hx(n), hx(val)}
		}))
	}
	out["tagAttr"] = ta

	pv := []any{}
	for _, s := range corpus {
		b := []byte(s)
		pv = append(pv, vec([]any{hx(b)}, func() any {
			v, r, spec := linkParseAttrValSpec(exact(b))
			return []any{v, hx(r), hx(spec)}
		}))
	}
	out["parseAttrValSpec"] = pv

	pa := []any{}
	for _, s := range corpus {
		b := []byte(s)
		pa = append(pa, vec([]any{hx(b)}, func() any {
			r, n := linkParseAttrName(exact(b))
			return []any{hx(r), hx(n)}
		}))
	}
	out["parseAttrName"] = pa
}

// ---- links on text nodes ----

func linkCores() []string {
	return []string{
		"http://example.com", "https://example.com/path", "https://example.com/a(b)c", "https://example.com/a(b)", "https://en.wikipedia.org/wiki/Foo_(bar)", "http://example.com:8080/x", "http://example.com:80", "http://example.com:", "http://example.com:a", "http://example.com:80a/x", "http://a.b:1:2",
		"www.example.com", "www.example.com/path?x=1&y=2#z", "www.a.co", "www.", "www.x", "www.example", "www.example.invalid", "WWW.example.com", "Www.example.com", "xwww.example.com", "www.example.com.", "www..com",
		"ftp://example.com/file", "ftp://a.b", "FTP://example.com", "HTTP://example.com", "Http://Example.Com/Path", "foo://bar", "foo://bar.baz/qux", "git+ssh://host/path", "custom://x", "a://b", "x://yyyyy", "ab://cd.ef", "a1b2://x.y.z/", "://x.y.z", "http://", "https://", "http:///x", "http://x", "http://x.y",
		"https://github.com/88250/lute/issues/161", "https://github.com/88250/lute/issues/161?x=1", "https://github.com/88250/lute/issues/abc", "https://github.com/88250/lute/issues/", "https://github.com/88250/lute/pull/208", "https://github.com/88250/lute/pull/208?w=1", "https://github.com/issues/1", "https://github.com/pull/1",
		"https://github.com/a/issues/1/pull/2", "https://github.com/a/pull/1/issues/2", "https://github.com/", "https://github.com/a", "https://github.com/issues/", "https://github.com/a/issues/12#c", "https://github.com/a/issues/12)", "http://github.com/a/issues/1", "https://github.com/a/issues/12/", "https://github.com/a/b/issues/12", "https://github.com/a/issues/1?x?y",
		"http://中文.com", "http://例え.jp/パス", "https://example.com/中文路径", "https://example.com/%E4%B8%AD", "https://example.com/a%2", "https://example.com/%zz", "https://example.com/a b", "http://localhost", "http://127.0.0.1", "http://127.0.0.1:8080/", "http://1.2.3", "http://256.1.1.1", "http://a_b.example.com", "http://example_.com", "http://a.b_c.com", "http://example.invalid",
		"http://.com", "http://a..com", "http://-a.com", "http://example.com.", "http://example.com..", "http://[::1]/", "http://user:pass@example.com/", "http://user@example.com", "https://example.com/?q=a&amp;b", "https://example.com/a&amp", "https://example.com/&a;", "https://example.com/&;", "https://example.com/&#x41;", "https://example.com/&a1;", "https://example.com/&b#;", "https://example.com/&amp;&lt;",
		"https://example.com/a?b#c", "https://example.com/a?", "https://example.com/a?b=", "https://example.com/(a)(b)", "https://example.com/((a)", "https://example.com/(a))", "https://example.com/a)", "https://example.com/a))))", "https://example.com/(", "https://example.com/)", "https://example.com/)(", "https://example.com/a_b_", "https://example.com/a*", "https://example.com/a~", "https://example.com/a~~", "https://example.com/a.,", "https://example.com/a.).",
		"a@b.com", "foo.bar+baz@example.co.uk", "a@b", "@b.com", "a@", "a@@b.com", "a@b.c_", "a@b.com.", "a@b.com-", "a@b.com_", "a.@b.com", "a@.com", "a@b..com", "A@B.COM", "中@b.com", "a@中.com", "a b@c.com", "a@b.com,c@d.com", "mailto:a@b.com", "a@b.com/c", "a+b@c-d.org", "_@_._", "a@b.c.", "a.@", "a-@b", "a_@b", "a.@.", "a+@b", "-@-", "@", "@@", "a@b@c", "a@b.com@c.com", "x@y.z", "user.name+tag@sub.domain.example.org",
		"https://example.com", "‸http://a.com", "http://a.com‸", "http://a.com/‸", "a@b.com‸", "‸a@b.com", "http://a.com/%E2%80%B8", "www.a.com‸", "‸www.a.com",
	}
}

func linkTexts() []string {
	cores := linkCores()
	prefixes := []string{"", "see ", "(", "中文", "a", "\n", "http://x.org "}
	suffixes := []string{"", ".", ",", ")", ".)", "?", "!", "~", "*", "_", ":", ";", "&amp;", "&lt;", ")))", " and more", "\n", "<b>", " www.b.co", " http://c.io/x", " d@e.fg", "。", "、中文", "\"", "'", "]", "}", "/", "#"}
	var ret []string
	for i, c := range cores {
		ret = append(ret, c)
		for j, p := range prefixes {
			if (i+j)%14 == 0 {
				ret = append(ret, p+c)
			}
		}
		for j, s := range suffixes {
			if (i+j)%17 == 0 {
				ret = append(ret, c+s)
			}
		}
		if i%7 == 0 {
			ret = append(ret, "pre "+c+" post", "("+c+")", "<"+c+">", c+" "+c, c+"\n"+c)
		}
	}
	ret = append(ret,
		"www.example.com http://example.org", "http://a.com http://b.com", "see http://a.com, then www.b.com/x.", "(https://a.com)", "<https://a.com>", "a http://b.com c@d.com e", "http://a.com/b\nhttp://c.com", "x://a.b://c.d", "foo://bar http://x.com", "http://x.com foo://bar", "http://a.com/é",
		"www.a.com www.b.com www.c.com", "http://a.com http://b.com http://c.com", "text a@b.com text c@d.com text", "a@b.com a@b.com", "a@b.com\na@b.com", "  a@b.com  ", " ", "  ", "\t", "a", "ab", "abcd", "abcde", "abcde ", " abcde", "w", "ww", "www", "www.", "www.a", "www.ab", "www.abc", "www.a.b", "http:", "http:/", "http://a", "ftp://", "ftp://a", "ftp://a.b",
		"http://a.com\u00a0http://b.com", "http://a.com\u3000http://b.com", "http://a.com<b>http://b.com", "https://a.com/\x00x", "https://a.com/\x7f", "http://a.com\xff", "a@b.com\xff", "\xff\xfehttp://a.com", "http://\xff.com", "http://a.com/\xe4\xb8",
		"foo://bar foo://baz", "foo://bar.baz foo://baz.qux", "http://a.com foo://bar.baz", "foo://bar.baz http://a.com", "foo://bar.baz/x http://a.com/y", "xhttp://a.com", "http://a.comhttp://b.com", "a.http://b.com", "1http://a.com",
		"http://a.com/aaaa bbbb http://c.com/dddd", "xx http://a.com/ yy http://b.com/ zz", "www.a.com/x www.b.com/y", "ab www.a.com cd www.b.com ef",
	)
	return ret
}

func buildTree(o *parse.Options, kind string, text string) (*parse.Tree, *ast.Node) {
	t := newTree(o)
	root := &ast.Node{Type: ast.NodeDocument}
	para := &ast.Node{Type: ast.NodeParagraph}
	root.AppendChild(para)
	t.Root = root
	node := &ast.Node{Type: ast.NodeText, Tokens: exact([]byte(text))}
	switch kind {
	case "prev":
		para.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: exact([]byte("pre "))})
	case "html":
		para.AppendChild(&ast.Node{Type: ast.NodeInlineHTML, Tokens: exact([]byte("<a href=\"x\">"))})
	case "link":
		l := &ast.Node{Type: ast.NodeLink}
		para.AppendChild(l)
		node = &ast.Node{Type: ast.NodeText, Tokens: exact([]byte(text))}
		l.AppendChild(node)
		return t, para
	}
	para.AppendChild(node)
	if kind == "html" {
		para.AppendChild(&ast.Node{Type: ast.NodeInlineHTML, Tokens: exact([]byte("</a>"))})
	}
	if kind == "next" {
		para.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: exact([]byte(" post"))})
	}
	return t, para
}

func genTreeLinks(out map[string]any) {
	texts := linkTexts()
	res := []any{}
	run := func(optName, kind, mode, text string) {
		args := []any{optName, kind, mode, hx([]byte(text))}
		res = append(res, vec(args, func() any {
			t, para := buildTree(optionsByName(optName), kind, text)
			switch mode {
			case "email":
				linkParseGFMAutoEmailLink(t, para)
			case "link":
				linkParseGFMAutoLink(t, para)
			case "both":
				linkParseGFMAutoEmailLink(t, para)
				linkParseGFMAutoLink(t, para)
			}
			return dumpChildren(para)
		}))
	}
	for i, s := range texts {
		run("default", "single", "both", s)
		if i%4 == 0 {
			run("default", "single", "link", s)
		}
		if i%4 == 1 {
			run("default", "single", "email", s)
		}
		if i%7 == 0 {
			run("default", "prev", "both", s)
		}
		if i%11 == 0 {
			run("default", "html", "email", s)
		}
		if i%13 == 0 {
			run("default", "link", "both", s)
		}
		if i%11 == 1 || strings.Contains(s, "‸") {
			run("protyle", "single", "both", s)
			run("vditor", "single", "both", s)
		}
	}
	out["treeLinks"] = res

	// newLink
	nl := []any{}
	for _, optName := range []string{"default", "protyle", "vditor"} {
		for _, typ := range []ast.NodeType{ast.NodeLink, ast.NodeImage} {
			for _, link := range []int{0, 1, 2} {
				for _, tc := range [][3]string{
					{"text", "dest", ""}, {"text‸", "dest%E2%80%B8", ""}, {"‸text", "%E2%80%B8dest", ""}, {"‸text‸", "%E2%80%B8dest%E2%80%B8", ""}, {"text‸", "dest", ""}, {"text", "dest%E2%80%B8", ""}, {"‸", "%E2%80%B8", ""},
					{"a%20b", "c", "title"}, {"中文%E4%B8%AD", "d", "t"}, {"", "", ""}, {"%zz%", "%", "x"}, {"t", "d", "T"},
				} {
					args := []any{optName, int(typ), link, hx([]byte(tc[0])), hx([]byte(tc[1])), tc[2]}
					nl = append(nl, vec(args, func() any {
						t := newTree(optionsByName(optName))
						var title []byte
						if tc[2] != "" {
							title = []byte(tc[2])
						}
						n := linkNewLink(t, typ, exact([]byte(tc[0])), exact([]byte(tc[1])), title, link)
						p := &ast.Node{Type: ast.NodeParagraph}
						p.AppendChild(n)
						return append(dumpChildren(p), "ref:"+hx(n.LinkRefLabel))
					}))
				}
			}
		}
	}
	out["newLink"] = nl
}

// ---- whole inline parses ----

func inlineCorpus() []string {
	ret := []string{
		"<http://a.b>", "<http://a.b/c?d=e#f>", "<a@b.com>", "<foo@bar.com>", "x <foo@bar.com>", "<foo@bar>", "<foo@bar.>", "<foo@>", "<@bar.com>", "<foo bar@baz.com>", "<mailto:a@b.com>", "<irc://foo.bar:2233/baz>", "<a:b>", "<ab:cd>", "<abc:d e>", "<abc:>", "<abc:", "<a>", "<中文:x>", "x <http://a.b> y", "<http://a.b><http://c.d>", "<http://a.b/中>", "<http://a.b/‸>",
		"<a href=\"x\">t</a>", "<span>t</span>", "<b>t</b>", "<br>", "<br/>", "<br />", "<BR>", "<Br />", "a<br>b", "<img src=\"x\" alt=\"y\">", "<img src=\"x\" width=\"20\" height=\"5\">", "<img src=\"x\" height=\"5\">", "<img src=\"x\" width=\"20px\" title=\"T\">", "<IMG SRC=x>", "<img src=x>", "<img>", "<img/>", "<img src=\"a\"/>", "<img src=\"a\" />", "<imgx src=\"a\">", "<img src=\"a\" width=\" 30 \">", "<img src=\"a\" width=\"50%\">",
		"<!-- c -->", "<!---->", "<!-->", "<!--", "<!-- a --> b", "<?php ?>", "<?x", "<!DOCTYPE html>", "<!A b>", "<![CDATA[x]]>", "<![CDATA[x", "<![CDATA[x]]> y",
		"<a href=x>", "<a b='c' d=\"e\" f=g h>", "<a  b = \"c\">", "<a b=\">", "<a b='c>", "<a =\"x\">", "<1>", "< a>", "<a", "<", "<>", "</>", "</a", "</a >", "</a b>", "</ a>", "<a/>", "<a />", "<a/ >", "<a b/>", "<a b=c/>", "<a b=\"c\"/>", "<a\nb=\"c\">", "<a\tb>", "<a-b>", "<a-b c>", "<A HREF=\"x\">", "<a:b>", "<a_b>", "<a.b>", "<a1>", "<h1>t</h1>", "<a b=c d=e>", "<a b=cd>", "<a b=c>", "<a b = c>", "<a b=>", "<a b='>", "<a b=c`>", "<a b=c\">",
		"a < b", "a <b", "a<b>c", "<<a>>", "<a<b>", "<a><b>", "<a><b></b></a>", "1 < 2 > 3", "<3", "<中>", "<a中>", "<a 中=\"x\">", "<a b=\"中\">",
		"<script>alert(1)</script>", "<style>x</style>", "<div>x</div>", "<p>x</p>", "<table><tr><td>x</td></tr></table>", "<iframe src=\"x\"></iframe>", "<!-- <b> -->", "<![CDATA[<b>]]>",
		"<a href=\"x‸\">t</a>", "<a‸ href=\"x\">", "<a href=\"x\"‸>", "<a href=\"x\" ‸>", "<a ‸href=\"x\">", "<a href=‸\"x\">", "<a‸>", "<‸a>", "<a>‸", "<!-- ‸ -->", "<a href=\"‸\">", "<a b=\"c\"‸d=\"e\">", "<a b=\"c\" ‸d=\"e\">",
		"<span data-type=\"a\" data-href=\"https://x.y\">text</span>", "<span data-type=\"a\" data-href=\"https://x.y\" data-title=\"T\">text</span>", "<span data-type=\"strong em\">x</span>", "<span data-type=\"code\">c</span>", "<span data-type=\"inline-math\" data-subtype=\"math\" data-content=\"x+y\">x</span>",
		"<span data-type=\"block-ref\" data-id=\"20200101010101-abcdefg\" data-subtype=\"s\">r</span>", "<span data-type=\"file-annotation-ref\" data-id=\"x\">y</span>", "<span data-type=\"inline-memo\" data-inline-memo-content=\"m\">t</span>", "<span data-type=\"tag\">t</span>", "<span data-type=\"em strong\">x</span>", "<span data-type=\"a strong\" data-href=\"u\">x</span>",
		"<span data-type=\"text\" style=\"color:red\">x</span>", "<span data-type=\"text\" style=\"color: red;  font-size: 12px\">x</span>", "<span data-type=\"text\" data-x=\"y\" style=\"color:red\">x</span>", "<span data-type=\"text\" data-x=\"y\">x</span>", "<span data-type=\"text\" custom-attr=\"v\">x</span>",
		"<span data-type=\"a\" data-href=\"x\">t</span> and <span data-type=\"code\">c</span>", "<span data-type=\"a\">unclosed", "<span data-type=\"a\"></span>", "<span data-type=\"a\"><span data-type=\"b\">x</span></span>", "<span data-type=\"\">x</span>", "<span data-type=\"text\"><b>x</b></span>", "<span data-type=\"text\">x</span><span data-type=\"text\">y</span>",
		"<span data-type=ab>x</span>", "<span data-type=a>x</span>", "<span data-type=\"a>x</span>", "<span data-type='a'>x</span>", "<span data-type=\"a\" >x</span>", "<span  data-type=\"a\">x</span>", "<span data-type=\"a\"/>x</span>", "<span data-type=\"code\">a&lt;b&amp;c&quot;d</span>", "<span data-type=\"code\">  a  </span>",
		"<kbd>k</kbd>", "<KBD>k</KBD>", "<u>under</u>", "<u>[a](b)</u>", "<u>**b**</u>", "<u>a *b* c</u>", "<u><span data-type=\"a\" data-href=\"x\">t</span></u>", "<u>a&amp;b</u>", "<u>a\"b</u>", "<u> </u>", "<u></u>", "<u>u</u><u>v</u>", "<u><u>x</u></u>",
		"<sup>1</sup>", "<sub>2</sub>", "<mark>m</mark>", "<s>s</s>", "<del>d</del>", "<strike>t</strike>", "<em>e</em>", "<i>i</i>", "<strong>s</strong>", "<b>b</b>", "<B>b</B>", "<b>a<b>c</b></b>", "<b>a", "<b>", "</b>", "<b> x </b>", "<b>  x</b>", "<b>x  </b>", "<b> </b>", "<b>\u3000x\u3000</b>", "a<b>x</b>b", "a <b>x</b> b", "<b>&amp;lt;</b>", "<b>&lt;</b>", "<b>&amp;</b>", "<b><i>x</i></b>", "<b><sup>x</sup></b>", "<em><strong>x</strong></em>", "<sup><b>x</b></sup>", "<i>a<b>b</b>c</i>", "<s>x</s> <s>y</s>", "<b>x</b><b>y</b>", "<b>x</i>", "<code>c</code>", "<mark><b>x</b></mark>", "<b>`c`</b>", "<b>[a](b)</b>", "<b>![i](j)</b>", "<b>x</b>‸", "<b>‸x</b>", "<b>x‸</b>", "<b‸>x</b>",
		"<span style=\"color:red\">x</span>", "<span style=\"color: red; background: yellow\">x</span>", "<span style=\"font-size:20px;color:#f00\">a **b** c</span>", "<font color=red size=5>x</font>", "<font face=\"Arial\">x</font>", "<small>x</small>", "<small><small>x</small></small>", "<span style=\"font-size:2em\"><small>x</small></span>",
		"<a href=\"http://x\" style=\"color:red\">y</a>", "<a href=\"javascript:alert(1)\" style=\"color:red\">y</a>", "<a href=\"  JavaScript:x\" style=\"color:red\">y</a>", "<a href=\"data:x\" style=\"color:red\">y</a>", "<a href=\"vbscript:x\" style=\"color:red\">y</a>", "<a href=\"http://x\" title=\"T\" style=\"color:red\">y</a>", "<span style=\"color:red\"><a href=\"http://x\">y</a></span>",
		"<span style=\"color:red\"><span style=\"background:blue\">x</span></span>", "<span style=\"color:red\">x</b>", "<span style=\"color:red\">x", "<span style=\"color:red\"></span>", "<span style=\"color:red\">a</span><span style=\"color:blue\">b</span>", "<code style=\"color:red\">c</code>", "<span style=\"color:red\">`c`</span>", "<span style=\"color:red\">[l](u)</span>", "<span style=\"color:red\">![i](u)</span>", "<span style=\"color:red\">a<br>b</span>",
		"<span style=\"color:red\">a&amp;b</span>", "<span style=\"color:red\">a **b** *c* ~~d~~ e</span>", "<span style=\"color:red\">**b**</span>", "<span style=\"color:red\"><b>x</b></span>", "<b style=\"color:red\">x</b>", "<strong style=\"font-weight:normal\">x</strong>", "<span style=\"font-weight:bold;font-style:italic;text-decoration:underline\">x</span>", "<span style=\"text-decoration:line-through\">x</span>", "<em style=\"color:red\">x</em>",
		"<span style=\"color:red\"><span data-type=\"code\">c</span></span>", "<span style=\"color:red\" data-type=\"a\" data-href=\"x\">t</span>", "<span style=\"color:red\" title=\"memo\">x</span>", "<span style=\"color:red\"><span title=\"memo\">x</span></span>", "<mark style=\"color:red\">x</mark>", "<kbd style=\"color:red\">x</kbd>", "<sub style=\"color:red\">x</sub>", "<sup style=\"color:red\">x</sup>", "<s style=\"color:red\">x</s>", "<u style=\"color:red\">x</u>", "<del style=\"color:red\">x</del>", "<strike style=\"color:red\">x</strike>", "<i style=\"color:red\">x</i>",
		"<span style=\"position:fixed;color:url(x)\">x</span>", "<span style=\"font-family:Arial, 'Noto Sans'\">x</span>", "<span style=\"font-size:smaller\">x</span>", "<font size=7>x</font>", "<font color=\"#abc\" face=\"a;b\" size=9>x</font>", "<span style=\"color:red\">x</span> y <span style=\"color:blue\">z</span>", "<span style=\"color:red\">x <b>y</b> z</span>",
		"hello <span style=\"color:red\">wor</span>ld", "中文<span style=\"color:red\">样式</span>文字", "<span style=\"color:red\">http://a.com</span>", "<span style=\"color:red\">a@b.com</span>", "<span style=\"color:red\">www.a.com</span>", "<span style=\"color:red\">x</span>\n<span style=\"color:red\">y</span>",
		"http://a.com", "www.a.com", "a@b.com", "x http://a.com y", "http://a.com/b(c)", "[http://a.com](http://b.com)", "![http://a.com](http://b.com)", "`http://a.com`", "*http://a.com*", "**www.a.com**", "<b>http://a.com</b>", "<a href=\"x\">http://a.com</a>", "<a href=\"x\">a@b.com</a>", "<a href=\"x\">www.a.com</a>",
		"http://a.com‸", "www.a.com‸", "a@b.com‸", "‸http://a.com", "foo://bar.baz", "foo://bar.baz and http://c.com", "https://github.com/88250/lute/issues/161", "https://github.com/88250/lute/pull/208", "https://github.com/issues/1", "https://github.com/pull/1", "x https://github.com/a/issues/1 y",
		"a &amp; b", "&lt;b&gt;", "&#35; &#x41;", "a\\<b>c", "\\<br>", "<br>\n<br>", "line1\nline2 <b>x</b>\nline3",
	}
	return ret
}

func genInline(out map[string]any) {
	res := []any{}
	run := func(optName, md string) {
		args := []any{optName, hx([]byte(md))}
		res = append(res, vec(args, func() any {
			tree := parse.Inline("", exact([]byte(md)), optionsByName(optName))
			return dumpNode(tree.Root)
		}))
	}
	for _, md := range inlineCorpus() {
		run("gfm", md)
		run("protyle", md)
		if strings.Contains(md, "‸") || strings.Contains(md, "<a") {
			run("vditor", md)
			run("ir", md)
		}
		if strings.Contains(md, "&") || strings.Contains(md, "<u>") || strings.Contains(md, "style") || strings.Contains(md, "<b>") {
			run("protyle-keep", md)
		}
	}
	out["inline"] = res
}

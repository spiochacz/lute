package main

import (
	"math/rand"
	"strings"
)

func sanitizeInputs() []string {
	var ret []string
	// hand written
	ret = append(ret,
		"", "plain text", "<p>hello</p>", "<b>bold</b> and <i>italic</i>", "中文<b>加粗</b>文本",
		"<script>alert(1)</script>", "<SCRIPT>alert(1)</SCRIPT>", "<script src=x></script>", "<script>alert(1)", "a<script>b</script>c<script>d</script>e",
		"<script><script>x</script></script>", "</script>", "<script/>", "<script />", "<style>body{x:y}</style>text", "<style>", "<title>t</title>x",
		"<noscript><p>x</p></noscript>", "<object data=x>y</object>", "<frameset><frame src=x></frameset>", "<noembed>z</noembed>y", "<noframes>q</noframes>",
		"<iframe src=\"http://x\"></iframe>", "<iframe srcdoc=\"<script>alert(1)</script>\"></iframe>", "<embed src=x>",
		"<img src=x onerror=alert(1)>", "<img src=\"x\" onerror=\"alert(1)\" />", "<IMG SRC=x ONERROR=alert(1)>", "<img src='x' alt='a\"b'>", "<img src=javascript:alert(1)>",
		"<a href=\"javascript:alert(1)\">x</a>", "<a href=\"JaVaScRiPt:alert(1)\">x</a>", "<a href=\"  javascript:alert(1)\">x</a>", "<a href=\"java\tscript:alert(1)\">x</a>", "<a href=\"java\nscript:alert(1)\">x</a>",
		"<a href=\"&#106;avascript:alert(1)\">x</a>", "<a href=\"&#x6A;avascript:alert(1)\">x</a>", "<a href=\"javascript&colon;alert(1)\">x</a>", "<a href=\"javascript&#58;alert(1)\">x</a>", "<a href=\"&#0000106avascript:alert(1)\">x</a>",
		"<a href=\"data:text/html,<script>alert(1)</script>\">x</a>", "<a href=\"data:image/svg+xml;base64,PHN2Zz4=\">x</a>", "<a href=\"DATA:TEXT/HTML,x\">x</a>", "<a href=\"data:image/png;base64,AAAA\">x</a>",
		"<a href=\"http://example.com/?a=1&b=2\">x</a>", "<a href=\"http://example.com/?a=1&amp;b=2\">x</a>", "<a href=\"/path?x=<y>\">x</a>", "<a href=\"mailto:a@b.c\">m</a>", "<a href=\"#frag\">f</a>", "<a href=\"\">e</a>", "<a href>n</a>", "<a>n</a>",
		"<a href=x onclick=y>z</a>", "<a href=\"x\" target=\"_blank\" rel=\"noopener\">z</a>", "<a href=\"x\" title=\"t&quot;q\">z</a>", "<a href=\"中文.html\">中文</a>",
		"<div onmouseover=alert(1)>x</div>", "<div style=\"background:url(javascript:alert(1))\">x</div>", "<div style=\"x:expression(alert(1))\">x</div>", "<div class=\"a b\" id=\"c\">d</div>",
		"<form action=\"javascript:alert(1)\"><input formaction=\"javascript:x\"></form>", "<form action=\"http://x\"><button formaction=\"http://y\">b</button></form>", "<input type=text value=\"a\">",
		"<svg><a xlink:href=\"javascript:alert(1)\">x</a></svg>", "<svg onload=alert(1)>", "<svg><script>alert(1)</script></svg>", "<math><mi xlink:href=\"data:x\">x</mi></math>",
		"<meta http-equiv=\"refresh\" content=\"0;url=javascript:alert(1)\">", "<meta charset=utf-8>", "<link rel=stylesheet href=\"javascript:x\">", "<link rel=stylesheet href=\"http://x/y.css\">", "<base href=\"javascript:x\">",
		"<video src=x onerror=y><source src=z></video>", "<audio src=\"javascript:x\"></audio>", "<video controls><source src=\"a.mp4\" type=\"video/mp4\"></video>",
		"<body onload=alert(1)>", "<body background=\"javascript:x\">", "<table background=\"javascript:x\"><tr><td>x</td></tr></table>",
		"<button onclick=x>b</button>", "<details open ontoggle=alert(1)>x</details>", "<marquee onstart=alert(1)>x</marquee>",
		"<img src=x onerror=alert(1)//", "<img src=x onerror=alert(1)", "<img src=\"x", "<a href=\"x", "<a href='x", "<<script>>", "<<a>>", "< a href=x>", "<a href = x >t</a>", "<a  href=x  >t</a>", "<a\nhref=x>t</a>",
		"<!-- comment -->x", "<!-- <script>alert(1)</script> -->", "<!DOCTYPE html><p>x</p>", "<![CDATA[x]]>", "<?php echo 1 ?>", "<!-->x", "<!--x", "<!--->x",
		"&lt;script&gt;alert(1)&lt;/script&gt;", "&amp;&lt;&gt;&quot;&#39;", "&nbsp;&copy;&hellip;", "&#x1F600;", "&unknown;", "&amp", "& < > \"", "a & b", "a &b", "5 < 6 > 4",
		"text<br>text<br/>text<hr>", "<p>unclosed", "</p>stray", "</b></i>", "<b><i>nested</b></i>", "<p><p><p>", "<ul><li>a<li>b</ul>",
		"<a href=\"x\"><img src=\"y\" onerror=\"z\"></a>", "<a href=\"javascript:x\"><img src=\"y\"></a>", "<img src=\"data:image/svg+xml;utf8,<svg onload=alert(1)>\">",
		"<img src=\"a.png\" alt=\"中文\" title=\"标题\">", "<span style=\"color:red\">红</span>", "<font color=red>x</font>",
		"‸", "a ‸b", "<a ‸href=x>t</a>", "<a href=\"x\"‸>t</a>", "<a href=\"x\" ‸>t</a>", "<img src=\"x\"‸ />", "<img src=\"x\" ‸/>", "x ‸<script>y</script>", "<p>a</p>‸", "<div ‸ class=\"c\">x</div>", "<a href=\"x ‸\">t</a>", "<p ‸>", "<p‸>",
		"<script type=\"text/javascript\">x</script>", "<SCRIPT SRC=//evil.com/x.js>", "<script>/*</script>*/alert(1)</script>", "<scr<script>ipt>alert(1)</scr</script>ipt>",
		"<img src=`javascript:alert(1)`>", "<img src=\"java\x00script:alert(1)\">", "<a href=\"\x01javascript:alert(1)\">x</a>", "<a href=\"\u00a0javascript:alert(1)\">x</a>", "<a href=\"\u2003javascript:alert(1)\">x</a>",
		"<IMG SRC=&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;&#97;&#108;&#101;&#114;&#116;&#40;&#49;&#41;>", "<a href=\"jav&#x09;ascript:alert(1)\">x</a>", "<a href=\"jav&#x0A;ascript:alert(1)\">x</a>", "<a href=\"jav&#x0D;ascript:alert(1)\">x</a>",
		"<a href=\"vbscript:x\">v</a>", "<a href=\"file:///etc/passwd\">f</a>", "<a href=\"//evil.com\">p</a>", "<a href=\"javascript\">j</a>", "<a href=\"javascripts://x\">j</a>", "<a href=\"x&#x6A;avascript:y\">j</a>",
		"<a href=\"http://x/?q=javascript:alert(1)\">j</a>", "<img srcset=\"javascript:x 1x, y.png 2x\">", "<img srcset=\"a.png 1x, b.png 2x\">", "<source srcset=\"javascript:x\">",
		"<a href=\"x\" onclick=\"a\" onmouseover=\"b\" class=\"c\">t</a>", "<a href=\"x\" ONCLICK=\"a\">t</a>", "<a href=\"x\" On=\"a\">t</a>", "<a href=\"x\" data-on=\"a\">t</a>",
		"<img/src=x/onerror=alert(1)>", "<img src=x\nonerror=alert(1)>", "<img src=x\tonerror=alert(1)>", "<img src=x onerror=alert(1) src=y>", "<a href=\"a\" href=\"javascript:b\">t</a>",
	)
	tags := []string{"a", "img", "script", "iframe", "div", "span", "svg", "form", "input", "object", "style", "link", "meta", "body", "p", "b", "video", "audio", "button", "math", "table", "base", "embed", "template", "textarea", "title", "noscript", "frameset", "area", "blockquote", "A", "IMG"}
	attrs := []string{
		"onclick=\"x()\"", "href=\"javascript:alert(1)\"", "HREF=\"JaVaScRiPt:alert(1)\"", "src=\"data:text/html,<script>\"", "style=\"x:expression(1)\"", "href=\"  javascript:1\"",
		"href=\"&#106;avascript:1\"", "href=\"java&#x09;script:1\"", "href=\"javascript&colon;1\"", "xlink:href=\"javascript:1\"", "action=\"javascript:1\"", "formaction=\"javascript:1\"",
		"srcdoc=\"<b>x</b>\"", "http-equiv=\"refresh\"", "ONERROR=\"1\"", "href=javascript:alert(1)", "src=\"http://ok/x.png\"", "href=\"http://ok/?a=1&b=2\"", "title=\"a&amp;b\"", "class=ok",
		"srcset=\"javascript:1 1x\"", "href=\"data:image/svg+xml,<svg>\"", "src='java\tscript:1'", "href=\"中文\"",
	}
	for _, t := range tags {
		for i, a := range attrs {
			switch i % 3 {
			case 0:
				ret = append(ret, "<"+t+" "+a+">x</"+t+">")
			case 1:
				ret = append(ret, "<"+t+" "+a+" />")
			default:
				ret = append(ret, "a <"+t+" "+a+">b c</"+t+"> d")
			}
		}
	}
	return ret
}

func runePool() []rune {
	return []rune{
		'a', 'Z', 'z', '0', '5', '9', '_', '-', '+', '*', '/', '\\', '.', ',', ':', ';', '!', '?', '"', '\'', '(', ')', '[', ']', '{', '}', '<', '>', '|', '&', '^', '`', '$',
		'%', '@', '#', '~', '=', ' ', '\t', '\n', 0xa0, 0x3000, 0x200b, 0x200d, 0xfe0f, 0x2028, '‸', 0x7f, 0x0,
		'中', '文', '汉', '字', '々', 'ー', 'ひ', 'ら', 'カ', 'タ', '한', '글', 'ᄀ', 'ʰ', 'ˇ', 'ｱ',
		'，', '。', '！', '？', '：', '；', '（', '）', '「', '」', '、', '《', '》', '…', '—', '·',
		'Ａ', 'ｚ', '１', '９', '％', '＠', '＃', '～', '＝', '￥', '￡', '＄', '￩',
		'é', 'ñ', 'ß', 'Ω', 'я', '€', '©', '™', '→', '☃',
		'😀', '🎉', 0x20e3, 0x1f1e8, 0xfffd, 0x1d11e, 0x20000,
	}
}

func spaceInputs(rnd *rand.Rand) []string {
	ret := []string{
		"", "a", "中", "hello world", "你好world", "world你好", "你好 world", "中文English中文", "中文123中文", "123中文", "中文abc。", "中文,abc", "abc，中文", "中文(abc)", "(中文)abc", "中文abc中文",
		"打码ing", "打码ing中文", "中ing", "中inga", "a中ing", "ing", "x打ing", "打ingx", "打码Ing", "打码 ing", "ひingx", "한ing", "中in", "中i", "中ng",
		"1️⃣", "9️⃣x", "1️⃣中文", "中文1️⃣", "5️", "a1️", "12️", "x1️x", "🎉中文", "中文🎉", "中🎉a", "a🎉中", "😀😀", "👨‍👩‍👧中",
		"中文%", "%中文", "中文@abc", "abc@中文", "中文#abc", "#中文", "中文~", "~中文", "中文=", "=中文", "中文＝abc", "ＡＢＣ中文", "中文ＡＢＣ", "ＡＢＣabc",
		"‸中文", "中文‸abc", "a‸中", "‸", "中‸‸a", "中\u200bab", "中\u00a0ab", "中 ab", "中\tab", "中\nab", "a\n中", "\u3000中a",
		"한글English", "English한글", "ひらがなabc", "カタカナabc", "ｱｲｳabc", "abcｱｲｳ", "ʰ中", "中ʰ", "ˇa", "aˇ",
		"中文，English。中文", "「中文」English", "English「中文」", "《中文》abc", "abc《中文》", "中文—abc", "中文…abc", "中文·abc", "中文-abc", "abc-中文", "中文_abc", "中文/abc", "中文.abc", "中文:abc", "中文!abc",
		"中\x7fa", "中\x00a", "a\u2028中", "ｚ中", "中ｚ", "１中", "中１", "9中", "中9", "Ω中", "中Ω", "é中", "中é", "€中", "中€", "→中", "中→", "©中",
		"The quick 棕色 fox 跳过 the lazy 狗.", "Go语言和JavaScript互操作", "使用Markdown编写Document", "版本v1.2.3发布", "价格$5.00美元", "文件test.txt已保存", "邮箱a@b.com已验证", "网址https://x.com/y访问",
	}
	pool := runePool()
	for i := 0; i < 360; i++ {
		n := 1 + rnd.Intn(14)
		var sb strings.Builder
		for j := 0; j < n; j++ {
			if 0 == rnd.Intn(14) {
				sb.WriteString("ing")
				continue
			}
			sb.WriteRune(pool[rnd.Intn(len(pool))])
		}
		ret = append(ret, sb.String())
	}
	return ret
}

func genLink() []map[string]any {
	bases := []string{"", "http://domain.com/", "http://domain.com", "https://assets.b3logfile.com/siyuan/", "https://assets.liuyun.io/siyuan/x", "/abs/", "assets/", "中文/"}
	prefixes := []string{"", "http://p.com", "/pre"}
	dests := []string{"", "a.png", "/a.png", "assets/x.png", "assets/", "http://x/y", "HTTPS://X", "data:image/png;base64,xx", "DATA:text/plain,x", "mailto:a@b", "MAILTO:x", "tel:123", "sms:1", "c:\\win", "a%5Cb.png", "foo:/bar", "foo:%5Cbar", "./x", "../y", "#frag", "?q", "中文.png", "a b.png", "javascript:x", "//cdn.x/y.js", "\\x", "a:b", "1:/", "a%5C%5Cb"}
	var ret []map[string]any
	for _, b := range bases {
		for _, p := range prefixes {
			for _, d := range dests {
				o := newRenderOptions()
				o.LinkBase = b
				o.LinkPrefix = p
				r := newBaseRenderer(o)
				m := map[string]any{"linkBase": b, "linkPrefix": p, "dest": d}
				m["relativePath"] = string(r.RelativePath([]byte(d)))
				m["prefixPath"] = string(r.PrefixPath([]byte(d)))
				m["linkPath"] = string(r.LinkPath([]byte(d)))
				m["isRelativePath"] = linkIsRelativePath(r, []byte(d))
				ret = append(ret, m)
			}
		}
	}
	for _, d := range []string{"", "a b", "a  b", " a", "a b c d", "中 文", "a%20b", "a\tb"} {
		for _, prevent := range []bool{false, true} {
			o := newRenderOptions()
			o.PreventEncodeLinkSpace = prevent
			r := newBaseRenderer(o)
			ret = append(ret, map[string]any{"encodeLinkSpace": d, "prevent": prevent, "out": r.EncodeLinkSpace(d)})
		}
	}
	return ret
}

package main

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/88250/lute/ast"
)

// cloneIAL deep-copies a KramdownIAL value, keeping nil and empty apart.
func cloneIAL(src [][]string) [][]string {
	if src == nil {
		return nil
	}
	out := make([][]string, 0, len(src))
	for _, kv := range src {
		out = append(out, append([]string{}, kv...))
	}
	return out
}

func ialJSON(src [][]string) any {
	// Deep copy: the inner [name, value] slices are mutated in place by
	// SetIALAttr, so snapshots must not share them.
	if src == nil {
		return nil
	}
	return cloneIAL(src)
}

// writeIAL records SetIALAttr, IALAttr, RemoveIALAttr, RemoveIALAttrsByPrefix
// and IsEmptyBlockIAL on nodes with a random initial KramdownIAL.
func writeIAL() {
	rng := rand.New(rand.NewSource(20260102))
	names := []string{"id", "style", "class", "data-x", "custom-attr", "名字", "a", "data-"}
	vals := []string{"", "plain", "a\"b", "x\ny", "{a}{b}", "&amp;", "a&b", "中文值", "<tag>", "back\\slash", "100%", "it's", "line\r\nend", "&quot;q&quot;", "💡 emoji", "}{", "a\tb"}
	prefixes := []string{"data-", "a", "", "名", "style", "nomatch"}

	cases := []any{}
	for c := 0; c < 120; c++ {
		typ := ast.NodeParagraph
		if c%3 == 0 {
			typ = ast.NodeKramdownBlockIAL
		}
		var initial [][]string
		switch r := rng.Intn(100); {
		case r < 25:
			initial = nil
		case r < 40:
			initial = [][]string{}
		default:
			for k := rng.Intn(4); k > 0; k-- {
				initial = append(initial, []string{names[rng.Intn(len(names))], vals[rng.Intn(len(vals))]})
			}
			if initial == nil {
				initial = [][]string{}
			}
		}

		n := &ast.Node{Type: typ, KramdownIAL: cloneIAL(initial)}
		ops := []any{}
		steps := []any{}
		for k := 6 + rng.Intn(7); k > 0; k-- {
			var op map[string]any
			var result any
			switch r := rng.Intn(100); {
			case r < 40:
				name := names[rng.Intn(len(names))]
				value := vals[rng.Intn(len(vals))]
				op = map[string]any{"op": "SetIALAttr", "name": name, "value": value}
				n.SetIALAttr(name, value)
			case r < 55:
				name := names[rng.Intn(len(names))]
				op = map[string]any{"op": "IALAttr", "name": name}
				result = n.IALAttr(name)
			case r < 70:
				name := names[rng.Intn(len(names))]
				op = map[string]any{"op": "RemoveIALAttr", "name": name}
				n.RemoveIALAttr(name)
			case r < 80:
				prefix := prefixes[rng.Intn(len(prefixes))]
				op = map[string]any{"op": "RemoveIALAttrsByPrefix", "prefix": prefix}
				n.RemoveIALAttrsByPrefix(prefix)
			default:
				op = map[string]any{"op": "IsEmptyBlockIAL"}
				result = n.IsEmptyBlockIAL()
			}
			ops = append(ops, op)
			steps = append(steps, map[string]any{"ial": ialJSON(n.KramdownIAL), "result": result})
		}
		cases = append(cases, map[string]any{
			"type":    int(typ),
			"initial": ialJSON(initial),
			"ops":     ops,
			"steps":   steps,
		})
	}
	writeJSON("ial_vectors.json", map[string]any{"cases": cases})
}

// nodeIDCandidates builds strings around the NodeID pattern: 14 digits, '-',
// 7 characters from a-z0-9, with variations in length, character class and
// UTF-8 byte length.
func nodeIDCandidates(rng *rand.Rand) []string {
	out := []string{
		"20060102150405-1a2b3c4",
		"20240101120000-abcdefg",
		"20240101120000-0000000",
		"2024010112000-abcdefg",
		"202401011200000-abcdefg",
		"20240101120000-abcdef",
		"20240101120000-abcdefgh",
		"20240101120000-ABCDEFG",
		"20240101120000-abcdeF0",
		"2024010112000a-abcdefg",
		"20240101120000_abcdefg",
		"20240101120000--abcdef",
		"20240101120000 abcdefg",
		"20240101120000-abcdefg ",
		" 20240101120000-abcdefg",
		"20240101120000-abc-efg",
		"20240101120000-中文中",
		"中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文中文",
		"2024010112000中-abcdef",
		"20240101120000-abcdéfg",
		"20240101120000-🙂bcdefg",
		"2024010112000🙂-abcdefg",
		"",
		"-",
		"20240101120000",
		"abcdefghijklmnopqrstuvw",
		"20240101120000-abcdefg-",
	}
	// valid prefixes with each random tail character class
	alphabet := []string{"0", "9", "a", "z", "A", "-", "_", "é", "中", "🙂", " ", "\x01", "."}
	for i := 0; i < 240; i++ {
		var sb strings.Builder
		length := 14 + 1 + 7
		if rng.Intn(5) == 0 {
			length = 20 + rng.Intn(6)
		}
		for j := 0; j < length; j++ {
			if j == 14 {
				sb.WriteString("-")
				continue
			}
			if rng.Intn(10) < 8 {
				if j < 14 {
					sb.WriteByte(byte('0' + rng.Intn(10)))
				} else {
					sb.WriteByte(byte('a' + rng.Intn(26)))
				}
			} else {
				sb.WriteString(alphabet[rng.Intn(len(alphabet))])
			}
		}
		out = append(out, sb.String())
	}
	return out
}

func calloutSources() []string {
	schemes := []string{"http", "HTTP", "https", "HtTpS", "ftp", "mailto", "data", "javascript", "", "file"}
	hosts := []string{"", "//", "example.com", "[::1]", "[::1]:8080", "a b.com", "user:pw@host", "host:80", "host:port", "中文.com", "exa%zzmple.com", "exa%41mple.com"}
	paths := []string{"", "/", "/x", "/x y", "/%zz", "/%41", "?q", "#f", "\x01"}
	out := []string{
		"", "/emojis/x", "/emojis/", "/emojis", "emojis/x", "api/icon/x", "api/icon/", "api/icon", "/api/icon/x",
		"http:", "https:", "https://", "http://[::1", "https://a:b@c", "https://[fe80::1%25en0]/x", "http://a/b c",
		"HTTPS://EXAMPLE.COM/icon.png", "http://example.com:99999/x", "http://example.com:abc/", "https://%41.com/",
		"https://host/%zz", "https://host/%e4%b8%ad", "https://host/%E4%B8%AD", "https://host/a%", "https://host/a%2",
		"ht tp://host", "1http://host", "+http://host", "http+s://host", "http:/host", "http:host", "http:///host",
		"mailto:a@b.c", "./icon.png", "../icon.png", "icon.png", "/icon.png", "//cdn.example.com/x.png", "///x",
		"https://例子.测试/图标.png", "https://host\u00a0/x", "https://host\t/x", "https://\x7fhost/x", "https://host/\u2028",
		"https://[::1]:8080/x", "https://[::1]x/", "https://[v1.fe]/x", "https://user@/x", "https://:80/x",
		"https://host:/x", "https://host:0/x", "https://host:65536/x", "https://host?q=1#frag", "https:host", "https:/host",
	}
	for _, s := range schemes {
		for _, h := range hosts {
			for _, p := range paths {
				if s == "" {
					out = append(out, h+p)
					continue
				}
				out = append(out, s+"://"+h+p)
			}
		}
	}
	return out
}

func writeMisc() {
	rng := rand.New(rand.NewSource(20260103))

	idList := []any{}
	for _, s := range nodeIDCandidates(rng) {
		idList = append(idList, []any{s, ast.IsNodeIDPattern(s)})
	}

	srcList := []any{}
	seenSrc := map[string]bool{}
	srcAll := calloutSources()
	alphabet := []string{"http", "https", "/", ":", "@", "[", "]", "%", "2", "a", "Z", " ", "\x01", "中", "?", "#", ".", "emojis/", "api/icon/"}
	for i := 0; i < 200; i++ {
		var sb strings.Builder
		for k := rng.Intn(12); k > 0; k-- {
			sb.WriteString(alphabet[rng.Intn(len(alphabet))])
		}
		srcAll = append(srcAll, sb.String())
	}
	for _, s := range srcAll {
		if seenSrc[s] {
			continue
		}
		seenSrc[s] = true
		srcList = append(srcList, []any{s, ast.IsValidCalloutImageSrc(s)})
	}

	types := []string{"NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION", "note", "Note", "custom", "", "NOTE ", " TIP", "CAUTIONS", "\u00a0NOTE", "Warning", "warning"}
	builtin := []any{}
	icons := []any{}
	titles := []any{}
	for _, t := range types {
		builtin = append(builtin, []any{t, ast.IsBuiltInCalloutType(t)})
		icons = append(icons, []any{t, ast.GetCalloutIcon(t)})
		titles = append(titles, []any{t, ast.GetCalloutTitle(t)})
	}

	writeJSON("misc_vectors.json", map[string]any{
		"isNodeIDPattern":       idList,
		"isValidCalloutImageSrc": srcList,
		"isBuiltInCalloutType":  builtin,
		"getCalloutIcon":        icons,
		"getCalloutTitle":       titles,
		"calloutConsts": map[string]any{
			"CalloutTypeNote":      ast.CalloutTypeNote,
			"CalloutTypeTip":       ast.CalloutTypeTip,
			"CalloutTypeImportant": ast.CalloutTypeImportant,
			"CalloutTypeWarning":   ast.CalloutTypeWarning,
			"CalloutTypeCaution":   ast.CalloutTypeCaution,
			"CalloutIconImageAlt":  ast.CalloutIconImageAlt,
		},
		"newNodeIDTesting": "20060102150405-1a2b3c4",
	})
}

// hasExcludedControl reports whether s contains U+0008 or U+000C, which the Go
// 1.27 encoder writes as \b and \f (see the GO121 vectors for those inputs).
func hasExcludedControl(s string) bool {
	return strings.ContainsAny(s, "\b\f")
}

var tableRichContents = []string{
	"", "plain", "a\"b\\c<d>e&f\ng\rh\ti", "\u2028 and \u2029", "\u0080\u009f\u00ad", "\ufffd\ufffe",
	"中文 数学", "🙂 emoji 𝔸", "e\u0301 combining", "\u007f", "x|y", "{: id=\"a\"}", "[link](/u)", "a\x00b",
	"\x00", "\u0000\u0000", "trailing space ", "  leading", "\u0001\u0002\u0003\u0004\u0005\u0006\u0007",
	"\u000b\u000e\u000f\u0010\u001f", "\"quoted\"", "\\backslash\\", "<script>alert(1)</script>", "&amp;&lt;",
	"line\r\nbreak", "tab\there", "\xff\xfe", "\xc3\x28", "a\xed\xa0\x80b", "\xf4\x90\x80\x80", "ok after bad",
}

// tableRichContentsAll adds every ASCII code point 0..127 as its own content.
func tableRichContentsAll() []string {
	out := append([]string{}, tableRichContents...)
	for c := 0; c < 128; c++ {
		out = append(out, string(rune(c)))
	}
	return out
}

// decodeRecord runs DecodeTableCellRich and records what Go returns. Go never
// returns nil here: an invalid payload comes back with Invalid set.
func decodeRecord(input string) map[string]any {
	rich := ast.DecodeTableCellRich(input)
	rec := map[string]any{
		"input":         input,
		"valid":         !rich.Invalid,
		"spec":          rich.Spec,
		"format":        rich.Format,
		"content":       rich.Content,
		"validateError": rich.Validate() != nil,
		"specRaw":       specRaw(input),
	}
	return rec
}

// specRaw returns the raw token text of the spec value, as the map step of
// DecodeTableCellRich sees it (the last occurrence of a duplicate key). It is
// "" when the input is not base64 or the decoded payload is not an object.
func specRaw(input string) string {
	data, err := base64.RawURLEncoding.DecodeString(input)
	if err != nil {
		return ""
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil {
		return ""
	}
	return string(fields["spec"])
}

var tableRichJSON = []string{
	`{"spec":1,"format":"kramdown","content":"x"}`,
	`{"spec":1,"format":"kramdown","content":""}`,
	` { "spec" : 1 , "format" : "kramdown" , "content" : "x" } `,
	"{\n\"spec\": 1,\n\"format\": \"kramdown\",\n\"content\": \"x\"\n}\n",
	"\t{\"spec\":1,\r\n\"format\":\"kramdown\",\"content\":\"x\"}",
	`{"content":"x","format":"kramdown","spec":1}`,
	`{"spec":1,"format":"kramdown","content":"x","extra":1}`,
	`{"spec":1,"format":"kramdown"}`,
	`{"spec":1,"format":"kramdown","content":"x","content":"y"}`,
	`{"spec":1,"spec":1,"format":"kramdown","content":"x"}`,
	`{"spec":"x","spec":1,"format":"kramdown","content":"x"}`,
	`{"spec":1,"spec":"x","format":"kramdown","content":"x"}`,
	`{"spec":1,"format":"kramdown","format":"x","content":"x"}`,
	`{"spec":1,"format":"kramdown","content":"x","content":null}`,
	`{"SPEC":1,"format":"kramdown","content":"x"}`,
	`{"Spec":1,"Format":"kramdown","Content":"x"}`,
	`{"spec":1,"format":"kramdown","Content":"x"}`,
	`{"spec":null,"format":"kramdown","content":"x"}`,
	`{"spec":1,"format":null,"content":"x"}`,
	`{"spec":1,"format":"kramdown","content":null}`,
	`{"spec":"1","format":"kramdown","content":"x"}`,
	`{"spec":1.0,"format":"kramdown","content":"x"}`,
	`{"spec":1e0,"format":"kramdown","content":"x"}`,
	`{"spec":1E+0,"format":"kramdown","content":"x"}`,
	`{"spec":-0,"format":"kramdown","content":"x"}`,
	`{"spec":01,"format":"kramdown","content":"x"}`,
	`{"spec":2,"format":"kramdown","content":"x"}`,
	`{"spec":9223372036854775807,"format":"kramdown","content":"x"}`,
	`{"spec":9223372036854775808,"format":"kramdown","content":"x"}`,
	`{"spec":-9223372036854775808,"format":"kramdown","content":"x"}`,
	`{"spec":-9223372036854775809,"format":"kramdown","content":"x"}`,
	`{"spec":99999999999999999999999,"format":"kramdown","content":"x"}`,
	`{"spec":1,"format":"kramdown","content":"x"} x`,
	`{"spec":1,"format":"kramdown","content":"x"}  `,
	`{"spec":1,"format":"kramdown","content":"x"}{}`,
	`[]`, `[{"spec":1}]`, `null`, `"x"`, `1`, `true`, `{}`, `""`, ``,
	`{"spec":1,"format":"kramdown","content":"\u0000"}`,
	`{"spec":1,"format":"kramdown","content":"\ud800"}`,
	`{"spec":1,"format":"kramdown","content":"\u00e9\u4e2d\ud83d\ude42"}`,
	`{"spec":1,"format":"Kramdown","content":"x"}`,
	`{"spec":1,"format":"kramdown","content":"x\u2028y"}`,
	`{"spec":1,"format":"kramdown","content":"<>&"}`,
	`{"sp\u0065c":1,"format":"kramdown","content":"x"}`,
	`{"spec":1,"format":"kramdown","content":"raw` + "\x01" + `control"}`,
	`{"spec":1,"format":"kramdown","content":"` + "\xff" + `"}`,
	`{"spec":1,"format":"kramdown","content":"x","` + "\xff" + `":1}`,
	`{"spec":1,"format":"kramdown","content":"\u000b"}`,
}

func writeTableRich() {
	encode := []any{}
	for _, spec := range []int{1, 0, -1, 2, math.MaxInt64, math.MinInt64} {
		for _, format := range []string{"kramdown", "", "other", "Kramdown", "a\"b", "a\\b", "中文"} {
			if spec != 1 && format != "kramdown" {
				continue
			}
			for _, content := range tableRichContentsAll() {
				if hasExcludedControl(content) || hasExcludedControl(format) {
					continue
				}
				rich := &ast.TableCellRich{Spec: spec, Format: format, Content: content}
				e := map[string]any{
					"spec":       spec,
					"specRaw":    strconv.Itoa(spec),
					"format":     format,
					"contentHex": hex.EncodeToString([]byte(content)),
					"encoded":    rich.Encode(),
				}
				if utf8.ValidString(content) {
					e["content"] = content
				}
				encode = append(encode, e)
			}
		}
	}

	decodeInputs := []string{}
	for _, e := range encode {
		decodeInputs = append(decodeInputs, e.(map[string]any)["encoded"].(string))
	}
	for _, s := range tableRichJSON {
		if hasExcludedControl(s) {
			continue
		}
		decodeInputs = append(decodeInputs, base64.RawURLEncoding.EncodeToString([]byte(s)))
	}
	// base64 alphabet, padding, line breaks, truncation and length variants
	valid := `{"spec":1,"format":"kramdown","content":"中文>&"}`
	raw := base64.RawURLEncoding.EncodeToString([]byte(valid))
	std := base64.StdEncoding.EncodeToString([]byte(valid))
	padded := base64.URLEncoding.EncodeToString([]byte(valid))
	decodeInputs = append(decodeInputs,
		raw, std, padded,
		raw[:len(raw)-1], raw[:len(raw)-2], raw[:len(raw)-3], raw+"=", raw+"==", raw+"A",
		raw[:10]+"\n"+raw[10:], raw[:10]+"\r\n"+raw[10:], "\r\n"+raw+"\n", raw[:10]+" "+raw[10:], raw[:10]+"\t"+raw[10:],
		"", "=", "==", "a", "ab", "abc", "abcde", "YR", "YS", "YQ", "YQ==", "!!!!", "*", "+/+/", "a+b/", "-_-_", "ab=c", "A", "AB",
		"ZZZZ", "eyJzcGVjIjoxfQ", raw[:len(raw)/2],
	)
	for _, s := range []string{"x", "a", "é", "\xff\xfe"} {
		decodeInputs = append(decodeInputs, base64.RawURLEncoding.EncodeToString([]byte(s)))
	}

	decode := []any{}
	seen := map[string]bool{}
	for _, in := range decodeInputs {
		if seen[in] {
			continue
		}
		seen[in] = true
		decode = append(decode, decodeRecord(in))
	}
	fmt.Fprintf(os.Stderr, "table_rich: %d encode, %d decode\n", len(encode), len(decode))
	writeJSON("table_rich_vectors.json", map[string]any{"encode": encode, "decode": decode})
}

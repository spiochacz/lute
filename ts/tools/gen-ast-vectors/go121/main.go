// Generator for the Go 1.21 reference vectors used by the TypeScript runtime
// (runtime/json.ts QuoteString, runtime/base64.ts, runtime/url.ts) and by
// ast/table_rich.ts. Standard library only; it does not import Lute.
//
// Run from this directory with the Go 1.21 toolchain:
//   set GOTOOLCHAIN=local
//   "C:\Users\SlawomirPiochacz\sdk\go1.21.13\bin\go.exe" run .
//
// Output (relative to this directory):
//   ../../../src/runtime/testdata/json_quote_vectors.json
//   ../../../src/runtime/testdata/base64_vectors.json
//   ../../../src/runtime/testdata/url_vectors.json
//   ../../../src/ast/testdata/table_rich_121_vectors.json
//   ../../../src/ast/testdata/callout_src_121_vectors.json (reads misc_vectors.json: run the 1.27 generator first)
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const outDir = "../../../src"

func writeJSON(rel string, v interface{}) {
	path := filepath.Join(outDir, rel)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		panic(err)
	}
	data, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		panic(err)
	}
	fmt.Printf("%s: %d bytes\n", path, len(data))
}

// ---------------------------------------------------------------- json quote

var quotePool = []string{
	"a", "Z", "0", " ", "\"", "\\", "/", "<", ">", "&", "'", "=", "+",
	"\n", "\r", "\t", "\b", "\f", "\x00", "\x01", "\x0b", "\x1b", "\x1f", "\x7f",
	"\u0080", "\u00e9", "\u00ff", "\u2027", "\u2028", "\u2029", "\u202a",
	"\ufeff", "\ufffd", "\uffff", "\u0800", "\u4e2d", "\u6587", "\uac00",
	"\U00010000", "\U0001f600", "\U0010ffff", "\ud7ff", "\ue000",
	"\u00a0", "\u3000", "\u200b", "\u2192",
}

type quoteCase struct {
	Input    string `json:"input"`
	Expected string `json:"expected"`
}

func genQuote() []quoteCase {
	var cases []quoteCase
	seen := map[string]bool{}
	add := func(s string) {
		if seen[s] {
			return
		}
		seen[s] = true
		data, err := json.Marshal(s)
		if err != nil {
			panic(err)
		}
		cases = append(cases, quoteCase{Input: s, Expected: string(data)})
	}
	// Every ASCII byte alone, and every ASCII byte between two letters.
	for c := 0; c < 128; c++ {
		add(string(rune(c)))
		add("x" + string(rune(c)) + "y")
	}
	for _, s := range quotePool {
		add(s)
	}
	rng := rand.New(rand.NewSource(20260101))
	for len(cases) < 500 {
		n := rng.Intn(10)
		var b strings.Builder
		for i := 0; i < n; i++ {
			b.WriteString(quotePool[rng.Intn(len(quotePool))])
		}
		add(b.String())
	}
	return cases
}

// ---------------------------------------------------------------- base64

type b64EncodeCase struct {
	Bytes   string `json:"bytes"` // hex
	Encoded string `json:"encoded"`
}

type b64DecodeCase struct {
	Input string `json:"input"`
	Valid bool   `json:"valid"`
	Bytes string `json:"bytes"` // hex, empty when invalid
}

type b64Vectors struct {
	Encode []b64EncodeCase `json:"encode"`
	Decode []b64DecodeCase `json:"decode"`
}

func genBase64() b64Vectors {
	var v b64Vectors
	rng := rand.New(rand.NewSource(20260102))
	for n := 0; n <= 40; n++ {
		for k := 0; k < 3; k++ {
			b := make([]byte, n)
			rng.Read(b)
			v.Encode = append(v.Encode, b64EncodeCase{
				Bytes:   hex.EncodeToString(b),
				Encoded: base64.RawURLEncoding.EncodeToString(b),
			})
		}
	}
	// Fixed bytes that exercise the 62 and 63 alphabet positions.
	for _, b := range [][]byte{{0xfb, 0xff, 0xbf}, {0xff}, {0xfb, 0xef}, {0x00, 0x00, 0x00}, {0x3e, 0x3f}} {
		v.Encode = append(v.Encode, b64EncodeCase{
			Bytes:   hex.EncodeToString(b),
			Encoded: base64.RawURLEncoding.EncodeToString(b),
		})
	}

	addDecode := func(s string) {
		b, err := base64.RawURLEncoding.DecodeString(s)
		c := b64DecodeCase{Input: s, Valid: err == nil}
		if err == nil {
			c.Bytes = hex.EncodeToString(b)
		}
		v.Decode = append(v.Decode, c)
	}
	// Valid encodings, with and without \r and \n inserted at random points.
	for n := 0; n <= 20; n++ {
		b := make([]byte, n)
		rng.Read(b)
		enc := base64.RawURLEncoding.EncodeToString(b)
		addDecode(enc)
		// Insert CR and LF at random positions.
		var sb strings.Builder
		for i := 0; i < len(enc); i++ {
			if rng.Intn(4) == 0 {
				sb.WriteString([]string{"\r", "\n", "\r\n"}[rng.Intn(3)])
			}
			sb.WriteByte(enc[i])
		}
		sb.WriteString("\n")
		addDecode(sb.String())
	}
	// Non-zero trailing bits are accepted (non-strict mode).
	for _, s := range []string{"QQ", "QR", "QQ\r\n", "Qf", "QR_", "QUE", "QUF", "Zm9v", "Zg", "Zm8", "_-_-", "AAAA", "AB", "ABC"} {
		addDecode(s)
	}
	// Invalid: standard alphabet characters, padding, bad characters, bad lengths.
	for _, s := range []string{
		"+", "/", "Zm9v+", "Zm9/", "Zg==", "Zm8=", "=", "==", "Zg=", "A=AA",
		" ", "AB C", "\t", "AB\t", "é", "AB\u00e9", "\u4e2d", "A", "AAAAA", "AAAAAAA",
		"A\r\rA", "\x00", "AB\x00", "AB.", "AB*", "AB!", "AB~", "A\u0000B", "AB\\",
	} {
		addDecode(s)
	}
	// Lengths 1 modulo 4 are errors; check each length with valid characters.
	for n := 1; n <= 9; n++ {
		addDecode(strings.Repeat("Q", n))
	}
	return v
}

// ---------------------------------------------------------------- url

type userCase struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	PasswordSet bool   `json:"passwordSet"`
}

type urlCase struct {
	Input       string    `json:"input"`
	Err         bool      `json:"err"`
	Scheme      string    `json:"scheme"`
	Opaque      string    `json:"opaque"`
	User        *userCase `json:"user"`
	Host        string    `json:"host"`
	Path        string    `json:"path"`
	RawPath     string    `json:"rawPath"`
	OmitHost    bool      `json:"omitHost"`
	ForceQuery  bool      `json:"forceQuery"`
	RawQuery    string    `json:"rawQuery"`
	Fragment    string    `json:"fragment"`
	RawFragment string    `json:"rawFragment"`
}

func urlVector(in string) urlCase {
	c := urlCase{Input: in}
	u, err := url.Parse(in)
	if err != nil {
		c.Err = true
		return c
	}
	c.Scheme = u.Scheme
	c.Opaque = u.Opaque
	if u.User != nil {
		p, set := u.User.Password()
		c.User = &userCase{Username: u.User.Username(), Password: p, PasswordSet: set}
	}
	c.Host = u.Host
	c.Path = u.Path
	c.RawPath = u.RawPath
	c.OmitHost = u.OmitHost
	c.ForceQuery = u.ForceQuery
	c.RawQuery = u.RawQuery
	c.Fragment = u.Fragment
	c.RawFragment = u.RawFragment
	return c
}

func genURL() []urlCase {
	fixed := []string{
		"", "*", "/", "//", "///", "////", "http://example.com", "HTTP://EXAMPLE.com/Path",
		"https://[::1]:8080/x?y#z", "http://[fe80::1%25en0]/", "http://[::1", "http://::1]",
		"http://[v1.x]/", "http://[::1]x", "http://[::ffff:1.2.3.4]/", "http://[%25]/",
		"mailto:user@example.com", "mailto:", "/emojis/x", "api/icon/x", "api/icon/x.png",
		"http:", "http:/", "http://", "http:///path", "//host/path", "//user:pw@host:99/p",
		"http://user@host", "http://u:p@ss@host/", "http://a b/", "http://ex%20ample/",
		"http://host:", "http://host:abc", "http://host:80:90/", "http://1.2.3.4:8080/",
		"http://host:99999999999999999999/", "http://%zz/", "http://h%7Fst/", "http://a%2fb/",
		"http://h%25st/", "http://%41bc/", "http://中文.com/路径", "http://a<b/", "http://a\"b/",
		"http://a>b/", "http://a|b/", "http://a^b/", "http://a`b/", "http://a{b}/",
		"http://u@@h/", "http://u%zz@h/", "http://u\x01@h/", "http://user name@h/", "http://u:p:q@h/",
		"1http://x", "+http://x", "-a:b", "a.b-c:d", "a_b:c", "a b:c", "ht!tp://x",
		":foo", ":", "a:", "a:b", "a:b/c", "a:/b", "a:/", "a://", "x:y?z#w",
		"cache_object:foo/bar", "rel/path", "./a:b", "a/b:c", "a:b:c", "%41:b",
		"/a/../b", "/a%2fb", "/a%2Fb", "/%41", "/%zz", "/%", "/%4", "/%2", "/%FF", "/%E4%B8%AD",
		"/中文", "/😀", "/a b", "/a;b,c=d", "/a+b", "/%2B", "/a?b", "/a#b", "/a#b#c",
		"x?y?z", "x??", "?", "#", "#frag", "#fr%20ag", "#%zz", "#a b", "#%E4%B8%AD", "#%2",
		"http://h/p?a=1&b=2#c", "http://h/p?a b", "http://h/p?x=%zz", "http://h?", "http://h?#",
		"http://h/p%3Fq", "http://h/%2F", "http://h/%2f%2F", "*x", "**", "http://h/*",
		"\x01", "http://h\x7f/", "http://h/\t", "http://h/\n", " http://h", "http://h ",
		"http://h/\x00", "a\x1fb:c", "%", "%%", "http://h/%%", "/\u00e9", "http://h/é?é#é",
		"http://user:pa%20ss@h/", "http://us%zzer@h/", "http://[::1]:%38%30/", "http://[::1%zz]/",
		"http://[::1%25%41]/", "http://[::1%25%7f]/", "http://[::1%25 x]/", "http://[::1%25x]y/",
		"HTTPS://[::1]:/", "https:///a", "https:/a", "https:a", "scheme://[]/", "scheme://[]:1/",
	}
	seen := map[string]bool{}
	var inputs []string
	add := func(s string) {
		if !seen[s] {
			seen[s] = true
			inputs = append(inputs, s)
		}
	}
	for _, s := range fixed {
		add(s)
	}

	schemes := []string{"", "http:", "HTTP:", "https:", "Https:", "mailto:", "ftp:", "x+y:", "1a:", "-a:", "a.b-c:", "a b:", ":", "file:", "ZZZ:"}
	authorities := []string{"", "//", "///", "//", "//", "//"}
	userinfos := []string{"", "", "user@", "user:pw@", "us%20er@", "a@b@", "u:p@ss@", "中@", "a b@", "%zz@", "u:%zz@", "@", ":@", "u:@", "u%2f@"}
	hosts := []string{"", "example.com", "EXAMPLE.com", "[::1]", "[fe80::1%25en0]", "[::1]", "[::1", "::1]", "[v1.x]", "1.2.3.4", "host", "%41bc", "a%2Fb", "中文.com", "host%zz", "[::ffff:1.2.3.4]", "[%25]", "[::1%25%41]", "xn--abc", "a<b", "ex ample", "ex%20ample", "h%7Fst", "h%25st", "a,b", "a;b", "a=b", "a'b", "a(b)", "a*b", "h\x7f", "h\x01"}
	ports := []string{"", "", ":80", ":", ":a", ":-1", ":65536", ":8080", ":0", ":1x"}
	paths := []string{"", "", "/", "/foo", "/foo bar", "/%41", "/%zz", "/%2F", "/a/../b", "/emojis/x", "api/icon/x", "rel", "rel/path", "a:b/c", "%", "%4", "/%FF", "/%E4%B8%AD", "/中", "/😀", "/a%2fb", "*", "/a;b,c=d", "/a+b", "/a%7e", "/~", "//x", "/./a/./b", "/a/b/../../../c"}
	queries := []string{"", "", "?", "?a=1", "?a b", "?x=%zz", "?a=1&b=2", "??", "?a=%2B+x"}
	fragments := []string{"", "", "#", "#frag", "#fr%20ag", "#%zz", "#a b", "#%E4%B8%AD", "#a#b"}

	rng := rand.New(rand.NewSource(20260103))
	pick := func(a []string) string { return a[rng.Intn(len(a))] }
	for i := 0; i < 500; i++ {
		s := pick(schemes) + pick(authorities) + pick(userinfos) + pick(hosts) + pick(ports) +
			pick(paths) + pick(queries) + pick(fragments)
		add(s)
	}
	alphabet := []string{"a", "Z", "0", ":", "/", "?", "#", "@", "[", "]", "%", "%2", "%41", "+", "-", ".", " ", "\x01", "\x7f", "中", "😀", "*", "=", "&", "\t", "\\", "~"}
	for i := 0; i < 300; i++ {
		n := rng.Intn(12)
		var b strings.Builder
		for j := 0; j < n; j++ {
			b.WriteString(pick(alphabet))
		}
		add(b.String())
	}

	var out []urlCase
	for _, s := range inputs {
		if !utf8.ValidString(s) {
			panic("invalid UTF-8 input")
		}
		out = append(out, urlVector(s))
	}
	return out
}

// ---------------------------------------------------------------- table_rich (copy of ast/table_rich.go)

const TableCellRichSpec = 1
const TableCellRichFormat = "kramdown"

type TableCellRich struct {
	Spec    int    `json:"spec"`
	Format  string `json:"format"`
	Content string `json:"content"`
	Raw     string `json:"-"`
	Invalid bool   `json:"-"`
}

func (rich *TableCellRich) Validate() error {
	if nil == rich {
		return nil
	}
	if rich.Invalid || "" != rich.Raw || TableCellRichSpec != rich.Spec || TableCellRichFormat != rich.Format {
		return fmt.Errorf("unsupported table cell rich text format [%d, %s]", rich.Spec, rich.Format)
	}
	if strings.ContainsRune(rich.Content, 0) || !utf8.ValidString(rich.Content) {
		return fmt.Errorf("table cell rich text contains invalid text")
	}
	return nil
}

func (rich *TableCellRich) Encode() string {
	if nil == rich {
		return ""
	}
	if rich.Invalid || "" != rich.Raw {
		return rich.Raw
	}
	data, _ := json.Marshal(rich)
	return base64.RawURLEncoding.EncodeToString(data)
}

func DecodeTableCellRich(encoded string) *TableCellRich {
	rich := &TableCellRich{Raw: encoded, Invalid: true}
	data, err := base64.RawURLEncoding.DecodeString(encoded)
	if nil != err || !utf8.Valid(data) {
		return rich
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(data, &fields); nil != err || nil == fields {
		return rich
	}
	if len(fields) != 3 {
		return rich
	}
	for _, key := range []string{"spec", "format", "content"} {
		if len(fields[key]) == 0 || bytes.Equal(bytes.TrimSpace(fields[key]), []byte("null")) {
			return rich
		}
	}
	if err = json.Unmarshal(data, rich); nil != err {
		return &TableCellRich{Raw: encoded, Invalid: true}
	}
	rich.Raw = ""
	rich.Invalid = false
	return rich
}

type richEncodeCase struct {
	Spec    int    `json:"spec"`
	Format  string `json:"format"`
	Content string `json:"content"`
	Encoded string `json:"encoded"`
}

type richDecodeCase map[string]interface{}

func genTableRich() (encode []richEncodeCase, decode []richDecodeCase) {
	contents := []string{
		"", "a", "plain text", "a\nb", "a\rb", "a\tb", "a\bb", "a\fb", "\b", "\f", "\u0008\u000c",
		"\x00", "x\x00y", "\x01\x1f\x7f", `"quoted"`, `back\slash`, "<tag>&amp;", "\u2028\u2029",
		"中文内容", "😀 emoji", "|pipe|", "tab\there", "{\"spec\":1}", "\u00a0nbsp",
		"\ufffd replacement", "\U0010ffff", "line1\r\nline2",
	}
	specs := []int{1, 0, -1, 2, 1000000}
	formats := []string{"kramdown", "markdown", ""}
	for _, c := range contents {
		for _, s := range specs {
			for _, f := range formats {
				rich := &TableCellRich{Spec: s, Format: f, Content: c}
				encode = append(encode, richEncodeCase{Spec: s, Format: f, Content: c, Encoded: rich.Encode()})
			}
		}
	}
	rng := rand.New(rand.NewSource(20260104))
	pool := []string{"a", "\b", "\f", "\"", "\\", "\n", "\x00", "中", "😀", "<", "&", "\u2028", " "}
	for i := 0; i < 150; i++ {
		var b strings.Builder
		for j := 0; j < rng.Intn(8); j++ {
			b.WriteString(pool[rng.Intn(len(pool))])
		}
		rich := &TableCellRich{Spec: 1, Format: "kramdown", Content: b.String()}
		encode = append(encode, richEncodeCase{Spec: 1, Format: "kramdown", Content: b.String(), Encoded: rich.Encode()})
	}

	// Decode vectors. Each payload is base64-encoded (RawURL) JSON, or raw text when marked.
	type dec struct {
		input string
		raw   bool // input is the literal string, not base64 of a payload
	}
	var inputs []dec
	payload := func(s string) {
		inputs = append(inputs, dec{input: base64.RawURLEncoding.EncodeToString([]byte(s))})
	}
	raw := func(s string) { inputs = append(inputs, dec{input: s, raw: true}) }

	// Valid.
	payload(`{"spec":1,"format":"kramdown","content":"x"}`)
	payload(` { "spec" : 1 , "format" : "kramdown" , "content" : "x" } `)
	payload("\n\t{\r\n\"spec\":1,\"format\":\"kramdown\",\"content\":\"\"}\n")
	payload(`{"content":"a\u0000b","format":"kramdown","spec":1}`)
	payload(`{"spec":1,"format":"kramdown","content":"\b\f\n\r\t\"\\\/"}`)
	payload(`{"spec":1,"format":"kramdown","content":"\ud83d\ude00"}`)
	payload(`{"spec":1,"format":"kramdown","content":"\ud800"}`)
	payload(`{"spec":1,"format":"kramdown","content":"\udc00x"}`)
	payload(`{"spec":1,"format":"kramdown","content":"\u0073\u0070"}`)
	payload(`{"\u0073pec":1,"format":"kramdown","content":"x"}`)
	payload(`{"spec":1,"spec":1,"format":"kramdown","content":"x"}`)
	payload(`{"spec":1,"format":"kramdown","content":"x","content":"y"}`)
	payload(`{"spec":null,"spec":1,"format":"kramdown","content":"x"}`)
	payload(`{"spec":1,"spec":null,"format":"kramdown","content":"x"}`)
	payload(`{"spec":1,"format":null,"format":"kramdown","content":"x"}`)
	payload(`{"spec":1,"format":"kramdown","content":"x","content":null}`)
	payload(`{"spec":-0,"format":"kramdown","content":"x"}`)
	payload(`{"spec":9223372036854775807,"format":"kramdown","content":"x"}`)
	payload(`{"spec":-9223372036854775808,"format":"kramdown","content":"x"}`)
	payload(`{"spec":1,"format":"kramdown","content":"中文 😀 <&>"}`)
	payload(`{"spec":1,"format":"kramdown","content":"\u2028"}`)
	payload(`{"spec":1,"format":"kramdown","content":"x\u0000"}`)
	payload(`{"spec":1,"format":"kramdown","content":"\u00ff"}`)
	payload(`{"spec":2,"format":"kramdown","content":"x"}`)
	payload(`{"spec":1,"format":"markdown","content":"x"}`)

	// Duplicate keys with type errors (every occurrence is checked by the struct decode).
	payload(`{"spec":"x","spec":1,"format":"kramdown","content":"x"}`)
	payload(`{"spec":1,"spec":"x","format":"kramdown","content":"x"}`)
	payload(`{"spec":1.0,"spec":1,"format":"kramdown","content":"x"}`)
	payload(`{"spec":1,"spec":1.5,"format":"kramdown","content":"x"}`)
	payload(`{"spec":1,"format":"kramdown","content":"x","content":5}`)
	payload(`{"spec":1,"format":5,"format":"kramdown","content":"x"}`)
	payload(`{"spec":[1],"spec":1,"format":"kramdown","content":"x"}`)
	payload(`{"spec":{},"spec":1,"format":"kramdown","content":"x"}`)
	payload(`{"spec":true,"spec":1,"format":"kramdown","content":"x"}`)

	// Missing, extra, null, wrong types.
	payload(`{"spec":1,"format":"kramdown"}`)
	payload(`{"spec":1,"content":"x"}`)
	payload(`{"format":"kramdown","content":"x"}`)
	payload(`{"spec":1,"format":"kramdown","content":"x","extra":1}`)
	payload(`{"spec":1,"format":"kramdown","content":"x","Raw":"y"}`)
	payload(`{"spec":1,"format":"kramdown","content":"x","SPEC":1}`)
	payload(`{"SPEC":1,"format":"kramdown","content":"x"}`)
	payload(`{"spec":null,"format":"kramdown","content":"x"}`)
	payload(`{"spec":1,"format":null,"content":"x"}`)
	payload(`{"spec":1,"format":"kramdown","content":null}`)
	payload(`{"spec":"1","format":"kramdown","content":"x"}`)
	payload(`{"spec":1.0,"format":"kramdown","content":"x"}`)
	payload(`{"spec":1e0,"format":"kramdown","content":"x"}`)
	payload(`{"spec":1E0,"format":"kramdown","content":"x"}`)
	payload(`{"spec":1.5e1,"format":"kramdown","content":"x"}`)
	payload(`{"spec":9223372036854775808,"format":"kramdown","content":"x"}`)
	payload(`{"spec":-9223372036854775809,"format":"kramdown","content":"x"}`)
	payload(`{"spec":99999999999999999999999,"format":"kramdown","content":"x"}`)
	payload(`{"spec":-0.0,"format":"kramdown","content":"x"}`)
	payload(`{"spec":true,"format":"kramdown","content":"x"}`)
	payload(`{"spec":[1],"format":"kramdown","content":"x"}`)
	payload(`{"spec":{"a":1},"format":"kramdown","content":"x"}`)
	payload(`{"spec":1,"format":5,"content":"x"}`)
	payload(`{"spec":1,"format":["kramdown"],"content":"x"}`)
	payload(`{"spec":1,"format":"kramdown","content":{}}`)
	payload(`{"spec":1,"format":"kramdown","content":true}`)

	// Top-level values that are not objects, and JSON syntax errors.
	payload(`null`)
	payload(`[]`)
	payload(`[{"spec":1,"format":"kramdown","content":"x"}]`)
	payload(`"x"`)
	payload(`1`)
	payload(`true`)
	payload(``)
	payload(`{}`)
	payload(`{"spec":1,"format":"kramdown","content":"x"} x`)
	payload(`{"spec":1,"format":"kramdown","content":"x",}`)
	payload(`{"spec":1,"format":"kramdown","content":"x"`)
	payload(`{"spec":01,"format":"kramdown","content":"x"}`)
	payload(`{"spec":1,"format":"kramdown","content":"x\x"}`)
	payload("{\"spec\":1,\"format\":\"kramdown\",\"content\":\"a\x00b\"}")
	payload("{\"spec\":1,\"format\":\"kramdown\",\"content\":\"a\x01b\"}")
	payload("{\"spec\":1,\"format\":\"kramdown\",\"content\":\"\xff\"}")
	payload("{\"spec\":1,\"format\":\"kramdown\",\"content\":\"\xe4\xb8\"}")
	payload("{\"spec\":1,\"format\":\"kramdown\",\"content\":\"a\"}\x00")
	payload("\xef\xbb\xbf{\"spec\":1,\"format\":\"kramdown\",\"content\":\"x\"}")
	payload("\xff{\"spec\":1,\"format\":\"kramdown\",\"content\":\"x\"}")

	// Base64 level: padding, standard alphabet, newlines, truncation, bad characters.
	good := `{"spec":1,"format":"kramdown","content":"x"}`
	enc := base64.RawURLEncoding.EncodeToString([]byte(good))
	raw(enc + "=")
	raw(enc + "==")
	raw(strings.Replace(enc, "-", "+", -1))
	raw(strings.Replace(enc, "_", "/", -1))
	raw(enc[:len(enc)-1])
	raw(enc[:len(enc)-2])
	raw(enc[:len(enc)-5])
	raw(enc + "\r\n")
	raw(enc[:10] + "\n" + enc[10:])
	raw(enc[:10] + "\r\n" + enc[10:])
	raw(" " + enc)
	raw(enc + "!")
	raw(enc + "é")
	raw("")
	raw("A")
	raw("====")
	raw("\r\n")

	var decode0 []richDecodeCase
	for _, in := range inputs {
		rich := DecodeTableCellRich(in.input)
		c := richDecodeCase{"input": in.input, "valid": !rich.Invalid}
		if !rich.Invalid {
			c["spec"] = rich.Spec
			c["specRaw"] = fmt.Sprintf("%d", rich.Spec)
			c["format"] = rich.Format
			c["content"] = rich.Content
			c["validateError"] = rich.Validate() != nil
		}
		decode0 = append(decode0, c)
	}
	return encode, decode0
}

func main() {
	writeJSON("runtime/testdata/json_quote_vectors.json", map[string]interface{}{"cases": genQuote()})
	writeJSON("runtime/testdata/base64_vectors.json", genBase64())
	writeJSON("runtime/testdata/url_vectors.json", map[string]interface{}{"cases": genURL()})
	callout := genCalloutSrc()
	writeJSON("ast/testdata/callout_src_121_vectors.json", map[string]interface{}{"isValidCalloutImageSrc": callout})
	encode, decode := genTableRich()
	writeJSON("ast/testdata/table_rich_121_vectors.json", map[string]interface{}{"encode": encode, "decode": decode})
	_ = bytes.MinRead
}

// ------------------------------------------------- IsValidCalloutImageSrc

// isValidCalloutImageSrc121 is a copy of ast.IsValidCalloutImageSrc from
// ast/node.go, run here with the Go 1.21 net/url package. The Go 1.27 result
// comes from misc_vectors.json (written by ts/tools/gen-ast-vectors).
func isValidCalloutImageSrc121(src string) bool {
	if strings.HasPrefix(src, "/emojis/") || strings.HasPrefix(src, "api/icon/") {
		return true
	}
	u, err := url.Parse(src)
	return nil == err && "" != u.Host && ("http" == strings.ToLower(u.Scheme) || "https" == strings.ToLower(u.Scheme))
}

type calloutSrcCase struct {
	Src   string `json:"src"`
	Go121 bool   `json:"go121"`
	Go127 bool   `json:"go127"`
}

// genCalloutSrc reads the input list and the Go 1.27 results from
// misc_vectors.json and computes the Go 1.21 result for each input.
func genCalloutSrc() []calloutSrcCase {
	data, err := os.ReadFile(filepath.Join(outDir, "ast/testdata/misc_vectors.json"))
	if err != nil {
		panic(err)
	}
	var misc struct {
		IsValidCalloutImageSrc [][]json.RawMessage `json:"isValidCalloutImageSrc"`
	}
	if err := json.Unmarshal(data, &misc); err != nil {
		panic(err)
	}
	out := []calloutSrcCase{}
	for _, pair := range misc.IsValidCalloutImageSrc {
		var src string
		var go127 bool
		if err := json.Unmarshal(pair[0], &src); err != nil {
			panic(err)
		}
		if err := json.Unmarshal(pair[1], &go127); err != nil {
			panic(err)
		}
		out = append(out, calloutSrcCase{Src: src, Go121: isValidCalloutImageSrc121(src), Go127: go127})
	}
	return out
}

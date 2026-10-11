// Command gen-util-vectors calls the real Go util package (built with -tags
// javascript) on a fixed corpus and writes the results as JSON to stdout.
// The output is the oracle for ts/src/util/util.vectors.test.ts.
package main

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"runtime"
	"strings"
	"unicode/utf8"

	"github.com/88250/lute/util"
)

// vec is one recorded call. Byte inputs are hex in argsHex; string inputs are in
// args. ret of a string result is the Go string with each invalid byte replaced
// by U+FFFD (Go's range rule), which is what the TypeScript port produces.
// retHex is the exact bytes of the Go result, and retValid tells whether they
// are valid UTF-8 (then ret equals the exact string).
type vec struct {
	Args     []any    `json:"args,omitempty"`
	ArgsHex  []string `json:"argsHex,omitempty"`
	Ret      any      `json:"ret,omitempty"`
	RetHex   string   `json:"retHex"`
	RetValid bool     `json:"retValid"`
	Err      bool     `json:"err"`
	ErrMsg   string   `json:"errMsg,omitempty"`
	Panic    bool     `json:"panic"`
}

type output struct {
	GoVersion string            `json:"goVersion"`
	Functions map[string][]vec `json:"functions"`
}

// strCorpus holds valid UTF-8 inputs for the string-taking functions. It covers
// empty, ASCII, CJK, emoji (astral), combining marks, the caret ‸, reserved
// characters, spaces, % followed by 0, 1 or 2 hex digits, invalid hex, upper and
// lower case hex, percent-encoded multi-byte and invalid UTF-8, +, query-like and
// path-like strings, and words for WordCount and IsEmptyStr.
var strCorpus = []string{
	"",
	"a",
	"abc",
	"hello world",
	" ",
	"   ",
	"  leading",
	"trailing  ",
	"a\tb",
	"a\nb\r\n",
	" ",
	"　",
	" \u0085",
	"0",
	"123",
	"0123456789",
	"-12",
	"1 2 3",
	"١٢٣",
	"²",
	"½",
	"１２３",
	"12a",
	"中文",
	"中 文 测试",
	"日本語のテキスト",
	"한국어 텍스트",
	"中文 English 混合 words",
	"one two  three",
	"👍",
	"👍 ok",
	"a👍b",
	"😀😃😄",
	"👨‍👩‍👧",
	"é",
	"é",
	"ä́",
	"x́ y",
	"Ä",
	"‸",
	"a‸b",
	"‸ ",
	"text‸more‸",
	"​",
	"‍",
	"a​b",
	"​‍ ",
	"e‍",
	"%",
	"%2",
	"%20",
	"%2G",
	"%g1",
	"%zz",
	"%41",
	"%4a",
	"%4A",
	"%E4%B8%AD",
	"%e4%b8%ad",
	"%E4%B8",
	"%FF",
	"%E4%B8%AD%FF",
	"%F0%9F%91%8D",
	"%F0%9F",
	"%ZZ%41",
	"%%",
	"%%41",
	"%E4中",
	"%中",
	"a%E4中",
	"中%E4",
	"a+b",
	"a+b c",
	"+",
	"+++",
	"q=1&x=2",
	"/path/to/file",
	"a/b/c?d=e#f",
	"a;b,c:d@e",
	"!*'()",
	"$&+,/:;=?@",
	"-_.~",
	"[]<>\"\\",
	"#",
	"http://例子.测试/路径?查询=值#片段",
	"a b",
	"%20%20",
	"100%",
	"50% off",
	"a%b%c",
	"%0",
	"%1",
	"%G0",
	"%0G",
	"%$",
	"~user",
	"~",
	"name=John Smith",
	"\\",
	"tab\there",
	"%7E%7e%2F",
	"%25",
	"%2541",
	"%C3%A9",
	"%e2%80%8b",
	"%E4%B8%AD%E6%96%87",
	"%F4%8F%BF%BF",
	"%ED%A0%80",
	"%C0%80",
	"%E4%B8%2",
	"%E4%B8%2G",
	"%e4%b8%ad%ZZ",
	"?",
	"&",
	"=",
	"/",
	";",
	"a?b=c d&e=f+g",
	"/a/b c/d%2Fe/..?x=1#y",
	"mailto:me@example.com",
	"a\x00b",
	"\x7f",
	"ÿ",
	"Ā",
	"\U0001F600",
	"\U0010FFFF",
	"中́文",
	"‸中%E4%B8%AD+",
	"%E4%B8%AD中",
	"a%2",
	"a%",
	"%%%",
	"%ff",
	"%Ff",
	"%fF",
	`type="doc"`,
	`{: type="doc"}`,
	`中文 type="doc" 结尾`,
	`type=doc`,
	`type="doc`,
	`type='doc'`,
	`type="DOC"`,
	`type="doc"type="doc"`,
}

// invalidBytes are byte inputs that are not valid UTF-8. They are used only for
// the functions that take bytes.
var invalidBytes = [][]byte{
	{0xff},
	{0x80},
	{0xe4},
	{0xe4, 0xb8},
	{0xc0, 0x80},
	{0xed, 0xa0, 0x80},
	{0xf4, 0x90, 0x80, 0x80},
	{0xf0, 0x9f, 0x91},
	{0xfe, 0xff},
	{0xef, 0xbf, 0xbd},
	[]byte(`type="doc"` + "\xff"),
	append([]byte("\xff"), []byte(`type="doc"`)...),
	[]byte("type=\"d\xffoc\""),
	[]byte("type=\"doc\"\xe4\xb8"),
	[]byte("\xe4\xb8\xad type=\"doc\" \xff"),
	[]byte("%\xe4\xb8"),
}

// byteCorpus is every string of strCorpus as bytes, followed by invalidBytes.
func byteCorpus() [][]byte {
	var out [][]byte
	for _, s := range strCorpus {
		out = append(out, []byte(s))
	}
	return append(out, invalidBytes...)
}

// stringSets are the second arguments used with every string of strCorpus for
// ContainsStr.
var stringSets = [][]string{
	{},
	{""},
	{"中"},
	{"%", "+"},
	{"‸", "x"},
	{"zz", "hello"},
	{"👍", "é"},
	{"%E4%B8%AD"},
}

// ialItems are single IAL key/value pairs. Some are too short (one or zero
// elements) to show Go's index panics.
var ialItems = [][]string{
	{"type", "doc"},
	{"type", "doc", "x"},
	{"type", "p"},
	{"id", "x"},
	{"Type", "doc"},
	{"type", "Doc"},
	{"doc", "type"},
	{"type"},
	{},
	{"", "doc"},
	{"type", ""},
	{"类型", "文档"},
	{"type", "doć"},
	{"‸", "x"},
	{"type", "%E4"},
	{"a", "b"},
}

// ialLists are the IAL inputs for IsDocIAL2: empty, every single item, and every
// ordered pair of items.
func ialLists() [][][]string {
	lists := [][][]string{{}}
	for _, it := range ialItems {
		lists = append(lists, [][]string{it})
	}
	for _, a := range ialItems {
		for _, b := range ialItems {
			lists = append(lists, [][]string{a, b})
		}
	}
	return lists
}

// lossy returns the bytes as a string where each invalid byte becomes U+FFFD,
// by ranging over the string as Go does.
func lossy(b []byte) string {
	var sb strings.Builder
	for _, r := range string(b) {
		sb.WriteRune(r)
	}
	return sb.String()
}

// strRet describes a string result given by its exact bytes.
func strRet(b []byte) vec {
	return vec{Ret: lossy(b), RetHex: hex.EncodeToString(b), RetValid: utf8.Valid(b)}
}

// bytesRet describes a []byte result.
func bytesRet(b []byte) vec {
	return vec{RetHex: hex.EncodeToString(b), RetValid: utf8.Valid(b)}
}

// run calls f and records a Go panic as Panic: true. base carries the inputs
// (args or argsHex), which are copied to the result.
func run(base vec, f func() vec) (out vec) {
	defer func() {
		if r := recover(); r != nil {
			out = base
			out.Panic = true
		}
	}()
	out = f()
	out.Args = base.Args
	out.ArgsHex = base.ArgsHex
	return out
}

func errFields(err error) (bool, string) {
	if err == nil {
		return false, ""
	}
	return true, err.Error()
}

func hexOf(b []byte) string {
	return hex.EncodeToString(b)
}

func main() {
	if 1 < len(os.Args) && "html" == os.Args[1] {
		writeHTMLVectors()
		return
	}
	fns := map[string][]vec{}

	for _, s := range strCorpus {
		fns["StrToBytes"] = append(fns["StrToBytes"], run(vec{Args: []any{s}}, func() vec {
			return bytesRet(util.StrToBytes(s))
		}))
	}

	for _, b := range byteCorpus() {
		fns["BytesToStr"] = append(fns["BytesToStr"], run(vec{ArgsHex: []string{hexOf(b)}}, func() vec {
			return strRet([]byte(util.BytesToStr(b)))
		}))
		fns["IsDocIAL"] = append(fns["IsDocIAL"], run(vec{ArgsHex: []string{hexOf(b)}}, func() vec {
			return vec{Ret: util.IsDocIAL(b), RetValid: true}
		}))
	}

	for _, ial := range ialLists() {
		fns["IsDocIAL2"] = append(fns["IsDocIAL2"], run(vec{Args: []any{ial}}, func() vec {
			return vec{Ret: util.IsDocIAL2(ial), RetValid: true}
		}))
	}

	for _, s := range strCorpus {
		for _, set := range stringSets {
			strs := set
			fns["ContainsStr"] = append(fns["ContainsStr"], run(vec{Args: []any{s, strs}}, func() vec {
				return vec{Ret: util.ContainsStr(s, strs), RetValid: true}
			}))
		}
		fns["IsEmptyStr"] = append(fns["IsEmptyStr"], run(vec{Args: []any{s}}, func() vec {
			return vec{Ret: util.IsEmptyStr(s), RetValid: true}
		}))
		fns["IsDigit"] = append(fns["IsDigit"], run(vec{Args: []any{s}}, func() vec {
			return vec{Ret: util.IsDigit(s), RetValid: true}
		}))
		fns["WordCount"] = append(fns["WordCount"], run(vec{Args: []any{s}}, func() vec {
			rc, wc := util.WordCount(s)
			return vec{Ret: []int{rc, wc}, RetValid: true}
		}))
		fns["PathEscape"] = append(fns["PathEscape"], run(vec{Args: []any{s}}, func() vec {
			return strRet([]byte(util.PathEscape(s)))
		}))
		fns["PathUnescape"] = append(fns["PathUnescape"], run(vec{Args: []any{s}}, func() vec {
			r, err := util.PathUnescape(s)
			v := strRet([]byte(r))
			v.Err, v.ErrMsg = errFields(err)
			return v
		}))
		fns["EscapeError"] = append(fns["EscapeError"], run(vec{Args: []any{s}}, func() vec {
			return vec{Ret: util.EscapeError(s).Error(), RetValid: true}
		}))
		fns["InvalidHostError"] = append(fns["InvalidHostError"], run(vec{Args: []any{s}}, func() vec {
			return vec{Ret: util.InvalidHostError(s).Error(), RetValid: true}
		}))
	}

	for i, s := range strCorpus {
		// Alternate between a nil error and a non-nil one carrying the corpus text.
		var argErr any
		var err error
		if i%2 == 1 {
			err = errors.New(s)
			argErr = s
		}
		fns["RecoverPanic"] = append(fns["RecoverPanic"], run(vec{Args: []any{argErr}}, func() vec {
			util.RecoverPanic(&err)
			return vec{RetValid: true}
		}))
	}

	out := output{GoVersion: runtime.Version(), Functions: fns}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", " ")
	enc.SetEscapeHTML(false)
	if err := enc.Encode(out); err != nil {
		panic(err)
	}
}

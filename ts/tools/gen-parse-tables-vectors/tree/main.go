// Command tree parses the cases of testdata/tables_tree_cases.json with the real Go parse package and writes a line dump of each tree to
// testdata/tables_tree_expected.txt, the oracle for ts/src/parse/tables_tree.vectors.test.ts (emoji, tables, kramdown IAL, references, rich table cells).
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

type c struct {
	Opt string `json:"opt"`
	Md  string `json:"md"`
}

// quote is json.Marshal without the HTML escaping, which is what JSON.stringify writes
func quote(v any) string {
	var sb strings.Builder
	enc := json.NewEncoder(&sb)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); nil != err {
		panic(err)
	}
	return strings.TrimSuffix(sb.String(), "\n")
}

func main() {
	ast.Testing = true
	data, err := os.ReadFile(os.Args[1])
	if nil != err {
		panic(err)
	}
	var cases []c
	if err := json.Unmarshal(data, &cases); nil != err {
		panic(err)
	}
	for i, cs := range cases {
		o := parse.NewOptions()
		switch cs.Opt {
		case "emoji":
			o.Emoji = true
			o.EmojiSite = "http://site"
			o.AliasEmoji["myimg"] = "a/b.png"
			o.AliasEmoji["site"] = "${emojiSite}/x"
		case "refs":
			o.BlockRef = true
			o.FileAnnotationRef = true
			o.KramdownSpanIAL = true
		case "ial":
			o.KramdownBlockIAL = true
			o.KramdownSpanIAL = true
		case "protyle":
			o.KramdownBlockIAL = true
			o.KramdownSpanIAL = true
			o.ProtyleWYSIWYG = true
			o.TextMark = true
			o.BlockRef = true
			o.FileAnnotationRef = true
		}
		tree := parse.Parse("", []byte(cs.Md), o)
		fmt.Printf("== %d %s\n", i, cs.Opt)
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}
			var sb strings.Builder
			sb.WriteString(n.Type.String())
			sb.WriteString(" " + quote(string(n.Tokens)))
			if nil == n.Tokens {
				sb.WriteString(" nil")
			}
			if nil != n.KramdownIAL {
				sb.WriteString(" ial=" + quote(n.KramdownIAL))
			}
			if "" != n.TextMarkType {
				sb.WriteString(" tm=" + n.TextMarkType + ":" + quote(n.TextMarkTextContent) + ":" + quote(n.TextMarkAHref) + ":" + quote(n.TextMarkInlineMathContent))
			}
			if ast.NodeTableCell == n.Type {
				sb.WriteString(fmt.Sprintf(" align=%d", n.TableCellAlign))
			}
			if ast.NodeTable == n.Type {
				sb.WriteString(fmt.Sprintf(" aligns=%v", n.TableAligns))
			}
			if nil != n.TableCellRich {
				sb.WriteString(" rich=" + quote(n.TableCellRich.Content))
			}
			fmt.Println(sb.String())
			return ast.WalkContinue
		})
	}
}

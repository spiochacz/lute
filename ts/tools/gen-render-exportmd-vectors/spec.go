package main

import (
	"encoding/json"
	"fmt"

	"github.com/88250/lute/ast"
)

// NodeSpec describes a hand-built ast.Node tree. The same JSON is read by the TypeScript test,
// which builds the same tree with the same property switch (buildNode in ts/src/render/testhelpers.ts (copied from ts/tools/gen-render-vectors/spec.go)).
type NodeSpec struct {
	Type     string         `json:"type"`
	Tokens   *string        `json:"tokens,omitempty"`
	Props    map[string]any `json:"props,omitempty"`
	Children []*NodeSpec    `json:"children,omitempty"`
}

func N(typ string, children ...*NodeSpec) *NodeSpec {
	return &NodeSpec{Type: typ, Children: children}
}

func T(typ, tokens string, children ...*NodeSpec) *NodeSpec {
	return &NodeSpec{Type: typ, Tokens: &tokens, Children: children}
}

func (n *NodeSpec) P(k string, v any) *NodeSpec {
	if nil == n.Props {
		n.Props = map[string]any{}
	}
	n.Props[k] = v
	return n
}

// roundTrip makes a spec look exactly like the JSON the TypeScript side reads.
func roundTrip(spec *NodeSpec) *NodeSpec {
	data, err := json.Marshal(spec)
	if nil != err {
		panic(err)
	}
	ret := &NodeSpec{}
	if err = json.Unmarshal(data, ret); nil != err {
		panic(err)
	}
	return ret
}

func str(v any) string { return v.(string) }
func num(v any) int    { return int(v.(float64)) }

func buildNode(spec *NodeSpec) *ast.Node {
	typ := ast.Str2NodeType(spec.Type)
	if 0 > int(typ) {
		panic("unknown node type " + spec.Type)
	}
	n := &ast.Node{Type: typ}
	if nil != spec.Tokens {
		n.Tokens = []byte(*spec.Tokens)
	}
	for k, v := range spec.Props {
		switch k {
		case "ID":
			n.ID = str(v)
		case "HeadingLevel":
			n.HeadingLevel = num(v)
		case "HeadingNormalizedID":
			n.HeadingNormalizedID = str(v)
		case "HeadingSetext":
			n.HeadingSetext = v.(bool)
		case "IsFencedCodeBlock":
			n.IsFencedCodeBlock = v.(bool)
		case "CodeBlockInfo":
			n.CodeBlockInfo = []byte(str(v))
		case "TaskListItemChecked":
			n.TaskListItemChecked = v.(bool)
		case "TaskListItemMarker":
			n.TaskListItemMarker = byte(num(v))
		case "LinkType":
			n.LinkType = num(v)
		case "LinkRefLabel":
			n.LinkRefLabel = []byte(str(v))
		case "ListData":
			m := v.(map[string]any)
			n.ListData = &ast.ListData{}
			for lk, lv := range m {
				switch lk {
				case "Typ":
					n.ListData.Typ = num(lv)
				case "Tight":
					n.ListData.Tight = lv.(bool)
				case "BulletChar":
					n.ListData.BulletChar = byte(num(lv))
				case "Start":
					n.ListData.Start = num(lv)
				case "Delimiter":
					n.ListData.Delimiter = byte(num(lv))
				case "Marker":
					n.ListData.Marker = []byte(str(lv))
				case "Num":
					n.ListData.Num = num(lv)
				default:
					panic("unknown ListData prop " + lk)
				}
			}
		case "KramdownIAL":
			for _, kv := range v.([]any) {
				pair := kv.([]any)
				n.KramdownIAL = append(n.KramdownIAL, []string{str(pair[0]), str(pair[1])})
			}
		case "TextMarkType":
			n.TextMarkType = str(v)
		case "TextMarkTextContent":
			n.TextMarkTextContent = str(v)
		case "TextMarkAHref":
			n.TextMarkAHref = str(v)
		case "TextMarkATitle":
			n.TextMarkATitle = str(v)
		case "TextMarkInlineMathContent":
			n.TextMarkInlineMathContent = str(v)
		case "TextMarkInlineMemoContent":
			n.TextMarkInlineMemoContent = str(v)
		case "TextMarkBlockRefID":
			n.TextMarkBlockRefID = str(v)
		case "TextMarkBlockRefSubtype":
			n.TextMarkBlockRefSubtype = str(v)
		case "TextMarkFileAnnotationRefID":
			n.TextMarkFileAnnotationRefID = str(v)
		case "CalloutType":
			n.CalloutType = str(v)
		case "CalloutTitle":
			n.CalloutTitle = str(v)
		case "CalloutTitleExplicit":
			n.CalloutTitleExplicit = v.(bool)
		case "CalloutIcon":
			n.CalloutIcon = str(v)
		case "CalloutIconType":
			n.CalloutIconType = num(v)
		case "CustomBlockInfo":
			n.CustomBlockInfo = str(v)
		case "AttributeViewID":
			n.AttributeViewID = str(v)
		case "AttributeViewType":
			n.AttributeViewType = str(v)
		case "TableCellAlign":
			n.TableCellAlign = num(v)
		case "FootnotesRefId":
			n.FootnotesRefId = str(v)
		case "TabItemTitle":
			n.TabItemTitle = str(v)
		default:
			panic(fmt.Sprintf("unknown prop %s", k))
		}
	}
	for _, c := range spec.Children {
		n.AppendChild(buildNode(c))
	}
	return n
}

// nodeAt returns the node reached by following the child indexes path from root.
func nodeAt(root *ast.Node, path []int) *ast.Node {
	n := root
	for _, i := range path {
		c := n.FirstChild
		for ; 0 < i; i-- {
			c = c.Next
		}
		n = c
	}
	return n
}

// Generates ts/src/runtime/testdata/stdhtml_vectors.json from the Go standard library html.UnescapeString.
// Usage (from this directory): GOTOOLCHAIN=local go run . <path to go1.21 src/html/entity.go> > ../../src/runtime/testdata/stdhtml_vectors.json
package main

import (
	"encoding/json"
	"fmt"
	"html"
	"math/rand"
	"os"
	"regexp"
	"sort"
	"strings"
)

func main() {
	src, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	re := regexp.MustCompile(`(?m)^\t\t"([A-Za-z0-9;]+)":`)
	set := map[string]bool{}
	for _, m := range re.FindAllStringSubmatch(string(src), -1) {
		set[m[1]] = true
	}
	var names []string
	for n := range set {
		names = append(names, n)
	}
	sort.Strings(names)

	var in []string
	add := func(s string) { in = append(in, s) }

	for _, n := range names {
		add("&" + n)
		for _, suf := range []string{"a", "1", "=", " ", "&"} {
			add("&" + n + suf)
		}
		if strings.HasSuffix(n, ";") {
			bare := strings.TrimSuffix(n, ";")
			add("&" + bare)
			for _, suf := range []string{"a", "1", "=", "z;"} {
				add("&" + bare + suf)
			}
		}
		if len(n) > 3 {
			add("&" + n[:len(n)-1] + "x;")
			add("x&" + n + "y")
		}
	}

	// Numeric references.
	nums := []string{"", "1", "0", "00", "9", "10", "31", "32", "38", "60", "65", "127", "128", "129", "130", "140", "141", "150", "159", "160", "255", "256",
		"8364", "55295", "55296", "56319", "57343", "57344", "65533", "65535", "65536", "128512", "1114111", "1114112", "4294967295", "4294967296",
		"2147483647", "2147483648", "99999999999", "123456789012345678901234567890", "0000000065"}
	for _, n := range nums {
		for _, suf := range []string{"", ";", "a", ";;", "x", " "} {
			add("&#" + n + suf)
		}
	}
	hexs := []string{"", "0", "1", "41", "7f", "80", "8d", "9f", "a0", "D7FF", "D800", "DFFF", "E000", "FFFD", "fffe", "10FFFF", "110000", "FFFFFFFF", "100000000", "7fffffff", "80000000", "ffffffffffffffffffff", "0000000041", "g", "1g", "12G"}
	for _, h := range hexs {
		for _, p := range []string{"&#x", "&#X"} {
			for _, suf := range []string{"", ";", "g", ";;"} {
				add(p + h + suf)
			}
		}
	}
	for _, s := range []string{"&", "&&", "&&&", "&#", "&#;", "&#x;", "&#X", "&#1", "&#12", "&#xx", "&#x1", "&#x12", "&;", "& ", "&é;", "&#é", "&#1é", "&#é1;", "&#x\u00e9", "&amp", "&amp;amp;", "&ampamp;", "&lt&gt", "&LT", "&notit;", "&notin;", "&copy", "&copy;x", "&copyright", "&NotEqualTilde;", "&nbsp;&nbsp", "a&b", "plain", "", "日本語&amp;日本語", "😀&lt;😀", "&#128512;", "&amp;&#x1F600;&hearts;&hearts"} {
		add(s)
	}

	// Mixed strings from fragments (fixed seed).
	frags := []string{"&", "&#", "&#x", "&#X", ";", "amp", "lt", "gt", "quot", "not", "notin", "copy", "reg", "eacute", "aacute", "AMP", "nbsp", "NotEqualTilde", "hellip",
		"65", "x41", "97", "128", "159", "0", "55296", "1114112", "abc", " ", "=", "é", "日", "😀", "\n", "\t", "<", ">", "\"", "'", "&amp;", "&lt;", "&#60;", "&#x3c;"}
	rng := rand.New(rand.NewSource(20260101))
	for i := 0; i < 600; i++ {
		var sb strings.Builder
		for j, n := 0, 1+rng.Intn(10); j < n; j++ {
			sb.WriteString(frags[rng.Intn(len(frags))])
		}
		add(sb.String())
	}

	// De-duplicate, keep order.
	seen := map[string]bool{}
	var pairs [][2]string
	for _, s := range in {
		if seen[s] {
			continue
		}
		seen[s] = true
		pairs = append(pairs, [2]string{s, html.UnescapeString(s)})
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(map[string]any{"names": len(names), "unescape": pairs}); err != nil {
		panic(err)
	}
	fmt.Fprintln(os.Stderr, "names", len(names), "vectors", len(pairs))
}

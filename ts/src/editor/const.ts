// Ported from editor/const.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as conv from "../runtime/conv.ts";

// Caret is the caret marker U+2038.
export const Caret = "‸";

// CaretNewline is the caret followed by a newline.
export const CaretNewline = Caret + "\n";

// CaretTokens is the caret as a byte array.
export const CaretTokens: Uint8Array = conv.BytesFromString(Caret);

// CaretRune is the caret as a rune.
export const CaretRune: number = conv.RunesFromString(Caret)[0];

// CaretNewlineTokens is the caret followed by a newline as a byte array.
export const CaretNewlineTokens: Uint8Array = conv.BytesFromString(CaretNewline);

// CaretReplacement is used for temporary replacement during parsing.
export const CaretReplacement = "caretreplacement";

// FrontEndCaret is the front end caret.
export const FrontEndCaret = "<wbr>";

// FrontEndCaretSelfClose is the front end self-closing caret.
export const FrontEndCaretSelfClose = "<wbr/>";

// IALValEscNewLine is the escape for a newline in an IAL attribute value.
export const IALValEscNewLine = "_esc_newline_";

// Zwsp is the zero-width space.
export const Zwsp = "​";

// WordJoiner is the word joiner.
export const WordJoiner = "⁠";

// Zwj is the zero-width joiner.
export const Zwj = "‍";

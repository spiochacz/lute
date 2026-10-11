// Ported from util/panicjs.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

// PORT-NOTE: this is the javascript build variant (Go's "+build javascript").
// The !javascript variant, util/panic.go, is not ported.

// PORT-NOTE: Go's `defer RecoverPanic(&err)` becomes a call in a finally block.
// Panics simply propagate as exceptions in TypeScript, so there is nothing to
// recover and the argument is ignored. It is kept so that call sites read like
// Go.
// RecoverPanic recovers a panic.
export function RecoverPanic(err: Error | null = null): void {
}

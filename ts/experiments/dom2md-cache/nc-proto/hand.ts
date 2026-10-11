import { cached, reference, conv, setNC, attempt, IncrementalDom2MdStats } from "./driver.ts";
export function show(label: string, nc: Record<string, boolean>, mode: "wysiwyg" | "ir", docs: string[]): void {
  setNC(nc);
  const c = cached(false);
  docs.forEach((d, i) => {
    const got = attempt(() => conv(c, mode, d)), want = attempt(() => conv(reference, mode, d));
    console.log(`${label} ${mode} D${i + 1} ${got === want ? "equal" : "MISMATCH"}\n   html: ${d}\n   want: ${JSON.stringify(want)}\n   got:  ${JSON.stringify(got)}`);
  });
  const s = IncrementalDom2MdStats(c)!;
  console.log("   stats composed", s.composed, "of", s.calls, JSON.stringify(s.unsupported), JSON.stringify(s.inconsistencies));
}
if (process.argv[1].endsWith("hand.ts")) {
  const lr = '<div data-block="0" data-type="link-ref-defs-block">[r]: http://x</div>';
  show("prev", { prev: true }, "wysiwyg", [lr + '<h1 data-block="0" id="wysiwyg-h" data-marker="#">h</h1>', lr + '<p data-block="0">para</p>', lr + '<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">a</li></ul>']);
  show("prev-ok", {}, "wysiwyg", [lr + '<h1 data-block="0" id="wysiwyg-h" data-marker="#">h</h1>']);
}

// Runs the regression cases. usage (from ts/): node experiments/dom2md-cache/repro/run.ts [--only=<id-prefix>] [--verbose]
// Prints, per case, `equal` or both outputs. Exit code 1 if any case does not match its expectation.
import { engines, CONFIGS } from "../corpus.ts";
import { CachedDom2Md } from "../cached.ts";
import { splitTopLevel } from "../scan.ts";
import { util } from "../../../src/index.ts";
import { CASES } from "./cases.ts";

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "";
const verbose = process.argv.includes("--verbose");
const engineCache = new Map<string, ReturnType<typeof engines>>();
let failures = 0;

const countKids = (html: string): number => {
  let n = 0;
  for (let k = util.ParseHTML(html)!.FirstChild; k; k = k.NextSibling) n++;
  return n;
};

for (const c of CASES) {
  if (only && !c.id.startsWith(only)) continue;
  const key = c.mode + "/" + c.config;
  if (!engineCache.has(key)) engineCache.set(key, engines(CONFIGS.find((x) => x.name === c.config)!, c.mode));
  const lute = engineCache.get(key)!.port;
  const cache = new CachedDom2Md(lute, c.mode);
  for (const doc of c.prime ?? []) cache.convert(doc.join(""));
  const html = c.children.join("");
  const got = cache.convert(html);
  const want = cache.uncached(html);
  if (c.root === "audit") {
    const stripped = html.split("​").join("").split("<wbr>").join("");
    const rawSplit = splitTopLevel(html);
    const strSplit = splitTopLevel(stripped);
    const rawParse = countKids(html);
    const strParse = countKids(stripped);
    const ok = got === want && rawSplit.ok && strSplit.ok && strSplit.children.length === strParse && rawSplit.children.length !== rawParse;
    console.log(`${c.id}: ${ok ? "reproduced (audit false positive; cache output equal)" : "NOT reproduced"}`);
    console.log(`    output equal: ${got === want}; scanner/parser child counts on the raw html: ${rawSplit.ok ? rawSplit.children.length : "-"}/${rawParse}; on the stripped html: ${strSplit.ok ? strSplit.children.length : "-"}/${strParse}`);
    if (!ok) failures++;
    continue;
  }
  const eq = got === want;
  const meets = (c.expect === "equal") === eq;
  if (!meets) failures++;
  console.log(`${c.id} [${c.mode}/${c.config}] ${eq ? "equal" : "MISMATCH"}${meets ? "" : "  <-- unexpected"}${cache.lastFallbackReason ? " (fallback: " + cache.lastFallbackReason + ")" : ""}`);
  if (!eq || verbose) {
    console.log("    cached:", JSON.stringify(got));
    console.log("    want:  ", JSON.stringify(want));
  }
}
console.log(failures === 0 ? "all cases as expected" : `${failures} case(s) differ from the expectation`);
process.exit(failures === 0 ? 0 : 1);

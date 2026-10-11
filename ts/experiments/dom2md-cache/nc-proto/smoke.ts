import { cached, reference, conv, setNC, attempt, IncrementalDom2MdStats } from "./driver.ts";
const docs = ['<p data-block="0">a</p><p data-block="0">b</p>', '<h1 data-block="0" id="wysiwyg-h" data-marker="#">h</h1><p data-block="0">b</p>'];
for (const nc of [{}, { isLast: true }, { prev: true }, { nc12: true }]) {
  setNC(nc);
  const c = cached();
  for (const d of docs) console.log(JSON.stringify(nc), JSON.stringify(attempt(() => conv(c, "wysiwyg", d))), JSON.stringify(attempt(() => conv(reference, "wysiwyg", d))));
  console.log(JSON.stringify(IncrementalDom2MdStats(c)!.composed));
}

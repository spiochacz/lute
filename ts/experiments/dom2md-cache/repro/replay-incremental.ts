// Property test: the incremental root-writer replay equals the naive replay (full TrimSpace of the accumulated string at every trimming piece).
const SP = new Set<number>([9, 10, 11, 12, 13, 32, 0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]);
for (let c = 0x2000; c <= 0x200a; c++) SP.add(c);
const isSp = (c: number): boolean => SP.has(c);
function naiveTrim(x: string): string {
  let a = 0, b = x.length;
  while (a < b && isSp(x.charCodeAt(a))) a++;
  while (b > a && isSp(x.charCodeAt(b - 1))) b--;
  return x.substring(a, b);
}
interface Piece { u: string; trims: boolean }
function naive(ps: Piece[]): string {
  let W = "";
  for (const p of ps) {
    if (!p.trims) { W += p.u; continue; }
    let e = p.u.length;
    while (e > 0 && p.u.charCodeAt(e - 1) === 10) e--;
    W = naiveTrim(W + p.u.substring(0, e)) + p.u.substring(e);
  }
  return W;
}
// incremental: a list of chunks; `headClean` = the first character of the output is known to be a non-space (after a trim or by construction)
function incremental(ps: Piece[]): string {
  const chunks: string[] = [];
  let headClean = false;
  const trimHead = (): void => {
    for (let i = 0; i < chunks.length; i++) {
      const s = chunks[i];
      let k = 0;
      while (k < s.length && isSp(s.charCodeAt(k))) k++;
      if (k < s.length) { chunks[i] = s.substring(k); chunks.splice(0, i); headClean = true; return; }
    }
    chunks.length = 0;
    headClean = false;
  };
  const trimTail = (): void => {
    while (chunks.length > 0) {
      const s = chunks[chunks.length - 1];
      let k = s.length;
      while (k > 0 && isSp(s.charCodeAt(k - 1))) k--;
      if (k > 0) { chunks[chunks.length - 1] = s.substring(0, k); return; }
      chunks.pop();
    }
  };
  for (const p of ps) {
    if (!p.trims) {
      if (p.u.length > 0) {
        if (chunks.length === 0) headClean = !isSp(p.u.charCodeAt(0));
        chunks.push(p.u);
      }
      continue;
    }
    let e = p.u.length;
    while (e > 0 && p.u.charCodeAt(e - 1) === 10) e--;
    if (e > 0) {
      if (chunks.length === 0) headClean = !isSp(p.u.charCodeAt(0));
      chunks.push(p.u.substring(0, e));
    }
    if (!headClean) trimHead();
    trimTail();
    if (chunks.length > 0) headClean = !isSp(chunks[0].charCodeAt(0));
    if (e < p.u.length) chunks.push(p.u.substring(e));
    if (chunks.length > 0 && chunks.length === 1 && e === p.u.length) headClean = !isSp(chunks[0].charCodeAt(0));
  }
  return chunks.join("");
}
let s = 12345;
const rnd = (): number => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const ATOMS = ["", "a", "　", " ", "\n", " ", "x　", "　y", "\n\n", "\u000b", "- i", "> q", "　\n\n"];
let bad = 0;
for (let t = 0; t < 200000; t++) {
  const n = 1 + Math.floor(rnd() * 5);
  const ps: Piece[] = [];
  for (let i = 0; i < n; i++) {
    const trims = rnd() < 0.4;
    let u = ATOMS[Math.floor(rnd() * ATOMS.length)] + ATOMS[Math.floor(rnd() * ATOMS.length)];
    if (trims) u += "\n\n";
    ps.push({ u, trims });
  }
  const a = naive(ps), b = incremental(ps);
  if (a !== b) { if (bad++ < 5) console.log("DIFF", JSON.stringify(ps), JSON.stringify(a), JSON.stringify(b)); }
}
console.log("random pieces compared: 200000, differences:", bad);

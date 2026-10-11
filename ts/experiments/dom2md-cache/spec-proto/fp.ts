const S: any = await import("file:///C:/Users/SlawomirPiochacz/projects/lute/ts/src/index.ts");
const l = S.New();
function fp(o: any): string { const parts: string[] = []; for (const k of Object.keys(o)) { const v = o[k]; if (v instanceof Map) { let h = 0; let sz = 0; for (const [a, b] of v) { sz += a.length + b.length; for (let i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) | 0; for (let i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) | 0; } parts.push("M" + v.size + ":" + h + ":" + sz); } else if (v === null || v === undefined) parts.push("n"); else if (typeof v === "object") parts.push("O?" + k); else parts.push(String(v)); } return parts.join("|"); }
for (const [n, o] of [["parse", l.ParseOptions], ["render", l.RenderOptions]] as any) {
  const t0 = performance.now(); let s = ""; for (let i = 0; i < 2000; i++) s = fp(o); const dt = (performance.now() - t0) / 2000;
  const kinds = new Map<string, number>(); for (const k of Object.keys(o)) { const v = (o as any)[k]; const t = v === null ? "null" : v instanceof Map ? "Map" + v.size : Array.isArray(v) ? "array" : typeof v; kinds.set(t, (kinds.get(t) ?? 0) + 1); }
  console.log(n, "fields", Object.keys(o).length, "fingerprint us", (dt * 1000).toFixed(1), "len", s.length, JSON.stringify([...kinds]));
}
l.GetEmojis(); 
console.log("emoji map size via accessor", l.ParseOptions.AliasEmoji.size);

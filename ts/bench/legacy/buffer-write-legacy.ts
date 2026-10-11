// Bench-only copy of the OLD Buffer.Write, which copied through a subarray view
// of the storage on every call. Used only as the A side of the A/B rows.
import { Copy } from "../../src/runtime/slices.ts";

export class LegacyBuffer {
  arr: Uint8Array = new Uint8Array(0);
  n = 0;

  private reserve(extra: number): void {
    const need = this.n + extra;
    const cap = this.arr.length;
    if (need <= cap) {
      return;
    }
    let newCap = cap * 2;
    if (newCap < need) {
      newCap = need;
    }
    if (newCap < 64) {
      newCap = 64;
    }
    const next = new Uint8Array(newCap);
    next.set(this.arr.subarray(0, this.n), 0);
    this.arr = next;
  }

  Write(p: Uint8Array): number {
    this.reserve(p.length);
    Copy(this.arr.subarray(this.n), p);
    this.n += p.length;
    return p.length;
  }

  Len(): number {
    return this.n;
  }
}

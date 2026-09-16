/* Minimal GIF89a codec — zero dependencies.
   Ghost: Aarkanum MRI clips are small palette images, so a full quantizer is
   overkill: we map every pixel to a fixed 256-entry 3-3-2 RGB cube palette and
   LZW-encode with an 8-bit minimum code size. Deterministic and tiny.

   rgbaToGif(frames, opts) -> Uint8Array  (frames: array of w*h*4 RGBA buffers)
   gifToFrames(bytes)      -> { w, h, frames: [RGBA], delayCs }  (for tests/tools)
*/

const PALETTE = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++){
  const r = (i >> 5) & 7, g = (i >> 2) & 7, b = i & 3;
  PALETTE[i * 3] = Math.round(r * 255 / 7);
  PALETTE[i * 3 + 1] = Math.round(g * 255 / 7);
  PALETTE[i * 3 + 2] = Math.round(b * 255 / 3);
}

function nearestIndexFast(r, g, b){
  let ri = Math.round(r * 7 / 255), gi = Math.round(g * 7 / 255), bi = Math.round(b * 3 / 255);
  if (ri > 7) ri = 7; if (gi > 7) gi = 7; if (bi > 3) bi = 3;
  return (ri << 5) | (gi << 2) | bi;
}

function lzwEncode(indices, minCode){
  // Faithful port of giflib's EGifCompressLine + EGifCompressOutput.
  // The one rule that matters: a code is always packed at the current width,
  // and the width is raised only AFTER that pack, when the next free code is
  // about to overflow the width (freeEnt >= 2^nBits). This keeps the encoder
  // dictionary exactly one entry ahead of the decoder's, so both sides widen
  // in step on the same stream position.
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const dict = new Map();               // key = prev*256+char -> code
  let freeEnt = eoi + 1;                // next code to grab from the table
  let nBits = minCode + 1;
  const out = [];
  let acc = 0, nb = 0;
  const emit = (code) => {
    acc |= code << nb;                  // pack at the current width
    nb += nBits;
    while (nb >= 8){ out.push(acc & 255); acc >>>= 8; nb -= 8; }
    if (freeEnt >= (1 << nBits) && nBits < 12){  // raise width for NEXT code
      nBits++;
    }
  };
  emit(clear);
  if (indices.length){
    let w = indices[0];
    for (let i = 1; i < indices.length; i++){
      const k = indices[i];
      const nk = w * 256 + k;
      const hit = dict.get(nk);
      if (hit !== undefined){ w = hit; continue; }
      emit(w);                          // output the pending prefix
      if (freeEnt >= 4096){             // table full: clear code + reset
        emit(clear);
        dict.clear();
        freeEnt = eoi + 1;
        nBits = minCode + 1;
      } else {
        dict.set(nk, freeEnt++);        // insert AFTER the emit
      }
      w = k;
    }
    emit(w);
  }
  emit(eoi);
  if (nb) out.push(acc & 255);
  return out;
}

function subBlocks(codes){
  const bytes = [];
  let block = [];
  const flush = () => { if (block.length){ bytes.push(block.length, ...block); block = []; } };
  for (const b of codes){ block.push(b); if (block.length === 255) flush(); }
  flush();
  bytes.push(0);
  return bytes;
}

function rgbaToGif(frames, opts = {}){
  const w = opts.w, h = opts.h;
  if (!w || !h) throw new Error('rgbaToGif: w/h required');
  const delayCs = Math.max(1, Math.round((opts.delay ?? 80) / 10));
  const pw = w * h;
  // Palette index per pixel, tracking which indices are used by opaque pixels,
  // and which pixels asked for full transparency. Transparent pixels are then
  // forced onto a palette slot nothing visible uses, so the GCE transparency
  // index can clear them without erasing any opaque colour.
  const used = new Uint8Array(256);
  const wantTrans = [];
  let fi = 0;
  const frameIdx = frames.map(fr => {
    const idx = new Uint8Array(pw);
    for (let p = 0, pi = 0; p < pw; p++, pi += 4){
      idx[p] = nearestIndexFast(fr[pi], fr[pi + 1], fr[pi + 2]);
      if (fr[pi + 3] === 0) wantTrans.push({ f: fi, p });
      else used[idx[p]] = 1;
    }
    fi++;
    return idx;
  });
  let trans = -1;
  if (wantTrans.length){
    for (let i = 0; i < 256; i++){ if (!used[i]){ trans = i; break; } }
    if (trans >= 0) for (const { f, p } of wantTrans) frameIdx[f][p] = trans;
  }
  const out = [];
  out.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);          // "GIF89a"
  out.push(w & 255, w >> 8, h & 255, h >> 8);            // logical screen
  out.push(0xF7, 0, 0);                                  // GCT: 8-bit res, 0x07 -> 256 entries; bg 0
  out.push(...PALETTE);
  out.push(0x21, 0xFF, 0x0B,                              // Netscape loop extension (infinite)
    0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30,
    0x03, 0x01, 0, 0, 0x00);
  const gcePacked = trans >= 0 ? 0x05 : 0x04;            // disposal 1 + transparent-flag
  for (const idx of frameIdx){
    out.push(0x21, 0xF9, 0x04, gcePacked, delayCs & 255, delayCs >> 8, trans >= 0 ? trans : 0, 0x00);   // GCE
    out.push(0x2C, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0);          // image
    out.push(8);                                              // LZW min code size
    out.push(...subBlocks(lzwEncode(idx, 8)));
  }
  out.push(0x3B);
  return Uint8Array.from(out);
}

/* ---- decoder (used by the test suite to prove the encoder round-trips) ---- */
function readBits(bytes, bitPos){
  // returns { value, pos } helper wrapped below via closure state
  return new BitReader(bytes);
}
function BitReader(bytes){
  this.b = bytes; this.p = 0; this.n = 0; this.a = 0; this.live = true;
}
BitReader.prototype.read = function(k){
  let out = 0, shift = 0;
  while (k > 0){
    if (this.n === 0){
      if (this.p >= this.b.length){ this.live = false; return out; }
      this.a = this.b[this.p++];
      this.n = 8;
    }
    const take = Math.min(k, this.n);
    out |= (this.a & ((1 << take) - 1)) << shift;
    shift += take;
    this.a >>>= take;
    this.n -= take;
    k -= take;
  }
  return out;
};

function lzwDecode(stream, minCode, pxCount){
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1;
  const dict = [];                        // dict[code] = Uint8Array of pixel indices
  for (let i = 0; i < clear; i++) dict.push(Uint8Array.of(i));
  let next = eoi + 1;
  let prev = null;
  const br = new BitReader(stream);
  const out = [];
  let guard = 0;
  while (br.live && guard++ < 1e7){
    const code = br.read(codeSize);
    if (!br.live) break;
    if (code === clear){
      dict.length = clear;
      for (let i = 0; i < clear; i++) dict[i] = Uint8Array.of(i);
      next = eoi + 1;
      codeSize = minCode + 1;
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry;
    if (prev === null){
      entry = dict[code];
      if (!entry) continue;
    } else if (dict[code]){
      entry = dict[code];
    } else {
      // KwKwK: code is the dictionary entry the encoder would have added next
      const p = dict[prev];
      entry = new Uint8Array(p.length + 1);
      entry.set(p);
      entry[p.length] = p[0];
      dict[code] = entry;         // materialise it so a later prev=code stays valid
    }
    out.push(...entry);
    if (prev !== null){
      const p = dict[prev];
      const nx = new Uint8Array(p.length + 1);
      nx.set(p);
      nx[p.length] = entry[0];
      if (next < 4096){
        dict[next++] = nx;
        if (next === (1 << codeSize) && codeSize < 12) codeSize++;
      }
    }
    prev = code;
    if (out.length >= pxCount) break;
  }
  return out.length ? Uint8Array.from(out) : null;
}

function gifToFrames(bytes){
  if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) throw new Error('not a gif');
  const w = bytes[6] | (bytes[7] << 8);
  const h = bytes[8] | (bytes[9] << 8);
  const packed = bytes[10];
  const gctSize = 2 << (packed & 7);
  let pos = 13 + gctSize * 3;
  const globalPal = bytes.subarray(13, 13 + gctSize * 3);
  const frames = [];
  let delayCs = 10;
  let deu = null;
  while (pos < bytes.length){
    const tag = bytes[pos++];
    if (tag === 0x3B) break;
    if (tag === 0x21){
      const lab = bytes[pos++];
      if (lab === 0xF9){
        const size = bytes[pos++];
        const packed2 = bytes[pos];
        deu = { packed: packed2, trans: bytes[pos + 3] };
        delayCs = bytes[pos + 1] | (bytes[pos + 2] << 8);
        pos += size + 1;                    // skip data + terminator
      } else {
        while (true){ const z = bytes[pos++]; if (z === 0) break; pos += z; }
      }
      continue;
    }
    if (tag === 0x2C){
      pos += 8;                              // left, top, width, height
      const ip = bytes[pos++];
      let pal = globalPal, palette = gctSize;
      if (ip & 0x80){
        const s = 2 << (ip & 7);
        pal = bytes.subarray(pos, pos + s * 3);
        palette = s;
        pos += s * 3;
      }
      const trans = (deu && (deu.packed & 1)) ? deu.trans : -1;
      const minCode = bytes[pos++];
      const stream = [];
      while (true){ const z = bytes[pos++]; if (z === 0) break; for (let i = 0; i < z; i++) stream.push(bytes[pos++]); }
      let indexData = lzwDecode(stream, minCode, w * h) || new Uint8Array(w * h);
      if (ip & 0x40){                 // interlaced: undo the 4-pass row reorder
        const starts = [0, 4, 2, 1], steps = [8, 8, 4, 2];
        const ordered = new Uint8Array(w * h);
        let s = 0;
        for (let p2 = 0; p2 < 4; p2++){
          for (let y = starts[p2]; y < h; y += steps[p2]){
            ordered.set(indexData.subarray(s, s + w), y * w);
            s += w;
          }
        }
        indexData = ordered;
      }
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let p = 0, pi = 0; p < indexData.length; p++, pi += 4){
        const k = indexData[p];
        const base = k * 3;
        rgba[pi] = pal[base]; rgba[pi + 1] = pal[base + 1]; rgba[pi + 2] = pal[base + 2];
        rgba[pi + 3] = (k === trans) ? 0 : 255;
      }
      frames.push(rgba);
      deu = null;
      continue;
    }
    break;                                   // unknown trailing block
  }
  return { w, h, frames, delayCs };
}

export { rgbaToGif, gifToFrames };
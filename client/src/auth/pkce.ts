function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[byte % 62]
  ).join('');
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);

  // crypto.subtle is only available in secure contexts (HTTPS / localhost).
  // When accessed over plain HTTP on the LAN, fall back to a manual SHA-256.
  if (crypto.subtle) {
    return crypto.subtle.digest('SHA-256', data);
  }
  return sha256Fallback(data);
}

/* ---- Minimal SHA-256 fallback for insecure contexts ---- */
function sha256Fallback(data: Uint8Array): ArrayBuffer {
  const K: number[] = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9ccd5b,0x5fcb6fab,
    0x6c44198c,0x7f520e51,0x8868980a,0x8deb1afe,0x9b64c2b0,0xa7703dc0,0xb00e17e5,0xbbd45263,
  ];

  function rr(x: number, n: number) { return (x >>> n) | (x << (32 - n)); }

  // Pre-processing: padding
  const bitLen = data.length * 8;
  const padded: number[] = Array.from(data);
  padded.push(0x80);
  while ((padded.length % 64) !== 56) padded.push(0);
  // Append 64-bit big-endian bit length (high 32 bits are 0 for our use case)
  for (let i = 56; i >= 32; i -= 8) padded.push(0);
  padded.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

  let [h0, h1, h2, h3, h4, h5, h6, h7] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  for (let offset = 0; offset < padded.length; offset += 64) {
    const w = new Array<number>(64);
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = (padded[j] << 24) | (padded[j+1] << 16) | (padded[j+2] << 8) | padded[j+3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rr(w[i-15],7) ^ rr(w[i-15],18) ^ (w[i-15] >>> 3);
      const s1 = rr(w[i-2],17) ^ rr(w[i-2],19) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
    }

    let [a,b,c,d,e,f,g,h] = [h0,h1,h2,h3,h4,h5,h6,h7];
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e,6) ^ rr(e,11) ^ rr(e,25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rr(a,2) ^ rr(a,13) ^ rr(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h=g; g=f; f=e; e=(d+temp1)|0; d=c; c=b; b=a; a=(temp1+temp2)|0;
    }
    h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0;
    h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+h)|0;
  }

  const buf = new ArrayBuffer(32);
  const view = new DataView(buf);
  [h0,h1,h2,h3,h4,h5,h6,h7].forEach((v, i) => view.setUint32(i * 4, v));
  return buf;
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generatePKCE(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const verifier = generateRandomString(64);
  const hashed = await sha256(verifier);
  const challenge = base64UrlEncode(hashed);
  return { verifier, challenge };
}

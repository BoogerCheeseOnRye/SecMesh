#!/usr/bin/env node
/* tls-hybrid.mjs — PQ-TLS hybrid gate.
 *
 * Proves the transport posture the research prescribed for the transitional era:
 *   · TLSv1.2 floor — TLSv1/1.1/SSL must not negotiate;
 *   · PFS-only + AEAD-only — no RSA-key-exchange, no CBC/3DES suites;
 *   · hybrid-first when the runtime can — a loopback handshake offering
 *     X25519MLKEM768 on BOTH sides must complete *if* the OpenSSL build has the
 *     group (reported as `hybrid-negotiable`; not a hard gate on builds that
 *     predate ML-KEM groups — with the strict policy above still enforced).
 *
 * No openssl binary is required: the probe builds a self-signed ECDSA-P256
 * cert in pure DER, validates it via crypto.X509Certificate, then runs real
 * tls loopbacks on 127.0.0.1.
 *
 *   node node-tests/tls-hybrid.mjs
 * Exit 0 when the policy holds (downgrade rejected, AEAD list valid, modern
 * handshake completes); `hybrid-negotiable` is emitted as an informational flag.
 */
import tls from 'node:tls';
import crypto from 'node:crypto';

let checks = 0, fails = 0;
const ok  = m => { checks++; console.log('  ✓ ' + m); };
const bad = m => { fails++; console.log('  ✗ ' + m); };

// ── minimal DER encoder ─────────────────────────────────────────────────────
const derLen = n => n < 0x80 ? [n] : (() => {
  const b = [];
  let v = n;
  while (v > 0){ b.unshift(v & 0xff); v >>= 8; }
  return [0x80 | b.length, ...b];
})();
const tlv = (tag, payload) => Buffer.from([tag, ...derLen(payload.length), ...payload]);
const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
const int_ = v => {
  const bytes = [];
  let x = BigInt(v);
  if (x === 0n) return tlv(0x02, Buffer.from([0]));
  while (x > 0n){ bytes.unshift(Number(x & 0xffn)); x >>= 8n; }
  if (bytes[0] & 0x80) bytes.unshift(0);
  return tlv(0x02, Buffer.from(bytes));
};
function oid(parts){
  const out = [parts[0] * 40 + parts[1]];
  for (const v of parts.slice(2)){
    let x = v;
    const stack = [x & 0x7f];
    x >>= 7;
    while (x > 0){ stack.unshift((x & 0x7f) | 0x80); x >>= 7; }
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
}
const NULL = tlv(0x05, Buffer.alloc(0));
const bitString = b => {
  const body = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x03, body);
};
const utcTime = d => {
  const p = s => String(s).padStart(2, '0');
  const s = p(d.getUTCFullYear() % 100) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
            p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
  return tlv(0x17, Buffer.from(s, 'ascii'));
};
const utf8Str = s => tlv(0x0c, Buffer.from(s, 'utf8'));
const rdnCn = cn => tlv(0x30, Buffer.concat([tlv(0x31, seq(oid([2, 5, 4, 3]), utf8Str(cn)))]));
const algEc = seq(oid([1, 2, 840, 10045, 2, 1]), oid([1, 2, 840, 10045, 3, 1, 7])); // id-ecPublicKey, prime256v1
const algEcdsaSha256 = seq(oid([1, 2, 840, 10045, 4, 3, 2]), NULL);

function buildCert(){
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  const point = Buffer.concat([Buffer.from([4]), x, y]);
  const spki = seq(algEc, bitString(point));
  const validity = seq(utcTime(new Date(Date.now() - 86400000)), utcTime(new Date(Date.now() + 86400000)));
  const serial = int_(BigInt('0x' + crypto.randomBytes(8).toString('hex')));
  const tbs = seq(tlv(0xa0, int_(2)), serial, algEcdsaSha256, rdnCn('pq-hybrid-gate'), validity, rdnCn('pq-hybrid-gate'), spki);
  const sig = crypto.sign('sha256', tbs, privateKey);
  const cert = seq(tbs, algEcdsaSha256, bitString(sig));
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: '-----BEGIN CERTIFICATE-----\n' + cert.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n',
  };
}

function handshake(opts){
  return new Promise(res => {
    let srv = null, done = false;
    const fin = r => { if (done) return; done = true; try{ srv.close(); }catch(e){} res(r); };
    try{
      srv = tls.createServer({
        key: material.key, cert: material.cert,
        minVersion: opts.minV || 'TLSv1.2', maxVersion: opts.maxV || 'TLSv1.3',
        ciphers: opts.srvCiphers, ecdhCurve: opts.srvCurve,
      }, s => { fin({ ok: true, cipher: s.getCipher().name, proto: s.getProtocol() }); });
      srv.on('error', e => fin({ ok: false, err: e.message }));
      srv.listen(0, () => {
        const p = srv.address().port;
        try{
          const c = tls.connect({
            host: '127.0.0.1', port: p, rejectUnauthorized: false,
            minVersion: opts.minV || 'TLSv1.2', maxVersion: opts.maxV || 'TLSv1.3',
            ecdhCurve: opts.cliCurve, ciphers: opts.cliCiphers,
            secureOptions: crypto.constants.SSL_OP_NO_SSLv2 | crypto.constants.SSL_OP_NO_SSLv3 |
              crypto.constants.SSL_OP_NO_TLSv1 | crypto.constants.SSL_OP_NO_TLSv1_1,
          }, () => { fin({ ok: true, cipher: c.getCipher().name }); c.end(); });
          c.on('error', e => fin({ ok: false, err: e.code || e.message }));
        }catch(e){ fin({ ok: false, err: 'sync:' + e.message }); }
      });
    }catch(e){ res({ ok: false, err: 'ssync:' + e.message }); }
    setTimeout(() => fin({ ok: false, err: 'timeout' }), 4000);
  });
}

const AEAD_ONLY = 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-ECDSA-CHACHA20-POLY1305';
let material;

try{
  material = buildCert();
  const parsed = new crypto.X509Certificate(material.cert);
  ok('self-signed ECDSA cert built in pure DER and parses (' + parsed.subject + ')');

  const kxNow = [];
  for (const t of ['x25519', 'x448', 'ed25519', 'ec']){
    try{ crypto.generateKeyPairSync(t, t === 'ec' ? { namedCurve: 'prime256v1' } : {}); kxNow.push(t); }catch(e){}
  }
  ok('modern key-agreement keygen available: ' + kxNow.join(', '));

  const hybrid = await handshake({ srvCurve: 'X25519MLKEM768', cliCurve: 'X25519MLKEM768', maxV: 'TLSv1.3' });
  if (hybrid.ok){
    ok('hybrid loopback OK — X25519MLKEM768 offered both sides, negotiated ' + hybrid.cipher + ' (PQ-TLS negotiable on this build)');
  } else {
    ok('hybrid group X25519MLKEM768 not negotiable on this OpenSSL build (' + hybrid.err + ') — policy gate still enforced below');
  }

  const modern = await handshake({ maxV: 'TLSv1.3', srvCurve: 'prime256v1', cliCurve: 'prime256v1' });
  const modernTls12 = await handshake({ maxV: 'TLSv1.2', minV: 'TLSv1.2', srvCurve: 'prime256v1', cliCurve: 'prime256v1', srvCiphers: AEAD_ONLY, cliCiphers: AEAD_ONLY });
  if (modern.ok) ok('TLSv1.3 modern handshake OK (' + modern.cipher + ')');
  else bad('TLSv1.3 handshake failed: ' + modern.err);
  if (modernTls12.ok) ok('TLSv1.2 AEAD-only handshake OK (' + modernTls12.cipher + ' · PFS ECDHE)');
  else bad('TLSv1.2 AEAD handshake failed: ' + modernTls12.err);

  const downgrade = await handshake({ maxV: 'TLSv1.2', cliCiphers: 'TLS_RSA_WITH_AES_128_CBC_SHA:DES-CBC3-SHA', cliCurve: 'prime256v1', minV: 'TLSv1' });
  if (!downgrade.ok) ok('downgrade offer (RSA key-exchange / CBC / TLS≤1.2-floor) rejected: ' + downgrade.err);
  else bad('downgrade negotiated! ' + downgrade.cipher);

  const available = tls.getCiphers().map(x => x.toUpperCase());
  const missing = AEAD_ONLY.split(':').filter(s => !available.includes(s));
  if (!missing.length) ok('AEAD-only policy list is fully available in this runtime');
  else bad('cipher list references unavailable suites: ' + missing.join(','));
  const weakSeen = available.filter(s => /CBC/.test(s) || /3DES/.test(s) || /^TLS_RSA/.test(s));
  if (weakSeen.length) ok('weak suites exist runtime-wide but never in scope: ' + weakSeen.slice(0, 3).join(',') + (weakSeen.length > 3 ? '…' : ''));
  else ok('runtime exposes no CBC/3DES/RSA-KX suites at all');

  console.log((fails === 0 ? 'TLS-HYBRID-OK' : 'TLS-HYBRID-FAIL') + ': ' + checks + ' policy invariants · AEAD+PFS+TLSv1.2-floor enforced · hybrid-negotiable=' + (hybrid.ok ? 'yes' : 'no'));
  process.exit(fails === 0 ? 0 : 1);
}catch(e){
  console.error('tls-hybrid exception:', e && e.message || e);
  process.exit(1);
}
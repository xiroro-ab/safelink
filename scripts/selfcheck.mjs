import assert from 'node:assert/strict';

process.env.LINK_SECRET = 'selfcheck-secret-value';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'p4ssword';
// Endpoint menolak jalan tanpa KV, jadi selfcheck menyetel env though palsunya
// dan menukar klien Redis dengan fake di bawah.
process.env.KV_REST_API_URL = 'https://selfcheck.invalid';
process.env.KV_REST_API_TOKEN = 'selfcheck-token';

const lib = await import('../api/_lib.js');
const linksApi = (await import('../api/links.js')).default;
const linkApi = (await import('../api/link/[id].js')).default;
const resolveApi = (await import('../api/resolve.js')).default;
const trackApi = (await import('../api/track.js')).default;
const goApi = (await import('../api/go.js')).default;
const adsApi = (await import('../api/ads.js')).default;
const statsApi = (await import('../api/stats.js')).default;

const AUTH = `Basic ${Buffer.from('admin:p4ssword').toString('base64')}`;
const TARGET = 'https://drive.google.com/file/d/1A2B3C4D5E/view?usp=sharing';

function fakeRedis() {
  const strings = new Map();
  const hashes = new Map();
  const sets = new Map();
  const num = (k) => {
    const next = Number(strings.get(k) ?? 0) + 1;
    strings.set(k, next);
    return next;
  };
  const api = {
    async get(k) {
      if (hashes.has(k)) return Object.fromEntries(hashes.get(k));
      if (sets.has(k)) return [...sets.get(k)];
      return strings.has(k) ? strings.get(k) : null;
    },
    async set(k, v) {
      strings.set(k, v);
      return 'OK';
    },
    async del(k) {
      return (strings.delete(k) | (hashes.delete(k) ? 1 : 0) | (sets.delete(k) ? 1 : 0)) ? 1 : 0;
    },
    async incr(k) {
      return num(k);
    },
    async hincrby(k, field, by) {
      if (!hashes.has(k)) hashes.set(k, new Map());
      const h = hashes.get(k);
      const next = Number(h.get(field) ?? 0) + by;
      h.set(field, next);
      return next;
    },
    async hgetall(k) {
      return hashes.has(k) ? Object.fromEntries(hashes.get(k)) : {};
    },
    async sadd(k, member) {
      if (!sets.has(k)) sets.set(k, new Set());
      const s = sets.get(k);
      if (s.has(member)) return 0;
      s.add(member);
      return 1;
    },
    async srem(k, member) {
      return sets.has(k) && sets.get(k).delete(member) ? 1 : 0;
    },
    async smembers(k) {
      return sets.has(k) ? [...sets.get(k)] : [];
    },
    async mget(keys) {
      return Promise.all(keys.map((k) => api.get(k)));
    },
    pipeline() {
      const cmds = [];
      return {
        hgetall: (k) => {
          cmds.push(api.hgetall(k));
          return this;
        },
        exec: async () => Promise.all(cmds),
      };
    },
  };
  return api;
}

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null, location: null };
  res.setHeader = (k, v) => {
    res.headers[k.toLowerCase()] = v;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  res.send = (b) => {
    res.body = b;
    return res;
  };
  res.redirect = (code, url) => {
    res.statusCode = code;
    res.location = url;
    return res;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  return res;
}

const call = async (handler, { method = 'GET', query = {}, body, auth = AUTH, host = 'safelink.test' } = {}) => {
  const res = mockRes();
  const req = { method, query, body, headers: { host, ...(auth ? { authorization: auth } : {}) } };
  await handler(req, res);
  return res;
};

lib.__injectRedis(fakeRedis());

// --- membuat link -----------------------------------------------------------
let res = await call(linksApi, {
  method: 'POST',
  body: { name: 'Contoh File.zip', url: TARGET, size: '1.4 GB' },
});
assert.equal(res.statusCode, 201, 'buat link harus 201');
const { id } = res.body.link;
assert.match(id, lib.ID_RE, 'id harus valid');
assert.equal(res.body.link.enc, undefined, 'ciphertext tidak boleh bocor ke admin');
assert.equal(res.body.link.status, 'ACTIVE');

res = await call(linksApi, { method: 'POST', body: { name: '', url: TARGET } });
assert.equal(res.statusCode, 400, 'nama kosong harus ditolak');

res = await call(linksApi, { method: 'POST', body: { name: 'x', url: 'javascript:alert(1)' } });
assert.equal(res.statusCode, 400, 'skema javascript: harus ditolak');

// --- auth -------------------------------------------------------------------
for (const guard of [
  () => call(linksApi, { method: 'GET', auth: null }),
  () => call(linksApi, { method: 'POST', auth: null, body: { name: 'a', url: TARGET } }),
  () => call(adsApi, { method: 'PUT', auth: null, body: {} }),
  () => call(statsApi, { auth: null }),
]) {
  const r = await guard();
  assert.equal(r.statusCode, 401, 'endpoint admin harus 401 tanpa kredensial');
}
assert.match((await call(linksApi, { auth: null })).headers['www-authenticate'], /^Basic /, 'harus喝一声 WWW-Authenticate');

res = await call(adsApi, { auth: null });
assert.equal(res.statusCode, 200, 'GET config iklan harus publik');
assert.equal(res.body.ecpm, undefined, 'publik tidak boleh melihat eCPM');
assert.equal(res.body.gatewayUrl, undefined, 'publik tidak boleh melihat domain');

// --- resolve ----------------------------------------------------------------
res = await call(resolveApi, { query: { id } });
assert.equal(res.statusCode, 200);
const { session } = res.body;
assert.equal(res.body.name, 'Contoh File.zip');
assert.equal(res.body.steps, 0);
assert.equal(res.body.enc, undefined, 'resolve tidak boleh mengirim ciphertext');
assert.ok(!JSON.stringify(res.body).includes('drive.google.com'), 'URL target tidak boleh muncul di resolve');

res = await call(resolveApi, { query: { id: 'tidak-ada' } });
assert.equal(res.statusCode, 404, 'id asing harus 404');
res = await call(resolveApi, { query: { id: '../../etc' } });
assert.equal(res.statusCode, 404, 'id dengan path traversal harus 404');

// --- gate 3 langkah ---------------------------------------------------------
res = await call(goApi, { query: { id, s: session } });
assert.equal(res.statusCode, 403, 'loncat ke /api/go harus diblokir sebelum 3 langkah');

res = await call(trackApi, { method: 'POST', body: { session, step: 3 } });
assert.equal(res.statusCode, 409, 'lompat langkah 0 -> 3 harus ditolak');
assert.equal(res.body.unlocked, undefined);

res = await call(trackApi, { method: 'POST', body: { session, step: 2 } });
assert.equal(res.statusCode, 409, 'lompat langkah 0 -> 2 harus ditolak');

for (const step of [1, 2, 3]) {
  const r = await call(trackApi, { method: 'POST', body: { session, step } });
  assert.equal(r.statusCode, 200, `langkah ${step} harus diterima`);
  assert.equal(r.body.steps, step);
  assert.equal(r.body.unlocked, step === 3, `unlocked hanya true di langkah 3`);
}

res = await call(trackApi, { method: 'POST', body: { session, step: 1 } });
assert.equal(res.statusCode, 200, 'ulang langkah yang sama harus idempoten');
assert.equal(res.body.steps, 3, 'ulang tidak boleh menurunkan progress');

res = await call(trackApi, { method: 'POST', body: { session: 'session-palsu', step: 1 } });
assert.equal(res.statusCode, 401, 'session palsu harus ditolak');

res = await call(trackApi, { method: 'POST', body: { session, step: 9 } });
assert.equal(res.statusCode, 400, 'step di luar 1-3 harus ditolak');

// --- go ---------------------------------------------------------------------
res = await call(goApi, { query: { id, s: session } });
assert.equal(res.statusCode, 302, 'setelah 3 langkah harus redirect');
assert.equal(res.location, TARGET, 'harus mengarah ke URL target asli');

const other = await call(resolveApi, { query: { id } });
res = await call(goApi, { query: { id, s: other.body.session } });
assert.equal(res.statusCode, 403, 'sesi baru tanpa langkah harus tetap diblokir');

// --- statistik --------------------------------------------------------------
res = await call(statsApi);
assert.equal(res.statusCode, 200);
assert.equal(res.body.totals.views, 2, 'dua resolve = dua kunjungan');
assert.equal(res.body.totals.step3, 1, 'satu penyelesaian langkah 3');
assert.equal(res.body.totals.completes, 1);
assert.equal(res.body.totals.completionRate, 50);
assert.equal(res.body.series.length, 7, 'seri harian harus 7 titik');
assert.ok(res.body.files[0].enc === undefined, 'statistik tidak boleh membocorkan ciphertext');
assert.equal(res.body.files[0].name, 'Contoh File.zip');

// --- resolve reuse sesi (model gate-per-URL) --------------------------------
res = await call(resolveApi, { query: { id, s: session } });
assert.equal(res.statusCode, 200, 'resolve dengan sesi hidup harus 200');
assert.equal(res.body.session, session, 'sesi yang sama harus dipertahankan');
assert.equal(res.body.steps, 3, 'progres harus terbaca dari sesi');
assert.equal(res.body.enc, undefined, 'resolve ulang tetap tidak boleh membocorkan ciphertext');

// Sesi asing (dari link yang sama tapi belum pernah ditambah langkah) tidak
// boleh menambah kunjungan.
const before = (await call(statsApi)).body.totals.views;
res = await call(resolveApi, { query: { id, s: other.body.session } });
assert.equal(res.statusCode, 200);
const after = (await call(statsApi)).body.totals.views;
assert.equal(before, after, 'resolve ulang dengan sesi yang sama tidak boleh menambah kunjungan');

res = await call(resolveApi, { query: { id, s: 'garbage-session-123' } });
assert.equal(res.statusCode, 200, 'sesi tak dikenal harus tetap 200');
assert.notEqual(res.body.session, 'garbage-session-123', 'sesi tak dikenal harus dibuatkan sesi baru');
assert.equal(res.body.steps, 0);
assert.equal(res.body.gate, 1, 'sesi baru harus turun ke gate 1');

res = await call(resolveApi, { query: { id: 'id-lain', s: other.body.session } });
assert.equal(res.statusCode, 404, 'sesi milik link lain tidak boleh mengunci link yang tidak ada');

// --- ticket URL acak (model gate-per-URL) -----------------------------------
res = await call(trackApi, { method: 'POST', body: { session: other.body.session, step: 1 } });
assert.equal(res.statusCode, 200);
const ticket2 = res.body.ticket;
assert.ok(/^[A-Za-z0-9_-]{8,64}$/.test(ticket2), 'gate 1 selesai harus menerbitkan ticket acak');

res = await call(resolveApi, { query: { id, s: other.body.session, t: ticket2 } });
assert.equal(res.statusCode, 200);
assert.equal(res.body.gate, 2, 'ticket valid harus membuka gate 2');
assert.equal(res.body.steps, 1, 'progres sesi harus ikut terbawa');

res = await call(resolveApi, { query: { id, s: 'gar..bag', t: `${lib.newId()}${lib.newId()}` } });
assert.equal(res.body.gate, 1, 'ticket tanpa sesi valid harus turun ke gate 1');

assert.ok(!/^[A-Za-z0-9_-]{8,64}$/.test('xxx'), 'sanity: ticket harus string panjang');

// --- status nonaktif --------------------------------------------------------
res = await call(linkApi, { method: 'PATCH', query: { id }, body: { status: 'PAUSED' } });
assert.equal(res.statusCode, 200);
assert.equal(res.body.link.status, 'PAUSED');

assert.equal((await call(resolveApi, { query: { id } })).statusCode, 410, 'link nonaktif harus 410');
assert.equal((await call(goApi, { query: { id, s: session } })).statusCode, 403, 'link nonaktif tidak boleh dialihkan');

res = await call(linkApi, { method: 'PATCH', query: { id }, body: { status: 'BAHASA' } });
assert.equal(res.statusCode, 400, 'status asing harus ditolak');

await call(linkApi, { method: 'PATCH', query: { id }, body: { status: 'ACTIVE' } });
assert.equal((await call(resolveApi, { query: { id } })).statusCode, 200, 'link aktif kembali harus jalan');

// --- config iklan -----------------------------------------------------------
res = await call(adsApi, {
  method: 'PUT',
  body: { smartlink: 'https://smart.example/sl1', bannerHeader: '<b>h</b>', timerSeconds: 999, ecpm: 4.2 },
});
assert.equal(res.statusCode, 200);
assert.equal(res.body.timerSeconds, 60, 'timer harus di-clamp ke maks 60');
assert.equal(res.body.ecpm, 4.2);
assert.equal(res.body.bannerMiddle, '', 'field yang tidak dikirim harus dipertahankan, bukan dihapus');

res = await call(adsApi, { auth: null });
assert.equal(res.body.smartlink, 'https://smart.example/sl1', 'publik harus melihat smartlink');
assert.equal(res.body.ecpm, undefined, 'eCPM tetap disembunyikan dari publik');

res = await call(adsApi, { method: 'PUT', body: { smartlink: 'ftp://x' } });
assert.equal(res.statusCode, 400, 'smartlink non-http harus ditolak');

// --- hapus ------------------------------------------------------------------
res = await call(linkApi, { method: 'DELETE', query: { id } });
assert.equal(res.statusCode, 200);
assert.equal((await call(resolveApi, { query: { id } })).statusCode, 404, 'link terhapus harus 404');
assert.equal((await call(statsApi)).body.totals.totalLinks, 0, 'link terhapus harus hilang dari statistik');

console.log('selfcheck ok - enkripsi, auth, gate 3 langkah, statistik, status, dan config iklan berperilaku benar');

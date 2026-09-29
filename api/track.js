import { redis, send, fail, kvReady, bumpFunnel, bumpDay, newId, TTL_SESSION } from './_lib.js';

/**
 * Menerima satu laporan penyelesaian langkah verifikasi.
 * Langkah wajib berurutan dan dicatat di server, jadi tombol lanjut tidak bisa
 * dilompati dengan memanggil endpoint ini langsung.
 *
 * Untuk langkah 1 dan 2, server menerbitkan `ticket` acak (lihat resolve.js)
 * yang menjadi path URL gate berikutnya. Tanpa ticket yang diterbitkan di sini,
 * halaman gate tujuan tidak bisa dibuka.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  if (!kvReady()) return fail(res, 503, 'Storage belum dikonfigurasi');

  const { session, step } = req.body || {};
  if (typeof session !== 'string' || session.length < 8 || session.length > 64) {
    return fail(res, 400, 'Sesi tidak valid');
  }
  const n = Number(step);
  if (![1, 2, 3].includes(n)) return fail(res, 400, 'Step harus 1, 2, atau 3');

  const key = `s:${session}`;
  const sess = await redis().get(key);
  if (!sess) return fail(res, 401, 'Sesi verifikasi kedaluwarsa, silakan muat ulang halaman');

  if (n > sess.steps + 1) {
    return fail(res, 409, 'Langkah verifikasi harus berurutan');
  }
  const isRepeat = n <= sess.steps;
  if (isRepeat) {
    const repeat = { ok: true, steps: sess.steps, unlocked: sess.steps >= 3 };
    if (sess.steps < 3) {
      // Klik ulang tetap menerbitkan ticket segar untuk gate berikutnya,
      // supaya URL selalu valid walau pengunjung balik ke gate sebelumnya.
      const ticket = `${newId()}${newId()}`;
      await redis().set(`t:${ticket}`, { id: sess.id, gate: sess.steps + 1 }, { ex: TTL_SESSION });
      repeat.ticket = ticket;
    }
    return send(res, 200, repeat);
  }

  await redis().set(key, { id: sess.id, steps: n }, { ex: TTL_SESSION });
  await Promise.all([
    bumpFunnel(sess.id, `s${n}`),
    n === 3 ? bumpDay('c') : Promise.resolve(),
  ]);

  if (n < 3) {
    const ticket = `${newId()}${newId()}`;
    await redis().set(`t:${ticket}`, { id: sess.id, gate: n + 1 }, { ex: TTL_SESSION });
    return send(res, 200, { ok: true, steps: n, unlocked: false, ticket });
  }

  return send(res, 200, { ok: true, steps: n, unlocked: true });
}

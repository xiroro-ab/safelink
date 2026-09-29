import {
  redis,
  send,
  fail,
  kvReady,
  newId,
  loadLink,
  bumpFunnel,
  bumpDay,
  TTL_SESSION,
} from './_lib.js';

/**
 * Dipanggil di tiap halaman gate (?id=X&s=sesi&g=N).
 * Kalau sesi yang dipakai masih hidup untuk link yang sama, kembalikan progres
 * tanpa menghitung kunjungan baru — supaya pindah gate 1 -> 2 -> 3 tidak
 * menggembungkan statistik view. Session baru (kunjungan baru) hanya dibuat
 * bila tidak ada sesi valid.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');
  if (!kvReady()) return fail(res, 503, 'Storage belum dikonfigurasi');

  const id = (req.query.id || '').toString();
  const link = await loadLink(id);
  if (!link) return fail(res, 404, 'Link tidak ditemukan atau sudah dihapus');
  if (link.status !== 'ACTIVE') return fail(res, 410, 'Link ini sedang dinonaktifkan');

  const given = (req.query.s || '').toString();
  if (given.length >= 8 && given.length <= 64) {
    const sess = await redis().get(`s:${given}`);
    if (sess && sess.id === link.id) {
      return send(res, 200, {
        id: link.id,
        name: link.name,
        size: link.size,
        session: given,
        steps: sess.steps,
      });
    }
  }

  const session = `${newId()}${newId()}`;
  await redis().set(`s:${session}`, { id: link.id, steps: 0 }, { ex: TTL_SESSION });
  await Promise.all([bumpFunnel(link.id, 'v'), bumpDay('v')]);

  return send(res, 200, {
    id: link.id,
    name: link.name,
    size: link.size,
    session,
    steps: 0,
  });
}

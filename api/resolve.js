import { redis } from './_lib.js';
import {
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
 * Dipanggil sekali saat halaman safelink dibuka.
 * Hanya mengembalikan metadata publik + session token. URL target TIDAK PERNAH
 * dikirim ke browser; itu hanya keluar lewat /api/go setelah 3 langkah tercatat.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');
  if (!kvReady()) return fail(res, 503, 'Storage belum dikonfigurasi');

  const id = (req.query.id || '').toString();
  const link = await loadLink(id);
  if (!link) return fail(res, 404, 'Link tidak ditemukan atau sudah dihapus');
  if (link.status !== 'ACTIVE') return fail(res, 410, 'Link ini sedang dinonaktifkan');

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

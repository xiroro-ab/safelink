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
 * Dipanggil di tiap halaman gate.
 * - URL publik : /?id=X  (gate 1)
 * - Gate 2/3   : /<ticket>?id=X&s=<sesi>
 *
 * Ticket adalah string acak yang hanya diterbitkan server saat gate sebelumnya
 * diselesaikan (lihat track.js). Tanpa ticket valid + sesi yang benar, halaman
 * selalu diturunkan ke gate 1. Jadi mengetik /xxx langsung tidak akan pernah
 * sampai ke gate 3.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');
  if (!kvReady()) return fail(res, 503, 'Storage belum dikonfigurasi');

  const id = (req.query.id || '').toString();
  const link = await loadLink(id);
  if (!link) return fail(res, 404, 'Link tidak ditemukan atau sudah dihapus');
  if (link.status !== 'ACTIVE') return fail(res, 410, 'Link ini sedang dinonaktifkan');

  const given = (req.query.s || '').toString();
  const givenTicket = (req.query.t || '').toString();
  const validSession = given.length >= 8 && given.length <= 64
    ? await redis().get(`s:${given}`)
    : null;

  // Ticket valid + sesi valid untuk link yang sama -> teruskan ke gate tujuan.
  if (validSession && validSession.id === link.id && givenTicket) {
    const ticket = await redis().get(`t:${givenTicket}`);
    if (ticket && ticket.id === link.id && ticket.gate >= 2 && ticket.gate <= 3) {
      return send(res, 200, {
        id: link.id,
        name: link.name,
        size: link.size,
        session: given,
        steps: validSession.steps,
        gate: ticket.gate,
      });
    }
  }

  // Sesi valid tanpa ticket -> gate berikutnya mengikuti progres sesi.
  if (validSession && validSession.id === link.id) {
    return send(res, 200, {
      id: link.id,
      name: link.name,
      size: link.size,
      session: given,
      steps: validSession.steps,
      gate: Math.min(3, validSession.steps + 1),
    });
  }

  // Tidak ada sesi/ticket valid -> kunjungan baru, kembali ke gate 1.
  const session = `${newId()}${newId()}`;
  await redis().set(`s:${session}`, { id: link.id, steps: 0 }, { ex: TTL_SESSION });
  await Promise.all([bumpFunnel(link.id, 'v'), bumpDay('v')]);

  return send(res, 200, {
    id: link.id,
    name: link.name,
    size: link.size,
    session,
    steps: 0,
    gate: 1,
  });
}
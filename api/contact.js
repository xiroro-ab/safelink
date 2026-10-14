import {
  redis,
  send,
  fail,
  kvReady,
  requireAdmin,
  newId,
} from './_lib.js';

const INBOX_KEY = 'inbox:ids';

export default async function handler(req, res) {
  if (!kvReady()) return fail(res, 503, 'Storage belum dikonfigurasi');

  // POST: Pengunjung mengirim pesan publik
  if (req.method === 'POST') {
    const { name, email, subject, message } = req.body || {};

    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim();
    const cleanSubject = String(subject || 'Pesan Umum').trim();
    const cleanMessage = String(message || '').trim();

    if (!cleanName || cleanName.length > 80) {
      return fail(res, 400, 'Nama wajib diisi (maks 80 karakter)');
    }
    if (!cleanEmail || cleanEmail.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return fail(res, 400, 'Format alamat email tidak valid');
    }
    if (!cleanMessage || cleanMessage.length < 5 || cleanMessage.length > 3000) {
      return fail(res, 400, 'Pesan wajib diisi (antara 5 sampai 3000 karakter)');
    }

    // Rate limiting sederhana: maks 5 pesan per IP dalam 60 detik
    const forwarded = req.headers['x-forwarded-for'];
    const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : 'unknown';
    try {
      const rateKey = `rate:contact:${ip}`;
      const count = await redis().incr(rateKey);
      if (count === 1) await redis().expire(rateKey, 60);
      if (count > 5) {
        return fail(res, 429, 'Terlalu banyak permintaan pesan. Tunggu sebentar sebelum mengirim lagi.');
      }
    } catch {
      // Abaikan error rate-limit agar pesan tetap bisa diproses
    }

    const id = newId();
    const record = {
      id,
      name: cleanName,
      email: cleanEmail,
      subject: cleanSubject,
      message: cleanMessage,
      createdAt: new Date().toISOString(),
      read: false,
    };

    try {
      await redis().set(`msg:${id}`, record);
      await redis().lpush(INBOX_KEY, id);
      await redis().ltrim(INBOX_KEY, 0, 199); // Simpan maksimal 200 pesan terakhir
      return send(res, 201, { ok: true, message: 'Pesan Anda berhasil dikirim ke Admin.' });
    } catch (err) {
      return fail(res, 500, 'Gagal menyimpan pesan: ' + err.message);
    }
  }

  // GET: Admin membaca semua pesan masuk
  if (req.method === 'GET') {
    if (!requireAdmin(req, res)) return;

    try {
      const ids = (await redis().lrange(INBOX_KEY, 0, 99)) || [];
      if (!ids.length) return send(res, 200, { messages: [] });

      const pipeline = redis().pipeline();
      ids.forEach((id) => pipeline.get(`msg:${id}`));
      const items = await pipeline.exec();

      const messages = items
        .map((it) => (typeof it === 'string' ? JSON.parse(it) : it))
        .filter(Boolean);

      return send(res, 200, { messages });
    } catch (err) {
      return fail(res, 500, 'Gagal mengambil pesan: ' + err.message);
    }
  }

  // PATCH: Admin menandai pesan sudah dibaca
  if (req.method === 'PATCH') {
    if (!requireAdmin(req, res)) return;
    const id = String(req.query.id || '').trim();
    if (!id) return fail(res, 400, 'ID pesan diperlukan');

    try {
      const msg = await redis().get(`msg:${id}`);
      if (!msg) return fail(res, 404, 'Pesan tidak ditemukan');
      const updated = { ...(typeof msg === 'string' ? JSON.parse(msg) : msg), read: true };
      await redis().set(`msg:${id}`, updated);
      return send(res, 200, { ok: true });
    } catch (err) {
      return fail(res, 500, err.message);
    }
  }

  // DELETE: Admin menghapus pesan
  if (req.method === 'DELETE') {
    if (!requireAdmin(req, res)) return;
    const id = String(req.query.id || '').trim();
    if (!id) return fail(res, 400, 'ID pesan diperlukan');

    try {
      await redis().del(`msg:${id}`);
      await redis().lrem(INBOX_KEY, 0, id);
      return send(res, 200, { ok: true, message: 'Pesan berhasil dihapus' });
    } catch (err) {
      return fail(res, 500, err.message);
    }
  }

  return fail(res, 405, 'Method not allowed');
}

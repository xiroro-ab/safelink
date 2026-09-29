import {
  redis,
  send,
  fail,
  kvReady,
  hasSecret,
  requireAdmin,
  encUrl,
  decUrl,
  newId,
  validateTarget,
  loadLink,
} from './_lib.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  if (req.method === 'GET') {
    if (!kvReady()) return fail(res, 503, 'Storage belum dikonfigurasi (KV_REST_API_URL kosong)');
    const ids = await redis().smembers('idx:links');
    const links = ids.length ? await redis().mget(ids.map((id) => `link:${id}`)) : [];
    return send(res, 200, { links: links.filter(Boolean).map(publicShape) });
  }

  if (req.method === 'POST') {
    if (!kvReady()) return fail(res, 503, 'Storage belum dikonfigurasi (KV_REST_API_URL kosong)');
    if (!hasSecret()) return fail(res, 503, 'LINK_SECRET belum di-set');

    const { name, url, size } = req.body || {};
    if (!name || !String(name).trim()) return fail(res, 400, 'Nama file wajib diisi');

    const target = validateTarget(url, req);
    if (!target.ok) return fail(res, 400, target.error);

    const id = newId();
    const link = {
      id,
      name: String(name).trim().slice(0, 120),
      size: String(size || '').trim().slice(0, 40),
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      enc: encUrl(target.url),
    };

    await redis().set(`link:${id}`, link);
    await redis().sadd('idx:links', id);
    return send(res, 201, { link: publicShape(link) });
  }

  return fail(res, 405, 'Method not allowed');
}

// Endpoint ini hanya untuk admin (requireAdmin di atas). Ciphertext tidak
// pernah dikirim, tapi URL target didekripsi supaya admin bisa melihat dan
// mengeditnya.
function publicShape(link) {
  const { enc, ...rest } = link;
  return { ...rest, url: enc ? decUrl(enc) : '' };
}

import { redis, send, fail, kvReady, requireAdmin, loadLink } from '../_lib.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!kvReady()) return fail(res, 503, 'Storage belum dikonfigurasi (KV_REST_API_URL kosong)');

  const link = await loadLink(req.query.id);
  if (!link) return fail(res, 404, 'Link tidak ditemukan');

  if (req.method === 'PATCH') {
    const { name, size, status } = req.body || {};
    if (name !== undefined) link.name = String(name).trim().slice(0, 120);
    if (size !== undefined) link.size = String(size).trim().slice(0, 40);
    if (status !== undefined) {
      if (status !== 'ACTIVE' && status !== 'PAUSED') {
        return fail(res, 400, 'Status harus ACTIVE atau PAUSED');
      }
      link.status = status;
    }
    await redis().set(`link:${link.id}`, link);
    const { enc, ...rest } = link;
    return send(res, 200, { link: rest });
  }

  if (req.method === 'DELETE') {
    await redis().del(`link:${link.id}`, `st:${link.id}`);
    await redis().srem('idx:links', link.id);
    return send(res, 200, { ok: true });
  }

  return fail(res, 405, 'Method not allowed');
}

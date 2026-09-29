import { redis, kvReady, decUrl, loadLink } from './_lib.js';

const blocked = (res, title, message) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res
    .status(403)
    .send(
      `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
        `<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:grid;place-items:center;height:100vh;margin:0;text-align:center">` +
        `<div><h1 style="font-size:20px">${title}</h1>` +
        `<p style="color:#a1a1aa;font-size:14px">${message}</p></div>`
    );
};

// Satu-satunya endpoint yang pernah mengirim URL target asli ke pengguna.
// Redirect 302 supaya alamat aslinya tidak pernah tampil di address bar.
export default async function handler(req, res) {
  if (req.method !== 'GET') return blocked(res, 'Method not allowed', 'Gunakan GET.');
  if (!kvReady()) return blocked(res, 'Gateway offline', 'Storage belum dikonfigurasi.');

  const id = (req.query.id || '').toString();
  const session = (req.query.s || '').toString();
  const sess = await redis().get(`s:${session}`);

  if (!sess || sess.id !== id || !sess.steps || sess.steps < 3) {
    return blocked(
      res,
      'Verifikasi belum selesai',
      'Tuntaskan ketiga langkah verifikasi pada halaman safelink untuk membuka tautan.'
    );
  }

  const link = await loadLink(id);
  if (!link || link.status !== 'ACTIVE') {
    return blocked(res, 'Link tidak tersedia', 'Link ini sudah dihapus atau dinonaktifkan.');
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, decUrl(link.enc));
}

import { redis, send, fail, kvReady, isAdmin, requireAdmin } from './_lib.js';

const KEY = 'config:ads';

const DEFAULTS = {
  smartlink: '',
  bannerHeader: '',
  bannerMiddle: '',
  bannerPopunder: '',
  timerSeconds: 10,
  ecpm: 3.7,
  gatewayUrl: '',
};

const read = async () => ({ ...DEFAULTS, ...((await redis().get(KEY)) || {}) });

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!kvReady()) return send(res, 200, DEFAULTS);
    const cfg = await read();
    // Halaman publik hanya butuh unit iklannya. Field internal (ecpm,
    // gatewayUrl) ikut dikembalikan kalau pemohon sudah terautentikasi admin.
    if (isAdmin(req)) return send(res, 200, cfg);
    const { ecpm, gatewayUrl, ...publicCfg } = cfg;
    return send(res, 200, publicCfg);
  }

  if (req.method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    if (!kvReady()) return fail(res, 503, 'Storage belum dikonfigurasi (KV_REST_API_URL kosong)');

    const body = req.body || {};
    const current = await read();
    const next = {
      smartlink: String(body.smartlink ?? current.smartlink).trim(),
      bannerHeader: String(body.bannerHeader ?? current.bannerHeader).trim(),
      bannerMiddle: String(body.bannerMiddle ?? current.bannerMiddle).trim(),
      bannerPopunder: String(body.bannerPopunder ?? current.bannerPopunder).trim(),
      timerSeconds: clamp(body.timerSeconds, 3, 60, current.timerSeconds),
      ecpm: clamp(body.ecpm, 0, 1000, current.ecpm),
      gatewayUrl: String(body.gatewayUrl ?? current.gatewayUrl).trim(),
    };

    if (next.smartlink && !/^https?:\/\//i.test(next.smartlink)) {
      return fail(res, 400, 'Smartlink harus diawali http:// atau https://');
    }

    await redis().set(KEY, next);
    return send(res, 200, next);
  }

  return fail(res, 405, 'Method not allowed');
}

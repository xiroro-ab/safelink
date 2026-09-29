import { redis, send, fail, kvReady, isAdmin, requireAdmin } from './_lib.js';

const KEY = 'config:ads';

const emptyGate = () => ({
  smartlink: '', header: '', middle: '', native: '',
  konten: '', halfpage: '', mobile: '', popunder: '', sticky: '',
});

const DEFAULTS = {
  smartlink: '',
  smartlinkGates: [],
  bannerHeader: '',
  bannerMiddle: '',
  bannerNative: '',
  bannerSticky: '',
  bannerKonten: '',
  bannerHalfpage: '',
  bannerMobile: '',
  bannerPopunder: '',
  popunderGates: [1],
  timerSeconds: 10,
  ecpm: 3.7,
  gatewayUrl: '',
  gates: { 1: emptyGate(), 2: emptyGate(), 3: emptyGate() },
};

const read = async () => {
  const stored = (await redis().get(KEY)) || {};
  const base = { ...DEFAULTS, ...stored };
  base.gates = {
    1: { ...emptyGate(), ...(stored.gates?.[1] || {}) },
    2: { ...emptyGate(), ...(stored.gates?.[2] || {}) },
    3: { ...emptyGate(), ...(stored.gates?.[3] || {}) },
  };
  return base;
};

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const gatesNum = (value, fallback) => {
  if (!Array.isArray(value)) return fallback;
  const v = value.map(Number).filter((n) => [1, 2, 3].includes(n)).sort();
  return [...new Set(v)];
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
    const gateFrom = (n) => {
      const g = body.gates?.[n] ?? current.gates[n] ?? {};
      return {
        smartlink: String(g.smartlink ?? '').trim(),
        header: String(g.header ?? '').trim(),
        middle: String(g.middle ?? '').trim(),
        native: String(g.native ?? '').trim(),
        konten: String(g.konten ?? '').trim(),
        halfpage: String(g.halfpage ?? '').trim(),
        mobile: String(g.mobile ?? '').trim(),
        popunder: String(g.popunder ?? '').trim(),
        sticky: String(g.sticky ?? '').trim(),
      };
    };
    const next = {
      smartlink: String(body.smartlink ?? current.smartlink).trim(),
      smartlinkGates: body.smartlinkGates !== undefined
        ? gatesNum(body.smartlinkGates, [])
        : gatesNum(
            current.smartlinkGates.length ? current.smartlinkGates
              : ((current.smartlink || String(body.smartlink ?? '').trim()) ? [1, 2, 3] : []),
            []),
      bannerHeader: String(body.bannerHeader ?? current.bannerHeader).trim(),
      bannerMiddle: String(body.bannerMiddle ?? current.bannerMiddle).trim(),
      bannerNative: String(body.bannerNative ?? current.bannerNative).trim(),
      bannerSticky: String(body.bannerSticky ?? current.bannerSticky).trim(),
      bannerKonten: String(body.bannerKonten ?? current.bannerKonten).trim(),
      bannerHalfpage: String(body.bannerHalfpage ?? current.bannerHalfpage).trim(),
      bannerMobile: String(body.bannerMobile ?? current.bannerMobile).trim(),
      bannerPopunder: String(body.bannerPopunder ?? current.bannerPopunder).trim(),
      // Popunder identik berulang cepat mudah dikenali anti-fraud: defaultnya
      // hanya gate 1, bukan semua gate.
      popunderGates: gatesNum(body.popunderGates ?? current.popunderGates, [1]),
      timerSeconds: clamp(body.timerSeconds, 3, 60, current.timerSeconds),
      ecpm: clamp(body.ecpm, 0, 1000, current.ecpm),
      gatewayUrl: String(body.gatewayUrl ?? current.gatewayUrl).trim(),
      gates: { 1: gateFrom(1), 2: gateFrom(2), 3: gateFrom(3) },
    };

    if (next.smartlink && !/^https?:\/\//i.test(next.smartlink)) {
      return fail(res, 400, 'Smartlink harus diawali http:// atau https://');
    }

    await redis().set(KEY, next);
    return send(res, 200, next);
  }

  return fail(res, 405, 'Method not allowed');
}

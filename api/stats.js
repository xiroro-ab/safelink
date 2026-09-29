import { redis } from './_lib.js';
import { send, fail, kvReady, requireAdmin } from './_lib.js';

const DAY_MS = 86_400_000;
const num = (v) => Number(v) || 0;
const round2 = (v) => Math.round(v * 100) / 100;

/** Tanggal YYYY-MM-DD di UTC, digeser `offset` hari dari hari ini. */
const dayKey = (offset) =>
  new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

export default async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');
  if (!requireAdmin(req, res)) return;
  if (!kvReady()) return fail(res, 503, 'Storage belum dikonfigurasi (KV_REST_API_URL kosong)');

  const ids = await redis().smembers('idx:links');
  const links = ids.length ? await redis().mget(ids.map((id) => `link:${id}`)) : [];
  const live = links.filter(Boolean);

  const days = [];
  for (let i = 6; i >= 0; i -= 1) days.push(dayKey(-i));

  // Pipeline Upstash memakai rantai perintah, bukan array.
  const p = redis().pipeline();
  live.forEach((l) => p.hgetall(`st:${l.id}`));
  const [funnels, daily, cfg] = await Promise.all([
    live.length ? p.exec() : Promise.resolve([]),
    redis().mget(days.flatMap((d) => [`d:${d}:v`, `d:${d}:c`])),
    redis().get('config:ads'),
  ]);

  const ecpm = num(cfg?.ecpm) || 3.7;
  const TOTAL_STEPS = 3;

  const files = live.map((link, i) => {
    const f = funnels[i] || {};
    const { enc, ...rest } = link;
    return {
      ...rest,
      views: num(f.v),
      step1: num(f.s1),
      step2: num(f.s2),
      step3: num(f.s3),
      completes: num(f.s3),
      estEarnings: round2((num(f.v) * TOTAL_STEPS * ecpm) / 1000),
    };
  });

  const sum = (key) => files.reduce((acc, f) => acc + num(f[key]), 0);
  const totals = {
    views: sum('views'),
    step1: sum('step1'),
    step2: sum('step2'),
    step3: sum('step3'),
    completes: sum('completes'),
    activeLinks: live.filter((l) => l.status === 'ACTIVE').length,
    totalLinks: live.length,
    ecpm,
    generatedAt: new Date().toISOString(),
  };
  totals.completionRate = totals.views ? round2((totals.completes / totals.views) * 100) : 0;
  totals.estEarnings = round2((totals.views * TOTAL_STEPS * ecpm) / 1000);

  const series = days.map((d, i) => ({
    date: d,
    views: num(daily[i * 2]),
    completes: num(daily[i * 2 + 1]),
  }));

  return send(res, 200, { totals, files: files.sort((a, b) => b.views - a.views), series });
}

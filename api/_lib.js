import crypto from 'node:crypto';
import { Redis } from '@upstash/redis';

export const TTL_SESSION = 60 * 60;
export const ID_RE = /^[A-Za-z0-9_-]{4,16}$/;

// Upstash sendiri menamai variabelnya UPSTASH_REDIS_REST_*; integrasi KV
// lama di Vercel memakai KV_REST_API_*. Dua-duanya diterima.
const redisUrl = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const kvReady = () => Boolean(redisUrl() && redisToken());

let client;
export const redis = () =>
  (client ??= new Redis({ url: redisUrl(), token: redisToken() }));

/** Test seam: scripts/selfcheck.mjs menyuntik klien Redis palsu ke sini. */
export const __injectRedis = (fn) => {
  client = fn;
};

export const hasSecret = () => Boolean(process.env.LINK_SECRET);

export function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

export const fail = (res, status, error) => send(res, status, { error });

function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function isAdmin(req) {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!user || !pass) return false;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const [gotUser, gotPass] = Buffer.from(header.slice(6), 'base64').toString().split(':');
  return timingSafeEq(gotUser, user) && timingSafeEq(gotPass, pass);
}

export function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  res.setHeader('WWW-Authenticate', 'Basic realm="Safelink Admin", charset="UTF-8"');
  fail(res, 401, 'Unauthorized');
  return false;
}

const aesKey = () =>
  crypto.createHash('sha256').update(process.env.LINK_SECRET, 'utf8').digest();

export function encUrl(url) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey(), iv);
  const sealed = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), sealed].map((b) => b.toString('base64url')).join('.');
}

export function decUrl(blob) {
  const [iv, tag, sealed] = String(blob).split('.').map((s) => Buffer.from(s, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed), decipher.final()]).toString('utf8');
}

export const newId = () => crypto.randomBytes(4).toString('base64url');

export const today = () => new Date().toISOString().slice(0, 10);

/**
 * Penghitung funnel per link disimpan sebagai satu hash (`st:{id}`) supaya tiap
 * langkah cukup satu perintah KV, bukan satu per metrik. Total sekunder
 * digabung di /api/stats, bukan lewat penulisan tambahan.
 *
 * field: v = kunjungan, s1/s2/s3 = langkah selesai, c = unduhan final
 */
export const bumpFunnel = (id, field) => redis().hincrby(`st:${id}`, field, 1);

export const bumpDay = (field) => redis().incr(`d:${today()}:${field}`);

/**
 * Target URL hanya boleh http/https dan tidak boleh menunjuk balik ke gate
 * sendiri (mencegah redirect loop dan abuse open-redirect).
 */
export function validateTarget(raw, req) {
  let parsed;
  try {
    parsed = new URL(String(raw).trim());
  } catch {
    return { ok: false, error: 'URL target tidak valid' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'URL target harus diawali http:// atau https://' };
  }
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  if (host && parsed.host.toLowerCase() === host.toLowerCase()) {
    return { ok: false, error: 'URL target tidak boleh menunjuk ke domain gate ini' };
  }
  return { ok: true, url: parsed.toString() };
}

export async function loadLink(id) {
  if (!ID_RE.test(String(id || ''))) return null;
  return redis().get(`link:${id}`);
}

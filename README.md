# Safelink Gateway

Halaman penghalihan link download (safelink) dengan iklan Adsterra, dashboard admin,
dan penyimpanan statistik di server. Dirancang untuk deployment ke Vercel.

```
public/index.html   Halaman safelink yang dilihat pengunjung (?id=xxxx)
public/admin.html   Dashboard admin (/admin), dilindungi HTTP Basic Auth
api/                Serverless functions (Vercel Node runtime)
legacy/             Dua file HTML asli sebelum digabung, untuk referensi
```

## Cara kerja

Tautan yang dibagikan berbentuk `https://domain-anda/?id=aBc12345`. ID itu acak,
6 karakter, dan **bukan** URL target. Alurnya:

1. `GET /api/resolve?id=aBc12345` mengembalikan nama file, ukuran, dan `session`
   acak. **URL target tidak pernah dikirim ke browser.**
2. Pengunjung melewati **3 gate, masing-masing di URL sendiri**:
   `/?id=X&s=<sesi>&g=1` → `g=2` → `g=3`. Tiap gate butuh satu klik verifikasi
   (smartlink iklan terbuka), lalu hitung mundur.
3. Setiap langkah mengirim `POST /api/track`. Server mencatat langkahnya dan
   menolak laporan yang tidak berurutan, jadi tidak bisa dilompati. Sesi yang sama
   dipakai lintas URL gate, dan berpindah URL tidak menghitung kunjungan kedua.
4. Setelah langkah 3 tercatat, tombol unduh muncul yang mengarah ke `/api/go`,
   melakukan redirect 302 ke URL target. Alamat aslinya tidak pernah tampil
   di address bar.

URL target disimpan di Redis dalam bentuk terenkripsi AES-256-GCM (kunci dari
`LINK_SECRET`), jadi bocornya isi database tidak langsung berarti bocornya target.

Yang dilindungi: klik kanan, view-source, membuka tautan di tab baru, dan
membagikan `?id=` ke orang lain. Yang **tidak** dilindungi: pengguna yang
sengaja memanggil API langsung dengan instrumentasi sendiri. Tidak ada mekanisme
client-side yang bisa menahan hal itu. Menutup celah tersebut butuh bukti tambahan
di luar anggaran tiga klik, dan bertentangan dengan tujuan produk ini.

## Deploy

Prasyarat: akun Vercel dan satu Redis (Upstash).

```bash
npm install
```

## Titik balik (restore)

Versi yang berjalan sebelum revamp gate disimpan sebagai tag
`backup-pre-revamp` (commit `556cca9`). Untuk kembalikan seluruh kode ke versi itu:

```bash
git checkout backup-pre-revamp
vercel deploy --prod --yes
```

Data (link, statistik) tidak terpengaruh — semuanya di Redis Upstash, di luar repo.

1. Push repo ini ke GitHub, lalu import ke Vercel. Framework preset: **Other**.
   `vercel.json` sudah menangani build dan routing.
2. Di Vercel, buat store Redis: **Storage → Create Database → Redis** (atau
   pasang integrasi Upstash dari Marketplace). Vercel otomatis mengisi
   `KV_REST_API_URL` dan `KV_REST_API_TOKEN`.
3. Set tiga environment variable di **Settings → Environment Variables**
   (Production dan Preview):
   - `ADMIN_USER` — username dashboard
   - `ADMIN_PASS` — password dashboard, pakai yang panjang
   - `LINK_SECRET` — `openssl rand -hex 32`

   Kalau `ADMIN_USER`/`ADMIN_PASS` kosong, semua endpoint admin menutup
   sendiri. Kalau `LINK_SECRET` kosong, pembuatan link ditolak.
4. Deploy. Buka `/admin`, browser akan meminta kredensial Basic Auth.

> Mengubah `LINK_SECRET` membuat seluruh link yang ada tidak bisa di-resolve lagi.

## Pengembangan lokal

```bash
cp .env.example .env.local   # isi ADMIN_USER, ADMIN_PASS, LINK_SECRET
vercel dev                   # butuh CLI Vercel
npm run check                # test: enkripsi, auth, gate 3 langkah, statistik
```

`npm run check` tidak butuh Redis sungguhan — ia menyuntik klien Redis palsu
lalu menjalankan semua handler dari awal sampai akhir.

## Endpoint

Publik (tanpa auth):

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/resolve?id=` | Metadata + session baru, pencatat kunjungan |
| POST | `/api/track` | `{session, step}` — rekam penyelesaian langkah |
| GET | `/api/go?id=&s=` | 302 ke target, hanya kalau 3 langkah tercatat |
| GET | `/api/ads` | Config iklan (field internal disembunyikan) |

Admin (wajib Basic Auth):

| Method | Path | Keterangan |
| --- | --- | --- |
| GET/POST | `/api/links` | Daftar link / buat link baru |
| PATCH/DELETE | `/api/link/[id]` | Ubah status, nama, ukuran / hapus |
| GET | `/api/stats` | Total, funnel, per-file, seri 7 hari |
| GET/PUT | `/api/ads` | Config iklan, timer, eCPM, domain |

## Batas yang perlu diketahui

- **Kuota Redis.** Satu kunjungan memakai sekitar 6 perintah Redis (buat session,
  2 pencatat harian, 3 langkah). Free tier Upstash 10.000 perintah/hari berarti
  sekitar 1.500 kunjungan lengkap per hari. Kalau lewat, pindah ke Postgres
  (Neon/Supabase) — tidak ada perubahan di sisi halaman, hanya di `api/`.
- **Estimasi earning bukan pembayaran.** Dihitung dari `kunjungan × 3 unit
  iklan × eCPM`. eCPM hanya tebakan yang Anda isi sendiri; uang nyata tetap
  mengikuti laporan Adsterra.
- **Kode iklan dieksekusi apa adanya.** Skrip yang Anda simpan di dashboard
  dijalankan di halaman pengunjung. Admin adalah satu-satunya penulis nilai ini
  dan sudah melewati Basic Auth, tapi jangan pernah menempelkan kode dari
  sumber yang tidak Anda percaya.
- **Adsterra.** Format kodenya berubah-ubah. Tempelkan persis yang diberikan
  dashboard Adsterra; kalau slot kosong, placeholder `[ADSTERRA_SLOT_..]`
  tetap tampil dan tidak merusak halaman.
- **Tailwind via CDN.** Tidak ada build step, tapi menambah ~100 KB dan
  production-grade CSS perlu Tailwind CLI + satu perintah build.

## Yang dihapus dari versi asli

- **Link generator di halaman safelink.** Dulu membuat `?url=<base64>`;
  base64 itu bukan rahasia dan bisa dibalik siapa pun. Sekarang ID-nya acak dan
  target hanya keluar dari server.
- **Modal AD_CONFIG di halaman safelink.** Duplikat dari dashboard admin dan
  disimpan di `localStorage`, jadi hanya berlaku di browser tertentu.
- **Tombol "Reset Semua Data".** Data lama tidak bisa dipulihkan; sekarang
  hapus per link, dan statistiknya ikut terhapus.

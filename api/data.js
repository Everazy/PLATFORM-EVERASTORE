// Vercel Serverless Function — menyimpan & membaca data halaman di Upstash Redis.
// Env yang dibutuhkan: ADMIN_PASSWORD (isi sendiri) + kredensial Upstash (otomatis dari integrasi Storage Vercel).
const crypto = require('crypto');

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const KEY = 'linkhub:data';

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

const same = (a, b) => {
  const h = (x) => crypto.createHash('sha256').update(String(x)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN)
    return res.status(503).json({ error: 'Database belum terhubung. Buat Upstash Redis di tab Storage pada Vercel.' });
  try {
    if (req.method === 'GET') {
      const v = await redis(['GET', KEY]);
      return res.status(200).json({ data: v ? JSON.parse(v) : null });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const pw = process.env.ADMIN_PASSWORD;
    if (!pw) return res.status(503).json({ error: 'ADMIN_PASSWORD belum diatur di Vercel.' });

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const fk = 'linkhub:fail:' + ip;
    if ((Number(await redis(['GET', fk])) || 0) >= 8)
      return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' });

    if (!same(req.headers['x-admin-password'] || '', pw)) {
      const c = await redis(['INCR', fk]);
      if (c === 1) await redis(['EXPIRE', fk, 900]);
      return res.status(401).json({ error: 'Password salah' });
    }
    await redis(['DEL', fk]);

    let b = req.body || {};
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }

    if (b.action === 'login') return res.status(200).json({ ok: true });
    if (b.action === 'save') {
      const d = b.data;
      if (!d || typeof d.profile !== 'object' || !Array.isArray(d.sections))
        return res.status(400).json({ error: 'Format data tidak valid' });
      const s = JSON.stringify(d);
      if (s.length > 900000) return res.status(413).json({ error: 'Data terlalu besar (kecilkan gambar logo)' });
      await redis(['SET', KEY, s]);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Aksi tidak dikenal' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
};

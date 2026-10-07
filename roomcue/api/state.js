// Stores one JSON document per passcode-derived key in Vercel Blob.
const { put, head } = require('@vercel/blob');

function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const name = Object.keys(process.env).find((n) => /READ_WRITE_TOKEN$/.test(n));
  return name ? process.env[name] : undefined;
}

const KEY_RE = /^[a-f0-9]{64}$/;
const MAX_BYTES = 2000000;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const key = req.query && req.query.key;
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    return res.status(400).json({ error: 'bad key' });
  }
  const path = `sync/${key}.json`;
  const token = blobToken();
  const auth = token ? { token } : {};
  try {
    if (req.method === 'GET') {
      let meta;
      try {
        meta = await head(path, auth);
      } catch (e) {
        if (e && (e.name === 'BlobNotFoundError' || /does not exist|not found/i.test(e.message || ''))) {
          return res.status(404).json({ error: 'none' });
        }
        throw e;
      }
      const r = await fetch(`${meta.url}?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return res.status(502).json({ error: 'read failed' });
      return res.status(200).json(await r.json());
    }
    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (!body || body === '{}' || body.length > MAX_BYTES) {
        return res.status(413).json({ error: 'bad body' });
      }
      await put(path, body, {
        ...auth,
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    let reason = String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 160);
    if (/token|store/i.test(reason)) {
      reason += ' [vars: ' + (Object.keys(process.env).filter((n) => /BLOB|STORE|OIDC/i.test(n)).join(',') || 'none') + ']';
    }
    return res.status(500).json({ error: 'server error', reason });
  }
};

// A small fixed-window rate limiter for the sign-in routes
// (SECURITY_REVIEW.md S3). In memory: the API runs as one instance on
// Render, so counts live in this process and reset on a restart, which is
// fine for slowing down password guessing and bulk sign-ups.
//
//   const limit = rateLimit({ windowMs: 60_000, max: 10, keys: req => [req.ip] });
//   router.post('/login', limit, handler);
//
// `keys(req)` returns one or more strings; the request is refused when any
// of them is over the limit. Every key is counted on every request.

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function rateLimit({ windowMs, max, keys, message, name = 'rl' }) {
  const hits = new Map();   // key -> { n, resetAt }

  // Drop expired windows now and then so the map can't grow without bound.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, Math.max(windowMs, 60_000));
  if (sweep.unref) sweep.unref();

  function middleware(req, res, next) {
    // Local test runs sign up many players from this machine.
    if (process.env.NODE_ENV !== 'production' && LOOPBACK.has(req.ip)) return next();
    const now = Date.now();
    let worst = null;
    for (const raw of keys(req) || []) {
      if (!raw) continue;
      const k = name + ':' + String(raw).toLowerCase();
      let e = hits.get(k);
      if (!e || e.resetAt <= now) { e = { n: 0, resetAt: now + windowMs }; hits.set(k, e); }
      e.n += 1;
      if (e.n > max && (!worst || e.resetAt > worst.resetAt)) worst = e;
    }
    if (!worst) return next();
    const retry = Math.max(1, Math.ceil((worst.resetAt - now) / 1000));
    res.set('Retry-After', String(retry));
    return res.status(429).json({ error: message || 'Too many attempts. Please wait a little and try again.', retry_after: retry });
  }
  middleware._reset = () => hits.clear();
  return middleware;
}

module.exports = { rateLimit };

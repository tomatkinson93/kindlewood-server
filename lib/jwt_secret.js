// ══════════════════════════════════════════════════════════════════════════
//  jwt_secret — the one place the sign-in token secret comes from.
//
//  In production (NODE_ENV=production, as render.yaml sets) the server will
//  not start without a JWT_SECRET of at least 16 characters: with the old
//  built-in fallback, anyone who had read this repository could have forged a
//  sign-in token for any player, admins included.
//  Anywhere else (local runs, tests) a fixed development secret is used.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const DEV_SECRET = 'dev-secret-change-in-production';

function resolve(env = process.env) {
  const s = env.JWT_SECRET;
  if (env.NODE_ENV === 'production') {
    if (!s || s.length < 16 || s === DEV_SECRET) {
      throw new Error('JWT_SECRET is missing or too weak. Set a long random JWT_SECRET in the environment before starting in production.');
    }
    return s;
  }
  return s || DEV_SECRET;
}

module.exports = { JWT_SECRET: resolve(), resolve, DEV_SECRET };

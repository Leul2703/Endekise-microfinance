const crypto = require('crypto');
const { db } = require('../config/database');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ISSUER = 'Edekise Microfinance';
const TWO_FACTOR_ROLES = new Set(['admin', 'ceo']);
const isTwoFactorEnabled = () => process.env.ENABLE_2FA === 'true';

const base32Encode = (buffer) => {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
};

const base32Decode = (value) => {
  const normalized = (value || '').toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let buffer = 0;
  const bytes = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      continue;
    }

    buffer = (buffer << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
};

const normalizeToken = (token) => String(token || '').replace(/\s+/g, '');

const generate2FASecret = (username) => {
  const secret = base32Encode(crypto.randomBytes(20));
  const label = encodeURIComponent(`${ISSUER} (${username})`);
  const issuer = encodeURIComponent(ISSUER);

  return {
    secret,
    otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
  };
};

const generateTOTP = (secret, timestamp = Date.now()) => {
  const counter = Math.floor(timestamp / 30000);
  const secretBuffer = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);

  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter % 0x100000000, 4);

  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = ((hmac[offset] & 127) << 24)
    | ((hmac[offset + 1] & 255) << 16)
    | ((hmac[offset + 2] & 255) << 8)
    | (hmac[offset + 3] & 255);

  return String(code % 1000000).padStart(6, '0');
};

const verify2FAToken = (secret, token, window = 1) => {
  const normalizedToken = normalizeToken(token);
  if (!secret || !/^\d{6}$/.test(normalizedToken)) {
    return false;
  }

  for (let offset = -window; offset <= window; offset += 1) {
    const expectedToken = generateTOTP(secret, Date.now() + offset * 30000);
    if (crypto.timingSafeEqual(Buffer.from(expectedToken), Buffer.from(normalizedToken))) {
      return true;
    }
  }

  return false;
};

const requiresTwoFactor = (role) => isTwoFactorEnabled() && TWO_FACTOR_ROLES.has(role);

const buildTwoFactorResponse = (mode, setup, setupToken) => ({
  requiresTwoFactor: true,
  twoFactorMode: mode,
  setupToken,
  setup
});

const getUserTwoFactorState = (userId) => new Promise((resolve, reject) => {
  db.get(
    'SELECT two_factor_secret, two_factor_enabled FROM users WHERE id = ?',
    [userId],
    (err, row) => {
      if (err) {
        return reject(err);
      }

      resolve({
        secret: row?.two_factor_secret || null,
        enabled: Boolean(row?.two_factor_enabled)
      });
    }
  );
});

const enableUserTwoFactor = (userId, secret) => new Promise((resolve, reject) => {
  db.run(
    'UPDATE users SET two_factor_secret = ?, two_factor_enabled = 1 WHERE id = ?',
    [secret, userId],
    function onUpdate(err) {
      if (err) {
        return reject(err);
      }

      resolve(this.changes > 0);
    }
  );
});

const require2FA = async (req, res, next) => {
  try {
    if (!req.user || !requiresTwoFactor(req.user.role)) {
      return next();
    }

    if (req.user.twoFactorVerified) {
      return next();
    }

    const twoFactorState = await getUserTwoFactorState(req.user.id);

    if (!twoFactorState.enabled || !twoFactorState.secret) {
      return res.status(403).json({
        error: 'Two-factor authentication setup required',
        requiresTwoFactorSetup: true
      });
    }

    return res.status(403).json({
      error: 'Two-factor authentication verification required',
      requiresTwoFactor: true
    });
  } catch (error) {
    console.error('2FA enforcement error:', error);
    return res.status(500).json({ error: 'Two-factor authentication check failed' });
  }
};

module.exports = {
  buildTwoFactorResponse,
  enableUserTwoFactor,
  generate2FASecret,
  getUserTwoFactorState,
  isTwoFactorEnabled,
  normalizeToken,
  require2FA,
  requiresTwoFactor,
  verify2FAToken
};

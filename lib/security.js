"use strict";

const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };
const MIN_PASSWORD_LENGTH = 12;

function validatePassword(password, { email, displayName } = {}) {
  const value = String(password || "");
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw httpError(400, `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
  }
  if (value.length > 200) throw httpError(400, "Mot de passe trop long.");
  const lowered = value.toLowerCase();
  const local = String(email || "").split("@")[0].toLowerCase();
  if ((local && local.length >= 4 && lowered.includes(local)) || /^(.)\1+$/.test(value)) {
    throw httpError(400, "Choisissez un mot de passe moins prévisible.");
  }
  if (displayName && String(displayName).length >= 4 && lowered.includes(String(displayName).toLowerCase())) {
    throw httpError(400, "Le mot de passe ne doit pas contenir votre nom.");
  }
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(String(password), salt, SCRYPT.keylen, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), derived.toString("base64")].join("$");
}

async function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored || "").split("$");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(hashB64, "base64");
    const derived = await scrypt(String(password || ""), Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    });
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// Hash factice : la vérification d'un compte inexistant prend le même temps qu'un vrai.
let dummyHash;
async function dummyVerify(password) {
  if (!dummyHash) dummyHash = await hashPassword("nova-compte-inexistant");
  await verifyPassword(password, dummyHash);
  return false;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function generateTemporaryPassword() {
  // 16 caractères lisibles (sans 0/O, 1/l/I), à transmettre de vive voix ou par un canal sûr.
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

// ---------- TOTP (RFC 6238), compatible Google Authenticator, Microsoft Authenticator, 1Password ----------

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function totpAt(secret, step, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

function currentStep(now = Date.now()) {
  return Math.floor(now / 1000 / 30);
}

// Renvoie le pas de temps accepté (pour bloquer la réutilisation du même code), ou null.
function verifyTotp(secret, code, { now = Date.now(), window = 1, lastStep = null } = {}) {
  const candidate = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(candidate)) return null;
  const step = currentStep(now);
  for (let delta = -window; delta <= window; delta += 1) {
    const tested = step + delta;
    if (lastStep !== null && tested <= Number(lastStep)) continue;
    const expected = totpAt(secret, tested);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) return tested;
  }
  return null;
}

function otpauthUrl({ secret, email, issuer = "Nova+" }) {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---------- Chiffrement des secrets 2FA au repos (clé NOVA_SECRET_KEY) ----------

function createSecretBox(rawKey) {
  const key = rawKey ? crypto.createHash("sha256").update(String(rawKey)).digest() : null;
  return {
    enabled: Boolean(key),
    seal(plain) {
      if (plain === null || plain === undefined) return null;
      if (!key) return `plain:${plain}`;
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
      return `v1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")}`;
    },
    open(sealed) {
      if (!sealed) return null;
      if (sealed.startsWith("plain:")) return sealed.slice(6);
      if (!sealed.startsWith("v1:")) throw new Error("Secret chiffré illisible");
      if (!key) throw new Error("NOVA_SECRET_KEY manquante : impossible de lire les secrets 2FA");
      const raw = Buffer.from(sealed.slice(3), "base64");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
}

// ---------- Divers ----------

function httpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

// JSON canonique (clés triées) : sert à vérifier qu'une donnée relue est identique à l'originale.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function canonicalHash(value) {
  return sha256(canonicalJson(value));
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  validatePassword,
  hashPassword,
  verifyPassword,
  dummyVerify,
  randomToken,
  sha256,
  generateTemporaryPassword,
  base32Encode,
  base32Decode,
  generateTotpSecret,
  totpAt,
  currentStep,
  verifyTotp,
  otpauthUrl,
  createSecretBox,
  httpError,
  canonicalJson,
  canonicalHash,
};

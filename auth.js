const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function normalizeIdentifier(value) {
  return String(value || "").trim().toLowerCase();
}

function validateIdentifier(value) {
  const identifier = normalizeIdentifier(value);
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(identifier)) {
    throw new Error("L’identifiant doit contenir 3 à 64 caractères : lettres, chiffres, point, tiret ou underscore.");
  }
  return identifier;
}

function validatePassword(password) {
  if (String(password || "").length < 10) throw new Error("Le mot de passe doit contenir au moins 10 caractères.");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  validatePassword(password);
  return { salt, hash: crypto.scryptSync(String(password), salt, 64, SCRYPT_OPTIONS).toString("hex") };
}

function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.passwordSalt) return false;
  try {
    const candidate = crypto.scryptSync(String(password || ""), user.passwordSalt, 64, SCRYPT_OPTIONS);
    const expected = Buffer.from(user.passwordHash, "hex");
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch { return false; }
}

function readUsers(usersFile) {
  if (!fs.existsSync(usersFile)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(usersFile, "utf8"));
    return Array.isArray(parsed.users) ? parsed.users : [];
  } catch { return []; }
}

function writeUsers(usersFile, users) {
  fs.mkdirSync(path.dirname(usersFile), { recursive: true });
  const temporaryFile = `${usersFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify({ version: 1, users }, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryFile, usersFile);
}

function createUser(usersFile, { identifier, password, displayName, role = "client" }) {
  const safeIdentifier = validateIdentifier(identifier);
  validatePassword(password);
  const users = readUsers(usersFile);
  if (users.some((user) => user.identifier === safeIdentifier)) throw new Error(`Le compte « ${safeIdentifier} » existe déjà.`);
  const passwordRecord = hashPassword(password);
  const user = {
    id: crypto.randomUUID(), identifier: safeIdentifier,
    displayName: String(displayName || safeIdentifier).trim().slice(0, 80),
    role: role === "admin" ? "admin" : "client",
    passwordSalt: passwordRecord.salt, passwordHash: passwordRecord.hash,
    createdAt: new Date().toISOString(), disabled: false,
  };
  users.push(user);
  writeUsers(usersFile, users);
  return publicUser(user);
}

function updateUser(usersFile, userId, changes) {
  const users = readUsers(usersFile);
  const user = users.find((item) => item.id === userId);
  if (!user) throw new Error("Compte introuvable.");
  if (changes.password !== undefined) {
    const passwordRecord = hashPassword(changes.password);
    user.passwordSalt = passwordRecord.salt;
    user.passwordHash = passwordRecord.hash;
    user.passwordChangedAt = new Date().toISOString();
  }
  if (changes.disabled !== undefined) user.disabled = Boolean(changes.disabled);
  if (changes.identifier !== undefined) {
    const identifier = validateIdentifier(changes.identifier);
    if (users.some((item) => item.id !== userId && item.identifier === identifier)) throw new Error(`Le compte « ${identifier} » existe déjà.`);
    user.identifier = identifier;
  }
  writeUsers(usersFile, users);
  return publicUser(user);
}

function publicUser(user) {
  return { id: user.id, identifier: user.identifier, displayName: user.displayName, role: user.role };
}

function signSession(user, secret, ttlSeconds = 60 * 60 * 24 * 7) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, ver: user.passwordChangedAt || user.createdAt, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifySession(token, secret, users) {
  if (!token || !secret) return null;
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return users.find((user) => user.id === claims.sub && !user.disabled && claims.ver === (user.passwordChangedAt || user.createdAt)) || null;
  } catch { return null; }
}

function parseCookies(header) {
  return String(header || "").split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    return cookies;
  }, {});
}

module.exports = { createUser, normalizeIdentifier, parseCookies, publicUser, readUsers, signSession, updateUser, verifyPassword, verifySession };

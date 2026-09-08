const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createUser, normalizeIdentifier, parseCookies, publicUser, readUsers, signSession, updateUser, verifyPassword, verifySession } = require("./auth");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const ACCOUNTS_DIR = path.join(DATA_DIR, "accounts");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const LEGACY_STATE_FILE = path.join(DATA_DIR, "state.json");
const LEGACY_UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const LEGACY_BACKUP_DIR = path.join(DATA_DIR, "backups", "pre-accounts-v1");
const LEGACY_LOGIN_CLAIM_FILE = path.join(DATA_DIR, ".legacy-login-claimed");
const SESSION_COOKIE = "nova_session";
const SESSION_SECRET = process.env.NOVA_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const loginAttempts = new Map();
const signupAttempts = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};

fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
const bootstrapAdmin = bootstrapAccountFromEnvironment();
if (bootstrapAdmin) migrateLegacyData(bootstrapAdmin);

const server = http.createServer(async (request, response) => {
  try {
    addSecurityHeaders(response);
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/health") {
      return sendJson(response, { ok: true, name: "Nova+", accountsConfigured: readUsers(USERS_FILE).length > 0, checkedAt: new Date().toISOString() });
    }
    if (url.pathname === "/api/auth/login" && request.method === "POST") return handleLogin(request, response);
    if (url.pathname === "/api/auth/register" && request.method === "POST") return handleRegister(request, response);
    if (url.pathname === "/api/auth/logout" && request.method === "POST") return handleLogout(request, response);

    const user = authenticatedUser(request);
    if (url.pathname === "/api/auth/session") {
      return user ? sendJson(response, { authenticated: true, user: publicUser(user) }) : sendJson(response, { authenticated: false }, 401);
    }
    if (url.pathname === "/login" || url.pathname === "/login.html" || url.pathname === "/connexion") {
      if (user) return redirect(response, "/");
      return serveStaticFile(path.join(ROOT, "login.html"), response);
    }
    if (!user && (url.pathname === "/login.css" || url.pathname === "/login.js")) return serveStatic(url.pathname, response);
    if (!user) {
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")) return sendJson(response, { error: "Session expirée. Reconnectez-vous." }, 401);
      return redirect(response, "/connexion");
    }

    if (url.pathname === "/api/admin/accounts") {
      if (user.role !== "admin") return sendJson(response, { error: "Accès réservé à l’administrateur." }, 403);
      if (request.method === "GET") {
        return sendJson(response, {
          accounts: readUsers(USERS_FILE).map((account) => ({ ...publicUser(account), disabled: Boolean(account.disabled), createdAt: account.createdAt })),
        });
      }
      if (request.method === "POST") {
        const body = await readJsonBody(request, 32 * 1024);
        try {
          const account = createUser(USERS_FILE, { identifier: body.identifier, password: body.password, displayName: body.displayName, role: "client" });
          return sendJson(response, { ok: true, account }, 201);
        } catch (error) { return sendJson(response, { error: error.message }, 400); }
      }
    }
    if (url.pathname.startsWith("/api/admin/accounts/") && request.method === "PATCH") {
      if (user.role !== "admin") return sendJson(response, { error: "Accès réservé à l’administrateur." }, 403);
      const accountId = decodeURIComponent(url.pathname.slice("/api/admin/accounts/".length));
      const body = await readJsonBody(request, 32 * 1024);
      if (accountId === user.id && body.disabled === true) return sendJson(response, { error: "Vous ne pouvez pas désactiver votre propre compte." }, 400);
      const changes = {};
      if (body.disabled !== undefined) changes.disabled = body.disabled;
      if (body.password !== undefined) changes.password = body.password;
      if (!Object.keys(changes).length) return sendJson(response, { error: "Modification invalide." }, 400);
      try { return sendJson(response, { ok: true, account: updateUser(USERS_FILE, accountId, changes) }); }
      catch (error) { return sendJson(response, { error: error.message }, 400); }
    }

    if (url.pathname === "/api/state" && request.method === "GET") return sendJson(response, readState(user));
    if (url.pathname === "/api/state" && request.method === "PUT") {
      const state = await readJsonBody(request, 25 * 1024 * 1024);
      const stateFile = accountStateFile(user);
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      writeJsonAtomic(stateFile, state);
      return sendJson(response, { ok: true, savedAt: new Date().toISOString() });
    }
    if (url.pathname === "/api/files" && request.method === "POST") return sendJson(response, storeUpload(user, await readJsonBody(request, 80 * 1024 * 1024)));
    if (url.pathname.startsWith("/uploads/")) return serveUpload(user, url.pathname, response);
    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    return sendJson(response, { error: error.message || "Erreur serveur" }, error.statusCode || 500);
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Nova+ prêt : http://localhost:${PORT}`);
    console.log(`Données isolées par compte : ${ACCOUNTS_DIR}`);
    if (!process.env.NOVA_SESSION_SECRET) console.warn("Attention : NOVA_SESSION_SECRET absent, les sessions seront invalidées au redémarrage.");
    if (!readUsers(USERS_FILE).length) console.log("Aucun compte existant. Le premier client peut s’inscrire depuis la page de connexion.");
  });
}

async function handleLogin(request, response) {
  const key = request.socket.remoteAddress || "unknown";
  const attempt = loginAttempts.get(key);
  if (attempt?.blockedUntil > Date.now()) return sendJson(response, { error: "Trop de tentatives. Réessayez dans quelques minutes." }, 429);
  const body = await readJsonBody(request, 32 * 1024);
  const identifier = normalizeIdentifier(body.identifier);
  const users = readUsers(USERS_FILE);
  let user = users.find((item) => item.identifier === identifier && !item.disabled);
  if (!user) user = claimLegacyAccount(identifier, body.password, users);
  if (!user || !verifyPassword(body.password, user)) {
    registerFailedLogin(key);
    return sendJson(response, { error: "Identifiant ou mot de passe incorrect." }, 401);
  }
  loginAttempts.delete(key);
  migrateLegacyData(user);
  response.setHeader("Set-Cookie", sessionCookie(signSession(user, SESSION_SECRET, SESSION_TTL_SECONDS), request));
  return sendJson(response, { ok: true, user: publicUser(user) });
}

async function handleRegister(request, response) {
  const key = request.socket.remoteAddress || "unknown";
  const attempt = signupAttempts.get(key);
  if (attempt?.blockedUntil > Date.now()) return sendJson(response, { error: "Trop de créations de comptes. Réessayez plus tard." }, 429);
  registerSignup(key);
  const body = await readJsonBody(request, 32 * 1024);
  const displayName = String(body.displayName || "").trim();
  if (displayName.length < 2 || displayName.length > 80) return sendJson(response, { error: "Indiquez un nom d’entreprise valide." }, 400);
  try {
    const isFirstAccount = readUsers(USERS_FILE).length === 0;
    const account = createUser(USERS_FILE, { identifier: body.identifier, password: body.password, displayName, role: isFirstAccount ? "admin" : "client" });
    const user = readUsers(USERS_FILE).find((item) => item.id === account.id);
    if (isFirstAccount) migrateLegacyData(user);
    response.setHeader("Set-Cookie", sessionCookie(signSession(user, SESSION_SECRET, SESSION_TTL_SECONDS), request));
    return sendJson(response, { ok: true, user: publicUser(user) }, 201);
  } catch (error) {
    return sendJson(response, { error: error.message }, 400);
  }
}

function handleLogout(request, response) {
  response.setHeader("Set-Cookie", sessionCookie("", request, 0));
  return sendJson(response, { ok: true });
}

function authenticatedUser(request) {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  return verifySession(token, SESSION_SECRET, readUsers(USERS_FILE));
}

function claimLegacyAccount(identifier, password, users) {
  if (!process.env.NOVA_AUTH_PASSWORD || fs.existsSync(LEGACY_LOGIN_CLAIM_FILE)) return null;
  const admins = users.filter((user) => user.role === "admin" && !user.disabled);
  if (admins.length !== 1 || !verifyPassword(password, admins[0])) return null;
  try {
    updateUser(USERS_FILE, admins[0].id, { identifier });
    fs.writeFileSync(LEGACY_LOGIN_CLAIM_FILE, `${admins[0].id}\n`);
    return readUsers(USERS_FILE).find((user) => user.id === admins[0].id) || null;
  } catch { return null; }
}

function registerFailedLogin(key) {
  const previous = loginAttempts.get(key) || { count: 0, blockedUntil: 0 };
  previous.count += 1;
  if (previous.count >= 5) previous.blockedUntil = Date.now() + 5 * 60 * 1000;
  loginAttempts.set(key, previous);
}

function registerSignup(key) {
  const now = Date.now();
  const previous = signupAttempts.get(key);
  const attempt = !previous || now - previous.startedAt > 60 * 60 * 1000 ? { count: 0, startedAt: now, blockedUntil: 0 } : previous;
  attempt.count += 1;
  if (attempt.count >= 5) attempt.blockedUntil = now + 60 * 60 * 1000;
  signupAttempts.set(key, attempt);
}

function sessionCookie(value, request, maxAge = SESSION_TTL_SECONDS) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const secure = forwardedProto === "https" || process.env.NODE_ENV === "production";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function accountDir(user) { return path.join(ACCOUNTS_DIR, user.id); }
function accountStateFile(user) { return path.join(accountDir(user), "state.json"); }
function accountUploadDir(user) { return path.join(accountDir(user), "uploads"); }

function readState(user) {
  const stateFile = accountStateFile(user);
  if (!fs.existsSync(stateFile)) return {};
  try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { return {}; }
}

function storeUpload(user, payload) {
  if (!payload?.dataUrl || !payload?.name) throw httpError("Fichier invalide", 400);
  const match = String(payload.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw httpError("Format fichier invalide", 400);
  const extension = path.extname(payload.name).toLowerCase().slice(0, 12);
  const safeBase = path.basename(payload.name, extension).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const uploadDir = accountUploadDir(user);
  fs.mkdirSync(uploadDir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomUUID()}-${safeBase || "document"}${extension}`;
  const filePath = path.join(uploadDir, filename);
  fs.writeFileSync(filePath, Buffer.from(match[2], "base64"));
  return { name: payload.name, type: payload.type || match[1], size: Number(payload.size || fs.statSync(filePath).size), url: `/uploads/${filename}`, path: `accounts/${user.id}/uploads/${filename}`, uploadedAt: new Date().toISOString() };
}

function serveStatic(urlPath, response) {
  const pathname = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) return sendText(response, "Interdit", 403);
  return serveStaticFile(filePath, response);
}
function serveUpload(user, urlPath, response) { return serveStaticFile(path.join(accountUploadDir(user), path.basename(decodeURIComponent(urlPath))), response); }
function serveStaticFile(filePath, response) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return sendText(response, "Introuvable", 404);
  response.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
}

function bootstrapAccountFromEnvironment() {
  const existingUsers = readUsers(USERS_FILE);
  if (existingUsers.length) return existingUsers.find((user) => user.role === "admin") || null;
  const password = process.env.NOVA_ADMIN_PASSWORD || process.env.NOVA_AUTH_PASSWORD;
  if (!password) return null;
  return createUser(USERS_FILE, { identifier: process.env.NOVA_ADMIN_ID || "nova", password, displayName: process.env.NOVA_ADMIN_NAME || "Compte historique Nova+", role: "admin" });
}

function migrateLegacyData(user) {
  if (user.role !== "admin") return;
  const migrationMarker = path.join(DATA_DIR, ".legacy-data-migrated");
  if (fs.existsSync(migrationMarker)) return;
  fs.mkdirSync(LEGACY_BACKUP_DIR, { recursive: true });
  const backupStateFile = path.join(LEGACY_BACKUP_DIR, "state.json");
  const backupUploadDir = path.join(LEGACY_BACKUP_DIR, "uploads");
  if (!fs.existsSync(backupStateFile) && fs.existsSync(LEGACY_STATE_FILE)) fs.copyFileSync(LEGACY_STATE_FILE, backupStateFile, fs.constants.COPYFILE_EXCL);
  if (!fs.existsSync(backupUploadDir) && fs.existsSync(LEGACY_UPLOAD_DIR)) fs.cpSync(LEGACY_UPLOAD_DIR, backupUploadDir, { recursive: true, errorOnExist: true, force: false });
  const stateFile = accountStateFile(user);
  if (!fs.existsSync(stateFile) && fs.existsSync(LEGACY_STATE_FILE)) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.copyFileSync(LEGACY_STATE_FILE, stateFile);
  }
  const uploadDir = accountUploadDir(user);
  if (!fs.existsSync(uploadDir) && fs.existsSync(LEGACY_UPLOAD_DIR)) fs.cpSync(LEGACY_UPLOAD_DIR, uploadDir, { recursive: true });
  fs.writeFileSync(migrationMarker, `${user.id}\n`);
}

function readJsonBody(request, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    request.on("data", (chunk) => { size += chunk.length; if (size > limit) { reject(httpError("Requête trop lourde", 413)); request.destroy(); } else chunks.push(chunk); });
    request.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(httpError("JSON invalide", 400)); } });
    request.on("error", reject);
  });
}

function addSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; worker-src 'self' blob: https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
}

function writeJsonAtomic(filePath, payload) { const temp = `${filePath}.tmp`; fs.writeFileSync(temp, JSON.stringify(payload, null, 2)); fs.renameSync(temp, filePath); }
function redirect(response, location) { response.writeHead(302, { Location: location, "Cache-Control": "no-store" }); response.end(); }
function sendJson(response, payload, status = 200) { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); response.end(JSON.stringify(payload)); }
function sendText(response, text, status = 200) { response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }); response.end(text); }
function httpError(message, statusCode) { const error = new Error(message); error.statusCode = statusCode; return error; }

module.exports = { server };

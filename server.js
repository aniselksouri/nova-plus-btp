const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const AUTH_PASSWORD = process.env.NOVA_AUTH_PASSWORD || "";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/health") {
      return sendJson(response, { ok: true, name: "Nova+", checkedAt: new Date().toISOString() });
    }

    if (!isAuthorized(request)) {
      response.writeHead(401, {
        "Content-Type": "text/plain; charset=utf-8",
        "WWW-Authenticate": 'Basic realm="Nova+"',
      });
      return response.end("Authentification requise");
    }

    if (url.pathname === "/api/state" && request.method === "GET") {
      return sendJson(response, readState());
    }

    if (url.pathname === "/api/state" && request.method === "PUT") {
      const state = await readJsonBody(request, 25 * 1024 * 1024);
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
      return sendJson(response, { ok: true, savedAt: new Date().toISOString() });
    }

    if (url.pathname === "/api/files" && request.method === "POST") {
      const payload = await readJsonBody(request, 80 * 1024 * 1024);
      const stored = storeUpload(payload);
      return sendJson(response, stored);
    }

    if (url.pathname.startsWith("/uploads/")) {
      return serveUpload(url.pathname, response);
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    sendJson(response, { error: error.message || "Erreur serveur" }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`Nova+ prêt : http://localhost:${PORT}`);
  console.log(`Données : ${STATE_FILE}`);
  console.log(`Documents : ${UPLOAD_DIR}`);
  console.log(AUTH_PASSWORD ? "Protection par mot de passe active." : "Protection par mot de passe inactive.");
});

function isAuthorized(request) {
  if (!AUTH_PASSWORD) return true;
  const header = request.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const [, password] = decoded.split(":");
  return password === AUTH_PASSWORD;
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function storeUpload(payload) {
  if (!payload?.dataUrl || !payload?.name) throw new Error("Fichier invalide");
  const match = String(payload.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Format fichier invalide");
  const extension = path.extname(payload.name).toLowerCase();
  const safeBase = path
    .basename(payload.name, extension)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const filename = `${Date.now()}-${randomUUID()}-${safeBase || "document"}${extension}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(match[2], "base64"));
  return {
    name: payload.name,
    type: payload.type || match[1] || "application/octet-stream",
    size: Number(payload.size || fs.statSync(filePath).size),
    url: `/uploads/${filename}`,
    path: `data/uploads/${filename}`,
    uploadedAt: new Date().toISOString(),
  };
}

function serveStatic(urlPath, response) {
  const pathname = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) return sendText(response, "Interdit", 403);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendText(response, "Introuvable", 404);
  }
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
}

function serveUpload(urlPath, response) {
  const filename = path.basename(decodeURIComponent(urlPath));
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!filePath.startsWith(UPLOAD_DIR)) return sendText(response, "Interdit", 403);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendText(response, "Introuvable", 404);
  }
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
}

function readJsonBody(request, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Requête trop lourde"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendText(response, text, status = 200) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

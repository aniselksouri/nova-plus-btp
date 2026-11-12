"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { httpError, sha256 } = require("./security");

// Formats exécutables par un navigateur : refusés (risque de script malveillant servi par Nova+).
const BLOCKED_EXTENSIONS = new Set([".html", ".htm", ".xhtml", ".svg", ".svgz", ".js", ".mjs", ".xml", ".xsl", ".php", ".exe", ".bat", ".cmd", ".sh", ".app", ".dmg"]);
// Formats affichables directement ; les autres sont proposés en téléchargement.
const INLINE_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt", ".csv"]);

function safeBaseName(name, extension) {
  return path
    .basename(String(name), extension)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function createFileStore(db, { uploadDir, auth }) {
  fs.mkdirSync(uploadDir, { recursive: true });

  async function store(payload, { user, ip }) {
    if (!payload?.dataUrl || !payload?.name) throw httpError(400, "Fichier invalide.");
    const match = String(payload.dataUrl).match(/^data:([^;,]*)(;base64)?,(.*)$/s);
    if (!match || !match[2]) throw httpError(400, "Format de fichier invalide.");
    const extension = path.extname(String(payload.name)).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(extension)) throw httpError(415, `Type de fichier refusé pour des raisons de sécurité (${extension}).`);
    const buffer = Buffer.from(match[3], "base64");
    if (!buffer.length) throw httpError(400, "Fichier vide.");
    const key = `${Date.now()}-${crypto.randomUUID()}-${safeBaseName(payload.name, extension) || "document"}${extension}`;
    const finalPath = path.join(uploadDir, key);
    const temporaryPath = `${finalPath}.part`;

    // Écriture atomique et forcée sur disque avant d'annoncer le succès.
    const handle = fs.openSync(temporaryPath, "w", 0o640);
    try {
      fs.writeSync(handle, buffer);
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(temporaryPath, finalPath);
    if (fs.statSync(finalPath).size !== buffer.length) throw httpError(500, "Écriture du fichier incomplète.");

    const mime = String(payload.type || match[1] || "application/octet-stream").slice(0, 120);
    const digest = sha256(buffer);
    await db.query(
      `INSERT INTO files (storage_key, original_name, mime_type, size_bytes, sha256, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [key, String(payload.name).slice(0, 255), mime, buffer.length, digest, user?.id || null],
    );
    await auth.audit({ user, action: "file.upload", entity: "file", entityId: key, details: { name: payload.name, size: buffer.length }, ip });
    return {
      name: payload.name,
      type: mime,
      size: buffer.length,
      url: `/uploads/${key}`,
      path: `data/uploads/${key}`,
      sha256: digest,
      uploadedAt: new Date().toISOString(),
    };
  }

  function resolve(urlPath) {
    const key = path.basename(decodeURIComponent(urlPath));
    if (!key || key.startsWith(".") || key.endsWith(".part")) return null;
    const filePath = path.join(uploadDir, key);
    if (!filePath.startsWith(uploadDir + path.sep)) return null;
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return filePath;
  }

  // Recense les fichiers présents sur le disque qui ne sont pas encore en base (import initial).
  async function inventoryDisk({ source = "inventory" } = {}) {
    const known = new Set((await db.query("SELECT storage_key FROM files")).map((row) => row.storage_key));
    let added = 0;
    for (const entry of fs.readdirSync(uploadDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith(".") || entry.name.endsWith(".part") || known.has(entry.name)) continue;
      const filePath = path.join(uploadDir, entry.name);
      const buffer = fs.readFileSync(filePath);
      const original = entry.name.replace(/^\d+-[0-9a-f-]{36}-/, "");
      await db.query(
        `INSERT INTO files (storage_key, original_name, mime_type, size_bytes, sha256, source)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (storage_key) DO NOTHING`,
        [entry.name, original, guessMime(entry.name), buffer.length, sha256(buffer), source],
      );
      added += 1;
    }
    return added;
  }

  // Vérifie que chaque pièce jointe connue et chaque lien présent dans les données existe bien sur le disque.
  async function check(stateData) {
    const rows = await db.query("SELECT storage_key, original_name, size_bytes FROM files ORDER BY uploaded_at");
    const missing = [];
    const sizeMismatch = [];
    for (const row of rows) {
      const filePath = path.join(uploadDir, row.storage_key);
      if (!fs.existsSync(filePath)) missing.push({ key: row.storage_key, name: row.original_name });
      else if (fs.statSync(filePath).size !== Number(row.size_bytes)) sizeMismatch.push({ key: row.storage_key, name: row.original_name });
    }
    const references = collectUploadReferences(stateData);
    const brokenLinks = references.filter((ref) => !fs.existsSync(path.join(uploadDir, ref.key)));
    const embedded = countEmbeddedFiles(stateData);
    return {
      checkedAt: new Date().toISOString(),
      uploadDir,
      knownFiles: rows.length,
      missing,
      sizeMismatch,
      referencedInData: references.length,
      brokenLinks,
      embeddedInData: embedded,
      ok: missing.length === 0 && sizeMismatch.length === 0 && brokenLinks.length === 0,
    };
  }

  return { store, resolve, inventoryDisk, check, uploadDir };
}

function collectUploadReferences(data) {
  const found = [];
  const seen = new Set();
  walk(data, [], (value, trail) => {
    if (typeof value !== "string") return;
    const match = value.match(/^\/uploads\/([^/?#]+)$/);
    if (!match) return;
    const key = decodeURIComponent(match[1]);
    const id = `${key}|${trail.join(".")}`;
    if (seen.has(id)) return;
    seen.add(id);
    found.push({ key, where: describeTrail(data, trail) });
  });
  return found;
}

function countEmbeddedFiles(data) {
  let count = 0;
  walk(data, [], (value) => {
    if (typeof value === "string" && value.startsWith("data:") && value.includes(";base64,")) count += 1;
  });
  return count;
}

function walk(value, trail, visit) {
  visit(value, trail);
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, [...trail, index], visit));
  else if (value && typeof value === "object") Object.keys(value).forEach((key) => walk(value[key], [...trail, key], visit));
}

function describeTrail(data, trail) {
  if (trail[0] === "projects" && Number.isInteger(trail[1])) {
    const project = data.projects[trail[1]];
    return `Chantier « ${project?.name || project?.client || project?.id || trail[1]} »`;
  }
  return trail.slice(0, 2).join(" › ");
}

function guessMime(name) {
  const extension = path.extname(name).toLowerCase();
  return (
    {
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".csv": "text/csv",
      ".txt": "text/plain",
    }[extension] || "application/octet-stream"
  );
}

module.exports = { createFileStore, collectUploadReferences, countEmbeddedFiles, INLINE_EXTENSIONS, guessMime };

"use strict";

// Export en lecture seule des chantiers pour le suivi des tournages Pixtyse × HSM.
// GET /api/hooks/chantiers avec l'en-tête X-Nova-Key = NOVA_SUIVI_KEY.
// Ne renvoie que le strict nécessaire au planning des tournages : ni montants, ni documents, ni lots.

const { httpError } = require("./security");
const { safeEqual } = require("./leads-intake");

const PATH = "/api/hooks/chantiers";
const text = (value) => (typeof value === "string" ? value.trim() : "");

function toSuiviProject(project) {
  return {
    id: String(project?.id ?? ""),
    name: text(project?.name),
    client: text(project?.client),
    address: text(project?.address),
    startDate: text(project?.startDate),
    endDate: text(project?.endDate),
    status: text(project?.status),
    archived: project?.archived === true,
  };
}

function createSuiviExport({ stateStore, sendJson, env }) {
  const hits = new Map();

  async function handle({ request, response, pathname, method, ip }) {
    if (pathname !== PATH) return false;
    if (method !== "GET") throw httpError(405, "Méthode non autorisée.");
    if (!env.NOVA_SUIVI_KEY) throw httpError(503, "Export du suivi non configuré.");
    const now = Date.now();
    const recent = (hits.get(ip || "?") || []).filter((time) => now - time < 60_000);
    if (recent.length >= 30) throw httpError(429, "Trop de requêtes.");
    hits.set(ip || "?", [...recent, now]);
    if (!safeEqual(request.headers["x-nova-key"], env.NOVA_SUIVI_KEY)) throw httpError(401, "Clé invalide.");

    const { version, data, updatedAt } = await stateStore.get();
    const projects = (Array.isArray(data?.projects) ? data.projects : []).map(toSuiviProject).filter((project) => project.id);
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, { version, updatedAt, projects });
    return true;
  }

  return { handle, PATH };
}

module.exports = { createSuiviExport, toSuiviProject };

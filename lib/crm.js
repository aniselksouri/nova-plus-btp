"use strict";

// CRM leads et commerciaux (module 5) : entrée des leads, pipeline Nouveau → Signé / Perdu,
// attribution manuelle ou tour de rôle, relances, historique, lien avec les dossiers et devis.

const { httpError } = require("./security");
const permissions = require("./permissions");
const intake = require("./leads-intake");

const STAGES = [
  { key: "new", label: "Nouveau" },
  { key: "contacted", label: "Contacté" },
  { key: "visit", label: "Visite planifiée" },
  { key: "quote_sent", label: "Devis envoyé" },
  { key: "negotiation", label: "Négociation" },
  { key: "won", label: "Signé" },
  { key: "lost", label: "Perdu" },
];
const STAGE_KEYS = STAGES.map((stage) => stage.key);
const STAGE_LABELS = Object.fromEntries(STAGES.map((stage) => [stage.key, stage.label]));
const OPEN_STAGES = ["new", "contacted", "visit", "quote_sent", "negotiation"];
const SOURCES = { meta: "Meta (Facebook / Instagram)", google: "Google Ads", website: "Site internet", phone: "Téléphone", manual: "Saisie manuelle", other: "Autre" };
const EVENT_KINDS = ["call", "visit", "note", "email"];
const SELLER_ROLES = ["commercial", "direction_commerciale"];

const DEFAULT_SETTINGS = {
  assignment: "round_robin", // ou « manual » : les leads arrivent sans commercial
  rotation: [], // identifiants des commerciaux du tour de rôle ; vide = tous les commerciaux actifs
  stageDays: { new: 1, contacted: 3, visit: 7, quote_sent: 7, negotiation: 10 },
  lostReasons: ["Trop cher", "Délai trop long", "Concurrent retenu", "Projet abandonné", "Injoignable", "Hors zone ou hors métier"],
};

const text = (value, max = 300) => String(value ?? "").trim().slice(0, max);
const DAY = 86400000;

function createCrm(db, { auth, quotes = null, now = () => new Date() }) {
  // ---------- Réglages ----------

  async function settings() {
    const [row] = await db.query("SELECT value FROM crm_settings WHERE key = 'crm'");
    const saved = row?.value || {};
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      stageDays: { ...DEFAULT_SETTINGS.stageDays, ...(saved.stageDays || {}) },
      lostReasons: Array.isArray(saved.lostReasons) && saved.lostReasons.length ? saved.lostReasons : DEFAULT_SETTINGS.lostReasons,
      rotation: Array.isArray(saved.rotation) ? saved.rotation : [],
    };
  }

  async function saveSettings(input, { user, ip }) {
    permissions.require(user, "crm.settings");
    const current = await settings();
    const next = { ...current };
    if (input.assignment !== undefined) next.assignment = input.assignment === "manual" ? "manual" : "round_robin";
    if (input.rotation !== undefined) {
      if (!Array.isArray(input.rotation)) throw httpError(400, "Tour de rôle invalide.");
      const ids = [...new Set(input.rotation.map(String))];
      const valid = ids.length ? await db.query("SELECT id FROM users WHERE id = ANY($1::uuid[]) AND active AND role = ANY($2::text[])", [ids, SELLER_ROLES]) : [];
      if (valid.length !== ids.length) throw httpError(400, "Le tour de rôle ne peut contenir que des commerciaux actifs.");
      next.rotation = ids;
    }
    if (input.stageDays !== undefined) {
      next.stageDays = { ...current.stageDays };
      for (const stage of OPEN_STAGES) {
        if (input.stageDays[stage] === undefined) continue;
        const days = Number(input.stageDays[stage]);
        if (!Number.isInteger(days) || days < 1 || days > 90) throw httpError(400, `Délai de relance « ${STAGE_LABELS[stage]} » : entre 1 et 90 jours.`);
        next.stageDays[stage] = days;
      }
    }
    if (input.lostReasons !== undefined) {
      const reasons = (Array.isArray(input.lostReasons) ? input.lostReasons : []).map((reason) => text(reason, 80)).filter(Boolean).slice(0, 20);
      if (!reasons.length) throw httpError(400, "Indiquez au moins un motif de perte.");
      next.lostReasons = reasons;
    }
    await db.query("INSERT INTO crm_settings (key, value) VALUES ('crm', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [JSON.stringify(next)]);
    await auth.audit({ user, action: "crm.settings", entity: "crm_settings", entityId: "crm", details: { assignment: next.assignment, rotation: next.rotation.length }, ip });
    return next;
  }

  // ---------- Accès ----------

  function canSee(user, row) {
    if (permissions.can(user, "crm.read_all")) return true;
    if (permissions.can(user, "crm.read_own")) return row.commercial_id === user.id || (row.created_by === user.id && !row.commercial_id);
    return false;
  }
  function requireRead(user) {
    if (!permissions.can(user, "crm.read_all") && !permissions.can(user, "crm.read_own")) throw httpError(403, "Action non autorisée pour votre rôle.");
  }

  async function loadRow(id, user) {
    const [row] = await db.query("SELECT l.*, u.display_name AS commercial_name FROM leads l LEFT JOIN users u ON u.id = l.commercial_id WHERE l.id = $1", [id]);
    if (!row || !canSee(user, row)) throw httpError(404, "Lead introuvable.");
    return row;
  }

  function leadOut(row, conf, tasks = []) {
    const nowMs = now().getTime();
    const open = OPEN_STAGES.includes(row.stage);
    const since = new Date(row.stage_changed_at).getTime();
    const limit = conf.stageDays[row.stage];
    const openTasks = tasks.filter((task) => task.lead_id === row.id && !task.done_at).sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
    const lateTasks = openTasks.filter((task) => new Date(task.due_at).getTime() < nowMs);
    const stale = open && limit ? nowMs - since > limit * DAY : false;
    return {
      id: row.id,
      source: row.source,
      sourceLabel: SOURCES[row.source] || row.source,
      campaign: row.campaign,
      campaignId: row.campaign_id,
      adName: row.ad_name,
      formName: row.form_name,
      utm: row.utm || {},
      name: row.name,
      phone: row.phone,
      email: row.email,
      postalCode: row.postal_code,
      city: row.city,
      address: row.address,
      need: row.need,
      details: row.details || {},
      stage: row.stage,
      stageLabel: STAGE_LABELS[row.stage],
      lostReason: row.lost_reason,
      commercialId: row.commercial_id,
      commercialName: row.commercial_name || null,
      assignedAt: row.assigned_at,
      dossierId: row.dossier_id,
      duplicateOf: row.duplicate_of,
      isTest: row.is_test,
      incomplete: row.incomplete,
      stageChangedAt: row.stage_changed_at,
      daysInStage: Math.floor((nowMs - since) / DAY),
      stageLimitDays: open ? limit : null,
      receivedAt: row.received_at,
      wonAt: row.won_at,
      lostAt: row.lost_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      stale,
      overdue: stale || lateTasks.length > 0,
      openTasks: openTasks.length,
      nextTask: openTasks[0] ? { id: openTasks[0].id, title: openTasks[0].title, dueAt: openTasks[0].due_at, late: new Date(openTasks[0].due_at).getTime() < nowMs } : null,
    };
  }

  // ---------- Liste et fiche ----------

  async function list(user, { q = "", stage = "", commercialId = "", source = "", closedDays = 60 } = {}) {
    requireRead(user);
    const params = [];
    const where = [];
    const add = (value) => (params.push(value), `$${params.length}`);
    if (!permissions.can(user, "crm.read_all")) where.push(`(l.commercial_id = ${add(user.id)} OR (l.created_by = $${params.length} AND l.commercial_id IS NULL))`);
    if (stage && STAGE_KEYS.includes(stage)) where.push(`l.stage = ${add(stage)}`);
    else where.push(`(l.stage = ANY(${add(OPEN_STAGES)}::text[]) OR l.stage_changed_at > ${add(new Date(now().getTime() - closedDays * DAY).toISOString())})`);
    if (commercialId === "none") where.push("l.commercial_id IS NULL");
    else if (commercialId) where.push(`l.commercial_id = ${add(commercialId)}`);
    if (source && SOURCES[source]) where.push(`l.source = ${add(source)}`);
    if (q.trim()) {
      const like = add(`%${q.trim().replace(/[%_]/g, "")}%`);
      where.push(`(l.name ILIKE ${like} OR l.phone ILIKE ${like} OR l.email ILIKE ${like} OR l.city ILIKE ${like} OR l.campaign ILIKE ${like} OR l.need ILIKE ${like})`);
    }
    const rows = await db.query(
      `SELECT l.*, u.display_name AS commercial_name FROM leads l LEFT JOIN users u ON u.id = l.commercial_id
       WHERE ${where.join(" AND ")} ORDER BY l.received_at DESC LIMIT 1000`,
      params,
    );
    const tasks = rows.length ? await db.query("SELECT * FROM lead_tasks WHERE lead_id = ANY($1::uuid[]) AND done_at IS NULL", [rows.map((row) => row.id)]) : [];
    const conf = await settings();
    return rows.map((row) => leadOut(row, conf, tasks));
  }

  async function get(id, user) {
    const row = await loadRow(id, user);
    const conf = await settings();
    const tasks = await db.query("SELECT t.*, u.display_name AS assigned_name FROM lead_tasks t LEFT JOIN users u ON u.id = t.assigned_to WHERE t.lead_id = $1 ORDER BY t.done_at NULLS FIRST, t.due_at", [id]);
    const lead = leadOut(row, conf, tasks);
    lead.tasks = tasks.map((task) => ({ id: task.id, title: task.title, dueAt: task.due_at, doneAt: task.done_at, auto: task.auto, assignedTo: task.assigned_to, assignedName: task.assigned_name, late: !task.done_at && new Date(task.due_at) < now() }));
    lead.events = (await db.query("SELECT e.*, u.display_name AS user_name FROM lead_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.lead_id = $1 ORDER BY e.at DESC, e.id DESC LIMIT 300", [id])).map((event) => ({ id: event.id, kind: event.kind, body: event.body, details: event.details, at: event.at, userName: event.user_name }));
    lead.quotes = row.dossier_id
      ? (await db.query("SELECT id, number, amendment_no, version, status, totals, signed_at, sent_at FROM quotes WHERE dossier_id = $1 ORDER BY amendment_no, version", [row.dossier_id])).map((q) => ({ id: q.id, number: q.number, amendmentNo: q.amendment_no, version: q.version, status: q.status, sale: q.totals?.sale ?? null, total: q.totals?.total ?? null, signedAt: q.signed_at, sentAt: q.sent_at }))
      : [];
    if (row.duplicate_of) {
      const [original] = await db.query("SELECT id, name, stage, received_at, source, commercial_id, created_by FROM leads WHERE id = $1", [row.duplicate_of]);
      lead.duplicate = original && canSee(user, original) ? { id: original.id, name: original.name, stage: original.stage, stageLabel: STAGE_LABELS[original.stage], receivedAt: original.received_at, sourceLabel: SOURCES[original.source] } : null;
    }
    return lead;
  }

  // ---------- Entrée des leads ----------

  async function nextInRotation(conf) {
    let ids = conf.rotation;
    const active = await db.query("SELECT id FROM users WHERE active AND role = ANY($1::text[]) ORDER BY display_name, id", [ids.length ? SELLER_ROLES : ["commercial"]]);
    const activeIds = active.map((row) => row.id);
    ids = ids.length ? ids.filter((id) => activeIds.includes(id)) : activeIds;
    if (!ids.length) return null;
    const [{ value }] = await db.query(
      `INSERT INTO crm_settings (key, value) VALUES ('crm_rotation', '{"n":0}'::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = jsonb_build_object('n', COALESCE((crm_settings.value->>'n')::int, -1) + 1), updated_at = now()
       RETURNING value`,
    );
    return ids[Number(value.n) % ids.length];
  }

  async function findDuplicate(phone, email) {
    const key = intake.phoneKey(phone);
    if (!key && !email) return null;
    const since = new Date(now().getTime() - 180 * DAY).toISOString();
    const rows = await db.query(
      `SELECT id, commercial_id, phone FROM leads WHERE received_at > $1 AND duplicate_of IS NULL
         AND ((CAST($2 AS text) IS NOT NULL AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9) = $2) OR (CAST($3 AS text) IS NOT NULL AND lower(email) = $3))
       ORDER BY received_at LIMIT 1`,
      [since, key, email],
    );
    return rows[0] || null;
  }

  // Crée le lead (webhook ou saisie). Un même identifiant externe n'est jamais importé deux fois.
  async function receive(input, { user = null, ip = null } = {}) {
    const source = SOURCES[input.source] ? input.source : "other";
    const externalId = input.externalId ? text(input.externalId, 160) : null;
    if (externalId) {
      const [existing] = await db.query("SELECT id FROM leads WHERE source = $1 AND external_id = $2", [source, externalId]);
      if (existing) return { id: existing.id, created: false };
    }
    const phone = intake.normalizePhone(input.phone);
    const email = intake.normalizeEmail(input.email);
    const name = text(input.name, 160) || text(email || phone, 160) || "Contact sans nom";
    if (!phone && !email && source !== "meta") throw httpError(400, "Indiquez au moins un téléphone ou un e-mail.");
    const conf = await settings();
    const duplicate = await findDuplicate(phone, email);
    let commercialId = input.commercialId || null;
    if (commercialId && !(await db.query("SELECT 1 FROM users WHERE id = $1 AND active", [commercialId])).length) throw httpError(400, "Commercial inconnu.");
    if (!commercialId && duplicate?.commercial_id) commercialId = duplicate.commercial_id;
    if (!commercialId && input.autoAssign !== false && conf.assignment === "round_robin") commercialId = await nextInRotation(conf);
    const received = input.receivedAt && !Number.isNaN(new Date(input.receivedAt).getTime()) ? new Date(input.receivedAt) : now();
    const [row] = await db.query(
      `INSERT INTO leads (source, external_id, campaign, campaign_id, ad_name, form_name, utm, name, phone, email, postal_code, city, address, need, details,
         commercial_id, assigned_at, duplicate_of, is_test, incomplete, received_at, stage_changed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18, $19, $20, $21, $22, $23)
       ON CONFLICT (source, external_id) DO NOTHING RETURNING *`,
      [source, externalId, text(input.campaign, 200) || null, text(input.campaignId, 60) || null, text(input.adName, 200) || null, text(input.formName, 120) || null,
        JSON.stringify(input.utm || {}), name, phone, email, text(input.postalCode, 12) || null, text(input.city, 80) || null, text(input.address, 300) || null,
        intake.cleanText(input.need, 4000) || null, JSON.stringify({ ...(input.details || {}), ...(input.raw ? { _source: input.raw } : {}) }),
        commercialId, commercialId ? now().toISOString() : null, duplicate?.id || null, input.isTest === true, input.incomplete === true, received.toISOString(), now().toISOString(), user?.id || null],
    );
    if (!row) {
      const [existing] = await db.query("SELECT id FROM leads WHERE source = $1 AND external_id = $2", [source, externalId]);
      return { id: existing.id, created: false };
    }
    const origin = [SOURCES[source], row.campaign ? `campagne « ${row.campaign} »` : null, row.form_name].filter(Boolean).join(" · ");
    await event(row.id, "created", `Lead reçu : ${origin}`, { source }, user);
    if (duplicate) await event(row.id, "duplicate", "Même téléphone ou e-mail qu'un lead précédent : doublon possible.", { leadId: duplicate.id }, user);
    if (commercialId) {
      const [seller] = await db.query("SELECT display_name FROM users WHERE id = $1", [commercialId]);
      await event(row.id, "assigned", `Attribué à ${seller.display_name}${input.commercialId ? "" : duplicate?.commercial_id === commercialId ? " (même commercial que le lead précédent)" : " (tour de rôle)"}`, { commercialId }, user);
    }
    await followUp(row.id, "new", commercialId, conf, user);
    await auth.audit({ user, action: "lead.created", entity: "lead", entityId: row.id, details: { source, campaign: row.campaign, test: row.is_test }, ip });
    return { id: row.id, created: true };
  }

  async function create(input, { user, ip }) {
    permissions.require(user, "crm.write");
    let commercialId = input.commercialId || null;
    if (!permissions.can(user, "crm.assign")) commercialId = SELLER_ROLES.includes(user.role) ? user.id : null;
    const source = ["phone", "manual", "website", "other", "meta", "google"].includes(input.source) ? input.source : "phone";
    const { id } = await receive({ ...input, source, externalId: null, commercialId, autoAssign: !commercialId }, { user, ip });
    return get(id, user);
  }

  async function event(leadId, kind, body, details = {}, user = null) {
    await db.query("INSERT INTO lead_events (lead_id, kind, body, details, user_id, at) VALUES ($1, $2, $3, $4::jsonb, $5, $6)", [leadId, kind, text(body, 2000), JSON.stringify(details), user?.id || null, now().toISOString()]);
  }

  // Relance automatique : une tâche par colonne, à l'échéance du délai réglé ; la précédente est close.
  async function followUp(leadId, stage, commercialId, conf, user) {
    await db.query("UPDATE lead_tasks SET done_at = $2 WHERE lead_id = $1 AND auto AND done_at IS NULL", [leadId, now().toISOString()]);
    if (!OPEN_STAGES.includes(stage)) return;
    const titles = { new: "Premier appel", contacted: "Planifier la visite", visit: "Envoyer le devis", quote_sent: "Relancer le devis", negotiation: "Relancer pour signature" };
    const due = new Date(now().getTime() + conf.stageDays[stage] * DAY).toISOString();
    await db.query("INSERT INTO lead_tasks (lead_id, title, due_at, assigned_to, auto, created_by) VALUES ($1, $2, $3, $4, true, $5)", [leadId, titles[stage], due, commercialId || null, user?.id || null]);
  }

  // ---------- Modifications ----------

  async function update(id, input, { user, ip }) {
    permissions.require(user, "crm.write");
    const row = await loadRow(id, user);
    const fields = { name: ["name", 160], postalCode: ["postal_code", 12], city: ["city", 80], address: ["address", 300], campaign: ["campaign", 200] };
    const sets = [];
    const params = [id];
    const changed = [];
    for (const [key, [column, max]] of Object.entries(fields)) {
      if (input[key] === undefined) continue;
      const value = text(input[key], max) || (key === "name" ? row.name : null);
      params.push(value);
      sets.push(`${column} = $${params.length}`);
      changed.push(key);
    }
    if (input.phone !== undefined) {
      params.push(intake.normalizePhone(input.phone));
      sets.push(`phone = $${params.length}`);
      changed.push("phone");
    }
    if (input.email !== undefined) {
      const email = input.email ? intake.normalizeEmail(input.email) : null;
      if (input.email && !email) throw httpError(400, "E-mail invalide.");
      params.push(email);
      sets.push(`email = $${params.length}`);
      changed.push("email");
    }
    if (input.need !== undefined) {
      params.push(intake.cleanText(input.need, 4000) || null);
      sets.push(`need = $${params.length}`);
      changed.push("need");
    }
    if (input.source !== undefined && ["phone", "manual", "other", "website"].includes(input.source) && ["phone", "manual", "other"].includes(row.source)) {
      params.push(input.source);
      sets.push(`source = $${params.length}`);
      changed.push("source");
    }
    if (!sets.length) return get(id, user);
    await db.query(`UPDATE leads SET ${sets.join(", ")}, incomplete = false, updated_at = now() WHERE id = $1`, params);
    await event(id, "update", "Fiche mise à jour", { fields: changed }, user);
    return get(id, user);
  }

  async function move(id, { stage, lostReason }, { user, ip, system = false }) {
    if (!system) permissions.require(user, "crm.write");
    const row = system ? (await db.query("SELECT * FROM leads WHERE id = $1", [id]))[0] : await loadRow(id, user);
    if (!STAGE_KEYS.includes(stage)) throw httpError(400, "Colonne inconnue.");
    if (row.stage === stage) return system ? null : get(id, user);
    const reason = text(lostReason, 200);
    if (stage === "lost" && !reason) throw httpError(400, "Indiquez le motif de perte.");
    const at = now().toISOString();
    await db.query(
      `UPDATE leads SET stage = $2, stage_changed_at = $3, lost_reason = $4, won_at = CASE WHEN $2 = 'won' THEN $3::timestamptz ELSE NULL END,
         lost_at = CASE WHEN $2 = 'lost' THEN $3::timestamptz ELSE NULL END, updated_at = now() WHERE id = $1`,
      [id, stage, at, stage === "lost" ? reason : null],
    );
    await event(id, "stage", `${STAGE_LABELS[row.stage]} → ${STAGE_LABELS[stage]}${stage === "lost" ? ` (${reason})` : ""}`, { from: row.stage, to: stage, automatic: system }, system ? null : user);
    await followUp(id, stage, row.commercial_id, await settings(), system ? null : user);
    await auth.audit({ user: system ? null : user, action: "lead.stage", entity: "lead", entityId: id, details: { from: row.stage, to: stage, reason: reason || undefined, automatic: system || undefined }, ip });
    return system ? null : get(id, user);
  }

  async function assign(id, { commercialId }, { user, ip }) {
    permissions.require(user, "crm.assign");
    const row = await loadRow(id, user);
    let name = null;
    if (commercialId) {
      const [seller] = await db.query("SELECT display_name FROM users WHERE id = $1 AND active AND role = ANY($2::text[])", [commercialId, [...SELLER_ROLES, "admin"]]);
      if (!seller) throw httpError(400, "Commercial inconnu ou inactif.");
      name = seller.display_name;
    }
    await db.query("UPDATE leads SET commercial_id = $2, assigned_at = $3, updated_at = now() WHERE id = $1", [id, commercialId || null, commercialId ? now().toISOString() : null]);
    await db.query("UPDATE lead_tasks SET assigned_to = $2 WHERE lead_id = $1 AND done_at IS NULL AND auto", [id, commercialId || null]);
    // Le dossier client suit le lead (commission du bon commercial), tant qu'aucun devis n'est signé.
    if (row.dossier_id && commercialId) {
      const [signed] = await db.query("SELECT 1 FROM quotes WHERE dossier_id = $1 AND status = 'signed'", [row.dossier_id]);
      if (!signed) await db.query("UPDATE dossiers SET commercial_id = $2, updated_at = now() WHERE id = $1", [row.dossier_id, commercialId]);
    }
    await event(id, "assigned", name ? `Attribué à ${name}` : "Retiré du commercial", { commercialId: commercialId || null }, user);
    await auth.audit({ user, action: "lead.assigned", entity: "lead", entityId: id, details: { from: row.commercial_id, to: commercialId || null }, ip });
    return get(id, user);
  }

  async function addActivity(id, { kind, body }, { user }) {
    permissions.require(user, "crm.write");
    await loadRow(id, user);
    if (!EVENT_KINDS.includes(kind)) throw httpError(400, "Type d'action inconnu.");
    const content = text(body, 2000);
    if (!content) throw httpError(400, "Décrivez l'échange.");
    await event(id, kind, content, {}, user);
    await db.query("UPDATE leads SET updated_at = now() WHERE id = $1", [id]);
    return get(id, user);
  }

  async function addTask(id, { title, dueAt, assignedTo }, { user }) {
    permissions.require(user, "crm.write");
    const row = await loadRow(id, user);
    const label = text(title, 160);
    if (!label) throw httpError(400, "Intitulé de la tâche obligatoire.");
    const due = new Date(dueAt);
    if (!dueAt || Number.isNaN(due.getTime())) throw httpError(400, "Date de rappel invalide.");
    const assignee = permissions.can(user, "crm.assign") ? assignedTo || row.commercial_id || user.id : user.id;
    await db.query("INSERT INTO lead_tasks (lead_id, title, due_at, assigned_to, created_by) VALUES ($1, $2, $3, $4, $5)", [id, label, due.toISOString(), assignee, user.id]);
    await event(id, "task", `Rappel le ${due.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} : ${label}`, {}, user);
    return get(id, user);
  }

  async function completeTask(taskId, { done = true }, { user }) {
    permissions.require(user, "crm.write");
    const [task] = await db.query("SELECT * FROM lead_tasks WHERE id = $1", [taskId]);
    if (!task) throw httpError(404, "Tâche introuvable.");
    await loadRow(task.lead_id, user);
    await db.query("UPDATE lead_tasks SET done_at = $2 WHERE id = $1", [taskId, done ? now().toISOString() : null]);
    return get(task.lead_id, user);
  }

  // Rappels du jour : tâches échues et leads restés trop longtemps dans une colonne.
  async function reminders(user) {
    requireRead(user);
    const leads = await list(user, { closedDays: 0 });
    const mine = permissions.can(user, "crm.read_all") && !SELLER_ROLES.includes(user.role) ? leads : leads.filter((lead) => !permissions.can(user, "crm.read_all") || lead.commercialId === user.id || !lead.commercialId);
    return mine.filter((lead) => lead.overdue).sort((a, b) => new Date(a.nextTask?.dueAt || a.stageChangedAt) - new Date(b.nextTask?.dueAt || b.stageChangedAt));
  }

  // ---------- Dossier client et devis ----------

  async function createDossier(id, { user, ip }) {
    if (!quotes) throw httpError(503, "Module devis indisponible.");
    permissions.require(user, "quotes.write");
    const row = await loadRow(id, user);
    if (row.dossier_id) return get(id, user);
    const address = [row.address, [row.postal_code, row.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const dossier = await quotes.saveDossier(
      { clientName: row.name, clientPhone: row.phone || "", clientEmail: row.email || "", clientAddress: address, siteAddress: "", commercialId: row.commercial_id, notes: row.need ? `Demande : ${row.need}` : "" },
      { user, ip },
    );
    await db.query("UPDATE leads SET dossier_id = $2, updated_at = now() WHERE id = $1", [id, dossier.id]);
    await event(id, "quote", "Dossier client créé pour le devis", { dossierId: dossier.id }, user);
    return get(id, user);
  }

  // Les devis font avancer le lead : envoyé → « Devis envoyé », signé → « Signé ».
  async function onQuoteEvent({ quote, kind }) {
    const leads = await db.query("SELECT id, stage FROM leads WHERE dossier_id = $1", [quote.dossierId]);
    const label = `${quote.amendmentNo ? `Avenant ${quote.amendmentNo} · devis` : "Devis"} ${quote.number} V${quote.version}`;
    for (const lead of leads) {
      const sale = quote.totals?.sale;
      const money = typeof sale === "number" ? ` (${sale.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} HT)` : "";
      await event(lead.id, "quote", `${label} ${{ sent: "envoyé", signed: "signé", refused: "refusé" }[kind]}${kind === "refused" ? "" : money}`, { quoteId: quote.id, kind });
      if (kind === "sent" && ["new", "contacted", "visit"].includes(lead.stage)) await move(lead.id, { stage: "quote_sent" }, { system: true });
      if (kind === "signed" && !quote.amendmentNo && lead.stage !== "won") await move(lead.id, { stage: "won" }, { system: true });
    }
  }

  return { STAGES, SOURCES, OPEN_STAGES, settings, saveSettings, list, get, receive, create, update, move, assign, addActivity, addTask, completeTask, reminders, createDossier, onQuoteEvent, canSee };
}

module.exports = { createCrm, STAGES, STAGE_LABELS, OPEN_STAGES, SOURCES, SELLER_ROLES };

"use strict";

// Entrée automatique des leads (module 5) : lecture des formulaires Meta Lead Ads, Google Ads
// et du site WordPress, normalisés en un même format. Aucune clé n'est écrite dans le code :
// elles viennent des variables d'environnement (voir RAILWAY.md, « Leads »).

const crypto = require("crypto");

const clean = (value, max = 300) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const cleanText = (value, max = 4000) => String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
const keyOf = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Téléphone français lisible (06 12 34 56 78) ; un numéro étranger reste tel quel.
function normalizePhone(value) {
  const raw = clean(value, 40);
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+33")) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith("0033")) digits = `0${digits.slice(4)}`;
  if (/^0\d{9}$/.test(digits)) return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  return raw;
}
const phoneKey = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
};

function normalizeEmail(value) {
  const email = clean(value, 160).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// Noms de champs reconnus (Meta, Google, Contact Form 7, WPForms, Elementor, Gravity Forms…).
const FIELD_ALIASES = {
  name: ["full_name", "name", "nom", "nom_complet", "fullname", "your_name", "nom_prenom", "prenom_nom", "contact_name"],
  firstName: ["first_name", "prenom", "firstname", "your_first_name"],
  lastName: ["last_name", "nom_de_famille", "lastname", "your_last_name", "surname"],
  phone: ["phone_number", "phone", "telephone", "tel", "your_phone", "mobile", "portable", "numero", "numero_de_telephone"],
  email: ["email", "e_mail", "mail", "your_email", "courriel", "adresse_email", "adresse_e_mail"],
  postalCode: ["zip_code", "postal_code", "code_postal", "cp", "zip", "postcode"],
  city: ["city", "ville", "commune"],
  address: ["street_address", "address", "adresse", "adresse_postale", "adresse_du_chantier"],
  need: ["message", "besoin", "projet", "your_message", "description", "demande", "comments", "commentaire", "travaux", "votre_projet", "type_de_travaux"],
};
const ALIAS_INDEX = new Map(Object.entries(FIELD_ALIASES).flatMap(([field, names]) => names.map((name) => [name, field])));
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid", "page_url", "source_page", "referer", "referrer"];

// Transforme une liste [nom, valeur] en champs Nova+ ; le reste est conservé dans « details ».
function mapFields(pairs) {
  const out = { details: {}, utm: {} };
  for (const [rawName, rawValue] of pairs) {
    const value = Array.isArray(rawValue) ? rawValue.filter((v) => v !== null && v !== undefined && v !== "").join(", ") : rawValue;
    if (value === null || value === undefined || value === "" || typeof value === "object") continue;
    const key = keyOf(rawName);
    if (UTM_KEYS.includes(key)) {
      out.utm[key] = clean(value, 300);
      continue;
    }
    const field = ALIAS_INDEX.get(key);
    if (field && !out[field]) out[field] = field === "need" ? cleanText(value, 4000) : clean(value, 300);
    else if (Object.keys(out.details).length < 40) out.details[clean(rawName, 80)] = clean(value, 500);
  }
  if (!out.name) out.name = clean([out.firstName, out.lastName].filter(Boolean).join(" "), 160);
  delete out.firstName;
  delete out.lastName;
  return out;
}

// ---------- Meta Lead Ads ----------

// Vérification de l'abonnement au webhook (GET avec hub.challenge).
function metaChallenge(searchParams, verifyToken) {
  if (searchParams.get("hub.mode") !== "subscribe" || !verifyToken) return null;
  return safeEqual(searchParams.get("hub.verify_token"), verifyToken) ? searchParams.get("hub.challenge") : null;
}

// Signature X-Hub-Signature-256 = HMAC-SHA256 du corps brut avec la clé secrète de l'application.
function metaSignatureValid(rawBody, header, appSecret) {
  if (!appSecret || !header) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return safeEqual(header, expected);
}

function metaNotifications(body) {
  const out = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== "leadgen" || !change.value?.leadgen_id) continue;
      out.push({ leadgenId: String(change.value.leadgen_id), formId: change.value.form_id ? String(change.value.form_id) : null, adId: change.value.ad_id ? String(change.value.ad_id) : null, pageId: change.value.page_id ? String(change.value.page_id) : null, createdTime: change.value.created_time || null });
    }
  }
  return out;
}

const META_FIELDS = "created_time,field_data,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,platform,is_organic";

// Lecture du lead complet dans l'API Graph (le webhook ne transmet que son identifiant).
async function fetchMetaLead(leadgenId, { token, version = "v23.0", fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  if (!token) throw new Error("META_PAGE_ACCESS_TOKEN manquant");
  const url = `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(leadgenId)}?fields=${META_FIELDS}&access_token=${encodeURIComponent(token)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `API Meta : erreur ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function metaLeadInput(notification, data = null) {
  const mapped = data ? mapFields((data.field_data || []).map((field) => [field.name, field.values])) : { details: {}, utm: {} };
  const platform = data?.platform ? (data.platform === "ig" ? "Instagram" : data.platform === "fb" ? "Facebook" : data.platform) : null;
  return {
    ...mapped,
    source: "meta",
    externalId: notification.leadgenId,
    campaign: clean(data?.campaign_name, 200) || null,
    campaignId: clean(data?.campaign_id, 60) || null,
    adName: clean([data?.adset_name, data?.ad_name].filter(Boolean).join(" · "), 200) || null,
    formName: notification.formId ? `Formulaire ${notification.formId}` : null,
    details: { ...mapped.details, ...(platform ? { Plateforme: platform } : {}), ...(data?.is_organic ? { Organique: "oui" } : {}) },
    receivedAt: data?.created_time || (notification.createdTime ? new Date(Number(notification.createdTime) * 1000).toISOString() : null),
    incomplete: !data,
    raw: { notification, ...(data ? { leadgen: { id: data.id, form_id: data.form_id, ad_id: data.ad_id, campaign_id: data.campaign_id } } : {}) },
  };
}

// ---------- Google Ads (formulaires de lead, webhook) ----------

const GOOGLE_COLUMNS = { FULL_NAME: "full_name", FIRST_NAME: "first_name", LAST_NAME: "last_name", EMAIL: "email", PHONE_NUMBER: "phone", POSTAL_CODE: "postal_code", CITY: "city", STREET_ADDRESS: "street_address" };

function googleLeadInput(body) {
  const columns = Array.isArray(body?.user_column_data) ? body.user_column_data : [];
  const mapped = mapFields(columns.map((column) => [GOOGLE_COLUMNS[column.column_id] || column.column_name || column.column_id, column.string_value]));
  return {
    ...mapped,
    source: "google",
    externalId: clean(body?.lead_id, 120) || null,
    campaign: body?.campaign_name ? clean(body.campaign_name, 200) : body?.campaign_id ? `Campagne ${clean(body.campaign_id, 40)}` : null,
    campaignId: body?.campaign_id ? clean(body.campaign_id, 60) : null,
    adName: body?.adgroup_id ? `Groupe ${clean(body.adgroup_id, 40)}` : null,
    formName: body?.form_id ? `Formulaire ${clean(body.form_id, 40)}` : null,
    utm: { ...mapped.utm, ...(body?.gcl_id ? { gclid: clean(body.gcl_id, 300) } : {}) },
    isTest: body?.is_test === true,
    raw: { lead_id: body?.lead_id, form_id: body?.form_id, campaign_id: body?.campaign_id, adgroup_id: body?.adgroup_id, creative_id: body?.creative_id, api_version: body?.api_version },
  };
}

// ---------- Site internet (WordPress : Contact Form 7, WPForms, Elementor, Gravity Forms…) ----------

function flattenForm(body) {
  const pairs = [];
  const visit = (value, name) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      if (value.every((v) => typeof v !== "object")) pairs.push([name, value]);
      else value.forEach((item, index) => visit(item, item?.name || item?.label || item?.id || `${name}_${index}`));
    } else if (typeof value === "object") {
      if ("value" in value && typeof value.value !== "object") pairs.push([value.name || value.label || value.id || name, value.value]);
      else Object.entries(value).forEach(([key, inner]) => visit(inner, typeof inner === "object" && inner && (inner.name || inner.label) ? inner.name || inner.label : key));
    } else pairs.push([name, value]);
  };
  Object.entries(body || {}).forEach(([key, value]) => {
    if (["key", "nova_key", "_wpcf7", "_wpcf7_version", "_wpcf7_locale", "_wpcf7_unit_tag", "_wpnonce", "g-recaptcha-response"].includes(key)) return;
    visit(value, key);
  });
  return pairs;
}

function websiteLeadInput(body) {
  const mapped = mapFields(flattenForm(body));
  const form = clean(body?.form_name || body?.form || body?.form_title, 120);
  return {
    ...mapped,
    source: "website",
    externalId: clean(body?.entry_id || body?.submission_id, 120) || null,
    campaign: clean(mapped.utm.utm_campaign || body?.campaign, 200) || null,
    formName: form || null,
    raw: { form: form || null },
  };
}

function parseFormBody(raw, contentType = "") {
  const text = raw.toString("utf8");
  if (String(contentType).includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(text);
    const out = {};
    for (const [key, value] of params) out[key] = key in out ? [].concat(out[key], value) : value;
    return out;
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    const error = new Error("Données invalides.");
    error.status = 400;
    throw error;
  }
}

module.exports = {
  clean, cleanText, safeEqual, normalizePhone, normalizeEmail, phoneKey, mapFields,
  metaChallenge, metaSignatureValid, metaNotifications, fetchMetaLead, metaLeadInput,
  googleLeadInput, websiteLeadInput, parseFormBody,
};

"use strict";

(() => {
  // Libellés des rôles fournis par le serveur (source unique : lib/auth.js).
  let ROLES = {};
  const roleLabel = (role) => ROLES[role]?.label || role;
  const ACTION_LABELS = {
    "dossier.create": "Dossier client créé",
    "dossier.update": "Dossier client modifié",
    "library.import": "Bibliothèque importée",
    "library.item_create": "Ouvrage créé",
    "library.item_update": "Ouvrage modifié",
    "library.lot_create": "Lot créé",
    "library.lot_update": "Lot modifié",
    "st.create": "Sous-traitant créé",
    "st.update": "Sous-traitant modifié",
    "st.document_add": "Document ST ajouté",
    "st.document_remove": "Document ST retiré",
    "grid.create": "Grille ST créée",
    "grid.update": "Grille ST modifiée",
    "grid.sent": "Grille ST envoyée",
    "grid.signed": "Grille ST signée",
    "grid.new_version": "Nouvelle version de grille",
    "quote.create": "Devis créé",
    "quote.new_version": "Nouvelle version de devis",
    "quote.amendment_create": "Avenant créé",
    "quote.sent": "Devis envoyé",
    "quote.refused": "Devis refusé",
    "quote.signed": "Devis signé",
    "quote.forced": "Signature forcée (alerte bloquante)",
    "quote.line_forced": "Ligne forcée sans prix ST",
    "quote.numbering": "Numérotation des devis réglée",
    "orders.created": "Bons de commande ST créés",
    "orders.unblocked": "Bon de commande débloqué",
    "chantier.created_from_quote": "Chantier créé depuis un devis",
    "chantier.amendment_added": "Avenant ajouté au chantier",
    "lead.created": "Lead reçu",
    "lead.stage": "Lead changé d'étape",
    "lead.assigned": "Lead attribué",
    "crm.settings": "Réglages du CRM modifiés",
    "goals.fixed_cost_create": "Frais fixe ajouté",
    "goals.fixed_cost_update": "Frais fixe modifié",
    "goals.fixed_cost_delete": "Frais fixe supprimé",
    "goals.profit_target": "Bénéfice visé modifié",
    "goals.objectives": "Objectifs commerciaux modifiés",
    "goals.tier": "Palier de prime enregistré",
    "goals.tier_delete": "Palier de prime supprimé",
    "reception.create": "PV de réception créé",
    "reception.signed": "PV de réception signé",
    "auth.login.success": "Connexion",
    "auth.login.failure": "Échec de connexion",
    "auth.login.blocked": "Connexion bloquée (compte verrouillé)",
    "auth.lockout": "Compte verrouillé",
    "auth.logout": "Déconnexion",
    "auth.password.ok": "Mot de passe validé, 2FA en attente",
    "auth.password.changed": "Mot de passe changé",
    "auth.2fa.enabled": "Double authentification activée",
    "auth.2fa.failure": "Code 2FA incorrect",
    "user.create": "Compte créé",
    "user.update": "Compte modifié",
    "user.reset_password": "Mot de passe réinitialisé",
    "user.reset_2fa": "2FA réinitialisée",
    "user.unlock": "Compte déverrouillé",
    "user.bootstrap_admin": "Administrateur initial créé",
    "company.update": "Profil entreprise modifié",
    "company.bootstrap": "Profil entreprise initialisé",
    "company.logo_updated": "Logo de l'entreprise changé",
    "company.logo_removed": "Logo de l'entreprise retiré",
    "state.json_import": "Reprise de state.json",
    "state.projects_changed": "Chantiers ajoutés ou supprimés",
    "state.conflict": "Conflit d'enregistrement refusé",
    "state.mass_delete_blocked": "Suppression massive bloquée",
    "state.restore_version": "Version restaurée",
    "state.restored": "Version restaurée",
    "backup.create": "Sauvegarde créée",
    "backup.download": "Sauvegarde téléchargée",
    "backup.restore_test": "Test de restauration",
    "backup.restore": "Restauration complète",
    "file.upload": "Pièce jointe ajoutée",
    "files.check": "Vérification des pièces jointes",
  };
  const dateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });
  const $ = (selector) => document.querySelector(selector);
  let me = null;
  let latestBackup = null;

  // ---------- Utilitaires ----------

  async function api(url, { method = "GET", body } = {}) {
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (response.status === 401) {
      window.location.replace("/login.html");
      throw new Error("Session expirée.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Erreur ${response.status}`);
    return payload;
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    });
    (Array.isArray(children) ? children : [children]).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  const formatDate = (value) => (value ? dateTime.format(new Date(value)) : "—");
  const formatBytes = (bytes) => {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} o`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
    return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
  };
  const initials = (name) =>
    String(name || "?")
      .split(/\s+/)
      .filter((part) => /\p{L}/u.test(part))
      .slice(0, 2)
      .map((part) => part.match(/\p{L}/u)[0].toUpperCase())
      .join("") || "?";

  function feedback(node, message, tone = "ok") {
    node.textContent = message || "";
    node.className = `feedback ${message ? tone : ""}`;
  }

  async function withBusy(button, work) {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Patientez…";
    try {
      return await work();
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  function showSecret({ title, intro, value }) {
    $("#secretTitle").textContent = title;
    $("#secretIntro").textContent = intro;
    $("#secretValue").textContent = value;
    $("#secretDialog").showModal();
  }

  $("#secretCopy").addEventListener("click", async (event) => {
    try {
      await navigator.clipboard.writeText($("#secretValue").textContent);
      event.target.textContent = "Copié ✓";
    } catch {
      event.target.textContent = "Sélectionnez et copiez";
    }
    setTimeout(() => (event.target.textContent = "Copier"), 1800);
  });

  // ---------- Onglets ----------

  function selectTab(name) {
    document.querySelectorAll("[data-tab]").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.tab === name)));
    document.querySelectorAll("[data-panel]").forEach((panel) => (panel.hidden = panel.dataset.panel !== name));
    $("#pageTitle").textContent = { account: "Mon compte", company: "Entreprise", team: "Équipe", data: "Sécurité des données", audit: "Journal" }[name];
    if (window.location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
    const loaders = { company: loadCompany, team: loadUsers, data: loadData, audit: loadAudit };
    if (loaders[name]) loaders[name]().catch(showError);
  }
  document.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => selectTab(tab.dataset.tab)));

  function showError(error) {
    const panel = document.querySelector("[data-panel]:not([hidden])") || document.querySelector(".page");
    panel.querySelector(".load-error")?.remove();
    panel.prepend(el("p", { class: "alert bad load-error", text: `Chargement impossible : ${error.message}` }));
  }

  // ---------- Mon compte ----------

  function renderMe() {
    $("#whoAvatar").textContent = initials(me.displayName);
    $("#whoName").textContent = me.displayName;
    $("#whoRole").textContent = me.roleLabel || me.role;
    $("#meName").textContent = me.displayName;
    $("#meEmail").textContent = me.email;
    $("#meRole").textContent = me.roleLabel || me.role;
    $("#meMfa").replaceChildren(
      me.mfaEnabled ? el("span", { class: "badge ok", text: "Activée" }) : el("span", { class: "badge", text: me.mfaRequired ? "À activer" : "Non requise pour ce rôle" }),
    );
  }

  $("#passwordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const out = form.querySelector(".feedback");
    if (form.elements.newPassword.value !== form.elements.confirmPassword.value) return feedback(out, "Les deux mots de passe ne correspondent pas.", "error");
    await withBusy(form.querySelector("button[type=submit]"), async () => {
      try {
        await api("/api/auth/password", { method: "POST", body: { currentPassword: form.elements.currentPassword.value, newPassword: form.elements.newPassword.value } });
        form.reset();
        feedback(out, "Mot de passe changé. Vos autres sessions ont été fermées.");
      } catch (error) {
        feedback(out, error.message, "error");
      }
    });
  });

  $("#logout").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
    window.location.replace("/login.html");
  });

  // ---------- Équipe ----------

  async function loadUsers() {
    const { users, roles } = await api("/api/admin/users");
    ROLES = roles;
    renderRoleChoices();
    $("#usersBody").replaceChildren(...users.map(userRow));
  }

  function userRow(user) {
    const isMe = user.id === me.id;
    const role = el(
      "select",
      { "aria-label": `Rôle de ${user.displayName}`, disabled: isMe, onchange: (event) => patchUser(user, { role: event.target.value }, event.target) },
      Object.entries(ROLES).map(([value, role]) => el("option", { value, text: role.label, selected: value === user.role })),
    );
    const rate = el("input", {
      class: "rate",
      inputmode: "decimal",
      value: user.commissionRate ?? "",
      placeholder: "—",
      "aria-label": `Commission de ${user.displayName} en %`,
      onchange: (event) => patchUser(user, { commissionRate: event.target.value }, event.target),
    });
    const locked = user.lockedUntil && new Date(user.lockedUntil) > new Date();
    const security = el("div", { class: "row-actions", style: "justify-content:flex-start" }, [
      !user.active ? el("span", { class: "badge bad", text: "Désactivé" }) : null,
      locked ? el("span", { class: "badge bad", text: "Verrouillé" }) : null,
      user.mfaRequired ? el("span", { class: `badge ${user.mfaEnabled ? "ok" : "warn"}`, text: user.mfaEnabled ? "2FA active" : "2FA à configurer" }) : el("span", { class: "badge", text: "Mot de passe" }),
      user.mustChangePassword ? el("span", { class: "badge warn", text: "Mot de passe temporaire" }) : null,
    ]);
    const actions = el("div", { class: "row-actions" }, [
      locked ? el("button", { type: "button", class: "secondary mini", text: "Déverrouiller", onclick: () => userAction(user, "unlock") }) : null,
      el("button", {
        type: "button",
        class: "secondary mini",
        text: "Nouveau mot de passe",
        onclick: async () => {
          if (!confirm(`Générer un nouveau mot de passe temporaire pour ${user.displayName} ? Ses sessions seront fermées.`)) return;
          const { temporaryPassword } = await api(`/api/admin/users/${user.id}/reset-password`, { method: "POST", body: {} });
          showSecret({ title: "Nouveau mot de passe temporaire", intro: `Pour ${user.displayName} (${user.email}).`, value: temporaryPassword });
          loadUsers();
        },
      }),
      user.mfaEnabled
        ? el("button", {
            type: "button",
            class: "secondary mini",
            text: "Réinitialiser la 2FA",
            onclick: () => confirm(`Réinitialiser la double authentification de ${user.displayName} (téléphone perdu ou changé) ? Elle sera reconfigurée à sa prochaine connexion.`) && userAction(user, "reset-2fa"),
          })
        : null,
      isMe
        ? null
        : el("button", {
            type: "button",
            class: "secondary mini",
            text: user.active ? "Désactiver" : "Réactiver",
            onclick: () => (user.active ? confirm(`Désactiver le compte de ${user.displayName} ? Il sera déconnecté immédiatement.`) : true) && patchUser(user, { active: !user.active }),
          }),
    ]);
    return el("tr", { class: user.active ? "" : "inactive" }, [
      el("td", {}, [el("strong", { text: user.displayName }), el("span", { class: "sub", text: user.email }), isMe ? el("span", { class: "sub", text: "Vous" }) : null]),
      el("td", {}, role),
      el("td", {}, rate),
      el("td", {}, security),
      el("td", { class: "nowrap", text: formatDate(user.lastLoginAt) }),
      el("td", {}, actions),
    ]);
  }

  async function patchUser(user, changes, control) {
    try {
      await api(`/api/admin/users/${user.id}`, { method: "PATCH", body: changes });
    } catch (error) {
      alert(error.message);
    }
    if (control) control.blur();
    loadUsers();
  }

  async function userAction(user, action) {
    try {
      await api(`/api/admin/users/${user.id}/${action}`, { method: "POST", body: {} });
    } catch (error) {
      alert(error.message);
    }
    loadUsers();
  }

  $("#createUserForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const out = form.querySelector(".feedback");
    feedback(out, "");
    await withBusy(form.querySelector("button[type=submit]"), async () => {
      try {
        const body = Object.fromEntries(new FormData(form));
        const { user, temporaryPassword } = await api("/api/admin/users", { method: "POST", body });
        form.reset();
        showSecret({ title: "Compte créé", intro: `${user.displayName} se connecte avec ${user.email} et ce mot de passe temporaire.`, value: temporaryPassword });
        loadUsers();
      } catch (error) {
        feedback(out, error.message, "error");
      }
    });
  });

  function renderRoleChoices() {
    const select = $("#createRole");
    const current = select.value || "commercial";
    select.replaceChildren(...Object.entries(ROLES).map(([value, role]) => el("option", { value, text: `${role.label}${role.mfa ? " · 2FA" : ""}`, selected: value === current })));
    const hint = () => ($("#createRoleHint").textContent = ROLES[select.value]?.description || "");
    select.onchange = hint;
    hint();
  }

  // ---------- Entreprise ----------

  let company = null;

  const getPath = (object, dotted) => dotted.split(".").reduce((value, key) => (value == null ? undefined : value[key]), object);
  function setPath(object, dotted, value) {
    const keys = dotted.split(".");
    let cursor = object;
    keys.slice(0, -1).forEach((key) => (cursor = cursor[key] ??= {}));
    cursor[keys[keys.length - 1]] = value;
  }
  const parseRates = (value) =>
    String(value || "")
      .split(/[;\s/]+/)
      .filter(Boolean)
      .map((part) => Number(part.replace(",", ".").replace("%", "")))
      .filter((rate) => Number.isFinite(rate) && rate >= 0);
  const formatPercent = (value) => String(value).replace(".", ",");

  async function loadCompany() {
    const payload = await api("/api/company");
    company = payload.company;
    fillCompany(payload);
  }

  function fillCompany({ company: profile, missing }) {
    const form = $("#companyForm");
    form.querySelectorAll("input[name], select[name], textarea[name]").forEach((input) => {
      if (input.name === "vatRatesText" || input.name === "billing.defaultVatRate") return;
      const value = getPath(profile, input.name);
      if (input.type === "checkbox") input.checked = Boolean(value);
      else input.value = value ?? "";
    });
    form.elements.vatRatesText.value = profile.billing.vatRates.map(formatPercent).join(" ; ");
    renderDefaultVat(profile.billing.vatRates, profile.billing.defaultVatRate);
    renderSchedule(profile.billing.invoiceSchedule);
    toggleRge();
    renderLogo(profile.logoKey);
    renderMissing(missing);
  }

  function renderMissing(missing) {
    $("#companyMissing").replaceChildren(
      ...(missing.length
        ? [el("p", { class: "alert" }, [el("strong", { text: "Profil incomplet. " }), `Pour éditer des devis et factures conformes, complétez : ${missing.join(", ")}.`])]
        : [el("p", { class: "badge ok", text: "Profil complet : mentions légales prêtes pour les devis et factures." })]),
    );
  }

  function renderDefaultVat(rates, selected) {
    const select = $("#companyForm").elements["billing.defaultVatRate"];
    const list = rates.length ? rates : [20];
    const keep = list.includes(Number(selected)) ? Number(selected) : list[0];
    select.replaceChildren(...list.map((rate) => el("option", { value: rate, text: `${formatPercent(rate)} %`, selected: rate === keep })));
  }

  function renderSchedule(steps) {
    const rows = steps.map((step) =>
      el("div", { class: "schedule-row" }, [
        el("input", { "data-step-label": true, value: step.label, maxlength: "60", "aria-label": "Nom de l'échéance", oninput: updateScheduleTotal }),
        el("span", { class: "percent" }, el("input", { "data-step-percent": true, inputmode: "decimal", value: formatPercent(step.percent), "aria-label": "Pourcentage", oninput: updateScheduleTotal })),
        el("button", {
          type: "button",
          "aria-label": "Retirer cette échéance",
          text: "×",
          onclick: (event) => {
            if ($("#scheduleRows").children.length <= 1) return;
            event.currentTarget.closest(".schedule-row").remove();
            updateScheduleTotal();
          },
        }),
      ]),
    );
    $("#scheduleRows").replaceChildren(...rows);
    updateScheduleTotal();
  }

  function readSchedule() {
    return [...$("#scheduleRows").children].map((row) => ({
      label: row.querySelector("[data-step-label]").value,
      percent: Number(row.querySelector("[data-step-percent]").value.replace(",", ".")),
    }));
  }

  function updateScheduleTotal() {
    const total = Math.round(readSchedule().reduce((sum, step) => sum + (Number.isFinite(step.percent) ? step.percent : 0), 0) * 100) / 100;
    const badge = $("#scheduleTotal");
    badge.textContent = `Total ${formatPercent(total)} %`;
    badge.className = `badge ${total === 100 ? "ok" : "bad"}`;
  }

  $("#scheduleAdd").addEventListener("click", () => {
    const steps = readSchedule();
    renderSchedule([...steps, { label: `Échéance ${steps.length + 1}`, percent: 0 }]);
    $("#scheduleRows").lastElementChild.querySelector("input").focus();
  });

  function toggleRge() {
    const form = $("#companyForm");
    form.querySelector("[data-rge-fields]").hidden = !form.elements["rge.certified"].checked;
  }
  $("#companyForm").elements["rge.certified"].addEventListener("change", toggleRge);
  $("#companyForm").elements.vatRatesText.addEventListener("change", (event) => {
    renderDefaultVat([...new Set(parseRates(event.target.value))].sort((a, b) => b - a), $("#companyForm").elements["billing.defaultVatRate"].value);
  });

  function renderLogo(logoKey) {
    const preview = $("#logoPreview");
    $("#logoRemove").hidden = !logoKey;
    preview.replaceChildren(logoKey ? el("img", { src: `/api/public/logo?v=${encodeURIComponent(logoKey)}`, alt: "Logo de l'entreprise" }) : document.createTextNode("Aucun logo"));
  }

  $("#logoInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    const out = $("#companyForm .feedback");
    if (file.size > 2 * 1024 * 1024) return feedback(out, "Logo trop lourd (2 Mo maximum).", "error");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    try {
      const payload = await api("/api/admin/company/logo", { method: "POST", body: { dataUrl } });
      company = payload.company;
      renderLogo(company.logoKey);
      feedback(out, "Logo enregistré.");
    } catch (error) {
      feedback(out, error.message, "error");
    }
  });

  $("#logoRemove").addEventListener("click", async () => {
    if (!confirm("Retirer le logo de l'entreprise ?")) return;
    const payload = await api("/api/admin/company/logo", { method: "POST", body: { remove: true } });
    company = payload.company;
    renderLogo(null);
  });

  $("#companyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const out = form.querySelector(".feedback");
    const body = {};
    form.querySelectorAll("input[name], select[name], textarea[name]").forEach((input) => {
      if (input.name === "vatRatesText") return;
      setPath(body, input.name, input.type === "checkbox" ? input.checked : input.value);
    });
    body.billing.vatRates = parseRates(form.elements.vatRatesText.value);
    body.billing.defaultVatRate = Number(form.elements["billing.defaultVatRate"].value);
    body.billing.invoiceSchedule = readSchedule();
    await withBusy(form.querySelector("button[type=submit]"), async () => {
      try {
        const payload = await api("/api/admin/company", { method: "PUT", body });
        company = payload.company;
        fillCompany(payload);
        feedback(out, "Profil enregistré.");
      } catch (error) {
        feedback(out, error.message, "error");
      }
    });
  });

  // ---------- Sécurité des données ----------

  async function loadData() {
    const [status, backups, history] = await Promise.all([api("/api/admin/status"), api("/api/admin/backups"), api("/api/admin/state/history?limit=60")]);
    latestBackup = backups.backups[0] || null;
    const test = backups.lastRestoreTest;
    const stat = (label, value, hint, tone = "") => el("div", { class: `stat ${tone}` }, [el("span", { text: label }), el("strong", { text: value }), hint ? el("small", { text: hint }) : null]);
    $("#statusCards").replaceChildren(
      stat("État du stockage", status.health.ok ? "Sain" : "Problème", status.health.ok ? status.database === "postgres" ? "Base PostgreSQL" : "PostgreSQL embarqué (poste de développement)" : status.health.storage !== "ok" ? status.health.storage : status.health.volume, status.health.ok ? "ok" : "bad"),
      stat("Chantiers", String(status.state.projects), `${status.state.activeProjects} actifs · version ${status.state.version}`),
      stat("Pièces jointes", String(status.files), `${status.state.documents} documents liés aux chantiers`),
      stat("Dernière sauvegarde", status.lastBackup ? formatDate(status.lastBackup.createdAt) : "Aucune", status.lastBackup ? formatBytes(status.lastBackup.bytes) : "La première est créée automatiquement", status.lastBackup ? "" : "bad"),
      stat("Test de restauration", test ? (test.ok ? "Réussi" : "Échec") : "Jamais fait", test ? formatDate(test.testedAt) : "À lancer au moins une fois par mois", test ? (test.ok ? "ok" : "bad") : ""),
    );
    $("#warnings").replaceChildren(
      ...status.warnings.map((warning) => el("p", { class: "alert", text: warning })),
      ...(status.companyMissing.length ? [el("p", { class: "alert", text: `Profil entreprise incomplet (onglet Entreprise) : ${status.companyMissing.join(", ")}.` })] : []),
    );

    $("#backupList").replaceChildren(
      ...(backups.backups.length
        ? backups.backups.slice(0, 12).map((backup) =>
            el("li", {}, [
              el("span", { class: "name" }, [formatDate(backup.createdAt), el("small", { text: `${{ auto: "Automatique", manuel: "Manuelle", avant: "Avant restauration" }[backup.kind] || backup.kind} · ${formatBytes(backup.bytes)}` })]),
              el("span", { class: "row-actions" }, [
                el("button", { type: "button", class: "secondary mini", text: "Tester", onclick: (event) => runRestoreTest(backup.name, event.currentTarget) }),
                el("a", { class: "secondary mini", href: `/api/admin/backups/${encodeURIComponent(backup.name)}`, text: "Télécharger" }),
              ]),
            ]),
          )
        : [el("li", {}, el("span", { class: "muted", text: "Aucune sauvegarde pour l'instant." }))]),
    );

    $("#historyBody").replaceChildren(
      ...history.versions.map((version, index) =>
        el("tr", {}, [
          el("td", { class: "num" }, el("strong", { text: `v${version.version}` })),
          el("td", { class: "nowrap", text: formatDate(version.saved_at) }),
          el("td", { text: version.saved_by || "—" }),
          el("td", { class: "num", text: String(version.projects_count) }),
          el("td", { class: "num", text: formatBytes(version.size_bytes) }),
          el("td", { text: { save: "Enregistrement", json_import: "Reprise state.json", restore_version: "Restauration", restore_backup: "Sauvegarde" }[version.source] || version.source }),
          el(
            "td",
            {},
            index === 0
              ? el("span", { class: "badge ok", text: "Actuelle" })
              : el("button", {
                  type: "button",
                  class: "secondary mini",
                  text: "Restaurer",
                  onclick: async (event) => {
                    if (!confirm(`Revenir aux données de la version ${version.version} (${formatDate(version.saved_at)}, ${version.projects_count} chantiers) ? La version actuelle reste dans l'historique. Les autres postes devront recharger Nova+.`)) return;
                    await withBusy(event.currentTarget, async () => {
                      try {
                        const result = await api(`/api/admin/state/history/${version.id}/restore`, { method: "POST", body: {} });
                        alert(`Données restaurées : nouvelle version v${result.version}.`);
                        loadData();
                      } catch (error) {
                        alert(error.message);
                      }
                    });
                  },
                }),
          ),
        ]),
      ),
    );
  }

  async function runRestoreTest(name, button) {
    const out = $("#backupFeedback");
    await withBusy(button, async () => {
      try {
        const report = await api(`/api/admin/backups/${encodeURIComponent(name)}/restore-test`, { method: "POST", body: {} });
        const tables = Object.values(report.tables).reduce((sum, t) => sum + t.restored, 0);
        feedback(
          out,
          report.ok
            ? `Restauration testée avec succès : ${tables} enregistrements relus, données identiques, ${report.uploads.present}/${report.uploads.total} pièces jointes présentes. Rien n'a été modifié.`
            : `Test en échec : ${report.state.hashMatch ? "" : "données différentes. "}${report.uploads.missing.length ? `${report.uploads.missing.length} pièce(s) jointe(s) absente(s) du disque.` : ""}`,
          report.ok ? "ok" : "error",
        );
        loadData();
      } catch (error) {
        feedback(out, error.message, "error");
      }
    });
  }

  $("#backupNow").addEventListener("click", (event) =>
    withBusy(event.currentTarget, async () => {
      try {
        const created = await api("/api/admin/backups", { method: "POST", body: {} });
        feedback($("#backupFeedback"), `Sauvegarde créée (${formatBytes(created.bytes)}).${created.missingUploads ? ` Attention : ${created.missingUploads} pièce(s) jointe(s) absente(s) du disque.` : ""}`, created.missingUploads ? "error" : "ok");
        loadData();
      } catch (error) {
        feedback($("#backupFeedback"), error.message, "error");
      }
    }),
  );

  $("#restoreTestLatest").addEventListener("click", (event) => {
    if (!latestBackup) return feedback($("#backupFeedback"), "Créez d'abord une sauvegarde.", "error");
    runRestoreTest(latestBackup.name, event.currentTarget);
  });

  $("#filesCheck").addEventListener("click", (event) =>
    withBusy(event.currentTarget, async () => {
      const target = $("#filesReport");
      try {
        const report = await api("/api/admin/files/check");
        const items = [];
        if (report.missing.length) items.push(el("p", { class: "alert bad", text: `${report.missing.length} pièce(s) jointe(s) enregistrée(s) mais absente(s) du disque.` }), el("ul", {}, report.missing.slice(0, 30).map((f) => el("li", { text: f.name }))));
        if (report.brokenLinks.length) items.push(el("p", { class: "alert bad", text: `${report.brokenLinks.length} lien(s) de document sans fichier.` }), el("ul", {}, report.brokenLinks.slice(0, 30).map((f) => el("li", { text: `${f.where} · ${f.key.replace(/^\d+-[0-9a-f-]{36}-/, "")}` }))));
        if (report.sizeMismatch.length) items.push(el("p", { class: "alert bad", text: `${report.sizeMismatch.length} fichier(s) de taille inattendue (endommagés ?).` }));
        if (report.embeddedInData) items.push(el("p", { class: "alert", text: `${report.embeddedInData} fichier(s) stocké(s) dans les données plutôt que sur le disque (envoi serveur échoué à l'époque). Ils restent lisibles.` }));
        if (report.ok) items.unshift(el("p", { class: "badge ok", text: `${report.knownFiles} fichiers présents · ${report.referencedInData} liens vérifiés` }));
        target.replaceChildren(...items);
      } catch (error) {
        target.replaceChildren(el("p", { class: "alert bad", text: error.message }));
      }
    }),
  );

  // ---------- Journal ----------

  async function loadAudit() {
    const filter = $("#auditFilter").value;
    const { entries } = await api(`/api/admin/audit?limit=300${filter ? `&action=${encodeURIComponent(filter)}` : ""}`);
    $("#auditBody").replaceChildren(
      ...entries.map((entry) => {
        const details = { ...entry.details };
        const tone = /failure|lockout|blocked|conflict|mass_delete/.test(entry.action) ? "bad" : /restore|reset|backup\.restore$/.test(entry.action) ? "warn" : "";
        return el("tr", {}, [
          el("td", { class: "nowrap", text: formatDate(entry.at) }),
          el("td", { text: entry.user_label ? entry.user_label.replace(/\s<.*>$/, "") : details.email || "—" }),
          el("td", {}, el("span", { class: `badge ${tone}`, text: ACTION_LABELS[entry.action] || entry.action })),
          el("td", { class: "detail", text: Object.keys(details).length ? JSON.stringify(details) : "" }),
          el("td", { class: "nowrap muted", text: entry.ip || "" }),
        ]);
      }),
    );
  }
  $("#auditFilter").addEventListener("change", () => loadAudit().catch(showError));

  // ---------- Démarrage ----------

  (async () => {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    const payload = response.ok ? await response.json() : {};
    if (!payload.user || payload.mfaPending || payload.mustChangePassword) return window.location.replace("/login.html");
    me = payload.user;
    renderMe();
    const isAdmin = me.role === "admin";
    document.querySelectorAll("[data-admin]").forEach((node) => (node.hidden = !isAdmin));
    const wanted = window.location.hash.slice(1);
    selectTab(isAdmin && ["company", "team", "data", "audit"].includes(wanted) ? wanted : "account");
  })().catch((error) => {
    document.querySelector(".page").prepend(el("p", { class: "alert bad", text: error.message }));
  });
})();

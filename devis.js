"use strict";

// Module Devis et marges — socle de l'écran : utilitaires, dialogues, signature, routeur,
// dossiers clients, PV de réception et rapport des exceptions.
// L'éditeur de devis (devis-quote.js) et le catalogue (devis-catalog.js) s'y branchent.

window.ND = (() => {
  const P = window.NovaPricing;
  const $ = (selector, root = document) => root.querySelector(selector);
  const view = $("#view");
  const views = {};
  let ctx = null;
  let leaveHook = null;

  // ---------- Utilitaires ----------

  // replaceChildren sans les sections absentes (null / false).
  const fill = (node, ...children) => node.replaceChildren(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));

  const can = (grant) => Boolean(ctx?.grants.includes(grant));
  const moneyFormat = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
  const money = (value) => (value === null || value === undefined ? "—" : moneyFormat.format(Number(value)));
  const pct = (value) => (value === null || value === undefined ? "—" : `${String(Math.round(Number(value) * 10) / 10).replace(".", ",")} %`);
  const fr = (value) => (value === null || value === undefined || value === "" ? "" : String(value).replace(".", ","));
  const dateFr = (value) => {
    if (!value) return "—";
    const iso = String(typeof value === "string" ? value : new Date(value).toISOString()).slice(0, 10);
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  const dateTimeFr = (value) => (value ? new Date(value).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const addMonthsIso = (iso, months) => {
    const date = new Date(`${iso}T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + months);
    return date.toISOString().slice(0, 10);
  };

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
    if (!response.ok) {
      const error = new Error(payload.error || `Erreur ${response.status}`);
      error.status = response.status;
      error.code = payload.code;
      throw error;
    }
    return payload;
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "value") node.value = value;
      else if (key === "checked" || key === "disabled" || key === "selected" || key === "hidden" || key === "required") node[key] = Boolean(value);
      else if (key === "dataset") Object.assign(node.dataset, value);
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    });
    (Array.isArray(children) ? children : [children]).flat().forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
    });
    return node;
  }

  function options(list, selected) {
    return list.map(([value, label]) => el("option", { value, text: label, selected: String(value) === String(selected ?? "") }));
  }

  let toastTimer = null;
  function toast(message, tone = "") {
    const node = $("#toast");
    node.textContent = message;
    node.className = `toast ${tone}`;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (node.hidden = true), tone === "error" ? 7000 : 3500);
  }
  const fail = (error) => toast(error.message || String(error), "error");

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
  async function filePayload(file, maxMb = 25) {
    if (!file) return null;
    if (file.size > maxMb * 1024 * 1024) throw new Error(`Fichier trop lourd (${maxMb} Mo maximum).`);
    return { name: file.name, type: file.type, dataUrl: await fileToDataUrl(file) };
  }

  async function busy(button, work) {
    const label = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = "Patientez…";
    }
    try {
      return await work();
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = label;
      }
    }
  }

  const STATUS_TONE = { draft: "", sent: "info", signed: "ok", refused: "bad", superseded: "", ready: "ok", blocked: "bad", expired: "bad", replaced: "", upcoming: "info" };
  const statusBadge = (status, label) => el("span", { class: `badge ${STATUS_TONE[status] || ""}`, text: label || status });

  function setTitle(title, eyebrow = "Devis et marges", section = "dossiers") {
    $("#pageTitle").textContent = title;
    $("#pageEyebrow").textContent = eyebrow;
    document.title = `${title} · Nova+`;
    document.querySelectorAll(".tabs a").forEach((link) => (link.dataset.section === section ? link.setAttribute("aria-current", "page") : link.removeAttribute("aria-current")));
  }

  // ---------- Dialogues ----------

  // sheet({ title, intro, body, actions: [{ label, primary, danger, onClick }] , large })
  // onClick reçoit { close, dialog, button } ; renvoyer false garde le dialogue ouvert.
  function sheet({ title, intro, body = [], actions = [], large = false, onClose, cancelLabel }) {
    const dialog = el("dialog", { class: `sheet${large ? " large" : ""}` });
    const close = (value) => {
      dialog.close();
      dialog.remove();
      onClose?.(value);
    };
    const foot = el("div", { class: "sheet-foot" }, [
      el("button", { type: "button", class: "secondary", text: cancelLabel || (actions.length ? "Annuler" : "Fermer"), onclick: () => close(null) }),
      ...actions.map((action) =>
        el("button", {
          type: "button",
          class: action.primary ? "primary" : action.danger ? "danger secondary" : "secondary",
          text: action.label,
          onclick: async (event) => {
            const button = event.currentTarget;
            try {
              const result = await busy(button, () => action.onClick({ close, dialog, button }));
              if (result !== false && dialog.open) close(result);
            } catch (error) {
              fail(error);
            }
          },
        }),
      ),
    ]);
    dialog.append(
      el("div", { class: "sheet-body" }, [
        el("div", { class: "sheet-head" }, [el("div", {}, [el("h2", { text: title }), intro ? el("p", { class: "muted small", text: intro }) : null])]),
        ...body,
        foot,
      ]),
    );
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close(null);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    return { dialog, close };
  }

  const field = (label, input, hint) => el("label", {}, [el("span", { text: label }), input, hint ? el("small", { text: hint }) : null]);
  const input = (props = {}) => el("input", { autocomplete: "off", ...props });
  const numberInput = (value, props = {}) => input({ inputmode: "decimal", value: fr(value), ...props });

  // ---------- Signature manuscrite sur écran ----------

  function signaturePad() {
    const canvas = el("canvas");
    const wrap = el("div", { class: "signature-pad" }, [canvas, el("span", { class: "hint", text: "Signez ici avec le doigt ou la souris" })]);
    const context = canvas.getContext("2d");
    let drawing = false;
    let empty = true;
    let last = null;
    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineWidth = 2.4;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = "#14171f";
    };
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    canvas.addEventListener("pointerdown", (event) => {
      if (!canvas.width) resize();
      drawing = true;
      last = point(event);
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drawing) return;
      const next = point(event);
      context.beginPath();
      context.moveTo(last.x, last.y);
      context.lineTo(next.x, next.y);
      context.stroke();
      last = next;
      if (empty) {
        empty = false;
        wrap.classList.add("signed");
      }
    });
    const stop = () => (drawing = false);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    requestAnimationFrame(resize);
    return {
      node: wrap,
      isEmpty: () => empty,
      clear() {
        context.clearRect(0, 0, canvas.width, canvas.height);
        empty = true;
        wrap.classList.remove("signed");
      },
      toDataUrl: () => canvas.toDataURL("image/png"),
    };
  }

  // ---------- Sélecteur d'ouvrages de la bibliothèque ----------

  function libraryPicker({ title = "Ajouter des ouvrages", confirmLabel = "Ajouter", withSubcontractor = false, subcontractors = [] } = {}) {
    return new Promise((resolve) => {
      const chosen = new Map();
      const search = input({ type: "search", placeholder: "Rechercher un ouvrage, un code, un lot…" });
      const lotSelect = el("select", { "aria-label": "Lot" });
      const list = el("ul", { class: "picker-list" });
      const count = el("span", { class: "muted small", text: "Aucun ouvrage choisi" });
      const stSelect = withSubcontractor
        ? el("select", {}, options([["", "À choisir plus tard"], ...subcontractors.map((st) => [st.id, `${st.name}${st.compliance?.blocked ? " · documents à jour requis" : ""}`])], ""))
        : null;
      const refreshCount = () => (count.textContent = chosen.size ? `${chosen.size} ouvrage(s) choisi(s)` : "Aucun ouvrage choisi");
      const load = async () => {
        const params = new URLSearchParams({ q: search.value, lot: lotSelect.value });
        const { items } = await api(`/api/library/items?${params}`);
        fill(list, 
          ...(items.length
            ? items.map((item) => {
                const box = el("input", { type: "checkbox", checked: chosen.has(item.id) });
                box.addEventListener("change", () => {
                  box.checked ? chosen.set(item.id, item) : chosen.delete(item.id);
                  refreshCount();
                });
                return el("li", {}, el("label", {}, [box, el("span", {}, [el("strong", { text: item.label }), el("span", { class: "sub muted small", text: ` ${item.code} · ${item.lotName}` })]), el("span", { class: "meta", text: `${item.unit}${item.laborCost !== null ? ` · ST réf. ${money(item.laborCost)}` : ""}` })]));
              })
            : [el("li", { class: "empty", text: "Aucun ouvrage. Ajoutez-en dans l'onglet Bibliothèque." })]),
        );
      };
      api("/api/library/lots").then(({ lots }) => {
        fill(lotSelect, ...options([["", "Tous les lots"], ...lots.map((lot) => [lot.id, lot.name])], ""));
      });
      search.addEventListener("input", debounce(() => load().catch(fail), 220));
      lotSelect.addEventListener("change", () => load().catch(fail));
      load().catch(fail);
      sheet({
        title,
        large: true,
        body: [
          el("div", { class: "toolbar" }, [el("div", { class: "grow" }, search), lotSelect]),
          list,
          stSelect ? field("Sous-traitant de ces lignes", stSelect, "Son prix signé est repris automatiquement ; sinon la ligne reste à attribuer.") : null,
          count,
        ],
        actions: [{ label: confirmLabel, primary: true, onClick: () => (chosen.size ? { items: [...chosen.values()], subcontractorId: stSelect?.value || null } : (toast("Choisissez au moins un ouvrage.", "error"), false)) }],
        onClose: (value) => resolve(value),
      });
    });
  }

  // ---------- Routeur ----------

  const ROUTES = [
    [/^#?(dossiers)?$/, "dossiers", () => views.dossiers()],
    [/^#dossier\/([0-9a-f-]{36})$/, "dossiers", (id) => views.dossier(id)],
    [/^#devis\/([0-9a-f-]{36})$/, "dossiers", (id) => views.quote(id)],
    [/^#bibliotheque$/, "bibliotheque", () => views.library()],
    [/^#sous-traitants$/, "sous-traitants", () => views.subcontractors()],
    [/^#st\/([0-9a-f-]{36})$/, "sous-traitants", (id) => views.subcontractor(id)],
    [/^#grille\/([0-9a-f-]{36})$/, "sous-traitants", (id) => views.grid(id)],
    [/^#exceptions$/, "exceptions", () => views.exceptions()],
  ];

  async function route() {
    if (leaveHook) {
      const hook = leaveHook;
      leaveHook = null;
      await hook().catch(fail);
    }
    const hash = window.location.hash || "#dossiers";
    const match = ROUTES.find(([regex]) => regex.test(hash));
    if (!match) return (window.location.hash = "#dossiers");
    const [regex, section, render] = match;
    fill(view, el("p", { class: "muted", text: "Chargement…" }));
    document.querySelectorAll(".tabs a").forEach((link) => (link.dataset.section === section ? link.setAttribute("aria-current", "page") : link.removeAttribute("aria-current")));
    try {
      await render(...hash.match(regex).slice(1));
    } catch (error) {
      fill(view, el("div", { class: "empty" }, [el("p", { text: error.message }), el("a", { class: "link", href: "#dossiers", text: "Retour aux dossiers" })]));
    }
    window.scrollTo({ top: 0 });
  }

  // ---------- Dossiers ----------

  views.dossiers = async () => {
    setTitle("Dossiers et devis", "Devis et marges", "dossiers");
    const search = input({ type: "search", placeholder: "Client, adresse ou n° de devis", "aria-label": "Rechercher un dossier" });
    const body = el("div");
    fill(view, 
      el("section", { class: "card" }, [
        el("div", { class: "toolbar" }, [
          el("div", { class: "grow" }, search),
          can("quotes.write") ? el("button", { class: "primary", type: "button", text: "Nouveau dossier client", onclick: () => dossierSheet() }) : null,
        ]),
        body,
      ]),
    );
    const load = async () => {
      const { dossiers } = await api(`/api/dossiers?q=${encodeURIComponent(search.value)}`);
      if (!dossiers.length) {
        fill(body, el("div", { class: "empty", text: search.value ? "Aucun dossier ne correspond." : "Aucun dossier. Créez le premier : un dossier par client, ses devis et avenants y sont rangés." }));
        return;
      }
      fill(body, 
        el("div", { class: "table-wrap" }, el("table", { class: "table" }, [
          el("thead", {}, el("tr", {}, ["Client", "Commercial", "Statut", "Signé HT", "Devis", "Activité"].map((label, index) => el("th", { class: index === 3 ? "num" : "", text: label })))),
          el("tbody", {}, dossiers.map((d) =>
            el("tr", { class: "clickable", onclick: () => (window.location.hash = `#dossier/${d.id}`) }, [
              el("td", {}, [el("strong", { text: d.clientName }), el("span", { class: "sub", text: d.siteAddress || d.clientAddress || "" })]),
              el("td", { text: d.commercialName || "—" }),
              el("td", {}, statusBadge(d.mainStatus || "draft", d.mainStatusLabel)),
              el("td", { class: "num", text: d.signedSale ? money(d.signedSale) : "—" }),
              el("td", { text: String(d.quotesCount) }),
              el("td", { class: "nowrap", text: dateFr(d.lastActivity || d.updatedAt) }),
            ]),
          )),
        ])),
      );
    };
    search.addEventListener("input", debounce(() => load().catch(fail), 250));
    await load();
  };

  function dossierSheet(existing = null) {
    const d = existing || {};
    const f = {
      clientName: input({ value: d.clientName || "", placeholder: "M. et Mme LARGE", required: true }),
      clientPhone: input({ value: d.clientPhone || "", type: "tel" }),
      clientEmail: input({ value: d.clientEmail || "", type: "email" }),
      clientAddress: input({ value: d.clientAddress || "" }),
      siteAddress: input({ value: d.siteAddress || "", placeholder: "Si différente de l'adresse du client" }),
      offPremises: el("input", { type: "checkbox", checked: d.offPremises }),
      commercialId: el("select", { disabled: ctx.user.role === "commercial" }, options([["", "—"], ...ctx.commercials.map((c) => [c.id, c.displayName])], d.commercialId || (ctx.user.role === "commercial" ? ctx.user.id : ""))),
      notes: el("textarea", { rows: 3, value: d.notes || "" }),
    };
    sheet({
      title: existing ? "Modifier le dossier" : "Nouveau dossier client",
      intro: "Le devis initial, ses versions et ses avenants seront rangés dans ce dossier.",
      body: [
        field("Client", f.clientName),
        el("div", { class: "fields-2" }, [field("Téléphone", f.clientPhone), field("E-mail", f.clientEmail)]),
        field("Adresse du client", f.clientAddress),
        field("Adresse du chantier", f.siteAddress),
        field("Commercial", f.commercialId, "Sa commission est calculée sur le devis signé."),
        el("label", { class: "check" }, [f.offPremises, el("span", { text: "Contrat signé chez le client (hors établissement) : rétractation de 14 jours, formulaire joint, démarrage et paiement encadrés" })]),
        field("Notes internes", f.notes),
      ],
      actions: [
        {
          label: existing ? "Enregistrer" : "Créer le dossier",
          primary: true,
          onClick: async () => {
            const body = Object.fromEntries(Object.entries(f).map(([key, node]) => [key, node.type === "checkbox" ? node.checked : node.value]));
            if (existing) body.id = existing.id;
            const { dossier } = await api("/api/dossiers", { method: "POST", body });
            if (existing) await views.dossier(dossier.id);
            else window.location.hash = `#dossier/${dossier.id}`;
          },
        },
      ],
    });
  }

  views.dossier = async (id) => {
    const { dossier: d } = await api(`/api/dossiers/${id}`);
    setTitle(d.clientName, "Dossier client", "dossiers");
    const initial = d.quotes.filter((q) => q.amendmentNo === 0);
    const signedInitial = initial.find((q) => q.status === "signed");

    const newQuote = async (event) => {
      await busy(event.currentTarget, async () => {
        const { quote } = await api(`/api/dossiers/${id}/quotes`, { method: "POST", body: {} });
        window.location.hash = `#devis/${quote.id}`;
      });
    };

    const recap = d.recap;
    const stats = el("div", { class: "stats" }, [
      stat("Signé HT", money(recap.signedSale), recap.amendments ? `dont ${recap.amendments} avenant(s)` : "devis + avenants"),
      stat("Signé TTC", money(recap.signedTotal)),
      recap.margin !== null ? stat("Marge brute", money(recap.margin), pct(recap.marginRate), recap.marginRate >= ctx.company.margins.minimumNet ? "ok" : "bad") : null,
      recap.commission !== null ? stat("Commission", money(recap.commission)) : null,
      recap.net !== null ? stat("Marge nette", money(recap.net), "après commission") : null,
    ]);

    const quotesTable = d.quotes.length
      ? el("div", { class: "table-wrap" }, el("table", { class: "table" }, [
          el("thead", {}, el("tr", {}, ["Document", "Version", "Statut", "Total HT", "Total TTC", "Marge", "Date"].map((label, index) => el("th", { class: index >= 3 && index <= 5 ? "num" : "", text: label })))),
          el("tbody", {}, d.quotes.map((q) =>
            el("tr", { class: `clickable${q.status === "superseded" ? " inactive" : ""}`, onclick: () => (window.location.hash = `#devis/${q.id}`) }, [
              el("td", {}, [el("strong", { text: q.displayNumber }), el("span", { class: "sub", text: q.title || "" })]),
              el("td", { text: q.versionLabel }),
              el("td", {}, statusBadge(q.status, q.statusLabel)),
              el("td", { class: "num", text: money(q.totals?.sale) }),
              el("td", { class: "num", text: money(q.totals?.total) }),
              el("td", { class: "num", text: q.totals?.marginRate !== undefined ? pct(q.totals.marginRate) : "—" }),
              el("td", { class: "nowrap", text: dateFr(q.signedAt || q.sentAt || q.updatedAt) }),
            ]),
          )),
        ]))
      : el("div", { class: "empty", text: "Aucun devis dans ce dossier." });

    const scheduleCard = recap.schedule.length
      ? el("section", { class: "card" }, [
          el("div", { class: "card-head" }, [el("h2", { text: "Échéancier du dossier" }), el("p", { class: "muted small", text: "Devis initial et avenants signés. Les factures se suivent dans l'application chantiers." })]),
          el("div", { class: "table-wrap" }, el("table", { class: "table" }, [
            el("thead", {}, el("tr", {}, ["Échéance", "Part", "Montant TTC", "Origine", "Facture"].map((label, index) => el("th", { class: index === 2 ? "num" : "", text: label })))),
            el("tbody", {}, recap.schedule.map((step) => el("tr", {}, [el("td", { text: step.label }), el("td", { text: pct(step.percent) }), el("td", { class: "num", text: money(step.amountTtc) }), el("td", { class: "muted", text: step.source }), el("td", {}, step.invoiced ? statusBadge("signed", "Envoyée") : statusBadge("draft", "À venir"))]))),
          ])),
        ])
      : null;

    fill(view, 
      el("section", { class: "card" }, [
        el("div", { class: "card-head row" }, [
          el("div", {}, [el("h2", { text: "Client et chantier" })]),
          el("div", { class: "actions" }, [
            can("quotes.write") ? el("button", { class: "secondary", type: "button", text: "Modifier", onclick: () => dossierSheet(d) }) : null,
            can("quotes.write") && !signedInitial ? el("button", { class: signedInitial ? "secondary" : "primary", type: "button", text: initial.length ? "Nouveau devis (autre proposition)" : "Créer le devis", onclick: newQuote }) : null,
            signedInitial && can("quotes.write") ? el("button", { class: "primary", type: "button", text: "Ajouter un avenant", onclick: () => amendmentSheet(signedInitial) }) : null,
          ]),
        ]),
        el("dl", { class: "facts" }, [
          fact("Adresse du chantier", d.siteAddress || d.clientAddress || "—"),
          fact("Contact", [d.clientPhone, d.clientEmail].filter(Boolean).join(" · ") || "—"),
          fact("Commercial", d.commercialName || "—"),
          fact("Contrat", d.offPremises ? "Hors établissement : rétractation 14 jours" : "En agence / à distance"),
          d.projectId ? fact("Chantier", "Créé dans le suivi des chantiers à la signature") : null,
        ]),
      ]),
      d.quotes.some((q) => q.status === "signed") ? stats : null,
      el("section", { class: "card" }, [el("div", { class: "card-head" }, [el("h2", { text: "Devis et avenants" })]), quotesTable]),
      scheduleCard,
      receptionsCard(d, Boolean(signedInitial)),
    );
  };

  function stat(label, value, sub, tone = "") {
    return el("div", { class: `stat ${tone}` }, [el("span", { text: label }), el("strong", { text: value }), sub ? el("small", { text: sub }) : null]);
  }
  function fact(label, value) {
    return el("div", {}, [el("dt", { text: label }), el("dd", { text: value })]);
  }

  function amendmentSheet(signedInitial) {
    const title = input({ placeholder: "Travaux supplémentaires peinture", value: "" });
    const mode = el("select", {}, options([["separate", "Payé à part (ex. 50 % à la signature, 50 % à la fin)"], ["merge", "Ajouté aux échéances restantes du devis"]], "separate"));
    sheet({
      title: `Avenant au devis ${signedInitial.number}`,
      intro: "Travaux supplémentaires ou moins-values (quantités négatives), avec les mêmes ouvrages, ST et marges. Il se signe à part.",
      body: [field("Objet", title), field("Échéancier de l'avenant", mode)],
      actions: [{ label: "Créer l'avenant", primary: true, onClick: async () => {
        const { quote } = await api(`/api/quotes/${signedInitial.id}/amendment`, { method: "POST", body: { title: title.value, scheduleMode: mode.value } });
        window.location.hash = `#devis/${quote.id}`;
      } }],
    });
  }

  // ---------- PV de réception ----------

  function receptionsCard(d, hasSigned) {
    if (!hasSigned && !d.receptions.length) return null;
    const list = d.receptions.length
      ? el("ul", { class: "list" }, d.receptions.map((r) =>
          el("li", {}, [
            el("span", { class: "name" }, [`Réception du ${dateFr(r.receivedOn)}`, el("small", { text: r.reserves.length ? `${r.reserves.length} réserve(s) : ${r.reserves.map((x) => x.label).join(" · ")}` : "Sans réserve" })]),
            el("span", { class: "actions" }, [
              statusBadge(r.status === "signed" ? "signed" : "draft", r.status === "signed" ? `Signé · ${r.signerName || ""}` : "À signer"),
              r.signedUrl ? el("a", { class: "secondary mini", href: r.signedUrl, target: "_blank", rel: "noopener", text: "PDF" }) : null,
              r.status !== "signed" && can("receptions.write") ? el("button", { class: "primary mini", type: "button", text: "Faire signer", onclick: () => signReceptionSheet(r, d) }) : null,
            ]),
          ]),
        ))
      : el("p", { class: "muted", text: "Aucun PV. Le PV signé rend la dernière échéance (solde) exigible." });
    return el("section", { class: "card" }, [
      el("div", { class: "card-head row" }, [
        el("div", {}, [el("h2", { text: "Réception des travaux" }), el("p", { class: "muted small", text: "PV signé sur place, avec la liste des réserves : il rend le solde exigible." })]),
        hasSigned && can("receptions.write") ? el("button", { class: "secondary", type: "button", text: "Nouveau PV de réception", onclick: () => receptionSheet(d) }) : null,
      ]),
      list,
    ]);
  }

  function receptionSheet(d) {
    const date = input({ type: "date", value: todayIso() });
    const reserves = el("textarea", { rows: 5, placeholder: "Une réserve par ligne, par ex. :\nCarrelage : joint silicone douche à reprendre\nPeinture : retouche plafond chambre" });
    sheet({
      title: "PV de réception",
      body: [field("Date de réception", date), field("Réserves", reserves, "Laissez vide pour une réception sans réserve.")],
      actions: [{ label: "Créer le PV", primary: true, onClick: async () => {
        const list = reserves.value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
          const [lot, ...rest] = line.split(":");
          return rest.length ? { lot: lot.trim(), label: rest.join(":").trim() } : { label: line };
        });
        const { reception } = await api(`/api/dossiers/${d.id}/receptions`, { method: "POST", body: { receivedOn: date.value, reserves: list } });
        await views.dossier(d.id);
        signReceptionSheet(reception, d);
      } }],
    });
  }

  function signReceptionSheet(reception, d) {
    const pad = signaturePad();
    const name = input({ value: d.clientName });
    sheet({
      title: "Signature du PV de réception",
      intro: reception.reserves.length ? `Réception avec ${reception.reserves.length} réserve(s).` : "Réception sans réserve.",
      body: [field("Nom du signataire", name), pad.node, el("button", { class: "link", type: "button", text: "Effacer la signature", onclick: () => pad.clear() })],
      actions: [{ label: "Valider la signature", primary: true, onClick: async () => {
        if (pad.isEmpty()) return toast("Le client doit signer dans le cadre.", "error"), false;
        await api(`/api/receptions/${reception.id}/sign`, { method: "POST", body: { signatureImage: pad.toDataUrl(), signerName: name.value } });
        toast("PV signé : le solde est exigible dans le suivi du chantier.");
        await views.dossier(d.id);
      } }],
    });
  }

  // ---------- Rapport des exceptions ----------

  const EXCEPTION_KIND = { cost: "Coût ST hors grille", labor_price: "Prix prestation forcé", supply_price: "Prix fourniture forcé" };

  views.exceptions = async () => {
    setTitle("Exceptions de prix", "Où la marge se perd", "exceptions");
    const month = input({ type: "month", value: todayIso().slice(0, 7), "aria-label": "Mois" });
    const body = el("div", { class: "panel" });
    fill(view, el("section", { class: "card" }, [el("div", { class: "toolbar" }, [field("Mois", month), el("p", { class: "muted small grow", text: "Lignes des devis envoyés ou signés ce mois-ci dont le coût ST ou le prix de vente sort de la grille, avec le motif saisi." })]), body]));
    const load = async () => {
      const { report } = await api(`/api/reports/exceptions?month=${month.value}`);
      fill(body, 
        el("div", { class: "stats" }, [stat("Exceptions", String(report.count)), stat("Impact sur la marge", money(report.lostMargin), "surcoûts ST + remises", report.lostMargin > 0 ? "bad" : "ok")]),
        report.items.length
          ? el("div", { class: "table-wrap" }, el("table", { class: "table" }, [
              el("thead", {}, el("tr", {}, ["Devis", "Ligne", "Type", "Grille → appliqué", "Écart", "Motif", "Commercial"].map((label, index) => el("th", { class: index === 4 ? "num" : "", text: label })))),
              el("tbody", {}, report.items.map((item) =>
                el("tr", { class: "clickable", onclick: () => (window.location.hash = `#devis/${item.quoteId}`) }, [
                  el("td", {}, [el("strong", { text: `${item.amendmentNo ? `Avenant ${item.amendmentNo} · ` : ""}${item.number}` }), el("span", { class: "sub", text: item.clientName })]),
                  el("td", {}, [item.label, el("span", { class: "sub", text: [item.lotName, item.subcontractorName].filter(Boolean).join(" · ") })]),
                  el("td", { text: EXCEPTION_KIND[item.kind] || item.kind }),
                  el("td", { class: "nowrap", text: `${money(item.reference)} → ${money(item.actual)}` }),
                  el("td", { class: "num" }, [money(item.diffTotal), el("span", { class: "sub", text: item.diffRate !== null ? pct(item.diffRate) : "" })]),
                  el("td", { text: item.reason || "—" }),
                  el("td", { text: item.commercialName || "—" }),
                ]),
              )),
            ]))
          : el("div", { class: "empty", text: "Aucune exception ce mois-ci." }),
      );
    };
    month.addEventListener("change", () => load().catch(fail));
    await load();
  };

  // ---------- Démarrage ----------

  async function start() {
    try {
      ctx = await api("/api/devis/context");
    } catch (error) {
      fill(view, el("div", { class: "empty", text: error.message }));
      return;
    }
    const initials = ctx.user.displayName.split(/\s+/).filter((part) => /\p{L}/u.test(part)).slice(0, 2).map((part) => part.match(/\p{L}/u)[0].toUpperCase()).join("");
    $("#whoAvatar").textContent = initials || "?";
    $("#whoName").textContent = ctx.user.displayName;
    $("#whoRole").textContent = ctx.company.name || "Nova+";
    document.querySelectorAll("[data-grant]").forEach((node) => (node.hidden = !node.dataset.grant.split(" ").some(can)));
    window.addEventListener("hashchange", route);
    await route();
  }
  document.addEventListener("DOMContentLoaded", start);

  return {
    P, $, el, fill, api, can, money, pct, fr, dateFr, dateTimeFr, todayIso, addMonthsIso, options, toast, fail, debounce, busy, filePayload,
    statusBadge, setTitle, sheet, field, input, numberInput, signaturePad, libraryPicker, stat, fact, views, view,
    // Les modules branchés (CRM…) ajoutent leurs écrans au routeur.
    addRoute(regex, section, render) {
      ROUTES.push([regex, section, render]);
    },
    get ctx() {
      return ctx;
    },
    setLeaveHook(hook) {
      leaveHook = hook;
    },
  };
})();

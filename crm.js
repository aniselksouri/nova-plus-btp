"use strict";

// Module commercial (V2) : pipeline des leads, fiche lead, tableau de bord commercial,
// commissions, objectifs / point mort et réglages. Se branche sur le routeur de devis.js.

(() => {
  const { el, fill, api, can, money, pct, fr, dateFr, dateTimeFr, options, toast, fail, debounce, busy, setTitle, sheet, field, input, numberInput, stat, fact, views, view } = window.ND;
  const EYEBROW = "Commercial";
  const STAGE_TONE = { new: "info", contacted: "", visit: "", quote_sent: "dark", negotiation: "warn", won: "ok", lost: "bad" };
  const EVENT_LABELS = { created: "Lead reçu", stage: "Étape", assigned: "Attribution", call: "Appel", visit: "Visite", note: "Note", email: "E-mail", quote: "Devis", task: "Rappel", duplicate: "Doublon", update: "Mise à jour" };
  const store = {
    get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* navigation privée : sans mémoire locale */
      }
    },
  };

  let crmCtx = null;
  async function context() {
    if (!crmCtx) crmCtx = await api("/api/crm/context");
    return crmCtx;
  }
  const canReadLeads = () => can("crm.read_all") || can("crm.read_own");
  const stageLabel = (key) => crmCtx?.stages.find((stage) => stage.key === key)?.label || key;
  const badge = (text, tone = "") => el("span", { class: `badge ${tone}`, text });
  const monthNow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
  const monthLabel = (period) => {
    const [y, m] = period.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  };
  const ago = (days) => (days <= 0 ? "aujourd'hui" : days === 1 ? "depuis 1 jour" : `depuis ${days} jours`);
  const localInputValue = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const tomorrowNine = () => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
    return date;
  };
  const textarea = (props = {}) => el("textarea", { rows: 3, ...props });
  const sourceBadge = (lead) => badge(lead.sourceLabel?.replace(" (Facebook / Instagram)", "") || lead.source, lead.source === "meta" || lead.source === "google" ? "info" : "");

  function celebrate(text) {
    const node = el("div", { class: "celebrate", role: "status" }, [el("strong", { text: "Bravo !" }), el("span", { text })]);
    view.prepend(node);
    setTimeout(() => node.classList.add("out"), 6000);
    setTimeout(() => node.remove(), 6600);
  }

  // ---------- Saisie rapide d'un lead (appel entrant) ----------

  function leadSheet(onDone) {
    const name = input({ placeholder: "M. Dupont", required: true });
    const phone = input({ type: "tel", placeholder: "06 12 34 56 78", inputmode: "tel" });
    const need = textarea({ placeholder: "Fuite sous l'évier, rénovation de salle de bain…" });
    const email = input({ type: "email", placeholder: "client@exemple.fr" });
    const postalCode = input({ placeholder: "59000", inputmode: "numeric" });
    const city = input({ placeholder: "Lille" });
    const source = el("select", {}, options([["phone", "Appel téléphonique"], ["manual", "Saisie manuelle"], ["website", "Site internet"], ["other", "Bouche-à-oreille, salon…"]], "phone"));
    const commercial = can("crm.assign") ? el("select", {}, options([["", "Attribution automatique"], ...crmCtx.sellers.map((s) => [s.id, s.displayName])], "")) : null;
    const more = el("details", { class: "more" }, [
      el("summary", { text: "Plus d'informations" }),
      el("div", { class: "fields-2" }, [field("E-mail", email), field("Origine", source), field("Code postal", postalCode), field("Ville", city), commercial ? field("Commercial", commercial) : null]),
    ]);
    sheet({
      title: "Nouveau lead",
      intro: "Trois champs suffisent pendant l'appel ; le reste se complète ensuite.",
      body: [field("Nom", name), field("Téléphone", phone), field("Besoin", need), more],
      actions: [
        {
          label: "Créer le lead",
          primary: true,
          onClick: async () => {
            if (!name.value.trim()) return toast("Indiquez le nom du contact.", "error"), false;
            if (!phone.value.trim() && !email.value.trim()) return toast("Indiquez un téléphone ou un e-mail.", "error"), false;
            const { lead } = await api("/api/leads", { method: "POST", body: { name: name.value, phone: phone.value, need: need.value, email: email.value, postalCode: postalCode.value, city: city.value, source: source.value, commercialId: commercial?.value || null } });
            toast(lead.commercialName ? `Lead créé, attribué à ${lead.commercialName}.` : "Lead créé.");
            onDone?.(lead);
            return true;
          },
        },
      ],
    });
    setTimeout(() => name.focus(), 50);
  }

  function lostSheet() {
    return new Promise((resolve) => {
      const reasons = crmCtx.settings.lostReasons;
      const select = el("select", {}, options([...reasons.map((r) => [r, r]), ["__other", "Autre motif…"]], reasons[0]));
      const other = input({ placeholder: "Motif", hidden: true });
      select.addEventListener("change", () => (other.hidden = select.value !== "__other"));
      sheet({
        title: "Lead perdu",
        intro: "Le motif sert à comprendre ce qui fait perdre des chantiers.",
        body: [field("Motif de perte", select), other],
        actions: [{ label: "Marquer perdu", danger: true, onClick: () => (select.value === "__other" ? other.value.trim() || (toast("Précisez le motif.", "error"), false) : select.value) }],
        onClose: (value) => resolve(value || null),
      });
    });
  }

  async function moveLead(lead, stage) {
    let lostReason;
    if (stage === "lost") {
      lostReason = await lostSheet();
      if (!lostReason) return null;
    }
    const { lead: next } = await api(`/api/leads/${lead.id}/stage`, { method: "POST", body: { stage, lostReason } });
    if (stage === "won") celebrate(`${next.name} passe en signé.`);
    else toast(`${next.name} → ${stageLabel(stage)}`);
    return next;
  }

  // ---------- Pipeline ----------

  const filters = { q: "", commercial: "", source: "", late: false };

  views.pipeline = async () => {
    setTitle("Leads et pipeline", EYEBROW, "pipeline");
    if (!canReadLeads()) return fill(view, el("div", { class: "empty", text: "Le pipeline commercial n'est pas ouvert à votre rôle." }));
    const c = await context();
    const search = input({ type: "search", placeholder: "Nom, téléphone, ville, campagne…", "aria-label": "Rechercher un lead", value: filters.q });
    const commercial = can("crm.read_all") ? el("select", { "aria-label": "Commercial" }, options([["", "Tous les commerciaux"], ["none", "Non attribués"], ...c.sellers.map((s) => [s.id, s.displayName])], filters.commercial)) : null;
    const source = el("select", { "aria-label": "Origine" }, options([["", "Toutes les origines"], ...Object.entries(c.sources)], filters.source));
    const lateButton = el("button", { type: "button", class: "secondary", "aria-pressed": String(filters.late) });
    const board = el("div", { class: "board", role: "list" });
    let leads = [];

    const render = () => {
      const shown = filters.late ? leads.filter((lead) => lead.overdue) : leads;
      const late = leads.filter((lead) => lead.overdue).length;
      lateButton.textContent = late ? `À relancer (${late})` : "À relancer";
      lateButton.classList.toggle("alert", late > 0);
      fill(board, c.stages.map((stage) => column(stage, shown.filter((lead) => lead.stage === stage.key))));
    };

    const column = (stage, items) => {
      const col = el("section", { class: `column stage-${stage.key}`, role: "listitem", "aria-label": stage.label, dataset: { stage: stage.key } }, [
        el("header", {}, [el("h3", { text: stage.label }), el("span", { class: "count", text: String(items.length) })]),
        el("div", { class: "column-body" }, items.length ? items.map(card) : el("p", { class: "column-empty", text: stage.key === "new" ? "Aucun nouveau lead" : "—" })),
      ]);
      col.addEventListener("dragover", (event) => {
        event.preventDefault();
        col.classList.add("over");
      });
      col.addEventListener("dragleave", (event) => {
        if (!col.contains(event.relatedTarget)) col.classList.remove("over");
      });
      col.addEventListener("drop", async (event) => {
        event.preventDefault();
        col.classList.remove("over");
        const lead = leads.find((item) => item.id === event.dataTransfer.getData("text/plain"));
        if (!lead || lead.stage === stage.key) return;
        try {
          const next = await moveLead(lead, stage.key);
          if (next) {
            leads = leads.map((item) => (item.id === next.id ? { ...item, ...next } : item));
            render();
          }
        } catch (error) {
          fail(error);
        }
      });
      return col;
    };

    const card = (lead) => {
      const node = el("a", { class: `lead-card${lead.overdue ? " late" : ""}`, href: `#lead/${lead.id}`, draggable: "true", dataset: { id: lead.id } }, [
        el("div", { class: "lead-top" }, [el("strong", { text: lead.name }), lead.isTest ? badge("Test") : null, lead.duplicateOf ? badge("Doublon ?", "warn") : null]),
        el("div", { class: "lead-meta" }, [sourceBadge(lead), lead.campaign ? el("span", { class: "muted small ellipsis", text: lead.campaign }) : null]),
        lead.need ? el("p", { class: "lead-need", text: lead.need }) : null,
        el("div", { class: "lead-foot" }, [
          el("span", { class: "muted small", text: [lead.city || lead.postalCode, lead.commercialName || "Non attribué"].filter(Boolean).join(" · ") }),
          lead.stage === "lost" ? el("span", { class: "small bad-text", text: lead.lostReason }) : lead.overdue ? el("span", { class: "small bad-text", text: lead.nextTask?.late ? `Relance : ${lead.nextTask.title}` : `Relance ${ago(lead.daysInStage)}` }) : el("span", { class: "muted small", text: ago(lead.daysInStage) }),
        ]),
      ]);
      node.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", lead.id);
        event.dataTransfer.effectAllowed = "move";
        node.classList.add("dragging");
      });
      node.addEventListener("dragend", () => node.classList.remove("dragging"));
      return node;
    };

    const load = async () => {
      const params = new URLSearchParams({ q: filters.q, commercial: filters.commercial, source: filters.source });
      ({ leads } = await api(`/api/leads?${params}`));
      render();
    };
    search.addEventListener("input", debounce(() => ((filters.q = search.value), load().catch(fail)), 250));
    commercial?.addEventListener("change", () => ((filters.commercial = commercial.value), load().catch(fail)));
    source.addEventListener("change", () => ((filters.source = source.value), load().catch(fail)));
    lateButton.addEventListener("click", () => {
      filters.late = !filters.late;
      lateButton.setAttribute("aria-pressed", String(filters.late));
      render();
    });

    fill(
      view,
      el("section", { class: "card" }, [
        el("div", { class: "toolbar" }, [
          el("div", { class: "grow" }, search),
          commercial,
          source,
          lateButton,
          can("crm.write") ? el("button", { type: "button", class: "primary", text: "Nouveau lead", onclick: () => leadSheet((lead) => (window.location.hash = `#lead/${lead.id}`)) }) : null,
        ]),
        el("p", { class: "muted small", text: "Glissez une carte d'une colonne à l'autre, ou ouvrez-la pour changer d'étape. Un devis envoyé ou signé fait avancer le lead tout seul." }),
      ]),
      board,
    );
    await load();
  };

  // ---------- Fiche lead ----------

  views.lead = async (id) => {
    const c = await context();
    let lead = (await api(`/api/leads/${id}`)).lead;
    setTitle(lead.name, EYEBROW, "pipeline");

    const refresh = (next) => {
      lead = next;
      render();
    };
    const run = (work) => async (event) => {
      try {
        const next = await busy(event?.currentTarget, work);
        if (next) refresh(next);
      } catch (error) {
        fail(error);
      }
    };

    const stepper = () =>
      el("div", { class: "stepper", role: "group", "aria-label": "Étape du lead" }, c.stages.map((stage) =>
        el("button", {
          type: "button",
          class: `step stage-${stage.key}`,
          "aria-pressed": String(lead.stage === stage.key),
          disabled: !can("crm.write"),
          text: stage.label,
          onclick: run(async () => (lead.stage === stage.key ? null : moveLead(lead, stage.key).then((next) => next && api(`/api/leads/${id}`).then((r) => r.lead)))),
        }),
      ));

    const contactCard = () =>
      el("section", { class: "card" }, [
        el("div", { class: "card-head row" }, [
          el("div", {}, [
            el("div", { class: "badges" }, [sourceBadge(lead), badge(lead.stageLabel, STAGE_TONE[lead.stage]), lead.overdue ? badge("À relancer", "bad") : null, lead.isTest ? badge("Lead de test") : null, lead.incomplete ? badge("Incomplet", "warn") : null]),
            el("p", { class: "muted small", text: `Reçu le ${dateTimeFr(lead.receivedAt)} · ${lead.stageLabel} ${ago(lead.daysInStage)}${lead.stageLimitDays ? ` (relance après ${lead.stageLimitDays} j)` : ""}` }),
          ]),
          can("crm.write") ? el("button", { type: "button", class: "secondary", text: "Modifier", onclick: () => editSheet() }) : null,
        ]),
        stepper(),
        lead.stage === "lost" && lead.lostReason ? el("p", { class: "bad-text", text: `Perdu : ${lead.lostReason}` }) : null,
        lead.duplicate ? el("p", { class: "notice" }, ["Même téléphone ou e-mail qu'un lead précédent : ", el("a", { class: "link", href: `#lead/${lead.duplicate.id}`, text: `${lead.duplicate.name} (${lead.duplicate.stageLabel}, reçu le ${dateFr(lead.duplicate.receivedAt)})` })]) : null,
        el("dl", { class: "facts" }, [
          el("div", {}, [el("dt", { text: "Téléphone" }), el("dd", {}, lead.phone ? el("a", { class: "link", href: `tel:${lead.phone.replace(/\s/g, "")}`, text: lead.phone }) : "—")]),
          el("div", {}, [el("dt", { text: "E-mail" }), el("dd", {}, lead.email ? el("a", { class: "link", href: `mailto:${lead.email}`, text: lead.email }) : "—")]),
          fact("Adresse", [lead.address, [lead.postalCode, lead.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—"),
          fact("Commercial", lead.commercialName || "Non attribué"),
        ]),
        lead.need ? el("div", { class: "need" }, [el("h3", { text: "Besoin" }), el("p", { text: lead.need })]) : null,
        Object.keys(lead.details).filter((key) => !key.startsWith("_")).length
          ? el("dl", { class: "facts small-facts" }, Object.entries(lead.details).filter(([key]) => !key.startsWith("_")).map(([key, value]) => fact(key, String(value))))
          : null,
      ]);

    const activityCard = () => {
      const kind = el("select", { "aria-label": "Type d'échange" }, options([["call", "Appel"], ["visit", "Visite"], ["email", "E-mail"], ["note", "Note"]], "call"));
      const body = textarea({ placeholder: "Compte rendu de l'échange…", rows: 2 });
      return el("section", { class: "card" }, [
        el("div", { class: "card-head" }, [el("h2", { text: "Historique" })]),
        can("crm.write")
          ? el("form", { class: "activity-form", onsubmit: (event) => event.preventDefault() }, [
              kind,
              body,
              el("button", { type: "submit", class: "primary", text: "Ajouter", onclick: run(async () => (body.value.trim() ? (await api(`/api/leads/${id}/events`, { method: "POST", body: { kind: kind.value, body: body.value } })).lead : (toast("Décrivez l'échange.", "error"), null))) }),
            ])
          : null,
        el("ol", { class: "timeline" }, lead.events.map((event) =>
          el("li", { class: `ev-${event.kind}` }, [
            el("div", { class: "ev-head" }, [el("strong", { text: EVENT_LABELS[event.kind] || event.kind }), el("span", { class: "muted small", text: `${dateTimeFr(event.at)}${event.userName ? ` · ${event.userName}` : ""}` })]),
            el("p", { text: event.body }),
          ]),
        )),
      ]);
    };

    const tasksCard = () => {
      const open = lead.tasks.filter((task) => !task.doneAt);
      const done = lead.tasks.filter((task) => task.doneAt).slice(0, 5);
      const row = (task) => {
        const box = el("input", { type: "checkbox", checked: Boolean(task.doneAt), disabled: !can("crm.write"), "aria-label": `Fait : ${task.title}` });
        box.addEventListener("change", run(async () => (await api(`/api/lead-tasks/${task.id}`, { method: "POST", body: { done: box.checked } })).lead));
        return el("li", { class: `${task.late ? "late" : ""}${task.doneAt ? " done" : ""}` }, [
          el("label", { class: "check" }, [box, el("span", {}, [el("strong", { text: task.title }), el("span", { class: "sub muted small", text: `${task.doneAt ? `Fait le ${dateFr(task.doneAt)}` : `Pour le ${dateTimeFr(task.dueAt)}`}${task.auto ? " · relance auto" : ""}${task.assignedName ? ` · ${task.assignedName}` : ""}` })])]),
        ]);
      };
      return el("section", { class: "card" }, [
        el("div", { class: "card-head row" }, [el("h2", { text: "Relances" }), can("crm.write") ? el("button", { type: "button", class: "secondary", text: "Ajouter un rappel", onclick: () => taskSheet() }) : null]),
        open.length ? el("ul", { class: "tasks" }, open.map(row)) : el("p", { class: "muted small", text: lead.stage === "won" || lead.stage === "lost" ? "Lead clos : plus de relance." : "Aucune relance en attente." }),
        done.length ? el("details", {}, [el("summary", { class: "muted small", text: `Faites (${done.length})` }), el("ul", { class: "tasks" }, done.map(row))]) : null,
      ]);
    };

    const quotesCard = () =>
      el("section", { class: "card" }, [
        el("div", { class: "card-head" }, [el("h2", { text: "Dossier et devis" })]),
        lead.dossierId
          ? el("div", { class: "grid-gap" }, [
              el("a", { class: "secondary button", href: `#dossier/${lead.dossierId}`, text: "Ouvrir le dossier client" }),
              lead.quotes.length
                ? el("ul", { class: "quote-list" }, lead.quotes.map((q) => el("li", {}, [el("a", { class: "link", href: `#devis/${q.id}`, text: `${q.amendmentNo ? `Avenant ${q.amendmentNo} · ` : ""}${q.number} V${q.version}` }), badge({ draft: "Brouillon", sent: "Envoyé", signed: "Signé", refused: "Refusé", superseded: "Remplacé" }[q.status] || q.status, { signed: "ok", sent: "info", refused: "bad" }[q.status] || ""), el("span", { class: "num", text: money(q.sale) })])))
                : el("p", { class: "muted small", text: "Aucun devis : créez-le depuis le dossier." }),
            ])
          : can("quotes.write")
            ? el("div", { class: "grid-gap" }, [el("p", { class: "muted small", text: "Le dossier reprend le nom, le téléphone, l'e-mail et l'adresse du lead." }), el("button", { type: "button", class: "primary", text: "Créer le dossier client", onclick: run(async () => (await api(`/api/leads/${id}/dossier`, { method: "POST" })).lead) })])
            : el("p", { class: "muted small", text: "Pas encore de dossier client." }),
      ]);

    const assignCard = () => {
      if (!can("crm.assign")) return null;
      const select = el("select", { "aria-label": "Commercial" }, options([["", "Non attribué"], ...c.sellers.map((s) => [s.id, s.displayName])], lead.commercialId || ""));
      select.addEventListener("change", run(async () => (await api(`/api/leads/${id}/assign`, { method: "POST", body: { commercialId: select.value || null } })).lead));
      return el("section", { class: "card" }, [el("div", { class: "card-head" }, [el("h2", { text: "Attribution" })]), select]);
    };

    const originCard = () => {
      const utm = Object.entries(lead.utm || {});
      return el("section", { class: "card" }, [
        el("div", { class: "card-head" }, [el("h2", { text: "Origine" })]),
        el("dl", { class: "facts one" }, [
          fact("Source", lead.sourceLabel),
          lead.campaign ? fact("Campagne", lead.campaign) : null,
          lead.adName ? fact("Annonce", lead.adName) : null,
          lead.formName ? fact("Formulaire", lead.formName) : null,
          ...utm.map(([key, value]) => fact(key, value)),
        ]),
      ]);
    };

    function editSheet() {
      const fields = {
        name: input({ value: lead.name }),
        phone: input({ type: "tel", value: lead.phone || "" }),
        email: input({ type: "email", value: lead.email || "" }),
        address: input({ value: lead.address || "" }),
        postalCode: input({ value: lead.postalCode || "" }),
        city: input({ value: lead.city || "" }),
        need: textarea({ value: lead.need || "", rows: 4 }),
      };
      sheet({
        title: "Modifier le lead",
        body: [el("div", { class: "fields-2" }, [field("Nom", fields.name), field("Téléphone", fields.phone), field("E-mail", fields.email), field("Adresse", fields.address), field("Code postal", fields.postalCode), field("Ville", fields.city)]), field("Besoin", fields.need)],
        actions: [{ label: "Enregistrer", primary: true, onClick: async () => refresh((await api(`/api/leads/${id}`, { method: "PUT", body: Object.fromEntries(Object.entries(fields).map(([key, node]) => [key, node.value])) })).lead) }],
      });
    }

    function taskSheet() {
      const title = input({ value: "Rappeler le client" });
      const due = input({ type: "datetime-local", value: localInputValue(tomorrowNine()) });
      sheet({
        title: "Nouveau rappel",
        body: [field("À faire", title), field("Quand", due)],
        actions: [{ label: "Ajouter", primary: true, onClick: async () => refresh((await api(`/api/leads/${id}/tasks`, { method: "POST", body: { title: title.value, dueAt: due.value ? new Date(due.value).toISOString() : null } })).lead) }],
      });
    }

    function render() {
      setTitle(lead.name, EYEBROW, "pipeline");
      fill(view, el("a", { class: "link back-link", href: "#pipeline", text: "← Pipeline" }), el("div", { class: "lead-layout" }, [el("div", { class: "col" }, [contactCard(), activityCard()]), el("aside", { class: "col" }, [tasksCard(), quotesCard(), assignCard(), originCard()])]));
    }
    render();
  };

  // ---------- Jauges ----------

  function gauge({ title, value, target, marker, markerLabel, foot, tone = "" }) {
    const ratio = target ? Math.max(0, (value / target) * 100) : 0;
    return el("section", { class: `card gauge-card ${tone}` }, [
      el("div", { class: "gauge-head" }, [el("span", { class: "muted small strong", text: title }), el("strong", { class: "gauge-pct", text: target ? pct(ratio) : "—" })]),
      el("div", { class: "gauge-value" }, [el("strong", { text: money(value) }), el("span", { class: "muted", text: target ? ` / ${money(target)}` : " · objectif non défini" })]),
      el("div", { class: "gauge", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(Math.min(ratio, 100))), "aria-label": title }, [
        el("span", { class: `fill${ratio >= 100 ? " done" : ""}`, style: `width:${Math.min(ratio, 100)}%` }),
        marker !== null && marker !== undefined ? el("span", { class: "marker", style: `left:${Math.min(marker, 100)}%`, title: markerLabel || "" }) : null,
      ]),
      foot ? el("div", { class: "gauge-foot muted small" }, foot) : null,
    ]);
  }

  // ---------- Tableau de bord commercial ----------

  views.dashboard = async () => {
    setTitle("Objectifs et classement", EYEBROW, "tableau-de-bord");
    if (!can("goals.view")) return fill(view, el("div", { class: "empty", text: "Le tableau de bord commercial n'est pas ouvert à votre rôle." }));
    const month = input({ type: "month", value: monthNow(), "aria-label": "Mois" });
    const body = el("div", { class: "panel" });
    const load = async () => {
      const period = month.value || monthNow();
      const { dashboard: d } = await api(`/api/crm/dashboard?period=${period}`);
      const sources = can("crm.team_stats") ? (await api(`/api/crm/sources?period=${period}`)).report : null;
      fill(body, ...dashboardSections(d, sources));
      // Félicitations : nouvelles signatures et objectif atteint, une seule fois.
      if (period === monthNow()) {
        const seen = store.get("nova.crm.celebrated") || "";
        const fresh = d.celebrations.filter((item) => item.kind === "signature" && item.me && item.at > seen);
        if (fresh.length) celebrate(fresh.length === 1 ? fresh[0].text.replace(/^.*? a signé/, "Vous avez signé") : `${fresh.length} nouvelles signatures ce mois-ci.`);
        const latest = d.celebrations.filter((item) => item.at).map((item) => item.at).sort().pop();
        if (latest) store.set("nova.crm.celebrated", latest > seen ? latest : seen);
        const objectiveKey = `nova.crm.objective.${period}`;
        if (d.me?.badges.some((b) => b.key === "objective") && !store.get(objectiveKey)) {
          celebrate("Objectif du mois atteint. Tout ce qui suit compte pour les paliers.");
          store.set(objectiveKey, "1");
        }
      }
    };
    month.addEventListener("change", () => load().catch(fail));
    fill(view, el("section", { class: "card" }, el("div", { class: "toolbar" }, [el("div", { class: "grow" }, el("p", { class: "muted small", text: "CA signé hors taxes. Le CA encaissé arrivera avec la synchronisation iPaidThat (V3)." })), month])), body);
    await load();
  };

  function dashboardSections(d, sources) {
    const out = [];
    const gauges = [];
    if (d.me) {
      gauges.push(
        gauge({
          title: `Mon objectif · ${monthLabel(d.period)}`,
          value: d.me.sale,
          target: d.me.objective,
          tone: "mine",
          foot: [`${d.me.signatures} signature(s) · panier moyen ${money(d.me.basket)} · ${d.me.rank}ᵉ de l'équipe`, d.me.nextTier ? el("span", { class: "tier-next", text: ` · encore ${money(d.me.nextTier.threshold - d.me.sale)} pour le palier ${d.me.nextTier.label}${d.me.nextTier.reward ? ` (${d.me.nextTier.reward})` : ""}` }) : null],
        }),
      );
    }
    const be = d.breakeven;
    gauges.push(
      gauge({
        title: `Équipe · ${monthLabel(d.period)}`,
        value: d.team.signed,
        target: d.team.objective,
        marker: be?.marker,
        markerLabel: be ? `Point mort : ${money(be.amount)}` : "",
        foot: [
          d.team.breakevenReached ? badge("Point mort atteint", "ok") : d.team.breakevenConfigured ? badge("Point mort pas encore atteint") : badge("Point mort à configurer", "warn"),
          be ? el("span", { text: ` Point mort ${money(be.amount)}${be.estimated ? " (estimé)" : ""}${be.profitBeyond !== null ? ` · bénéfice du mois au-delà : ${money(be.profitBeyond)}` : ""}` }) : null,
        ],
      }),
    );
    gauges.push(gauge({ title: `Équipe · année ${d.year}`, value: d.team.yearSigned, target: d.team.yearObjective, foot: d.me?.yearObjective ? `Mon année : ${money(d.me.yearSale)} / ${money(d.me.yearObjective)}` : d.me ? `Mon année : ${money(d.me.yearSale)}` : null }));
    out.push(el("div", { class: "gauges" }, gauges));

    out.push(
      el("div", { class: "dash-grid" }, [
        el("section", { class: "card" }, [
          el("div", { class: "card-head" }, [el("h2", { text: "Classement du mois" }), el("p", { class: "muted small", text: "CA HT signé. Les commissions restent personnelles." })]),
          d.ranking.length
            ? el("ol", { class: "ranking" }, d.ranking.map((row) =>
                el("li", { class: row.me ? "me" : "" }, [
                  el("span", { class: `rank r${row.rank}`, text: String(row.rank) }),
                  el("div", { class: "who-cell" }, [el("strong", { text: row.displayName }), el("span", { class: "muted small", text: `${row.signatures} signature(s)${row.progress !== null ? ` · ${pct(row.progress)} de l'objectif` : ""}` }), row.badges.length ? el("div", { class: "badges" }, row.badges.map((b) => badge(b.label, b.key === "objective" ? "ok" : b.key.startsWith("tier") ? "info" : ""))) : null]),
                  el("strong", { class: "num", text: money(row.sale) }),
                ]),
              ))
            : el("p", { class: "muted", text: "Aucun commercial actif." }),
        ]),
        el("section", { class: "card" }, [
          el("div", { class: "card-head" }, [el("h2", { text: "Dernières bonnes nouvelles" })]),
          d.celebrations.length ? el("ul", { class: "feed" }, d.celebrations.map((item) => el("li", { class: `feed-${item.kind}${item.me ? " me" : ""}` }, [el("span", { text: item.text }), item.at ? el("span", { class: "muted small", text: dateFr(item.at) }) : null]))) : el("p", { class: "muted small", text: "La première signature du mois s'affichera ici." }),
          d.tiers.length ? el("div", {}, [el("h3", { text: "Paliers de primes" }), el("ul", { class: "tiers" }, d.tiers.map((tier) => el("li", {}, [el("strong", { text: tier.label }), el("span", { text: ` ${money(tier.threshold)} signés ${tier.periodKind === "year" ? "dans l'année" : "dans le mois"}` }), tier.reward ? el("span", { class: "muted", text: ` · ${tier.reward}` }) : null])))]) : null,
        ]),
      ]),
    );

    const statsRows = d.teamStats || (d.myStats ? [d.myStats] : []);
    if (statsRows.length) {
      out.push(
        el("section", { class: "card" }, [
          el("div", { class: "card-head" }, [el("h2", { text: d.teamStats ? "Par commercial" : "Mes chiffres" }), el("p", { class: "muted small", text: "Leads reçus dans le mois ; conversion = leads du mois passés en signé." })]),
          el("div", { class: "table-wrap" }, el("table", { class: "table" }, [
            el("thead", {}, el("tr", {}, ["Commercial", "Leads reçus", "Signés", "Perdus", "Conversion", "CA signé HT", "Signatures", "Panier moyen"].map((label, index) => el("th", { class: index ? "num" : "", text: label })))),
            el("tbody", {}, statsRows.map((row) => el("tr", {}, [el("td", { text: row.displayName }), el("td", { class: "num", text: String(row.leadsReceived) }), el("td", { class: "num", text: String(row.leadsWon) }), el("td", { class: "num", text: String(row.leadsLost) }), el("td", { class: "num", text: pct(row.conversion) }), el("td", { class: "num", text: money(row.sale) }), el("td", { class: "num", text: String(row.signatures) }), el("td", { class: "num", text: money(row.basket) })]))),
          ])),
        ]),
      );
    }

    if (sources) {
      out.push(
        el("section", { class: "card" }, [
          el("div", { class: "card-head" }, [el("h2", { text: "Quelle publicité ramène des chantiers" }), el("p", { class: "muted small", text: "Leads reçus dans le mois (doublons exclus), signés et CA HT des devis signés." })]),
          sources.sources.length
            ? el("div", { class: "table-wrap" }, el("table", { class: "table" }, [
                el("thead", {}, el("tr", {}, ["Origine / campagne", "Leads", "Signés", "Conversion", "CA signé HT", d.breakeven ? "Budget" : null, d.breakeven ? "Coût / lead" : null, d.breakeven ? "Coût / signature" : null].filter(Boolean).map((label, index) => el("th", { class: index ? "num" : "", text: label })))),
                el("tbody", {}, sources.sources.flatMap((s) => [
                  el("tr", { class: "group-row" }, [el("td", {}, el("strong", { text: s.label })), el("td", { class: "num", text: String(s.leads) }), el("td", { class: "num", text: String(s.won) }), el("td", { class: "num", text: pct(s.conversion) }), el("td", { class: "num", text: money(s.sale) }), d.breakeven ? el("td", { class: "num", text: s.spend ? money(s.spend) : "—" }) : null, d.breakeven ? el("td", { class: "num", text: money(s.costPerLead) }) : null, d.breakeven ? el("td", { class: "num", text: money(s.costPerWin) }) : null]),
                  ...s.campaigns.map((cmp) => el("tr", {}, [el("td", { class: "indent", text: cmp.campaign }), el("td", { class: "num", text: String(cmp.leads) }), el("td", { class: "num", text: String(cmp.won) }), el("td", { class: "num", text: pct(cmp.conversion) }), el("td", { class: "num", text: money(cmp.sale) }), d.breakeven ? el("td") : null, d.breakeven ? el("td") : null, d.breakeven ? el("td") : null])),
                ])),
              ]))
            : el("p", { class: "muted small", text: "Aucun lead reçu sur la période." }),
          d.breakeven ? el("p", { class: "muted small", text: "Budget = frais fixes des catégories « Publicité Meta » et « Publicité Google Ads »." }) : null,
        ]),
      );
    }
    return out;
  }

  // ---------- Commissions ----------

  views.commissions = async () => {
    setTitle("Commissions", EYEBROW, "commissions");
    const thisYear = Number(monthNow().slice(0, 4));
    const year = el("select", { "aria-label": "Année" }, options([thisYear, thisYear - 1, thisYear - 2].map((y) => [y, String(y)]), thisYear));
    const body = el("div", { class: "panel" });
    const load = async () => {
      const { commissions: c } = await api(`/api/crm/commissions?year=${year.value}`);
      const months = Object.entries(c.byMonth).sort(([a], [b]) => a.localeCompare(b));
      const max = Math.max(1, ...months.map(([, v]) => v));
      fill(
        body,
        el("div", { class: "stats" }, [stat(c.all ? "Commissions de l'équipe" : "Ma commission", money(c.total), `${c.items.length} devis signé(s) en ${c.year}`), stat("CA HT signé", money(c.sale)), stat("Déjà versé", "—", "Suivi des encaissements : iPaidThat (V3)")]),
        months.length ? el("section", { class: "card" }, [el("div", { class: "card-head" }, el("h2", { text: "Par mois" })), el("ul", { class: "bars" }, months.map(([m, v]) => el("li", {}, [el("span", { class: "muted small", text: monthLabel(m) }), el("span", { class: "bar" }, el("span", { style: `width:${(v / max) * 100}%` })), el("strong", { class: "num", text: money(v) })])))]) : null,
        c.bySeller ? el("section", { class: "card" }, [el("div", { class: "card-head" }, [el("h2", { text: "Par commercial" }), el("p", { class: "muted small", text: "Visible par l'administrateur uniquement." })]), el("div", { class: "table-wrap" }, el("table", { class: "table" }, [el("thead", {}, el("tr", {}, ["Commercial", "Devis", "CA HT", "Commission"].map((label, i) => el("th", { class: i ? "num" : "", text: label })))), el("tbody", {}, c.bySeller.map((s) => el("tr", {}, [el("td", { text: s.displayName }), el("td", { class: "num", text: String(s.count) }), el("td", { class: "num", text: money(s.sale) }), el("td", { class: "num strong", text: money(s.amount) })])))]))]) : null,
        el("section", { class: "card" }, [
          el("div", { class: "card-head" }, [el("h2", { text: "Détail par devis signé" }), el("p", { class: "muted small", text: "Calculée sur le CA HT du devis. Versée au rythme des encaissements client ; le suivi automatique arrive avec iPaidThat (V3)." })]),
          c.items.length
            ? el("div", { class: "table-wrap" }, el("table", { class: "table" }, [
                el("thead", {}, el("tr", {}, ["Devis", c.all ? "Commercial" : null, "Signé le", "CA HT", "Taux", "Commission", "Échéancier"].filter(Boolean).map((label, i) => el("th", { class: ["CA HT", "Taux", "Commission"].includes(label) ? "num" : "", text: label })))),
                el("tbody", {}, c.items.map((item) => el("tr", {}, [
                  el("td", {}, [el("a", { class: "link", href: `#devis/${item.quoteId}`, text: `${item.number} V${item.version}` }), el("span", { class: "sub", text: item.clientName })]),
                  c.all ? el("td", { text: item.commercialName }) : null,
                  el("td", { class: "nowrap", text: dateFr(item.signedAt) }),
                  el("td", { class: "num", text: money(item.sale) }),
                  el("td", { class: "num", text: pct(item.rate) }),
                  el("td", { class: "num strong", text: money(item.amount) }),
                  el("td", { class: "small muted", text: item.schedule.map((s) => `${s.label} ${money(s.amount)}`).join(" · ") }),
                ]))),
              ]))
            : el("div", { class: "empty", text: "Aucun devis signé sur cette année." }),
        ]),
      );
    };
    year.addEventListener("change", () => load().catch(fail));
    fill(view, el("section", { class: "card" }, el("div", { class: "toolbar" }, [el("div", { class: "grow" }, el("p", { class: "muted small", text: can("commissions.all") ? "Vous voyez les commissions de toute l'équipe." : "Vous seul voyez votre commission et votre taux." })), year])), body);
    await load();
  };

  // ---------- Objectifs, point mort et réglages ----------

  views.goals = async () => {
    setTitle("Objectifs et réglages", EYEBROW, "objectifs");
    const c = await context();
    const sections = [];
    if (can("goals.manage")) sections.push(await fixedCostsCard(c), await objectivesCard(), await tiersCard());
    if (can("crm.settings")) sections.push(crmSettingsCard(c));
    if (can("crm.integrations")) sections.push(await integrationsCard());
    if (!sections.length) return fill(view, el("div", { class: "empty", text: "Réservé à l'administrateur et à la direction commerciale." }));
    fill(view, ...sections);
  };

  async function fixedCostsCard(c) {
    const node = el("section", { class: "card" });
    let first = true;
    const render = ({ costs, breakeven: be }) => {
      if (!first) document.dispatchEvent(new CustomEvent("nova:goals-changed")); // l'objectif d'équipe calculé suit
      first = false;
      const row = (cost = {}) => {
        const category = el("select", { "aria-label": "Catégorie" }, options(Object.entries(c.costCategories), cost.category || "rent"));
        const label = input({ value: cost.label || "", placeholder: "Libellé", "aria-label": "Libellé" });
        const amount = numberInput(cost.monthlyAmount ?? "", { placeholder: "0", "aria-label": "Montant mensuel", class: "n" });
        const active = el("input", { type: "checkbox", checked: cost.id ? cost.active : true, "aria-label": "Actif" });
        const save = el("button", { type: "button", class: cost.id ? "secondary" : "primary", text: cost.id ? "Enregistrer" : "Ajouter" });
        save.addEventListener("click", async () => {
          try {
            render(await busy(save, () => api("/api/goals/fixed-costs", { method: "POST", body: { id: cost.id, category: category.value, label: label.value, monthlyAmount: amount.value, active: active.checked } })));
            toast("Frais fixes enregistrés.");
          } catch (error) {
            fail(error);
          }
        });
        const remove = cost.id ? el("button", { type: "button", class: "icon-btn", title: "Supprimer", "aria-label": `Supprimer ${cost.label}`, text: "×" }) : null;
        remove?.addEventListener("click", async () => {
          if (!window.confirm(`Supprimer « ${cost.label} » des frais fixes ?`)) return;
          try {
            render(await api(`/api/goals/fixed-costs/${cost.id}`, { method: "DELETE" }));
          } catch (error) {
            fail(error);
          }
        });
        return el("tr", { class: cost.id && !cost.active ? "inactive" : "" }, [el("td", {}, category), el("td", {}, label), el("td", { class: "num" }, amount), el("td", {}, active), el("td", {}, el("div", { class: "row-actions" }, [save, remove]))]);
      };
      const profit = numberInput(be.profitTarget, { "aria-label": "Bénéfice visé par mois", class: "n" });
      const saveProfit = el("button", { type: "button", class: "secondary", text: "Enregistrer" });
      saveProfit.addEventListener("click", async () => {
        try {
          const { breakeven: next } = await busy(saveProfit, () => api("/api/goals/profit-target", { method: "PUT", body: { profitTarget: profit.value } }));
          render({ costs, breakeven: next });
          toast("Bénéfice visé enregistré.");
        } catch (error) {
          fail(error);
        }
      });
      fill(
        node,
        el("div", { class: "card-head" }, [el("h2", { text: "Frais fixes et point mort" }), el("p", { class: "muted small", text: "Visible par l'administrateur uniquement. Les commerciaux ne voient que l'objectif et la jauge." })]),
        el("div", { class: "stats" }, [
          stat("Frais fixes / mois", money(be.fixedTotal)),
          stat("Marge nette moyenne", pct(be.netRate), be.estimated ? "Estimée (aucun devis signé sur 6 mois)" : `Après commission · ${be.quotesCount} devis signés sur 6 mois`),
          stat("Point mort / mois", money(be.amount), "CA HT signé minimum"),
          stat("Objectif d'équipe / mois", money(be.teamObjective), "Point mort + bénéfice visé"),
        ]),
        el("div", { class: "toolbar" }, [el("label", { class: "inline" }, [el("span", { text: "Bénéfice visé par mois" }), profit]), saveProfit]),
        el("div", { class: "table-wrap" }, el("table", { class: "table edit-table" }, [el("thead", {}, el("tr", {}, ["Catégorie", "Libellé", "Montant / mois", "Actif", ""].map((label, i) => el("th", { class: i === 2 ? "num" : "", text: label })))), el("tbody", {}, [...costs.map(row), row()])])),
      );
    };
    render(await api("/api/goals/fixed-costs"));
    return node;
  }

  async function objectivesCard() {
    const node = el("section", { class: "card" });
    let period = monthNow();
    const load = async () => render((await api(`/api/goals/objectives?period=${period}`)).objectives);
    const onChange = () => (node.isConnected ? load().catch(fail) : document.removeEventListener("nova:goals-changed", onChange));
    document.addEventListener("nova:goals-changed", onChange);
    const render = (o) => {
      const kind = el("select", { "aria-label": "Période" }, options([["month", "Mois"], ["year", "Année"]], period.length === 4 ? "year" : "month"));
      const picker = period.length === 4 ? el("select", { "aria-label": "Année" }, options([0, 1].map((i) => [String(Number(monthNow().slice(0, 4)) + i), String(Number(monthNow().slice(0, 4)) + i)]), period)) : input({ type: "month", value: period, "aria-label": "Mois" });
      kind.addEventListener("change", () => ((period = kind.value === "year" ? monthNow().slice(0, 4) : monthNow()), load().catch(fail)));
      picker.addEventListener("change", () => ((period = picker.value || period), load().catch(fail)));
      const team = numberInput(o.team.override ?? "", { placeholder: o.team.suggested !== null ? `Calculé : ${fr(o.team.suggested)}` : "À définir", class: "n", "aria-label": "Objectif d'équipe" });
      const amounts = new Map(o.sellers.map((s) => [s.id, numberInput(s.amount ?? "", { class: "n", placeholder: "—", "aria-label": `Objectif de ${s.displayName}` })]));
      const save = el("button", { type: "button", class: "primary", text: "Enregistrer les objectifs" });
      save.addEventListener("click", async () => {
        try {
          render((await busy(save, () => api("/api/goals/objectives", { method: "PUT", body: { period, team: team.value, sellers: [...amounts].map(([id, node]) => ({ id, amount: node.value })) } }))).objectives);
          toast("Objectifs enregistrés.");
        } catch (error) {
          fail(error);
        }
      });
      const split = el("button", { type: "button", class: "secondary", text: "Répartir à parts égales" });
      split.addEventListener("click", async () => {
        try {
          render((await busy(split, () => api("/api/goals/objectives/split", { method: "POST", body: { period } }))).objectives);
        } catch (error) {
          fail(error);
        }
      });
      fill(
        node,
        el("div", { class: "card-head row" }, [el("div", {}, [el("h2", { text: "Objectifs" }), el("p", { class: "muted small", text: "Mensuels ou annuels. Sans saisie, l'objectif d'équipe = point mort + bénéfice visé (× 12 pour l'année)." })]), el("div", { class: "actions" }, [kind, picker])]),
        el("div", { class: "stats" }, [stat("Objectif d'équipe", money(o.team.amount), o.team.computed ? "Calculé" : "Saisi"), stat("Réparti", money(o.assigned)), stat("Reste à répartir", money(o.remaining), o.remaining < 0 ? "Plus que l'objectif d'équipe" : "")]),
        el("div", { class: "table-wrap" }, el("table", { class: "table" }, [
          el("thead", {}, el("tr", {}, [el("th", { text: "Qui" }), el("th", { class: "num", text: "Objectif HT" })])),
          el("tbody", {}, [el("tr", {}, [el("td", {}, [el("strong", { text: "Équipe" }), el("span", { class: "sub", text: "Laissez vide pour le calcul automatique" })]), el("td", { class: "num" }, team)]), ...o.sellers.map((s) => el("tr", {}, [el("td", {}, [el("strong", { text: s.displayName }), el("span", { class: "sub", text: s.role === "direction_commerciale" ? "Direction commerciale" : "Commercial" })]), el("td", { class: "num" }, amounts.get(s.id))]))]),
        ])),
        el("div", { class: "actions" }, [split, save]),
      );
    };
    await load();
    return node;
  }

  async function tiersCard() {
    const node = el("section", { class: "card" });
    const render = (tiers) => {
      const row = (tier = {}) => {
        const label = input({ value: tier.label || "", placeholder: "Bronze", "aria-label": "Nom du palier" });
        const kind = el("select", { "aria-label": "Période" }, options([["month", "Par mois"], ["year", "Par an"]], tier.periodKind || "month"));
        const threshold = numberInput(tier.threshold ?? "", { class: "n", placeholder: "30000", "aria-label": "Seuil de CA signé" });
        const reward = input({ value: tier.reward || "", placeholder: "Prime de 300 €", "aria-label": "Récompense" });
        const save = el("button", { type: "button", class: tier.id ? "secondary" : "primary", text: tier.id ? "Enregistrer" : "Ajouter" });
        save.addEventListener("click", async () => {
          try {
            render((await busy(save, () => api("/api/goals/tiers", { method: "POST", body: { id: tier.id, label: label.value, periodKind: kind.value, threshold: threshold.value, reward: reward.value, active: true } }))).tiers);
          } catch (error) {
            fail(error);
          }
        });
        const remove = tier.id ? el("button", { type: "button", class: "icon-btn", text: "×", "aria-label": `Supprimer ${tier.label}` }) : null;
        remove?.addEventListener("click", async () => {
          if (!window.confirm(`Supprimer le palier « ${tier.label} » ?`)) return;
          try {
            render((await api(`/api/goals/tiers/${tier.id}`, { method: "DELETE" })).tiers);
          } catch (error) {
            fail(error);
          }
        });
        return el("tr", {}, [el("td", {}, label), el("td", {}, kind), el("td", { class: "num" }, threshold), el("td", {}, reward), el("td", {}, el("div", { class: "row-actions" }, [save, remove]))]);
      };
      fill(node, el("div", { class: "card-head" }, [el("h2", { text: "Paliers de primes" }), el("p", { class: "muted small", text: "CA HT signé par commercial. Les paliers sont visibles par toute l'équipe ; le badge s'affiche dès qu'il est franchi." })]), el("div", { class: "table-wrap" }, el("table", { class: "table edit-table" }, [el("thead", {}, el("tr", {}, ["Palier", "Période", "Seuil HT", "Récompense", ""].map((label, i) => el("th", { class: i === 2 ? "num" : "", text: label })))), el("tbody", {}, [...tiers.map(row), row()])])));
    };
    render((await api("/api/goals/tiers")).tiers);
    return node;
  }

  function crmSettingsCard(c) {
    const s = c.settings;
    const assignment = el("div", { class: "segmented", role: "group", "aria-label": "Attribution des leads" });
    let mode = s.assignment;
    const setMode = (next) => {
      mode = next;
      fill(assignment, [["round_robin", "Tour de rôle"], ["manual", "Manuelle"]].map(([value, label]) => el("button", { type: "button", "aria-pressed": String(mode === value), text: label, onclick: () => setMode(value) })));
    };
    setMode(mode);
    const rotation = new Map(c.sellers.filter((u) => u.role !== "admin").map((u) => [u.id, el("input", { type: "checkbox", checked: !s.rotation.length || s.rotation.includes(u.id) })]));
    const delays = Object.fromEntries(c.stages.filter((st) => s.stageDays[st.key] !== undefined).map((st) => [st.key, input({ type: "number", min: "1", max: "90", value: String(s.stageDays[st.key]), class: "n", "aria-label": `Relance ${st.label}` })]));
    const reasons = textarea({ rows: 6, value: s.lostReasons.join("\n") });
    const save = el("button", { type: "button", class: "primary", text: "Enregistrer les réglages" });
    save.addEventListener("click", async () => {
      try {
        const all = [...rotation].every(([, box]) => box.checked);
        const { settings } = await busy(save, () => api("/api/crm/settings", { method: "PUT", body: { assignment: mode, rotation: all ? [] : [...rotation].filter(([, box]) => box.checked).map(([id]) => id), stageDays: Object.fromEntries(Object.entries(delays).map(([key, node]) => [key, Number(node.value)])), lostReasons: reasons.value.split("\n") } }));
        crmCtx.settings = { ...crmCtx.settings, ...settings };
        toast("Réglages du CRM enregistrés.");
      } catch (error) {
        fail(error);
      }
    });
    return el("section", { class: "card" }, [
      el("div", { class: "card-head" }, [el("h2", { text: "Réglages du pipeline" })]),
      el("div", { class: "settings-grid" }, [
        el("div", {}, [el("h3", { text: "Attribution des nouveaux leads" }), assignment, el("p", { class: "muted small", text: "Tour de rôle : chaque lead va au commercial suivant de la liste. Un client déjà connu revient à son commercial." }), el("ul", { class: "checks" }, c.sellers.filter((u) => u.role !== "admin").map((u) => el("li", {}, el("label", { class: "check" }, [rotation.get(u.id), el("span", { text: u.displayName })]))))]),
        el("div", {}, [el("h3", { text: "Relancer après (jours sans bouger)" }), el("div", { class: "delays" }, Object.entries(delays).map(([key, node]) => el("label", {}, [el("span", { text: stageLabel(key) }), node])))]),
        el("div", {}, [el("h3", { text: "Motifs de perte" }), reasons, el("p", { class: "muted small", text: "Un motif par ligne." })]),
      ]),
      el("div", { class: "actions" }, save),
    ]);
  }

  async function integrationsCard() {
    const i = await api("/api/crm/integrations");
    const copy = (text) => el("button", { type: "button", class: "secondary small-btn", text: "Copier", onclick: () => navigator.clipboard?.writeText(text).then(() => toast("Adresse copiée."), () => toast(text)) });
    const block = (title, item, envs, help) =>
      el("div", { class: "integration" }, [
        el("div", { class: "integration-head" }, [el("h3", { text: title }), item.configured ? badge("Branché", "ok") : badge("À configurer", "warn")]),
        el("div", { class: "url-row" }, [el("code", { class: "code", text: item.url }), copy(item.url)]),
        el("p", { class: "muted small", text: help }),
        el("p", { class: "muted small", text: `Variables Railway : ${envs.join(", ")}` }),
        el("p", { class: "small", text: item.last ? `${item.last.count} lead(s) reçu(s), dernier le ${dateTimeFr(item.last.at)}` : "Aucun lead reçu pour l'instant." }),
      ]);
    return el("section", { class: "card" }, [
      el("div", { class: "card-head" }, [el("h2", { text: "Branchements des formulaires" }), el("p", { class: "muted small", text: "Les clés restent dans les variables d'environnement Railway, jamais dans l'application. Pas à pas : RAILWAY.md, section « Leads »." })]),
      el("div", { class: "integrations" }, [
        block("Meta Lead Ads (Facebook / Instagram)", i.meta, ["META_APP_SECRET", "META_VERIFY_TOKEN", "META_PAGE_ACCESS_TOKEN"], `Webhook de l'application Meta, champ « leadgen ». ${i.meta.canFetch ? "" : "Sans jeton de page, les leads arrivent incomplets. "}API Graph ${i.meta.version}.`),
        block("Google Ads (formulaires de lead)", i.google, ["NOVA_GOOGLE_LEADS_KEY"], "Dans Google Ads : formulaire → Intégration webhook, adresse ci-dessus et la même clé."),
        block("Site internet (WordPress)", i.website, ["NOVA_WEBSITE_LEADS_KEY"], "Envoi du formulaire depuis le serveur WordPress (extrait fourni dans RAILWAY.md), avec l'en-tête X-Nova-Key."),
      ]),
    ]);
  }

  // ---------- Routes ----------

  window.ND.addRoute(/^#pipeline$/, "pipeline", () => views.pipeline());
  window.ND.addRoute(/^#lead\/([0-9a-f-]{36})$/, "pipeline", (id) => views.lead(id));
  window.ND.addRoute(/^#tableau-de-bord$/, "tableau-de-bord", () => views.dashboard());
  window.ND.addRoute(/^#commissions$/, "commissions", () => views.commissions());
  window.ND.addRoute(/^#objectifs$/, "objectifs", () => views.goals());
})();

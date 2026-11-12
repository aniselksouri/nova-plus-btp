"use strict";

// Bibliothèque d'ouvrages (lots, import CSV, comparatif ST) ; sous-traitants, documents obligatoires
// et grilles de prix (brouillon → envoyée → signée, versions).

(() => {
  const { P, el, fill, api, can, money, pct, fr, dateFr, dateTimeFr, todayIso, addMonthsIso, options, toast, fail, debounce, busy, filePayload, statusBadge, setTitle, sheet, field, input, numberInput, libraryPicker, stat, views, view } = window.ND;

  // ---------- Bibliothèque ----------

  views.library = async () => {
    setTitle("Bibliothèque d'ouvrages", "Prix de référence, unités, marges par lot", "bibliotheque");
    const writable = can("library.write");
    const margins = can("library.margins");
    let lots = [];
    let currentLot = "";
    const search = input({ type: "search", placeholder: "Code, libellé, fournisseur…", "aria-label": "Rechercher un ouvrage" });
    const lotNav = el("ul", { class: "lot-list" });
    const itemsBody = el("div");

    const loadLots = async () => {
      ({ lots } = await api("/api/library/lots"));
      const total = lots.reduce((sum, lot) => sum + (lot.itemsCount || 0), 0);
      fill(lotNav, 
        el("li", {}, el("button", { type: "button", "aria-current": String(currentLot === ""), onclick: () => selectLot("") }, ["Tous les lots", el("small", { text: String(total) })])),
        ...lots.map((lot) => el("li", {}, el("button", { type: "button", "aria-current": String(currentLot === lot.id), onclick: () => selectLot(lot.id) }, [
          el("span", {}, [lot.name, el("small", { text: ` ${lot.code}${lot.laborMargin !== null && margins ? ` · ${fr(lot.laborMargin)} %` : ""}` })]),
          el("small", { text: String(lot.itemsCount || 0) }),
        ]))),
      );
    };
    const selectLot = async (lotId) => {
      currentLot = lotId;
      await loadLots();
      await loadItems();
    };
    const loadItems = async () => {
      const { items } = await api(`/api/library/items?q=${encodeURIComponent(search.value)}&lot=${currentLot}`);
      if (!items.length) {
        fill(itemsBody, el("div", { class: "empty", text: search.value || currentLot ? "Aucun ouvrage ici." : "Bibliothèque vide. Importez votre fichier (CSV exporté d'Excel) ou créez les ouvrages un par un." }));
        return;
      }
      fill(itemsBody, el("div", { class: "table-wrap" }, el("table", { class: "table" }, [
        el("thead", {}, el("tr", {}, ["Code", "Ouvrage", "Unité", "Coût ST réf.", "Fourniture pro / public", margins ? "Marges" : null, "TVA", ""].filter((v) => v !== null).map((label, index) => el("th", { class: index === 3 || index === 4 ? "num" : "", text: label })))),
        el("tbody", {}, items.map((item) => el("tr", { class: item.archived ? "inactive" : "" }, [
          el("td", { class: "nowrap code", text: item.code }),
          el("td", {}, [el("strong", { text: item.label }), el("span", { class: "sub", text: [item.lotName, item.supplier].filter(Boolean).join(" · ") })]),
          el("td", { text: item.unit }),
          el("td", { class: "num", text: money(item.laborCost) }),
          el("td", { class: "num", text: `${money(item.supplyProPrice)} / ${money(item.supplyPublicPrice)}` }),
          margins ? el("td", { class: "nowrap muted", text: `MO ${item.laborMargin !== null ? pct(item.laborMargin) : "lot"} · F ${item.supplyMargin !== null ? pct(item.supplyMargin) : "lot"}` }) : null,
          el("td", { text: item.vatRate !== null ? `${fr(item.vatRate)} %` : "défaut" }),
          el("td", { class: "actions nowrap" }, [
            el("button", { class: "secondary mini", type: "button", text: "Comparer les ST", onclick: () => compareSheet(item) }),
            writable ? el("button", { class: "secondary mini", type: "button", text: "Modifier", onclick: () => itemSheet(item) }) : null,
          ]),
        ]))),
      ])));
    };

    function lotSheet(lot = null) {
      const l = lot || {};
      const name = input({ value: l.name || "", placeholder: "Carrelage" });
      const code = input({ value: l.code || "", placeholder: "CAR (automatique si vide)" });
      const position = input({ type: "number", value: l.position ?? lots.length + 1 });
      const laborMargin = numberInput(l.laborMargin, { placeholder: "Marge de l'entreprise" });
      const supplyMargin = numberInput(l.supplyMargin, { placeholder: "Marge de l'entreprise" });
      sheet({
        title: lot ? `Lot ${lot.name}` : "Nouveau lot",
        body: [
          el("div", { class: "fields-2" }, [field("Nom", name), field("Code", code)]),
          field("Ordre d'affichage", position),
          margins ? el("div", { class: "fields-2" }, [field("Marge prestation du lot (%)", laborMargin), field("Marge fourniture du lot (%)", supplyMargin)]) : el("p", { class: "muted small", text: "Les marges par lot sont réservées à l'administrateur." }),
        ],
        actions: [{ label: "Enregistrer", primary: true, onClick: async () => {
          await api("/api/library/lots", { method: "POST", body: { id: lot?.id, name: name.value, code: code.value, position: position.value, laborMargin: laborMargin.value, supplyMargin: supplyMargin.value } });
          await loadLots();
        } }],
      });
    }

    function itemSheet(item = null) {
      const i = item || {};
      const f = {
        code: input({ value: i.code || "", placeholder: "CAR-01" }),
        lotId: el("select", {}, options(lots.map((lot) => [lot.id, lot.name]), i.lotId || currentLot || lots[0]?.id)),
        label: input({ value: i.label || "", placeholder: "Pose carrelage sol" }),
        description: el("textarea", { rows: 3, value: i.description || "" }),
        unit: input({ value: i.unit || "m²", list: "unitList" }),
        laborCost: numberInput(i.laborCost),
        supplier: input({ value: i.supplier || "" }),
        supplierRef: input({ value: i.supplierRef || "" }),
        supplyProPrice: numberInput(i.supplyProPrice),
        supplyPublicPrice: numberInput(i.supplyPublicPrice),
        laborMargin: numberInput(i.laborMargin, { placeholder: "Celle du lot" }),
        supplyMargin: numberInput(i.supplyMargin, { placeholder: "Celle du lot" }),
        vatRate: el("select", {}, options([["", "TVA par défaut"], ...(window.ND.ctx.company.billing.vatRates || []).map((rate) => [rate, `${fr(rate)} %`])], i.vatRate ?? "")),
        archived: el("input", { type: "checkbox", checked: i.archived }),
      };
      if (!lots.length) return toast("Créez d'abord un lot.", "error");
      sheet({
        title: item ? `Ouvrage ${item.code}` : "Nouvel ouvrage",
        large: true,
        body: [
          el("div", { class: "fields-2" }, [field("Code", f.code), field("Lot", f.lotId)]),
          field("Libellé", f.label),
          field("Description (reprise sur le devis)", f.description),
          el("div", { class: "fields-2" }, [field("Unité", f.unit), field("Coût ST de référence (HT / unité)", f.laborCost, "Le prix réel vient de la grille signée du ST choisi.")]),
          el("div", { class: "fields-2" }, [field("Fournisseur", f.supplier), field("Référence fournisseur", f.supplierRef)]),
          el("div", { class: "fields-2" }, [field("Prix fourniture pro (HT)", f.supplyProPrice), field("Prix public conseillé (HT)", f.supplyPublicPrice, "S'il existe, il sert de prix de vente de la fourniture.")]),
          margins ? el("div", { class: "fields-2" }, [field("Marge prestation (%)", f.laborMargin), field("Marge fourniture (%)", f.supplyMargin)]) : null,
          field("TVA", f.vatRate),
          el("label", { class: "check" }, [f.archived, el("span", { text: "Archivé (n'apparaît plus dans les devis)" })]),
          el("datalist", { id: "unitList" }, ["m²", "ml", "u", "forfait", "m³", "h", "jour", "kg", "lot"].map((unit) => el("option", { value: unit }))),
        ],
        actions: [{ label: "Enregistrer", primary: true, onClick: async () => {
          const body = Object.fromEntries(Object.entries(f).map(([key, node]) => [key, node.type === "checkbox" ? node.checked : node.value]));
          if (!margins) {
            delete body.laborMargin;
            delete body.supplyMargin;
          }
          await api("/api/library/items", { method: "POST", body: { ...body, id: item?.id } });
          await loadLots();
          await loadItems();
        } }],
      });
    }

    function importSheet() {
      const file = el("input", { type: "file", accept: ".csv,text/csv" });
      const report = el("div");
      let csv = "";
      const analyse = async () => {
        if (!file.files[0]) return toast("Choisissez un fichier CSV.", "error"), false;
        csv = await file.files[0].text();
        const { report: r } = await api("/api/library/import", { method: "POST", body: { csv, apply: false } });
        fill(report, 
          el("div", { class: "stats" }, [stat("Lignes lues", String(r.rows)), stat("Nouveaux", String(r.created)), stat("Mis à jour", String(r.updated)), stat("Inchangés", String(r.unchanged)), stat("Erreurs", String(r.errors.length), "", r.errors.length ? "bad" : "ok")]),
          r.lotsCreated.length ? el("p", { class: "muted small", text: `Lots créés : ${r.lotsCreated.join(", ")}` }) : null,
          r.ignoredColumns.length ? el("p", { class: "muted small", text: `Colonnes ignorées : ${r.ignoredColumns.join(", ")}` }) : null,
          r.errors.length ? el("div", { class: "alerts" }, r.errors.slice(0, 30).map((error) => el("p", { class: "blocking", text: `Ligne ${error.line} : ${error.message}` }))) : null,
        );
        return false;
      };
      sheet({
        title: "Importer la bibliothèque",
        large: true,
        intro: "CSV exporté d'Excel (séparateur ; ou ,). Colonnes reconnues : code, lot, libellé, description, unité, coût ST, fournisseur, réf. fournisseur, prix public, prix pro, marge MO, marge fourniture, TVA. Le code identifie l'ouvrage : une nouvelle importation met à jour sans doublon.",
        body: [
          field("Fichier", file),
          el("a", { class: "link small", href: "/api/library/export.csv", text: "Télécharger la bibliothèque actuelle comme modèle" }),
          report,
        ],
        actions: [
          { label: "Analyser", onClick: analyse },
          { label: "Importer", primary: true, onClick: async () => {
            if (!csv) await analyse();
            if (!csv) return false;
            const { report: r } = await api("/api/library/import", { method: "POST", body: { csv, apply: true } });
            toast(`Import terminé : ${r.created} créé(s), ${r.updated} mis à jour${r.errors.length ? `, ${r.errors.length} ligne(s) ignorée(s)` : ""}.`);
            await loadLots();
            await loadItems();
          } },
        ],
      });
    }

    search.addEventListener("input", debounce(() => loadItems().catch(fail), 250));
    fill(view, 
      el("div", { class: "lib-layout" }, [
        el("section", { class: "card" }, [
          el("div", { class: "card-head row" }, [el("h2", { text: "Lots" }), writable ? el("button", { class: "link", type: "button", text: "+ Lot", onclick: () => lotSheet() }) : null]),
          lotNav,
          writable ? el("p", { class: "muted small" }, el("button", { class: "link", type: "button", text: "Modifier le lot sélectionné", onclick: () => { const lot = lots.find((l) => l.id === currentLot); lot ? lotSheet(lot) : toast("Sélectionnez un lot.", "error"); } })) : null,
        ]),
        el("section", { class: "card" }, [
          el("div", { class: "toolbar" }, [
            el("div", { class: "grow" }, search),
            el("a", { class: "secondary", href: "/api/library/export.csv", text: "Exporter" }),
            writable ? el("button", { class: "secondary", type: "button", text: "Importer un CSV", onclick: importSheet }) : null,
            writable ? el("button", { class: "primary", type: "button", text: "Nouvel ouvrage", onclick: () => itemSheet() }) : null,
          ]),
          itemsBody,
        ]),
      ]),
    );
    await loadLots();
    await loadItems();
  };

  async function compareSheet(item) {
    const { prices } = await api(`/api/library/items/${item.id}/compare`).catch((error) => (fail(error), { prices: null }));
    if (!prices) return;
    sheet({
      title: `Comparatif ST · ${item.code}`,
      intro: item.label,
      large: true,
      body: [
        prices.length
          ? el("div", { class: "table-wrap" }, el("table", { class: "table" }, [
              el("thead", {}, el("tr", {}, ["Sous-traitant", "Prix signé", "Valable jusqu'au", "En négociation"].map((label, index) => el("th", { class: index === 1 ? "num" : "", text: label })))),
              el("tbody", {}, prices.map((entry) => el("tr", {}, [
                el("td", {}, [el("strong", { text: entry.name }), entry.best ? el("span", { class: "badge ok", style: "margin-left:8px", text: "Moins cher" }) : null]),
                el("td", { class: "num" }, entry.signed ? [money(entry.signed.laborPrice), el("span", { class: "sub", text: `V${entry.signed.version} · ${entry.signed.statusLabel}` })] : "—"),
                el("td", { text: entry.signed ? dateFr(entry.signed.endsOn) : "—" }),
                el("td", { text: entry.pending ? `${money(entry.pending.laborPrice)} (V${entry.pending.version} ${entry.pending.statusLabel.toLowerCase()})` : "—" }),
              ]))),
            ]))
          : el("div", { class: "empty", text: "Aucun sous-traitant n'a encore de prix pour cet ouvrage." }),
      ],
      actions: [],
    });
  }

  // ---------- Sous-traitants ----------

  const complianceBadge = (compliance) => {
    if (!compliance) return null;
    if (compliance.blocked) return el("span", { class: "badge bad", title: compliance.issues.map((issue) => issue.message).join(" · "), text: "Documents à jour requis" });
    if (compliance.issues.length) return el("span", { class: "badge warn", title: compliance.issues.map((issue) => issue.message).join(" · "), text: "Expire bientôt" });
    return el("span", { class: "badge ok", text: "Documents à jour" });
  };

  views.subcontractors = async () => {
    setTitle("Sous-traitants et grilles", "Prix signés, documents obligatoires", "sous-traitants");
    const showAll = el("input", { type: "checkbox" });
    const body = el("div");
    const load = async () => {
      const { subcontractors } = await api(`/api/st${showAll.checked ? "?all=1" : ""}`);
      fill(body, 
        subcontractors.length
          ? el("div", { class: "table-wrap" }, el("table", { class: "table" }, [
              el("thead", {}, el("tr", {}, ["Sous-traitant", "Lots", "Documents", "Grille en vigueur", "Contact"].map((label) => el("th", { text: label })))),
              el("tbody", {}, subcontractors.map((st) => el("tr", { class: `clickable${st.active ? "" : " inactive"}`, onclick: () => (window.location.hash = `#st/${st.id}`) }, [
                el("td", {}, [el("strong", { text: st.name }), el("span", { class: "sub", text: st.siret ? `SIRET ${st.siret}` : st.legacyId ? "Repris du suivi des chantiers" : "" })]),
                el("td", { text: st.lots.join(", ") || "—" }),
                el("td", {}, complianceBadge(st.compliance)),
                el("td", {}, st.activeGrid ? [`V${st.activeGrid.version} · ${st.activeGrid.linesCount} prix`, el("span", { class: "sub", text: `jusqu'au ${dateFr(st.activeGrid.endsOn)}` })] : el("span", { class: "muted", text: st.gridsCount ? "Aucune grille signée en vigueur" : "Aucune grille" })),
                el("td", { text: [st.contactName, st.phone].filter(Boolean).join(" · ") || "—" }),
              ]))),
            ]))
          : el("div", { class: "empty", text: "Aucun sous-traitant. Ceux du suivi des chantiers sont repris automatiquement." }),
      );
    };
    showAll.addEventListener("change", () => load().catch(fail));
    fill(view, el("section", { class: "card" }, [
      el("div", { class: "toolbar" }, [
        el("label", { class: "check grow" }, [showAll, el("span", { text: "Afficher les inactifs" })]),
        can("st.write") ? el("button", { class: "primary", type: "button", text: "Nouveau sous-traitant", onclick: () => stSheet() }) : null,
      ]),
      body,
    ]));
    await load();
  };

  function stSheet(st = null) {
    const s = st || {};
    const f = {
      name: input({ value: s.name || "", placeholder: "SARL Carrelage Nord" }),
      siret: input({ value: s.siret || "", inputmode: "numeric" }),
      address: input({ value: s.address || "" }),
      lots: input({ value: (s.lots || []).join(", "), placeholder: "Carrelage, Faïence" }),
      contactName: input({ value: s.contactName || "" }),
      phone: input({ value: s.phone || "", type: "tel" }),
      email: input({ value: s.email || "", type: "email" }),
      notes: el("textarea", { rows: 2, value: s.notes || "" }),
      active: el("input", { type: "checkbox", checked: st ? st.active : true }),
    };
    sheet({
      title: st ? st.name : "Nouveau sous-traitant",
      body: [
        el("div", { class: "fields-2" }, [field("Raison sociale", f.name), field("SIRET", f.siret)]),
        field("Adresse", f.address),
        field("Lots réalisés", f.lots, "Séparés par des virgules."),
        el("div", { class: "fields-2" }, [field("Contact", f.contactName), field("Téléphone", f.phone)]),
        field("E-mail", f.email),
        field("Notes", f.notes),
        el("label", { class: "check" }, [f.active, el("span", { text: "Actif" })]),
      ],
      actions: [{ label: "Enregistrer", primary: true, onClick: async () => {
        const body = Object.fromEntries(Object.entries(f).map(([key, node]) => [key, node.type === "checkbox" ? node.checked : node.value]));
        const { subcontractor } = await api("/api/st", { method: "POST", body: { ...body, id: st?.id } });
        if (st) await views.subcontractor(st.id);
        else window.location.hash = `#st/${subcontractor.id}`;
      } }],
    });
  }

  const DOC_KINDS = [["decennale", "Attestation décennale"], ["kbis", "Extrait Kbis"], ["urssaf", "Attestation de vigilance URSSAF"], ["rc_pro", "Attestation RC pro"], ["autre", "Autre document"]];

  views.subcontractor = async (id) => {
    const { subcontractor: st } = await api(`/api/st/${id}`);
    setTitle(st.name, "Sous-traitant", "sous-traitants");
    const writable = can("st.write");

    const docs = st.documents.length
      ? el("ul", { class: "list" }, st.documents.map((doc) => {
          const expired = doc.expiresOn && doc.expiresOn < todayIso();
          return el("li", {}, [
            el("span", { class: "name" }, [doc.kindLabel, el("small", { text: [doc.label !== doc.kindLabel ? doc.label : null, doc.expiresOn ? `valable jusqu'au ${dateFr(doc.expiresOn)}` : "sans échéance"].filter(Boolean).join(" · ") })]),
            el("span", { class: "actions" }, [
              expired ? statusBadge("expired", "Expiré") : null,
              doc.url ? el("a", { class: "secondary mini", href: doc.url, target: "_blank", rel: "noopener", text: "Voir" }) : null,
              writable ? el("button", { class: "secondary mini", type: "button", text: "Retirer", onclick: async () => {
                if (!window.confirm(`Retirer « ${doc.kindLabel} » ?`)) return;
                await api(`/api/st/documents/${doc.id}`, { method: "DELETE" }).catch(fail);
                await views.subcontractor(id);
              } }) : null,
            ]),
          ]);
        }))
      : el("p", { class: "muted", text: "Aucun document." });

    const grids = st.grids.length
      ? el("div", { class: "table-wrap" }, el("table", { class: "table" }, [
          el("thead", {}, el("tr", {}, ["Version", "Période", "Statut", "Prix", ""].map((label) => el("th", { text: label })))),
          el("tbody", {}, st.grids.map((grid) => el("tr", { class: "clickable", onclick: () => (window.location.hash = `#grille/${grid.id}`) }, [
            el("td", { class: "strong", text: `V${grid.version}` }),
            el("td", { class: "nowrap", text: `${dateFr(grid.startsOn)} → ${dateFr(grid.endsOn)}` }),
            el("td", {}, statusBadge(grid.displayStatus, grid.statusLabel)),
            el("td", { text: String(grid.linesCount ?? "") }),
            el("td", { class: "muted small", text: grid.signedAt ? `signée le ${dateFr(grid.signedAt)}` : grid.sentAt ? `envoyée le ${dateFr(grid.sentAt)}` : "" }),
          ]))),
        ]))
      : el("p", { class: "muted", text: "Aucune grille : sans grille signée, ses lignes de devis restent bloquées." });

    fill(view, 
      el("section", { class: "card" }, [
        el("div", { class: "card-head row" }, [
          el("div", {}, [el("h2", { text: "Fiche" }), el("p", { class: "muted small" }, [el("a", { class: "link", href: "#sous-traitants", text: "← Tous les sous-traitants" })])]),
          el("div", { class: "actions" }, [complianceBadge(st.compliance), writable ? el("button", { class: "secondary", type: "button", text: "Modifier", onclick: () => stSheet(st) }) : null]),
        ]),
        el("dl", { class: "facts" }, [
          fact("SIRET", st.siret || "—"),
          fact("Lots", st.lots.join(", ") || "—"),
          fact("Contact", [st.contactName, st.phone, st.email].filter(Boolean).join(" · ") || "—"),
          fact("Adresse", st.address || "—"),
        ]),
        st.compliance.issues.length ? el("div", { class: "alerts" }, st.compliance.issues.map((issue) => el("p", { class: issue.level === "expiring" ? "warning" : "blocking", text: `${issue.message}${issue.level !== "expiring" ? " : bons de commande bloqués" : ""}` }))) : null,
      ]),
      el("section", { class: "card" }, [
        el("div", { class: "card-head row" }, [
          el("div", {}, [el("h2", { text: "Documents obligatoires" }), el("p", { class: "muted small", text: "Décennale, Kbis (moins de 3 mois) et vigilance URSSAF (6 mois) à jour, sinon le bon de commande est bloqué." })]),
          writable ? el("button", { class: "secondary", type: "button", text: "Ajouter un document", onclick: () => documentSheet(st) }) : null,
        ]),
        docs,
      ]),
      el("section", { class: "card" }, [
        el("div", { class: "card-head row" }, [
          el("div", {}, [el("h2", { text: "Grilles de prix" }), el("p", { class: "muted small", text: "Une grille signée n'est plus modifiable : un changement de prix crée une nouvelle version." })]),
          writable ? el("button", { class: "primary", type: "button", text: "Nouvelle grille", onclick: (event) => newGrid(event.currentTarget, st) }) : null,
        ]),
        grids,
      ]),
    );
  };

  function fact(label, value) {
    return el("div", {}, [el("dt", { text: label }), el("dd", { text: value })]);
  }

  function documentSheet(st) {
    const kind = el("select", {}, options(DOC_KINDS, "decennale"));
    const expires = input({ type: "date" });
    const label = input({ placeholder: "Assureur, n° de police…" });
    const file = el("input", { type: "file", accept: "application/pdf,image/*" });
    const hint = el("small");
    const refreshHint = () => (hint.textContent = { urssaf: "Vide : 6 mois à partir d'aujourd'hui.", kbis: "Vide : 3 mois à partir d'aujourd'hui.", autre: "Facultatif." }[kind.value] || "Obligatoire : date de fin indiquée sur l'attestation.");
    kind.addEventListener("change", refreshHint);
    refreshHint();
    sheet({
      title: `Document · ${st.name}`,
      body: [field("Type", kind), el("label", {}, [el("span", { text: "Valable jusqu'au" }), expires, hint]), field("Précision", label), field("Fichier", file)],
      actions: [{ label: "Ajouter", primary: true, onClick: async () => {
        await api(`/api/st/${st.id}/documents`, { method: "POST", body: { kind: kind.value, expiresOn: expires.value || null, label: label.value, file: await filePayload(file.files[0]) } });
        await views.subcontractor(st.id);
      } }],
    });
  }

  async function newGrid(button, st) {
    await busy(button, async () => {
      const start = todayIso();
      const end = addMonthsIso(start, 12);
      const { grid } = await api("/api/grids", { method: "POST", body: { subcontractorId: st.id, startsOn: start, endsOn: end, lines: [] } });
      window.location.hash = `#grille/${grid.id}`;
    }).catch(fail);
  }

  // ---------- Grille de prix ----------

  views.grid = async (id) => {
    const { grid } = await api(`/api/grids/${id}`);
    setTitle(`Grille V${grid.version} · ${grid.subcontractorName}`, "Grille de prix sous-traitant", "sous-traitants");
    const editable = can("st.write") && ["draft", "sent"].includes(grid.status);
    let lines = grid.lines.map((line) => ({ ...line }));
    const startsOn = input({ type: "date", value: grid.startsOn, disabled: !editable });
    const endsOn = input({ type: "date", value: grid.endsOn, disabled: !editable });
    const notes = el("textarea", { rows: 2, value: grid.notes || "", disabled: !editable });
    const table = el("div");
    const state = el("p", { class: "save-state" });
    let changed = false;
    const markChanged = () => {
      changed = true;
      state.textContent = grid.status === "sent" ? "Modifications non enregistrées : la grille repassera en brouillon." : "Modifications non enregistrées.";
    };
    [startsOn, endsOn, notes].forEach((node) => node.addEventListener("input", markChanged));

    const renderTable = () => {
      if (!lines.length) {
        fill(table, el("div", { class: "empty", text: editable ? "Ajoutez les ouvrages que ce sous-traitant réalise, avec son prix." : "Grille vide." }));
        return;
      }
      fill(table, el("div", { class: "table-wrap" }, el("table", { class: "table" }, [
        el("thead", {}, el("tr", {}, ["Code", "Ouvrage", "Unité", "Prix MO HT", "Fourniture incluse", "Prix fourniture HT", ""].map((label, index) => el("th", { class: index === 3 || index === 5 ? "num" : "", text: label })))),
        el("tbody", {}, lines.map((line, index) => {
          const labor = numberInput(line.laborPrice, { class: "n wide", disabled: !editable, style: "width:100px;text-align:right", "aria-label": `Prix ${line.code}` });
          const included = el("input", { type: "checkbox", checked: line.supplyIncluded, disabled: !editable, "aria-label": "Fourniture incluse" });
          const supply = numberInput(line.supplyPrice, { disabled: !editable || !line.supplyIncluded, style: "width:100px;text-align:right", "aria-label": "Prix fourniture" });
          labor.addEventListener("input", () => { line.laborPrice = P.num(labor.value); markChanged(); });
          supply.addEventListener("input", () => { line.supplyPrice = P.num(supply.value); markChanged(); });
          included.addEventListener("change", () => { line.supplyIncluded = included.checked; if (!included.checked) line.supplyPrice = null; markChanged(); renderTable(); });
          return el("tr", {}, [
            el("td", { class: "code nowrap", text: line.code }),
            el("td", {}, [el("strong", { text: line.label }), el("span", { class: "sub", text: line.lotName })]),
            el("td", { text: line.unit }),
            el("td", { class: "num" }, editable ? labor : money(line.laborPrice)),
            el("td", {}, included),
            el("td", { class: "num" }, editable ? supply : line.supplyIncluded ? money(line.supplyPrice) : "—"),
            el("td", {}, editable ? el("button", { class: "icon-btn", type: "button", "aria-label": "Retirer", text: "×", onclick: () => { lines.splice(index, 1); markChanged(); renderTable(); } }) : null),
          ]);
        })),
      ])));
    };

    const save = async () => {
      if (lines.some((line) => line.laborPrice === null || line.laborPrice === undefined)) throw new Error("Indiquez un prix de main-d'œuvre sur chaque ligne (0 si inclus ailleurs).");
      await api(`/api/grids/${id}`, { method: "PUT", body: { startsOn: startsOn.value, endsOn: endsOn.value, notes: notes.value, lines } });
      changed = false;
    };
    window.ND.setLeaveHook(async () => {
      if (changed && window.confirm("Enregistrer les modifications de la grille avant de quitter ?")) await save();
    });

    const addItems = async () => {
      const choice = await libraryPicker({ title: "Ouvrages de la grille", confirmLabel: "Ajouter à la grille" });
      if (!choice) return;
      const present = new Set(lines.map((line) => line.itemId));
      choice.items.filter((item) => !present.has(item.id)).forEach((item) => lines.push({ itemId: item.id, code: item.code, label: item.label, unit: item.unit, lotName: item.lotName, laborPrice: item.laborCost ?? null, supplyIncluded: false, supplyPrice: null }));
      markChanged();
      renderTable();
    };

    const actions = [el("a", { class: "secondary", href: `/api/grids/${id}/pdf`, target: "_blank", rel: "noopener", text: editable ? "PDF à signer" : "PDF de la grille" })];
    if (grid.signedUrl) actions.push(el("a", { class: "secondary", href: grid.signedUrl, target: "_blank", rel: "noopener", text: "Grille signée" }));
    if (can("st.write")) {
      if (editable) {
        actions.push(el("button", { class: "secondary", type: "button", text: "Ajouter des ouvrages", onclick: addItems }));
        actions.push(el("button", { class: "primary", type: "button", text: "Enregistrer", onclick: (event) => busy(event.currentTarget, async () => { await save(); toast("Grille enregistrée."); await views.grid(id); }).catch(fail) }));
        actions.push(el("button", { class: "secondary", type: "button", text: grid.status === "sent" ? "Renvoyer" : "Marquer envoyée", onclick: (event) => busy(event.currentTarget, async () => {
          if (changed) await save();
          await api(`/api/grids/${id}/send`, { method: "POST", body: {} });
          toast("Grille marquée envoyée. Transmettez le PDF au sous-traitant pour signature.");
          await views.grid(id);
        }).catch(fail) }));
        actions.push(el("button", { class: "primary", type: "button", text: "Déposer la grille signée", onclick: () => signedSheet() }));
      } else {
        actions.push(el("button", { class: "secondary", type: "button", text: "Nouvelle version", onclick: (event) => busy(event.currentTarget, async () => {
          const { grid: next } = await api(`/api/grids/${id}/new-version`, { method: "POST", body: {} });
          window.location.hash = `#grille/${next.id}`;
        }).catch(fail) }));
      }
    }

    function signedSheet() {
      const file = el("input", { type: "file", accept: "application/pdf,image/*" });
      sheet({
        title: "Grille signée par le sous-traitant",
        intro: "Après dépôt, les prix ne sont plus modifiables et alimentent les devis. Une version signée plus ancienne sur la même période est remplacée.",
        body: [field("Document signé", file)],
        actions: [{ label: "Valider", primary: true, onClick: async () => {
          if (!file.files[0]) return toast("Joignez la grille signée.", "error"), false;
          if (changed) await save();
          await api(`/api/grids/${id}/signed`, { method: "POST", body: { file: await filePayload(file.files[0]) } });
          toast("Grille signée : ses prix sont utilisés dans les devis.");
          await views.grid(id);
        } }],
      });
    }

    const EVENTS = { sent: "Marquée envoyée", signed: "Signée", uploaded: "Document signé déposé", generated: "PDF généré" };
    fill(view, 
      el("section", { class: "card" }, [
        el("div", { class: "card-head row" }, [
          el("div", {}, [
            el("div", { class: "chips" }, [statusBadge(grid.displayStatus, grid.statusLabel)]),
            el("p", { class: "muted small" }, el("a", { class: "link", href: `#st/${grid.subcontractorId}`, text: `← ${grid.subcontractorName}` })),
          ]),
          el("div", { class: "actions" }, actions),
        ]),
        el("div", { class: "meta-grid" }, [
          el("label", {}, [el("span", { text: "Début" }), startsOn]),
          el("label", {}, [el("span", { text: "Fin" }), endsOn]),
          el("label", { class: "span-2" }, [el("span", { text: "Notes" }), notes]),
        ]),
        state,
      ]),
      el("section", { class: "card" }, [el("div", { class: "card-head" }, [el("h2", { text: `Prix (${lines.length})` })]), table]),
      grid.events.length
        ? el("section", { class: "card" }, [
            el("h2", { text: "Historique" }),
            el("ul", { class: "list" }, grid.events.map((event) => el("li", {}, [el("span", { class: "name", text: EVENTS[event.event] || event.event }), el("span", { class: "meta", text: dateTimeFr(event.at) })]))),
          ])
        : null,
    );
    renderTable();
  };
})();

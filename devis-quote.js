"use strict";

// Éditeur de devis et d'avenant : lignes par lot, coûts ST de la grille, marges, TVA par ligne,
// totaux et alertes en direct, envoi, signature sur place ou dépôt, bons de commande ST.

(() => {
  const { P, el, fill, api, can, money, pct, fr, dateFr, dateTimeFr, options, toast, fail, busy, filePayload, statusBadge, setTitle, sheet, field, input, numberInput, signaturePad, libraryPicker, stat, views, view } = window.ND;

  const MODE_LABELS = { both: "MO + fourniture", labor: "Main-d'œuvre", supply: "Fourniture" };
  const SCOPE_LABELS = { labor: "ST : main-d'œuvre", both: "ST : MO + fourniture", supply: "ST : fourniture", none: "MO interne" };
  const EVENT_LABELS = { generated: "Document généré", sent: "Marqué envoyé", opened: "Ouvert", signed: "Signé", refused: "Refusé", reminder: "Relance", uploaded: "Document déposé" };
  const RERENDER = ["laborCost", "laborPriceOverride", "supplyPriceOverride", "supplyPublicPrice", "laborMargin", "supplyMargin"];
  const NUMERIC = ["quantity", "laborCost", "laborMargin", "supplyProCost", "supplyMargin", "supplyPublicPrice", "laborPriceOverride", "supplyPriceOverride"];

  let keySeq = 0;
  const withKey = (line) => ({ ...line, _k: line._k || `k${++keySeq}` });

  views.quote = async (id) => {
    const ctx = window.ND.ctx;
    const [{ quote: initial }, stList] = await Promise.all([api(`/api/quotes/${id}`), api("/api/st").catch(() => ({ subcontractors: [] }))]);
    let quote = initial;
    const subcontractors = stList.subcontractors || [];
    const stById = new Map(subcontractors.map((st) => [st.id, st]));
    const editable = quote.status === "draft" && can("quotes.write");
    const costs = quote.canSeeCosts;
    const vatRates = ctx.company.billing.vatRates || [20, 10, 5.5];
    const minimumNet = ctx.company.margins.minimumNet;

    // ---------- État et sauvegarde ----------
    let lines = quote.lines.map(withKey);
    let meta = { title: quote.title || "", commercialId: quote.commercialId || "", validDays: quote.validDays, workStartOn: quote.workStartOn || "", schedule: (quote.schedule || []).map((s) => ({ ...s })), scheduleMode: quote.scheduleMode, notes: quote.notes || "" };
    const selected = new Set();
    const openDetails = new Set();
    let dirty = false;
    let saving = null;
    let saveTimer = null;
    let saveError = null;
    let saveStateNode = null;

    const payload = () => ({
      ...meta,
      validDays: P.num(meta.validDays),
      lines: lines.map(({ _k, subcontractorName, ...line }) => line),
    });

    async function save() {
      clearTimeout(saveTimer);
      if (saving) {
        await saving;
        if (!dirty) return;
      }
      if (!dirty || !editable) return;
      dirty = false;
      const keys = lines.map((line) => line._k);
      renderSaveState("saving");
      saving = api(`/api/quotes/${id}`, { method: "PUT", body: payload() })
        .then(({ quote: fresh }) => {
          saveError = null;
          quote = fresh;
          if (!dirty) {
            // Aucune saisie pendant l'enregistrement : on reprend les lignes du serveur (prix de grille à jour).
            const before = JSON.stringify(lines.map(stripVolatile));
            lines = fresh.lines.map((line, index) => ({ ...line, _k: keys[index] || `k${++keySeq}` }));
            if (JSON.stringify(lines.map(stripVolatile)) !== before) renderLines();
            else updateComputed();
          } else {
            // Saisie en cours : on récupère seulement les identifiants des nouvelles lignes.
            fresh.lines.forEach((line, index) => {
              const local = lines.find((candidate) => candidate._k === keys[index]);
              if (local && !local.id) local.id = line.id;
            });
          }
          renderSaveState();
        })
        .catch((error) => {
          saveError = error.message;
          dirty = true;
          renderSaveState();
          fail(error);
        })
        .finally(() => (saving = null));
      await saving;
      if (dirty && !saveError) await save();
    }
    const scheduleSave = (delay = 700) => {
      if (!editable) return;
      dirty = true;
      renderSaveState("pending");
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => save(), delay);
    };
    const flush = async () => {
      if (dirty || saving) await save();
      if (saveError) throw new Error(`Enregistrement impossible : ${saveError}`);
    };
    window.ND.setLeaveHook(flush);
    const beforeUnload = (event) => {
      if (dirty || saving) {
        save();
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("hashchange", () => window.removeEventListener("beforeunload", beforeUnload), { once: true });

    function stripVolatile(line) {
      const { _k, subcontractorName, ...rest } = line;
      return rest;
    }

    function computed() {
      if (!costs || !editable) return quote.computed;
      const enriched = lines.map((line) => ({ ...line, subcontractorBlocked: line.subcontractorId ? Boolean(stById.get(line.subcontractorId)?.compliance?.blocked) : false }));
      const result = P.computeQuote({ lines: enriched, commissionRate: quote.commissionRate }, { minimumNetMargin: minimumNet, frozen: quote.status === "signed" });
      if (!quote.canSeeCommission) Object.assign(result, { commission: null, net: null, netRate: null, commissionRate: null });
      return result;
    }

    // ---------- Structure de la page ----------
    setTitle(`${quote.displayNumber} · ${quote.versionLabel}`, quote.dossier.clientName, "dossiers");
    const head = el("section", { class: "card" });
    const metaCard = el("section", { class: "card" });
    const linesCard = el("section", { class: "card" });
    const after = el("div", { class: "panel" });
    const summary = el("aside", { class: "summary" });
    fill(view, head, el("div", { class: "editor" }, [el("div", { class: "panel" }, [metaCard, linesCard, after]), summary]));

    renderHead();
    renderMeta();
    renderLines();
    renderAfter();

    // ---------- En-tête : statut et actions ----------
    function renderHead() {
      const actions = [];
      const pdfLink = el("a", { class: "secondary", href: `/api/quotes/${id}/pdf`, target: "_blank", rel: "noopener", text: quote.status === "signed" ? "PDF du devis" : "Aperçu PDF" });
      pdfLink.addEventListener("click", async (event) => {
        if (!dirty && !saving) return;
        event.preventDefault();
        await flush().then(() => window.open(pdfLink.href, "_blank", "noopener")).catch(fail);
      });
      actions.push(pdfLink);
      if (quote.signedUrl) actions.push(el("a", { class: "secondary", href: quote.signedUrl, target: "_blank", rel: "noopener", text: "Document signé" }));
      if (can("quotes.write")) {
        if (["draft", "sent"].includes(quote.status)) {
          actions.push(el("button", { class: "secondary", type: "button", text: quote.status === "sent" ? "Renvoyer" : "Marquer envoyé", onclick: (event) => markSent(event.currentTarget) }));
          actions.push(el("button", { class: "secondary", type: "button", text: "Refusé", onclick: refuseSheet }));
        }
        if (["sent", "refused"].includes(quote.status)) actions.push(el("button", { class: "secondary", type: "button", text: "Nouvelle version", onclick: (event) => newVersion(event.currentTarget) }));
        if (["draft", "sent"].includes(quote.status)) actions.push(el("button", { class: "primary", type: "button", text: "Faire signer", onclick: signSheet }));
        if (quote.status === "signed" && quote.amendmentNo === 0) actions.push(el("button", { class: "primary", type: "button", text: "Ajouter un avenant", onclick: amendmentSheet }));
      }
      const info = [];
      if (quote.status === "sent") info.push(`Envoyé le ${dateFr(quote.sentAt)} : il ne se modifie plus, créez une nouvelle version pour changer un prix.`);
      if (quote.status === "signed") info.push(`Signé le ${dateFr(quote.signedAt)}${quote.signature?.signerName ? ` par ${quote.signature.signerName}` : ""} : coûts, marges et commission sont figés.${quote.amendmentNo === 0 ? " Toute modification passe par un avenant." : ""}`);
      if (quote.withdrawalUntil) info.push(`Délai de rétractation jusqu'au ${dateFr(quote.withdrawalUntil)}${quote.earlyStartRequested ? " (démarrage anticipé demandé par le client)" : ""}.`);
      if (quote.status === "refused") info.push(`Refusé le ${dateFr(quote.refusedAt)}${quote.refusalReason ? ` : ${quote.refusalReason}` : ""}.`);
      if (quote.status === "superseded") info.push("Remplacé par une version plus récente.");
      if (quote.forced) info.push("Signature forcée par l'administrateur malgré une alerte bloquante.");
      const siblings = quote.siblings.filter((s) => s.amendmentNo === quote.amendmentNo);
      fill(head, 
        el("div", { class: "card-head row" }, [
          el("div", {}, [
            el("div", { class: "chips" }, [
              statusBadge(quote.status, quote.statusLabel),
              ...siblings.map((s) => el("a", { class: `chip${s.id === id ? " current" : ""}`, href: `#devis/${s.id}`, text: `V${s.version} · ${s.statusLabel}` })),
            ]),
            el("p", { class: "muted small" }, [el("a", { class: "link", href: `#dossier/${quote.dossierId}`, text: `← Dossier ${quote.dossier.clientName}` }), quote.dossier.offPremises ? " · contrat hors établissement" : ""]),
          ]),
          el("div", { class: "actions" }, actions),
        ]),
        info.length ? el("div", { class: "alerts" }, info.map((message) => el("p", { class: quote.status === "refused" ? "warning" : "fine", text: message }))) : null,
      );
    }

    async function markSent(button) {
      await busy(button, async () => {
        await flush();
        ({ quote } = await api(`/api/quotes/${id}/send`, { method: "POST", body: {} }));
        toast("Devis marqué envoyé : les prix sont figés pour cette version. Envoyez le PDF au client.");
        await views.quote(id);
      }).catch(fail);
    }

    function refuseSheet() {
      const reason = input({ placeholder: "Trop cher, délai, concurrent…" });
      sheet({
        title: "Devis refusé",
        body: [field("Motif (facultatif)", reason, "Sert au suivi commercial ; une nouvelle version reste possible.")],
        actions: [{ label: "Marquer refusé", danger: true, onClick: async () => {
          await flush();
          await api(`/api/quotes/${id}/refuse`, { method: "POST", body: { reason: reason.value } });
          await views.quote(id);
        } }],
      });
    }

    async function newVersion(button) {
      await busy(button, async () => {
        const { quote: fresh } = await api(`/api/quotes/${id}/new-version`, { method: "POST", body: {} });
        toast(`Version ${fresh.version} créée : l'ancienne est conservée.`);
        window.location.hash = `#devis/${fresh.id}`;
      }).catch(fail);
    }

    function amendmentSheet() {
      const title = input({ placeholder: "Travaux supplémentaires" });
      const mode = el("select", {}, options([["separate", "Payé à part (50 % signature, 50 % fin)"], ["merge", "Ajouté aux échéances restantes"]], "separate"));
      sheet({
        title: `Avenant au devis ${quote.number}`,
        intro: "Mêmes ouvrages, ST et marges. Quantités négatives possibles pour une moins-value.",
        body: [field("Objet", title), field("Échéancier", mode)],
        actions: [{ label: "Créer l'avenant", primary: true, onClick: async () => {
          const { quote: fresh } = await api(`/api/quotes/${id}/amendment`, { method: "POST", body: { title: title.value, scheduleMode: mode.value } });
          window.location.hash = `#devis/${fresh.id}`;
        } }],
      });
    }

    // ---------- Conditions du devis ----------
    function renderMeta() {
      const disabled = !editable;
      const commercial = el("select", { disabled: disabled || ctx.user.role === "commercial" }, options([["", "—"], ...ctx.commercials.map((c) => [c.id, c.displayName])], meta.commercialId));
      commercial.addEventListener("change", () => {
        meta.commercialId = commercial.value;
        scheduleSave(0);
      });
      const bind = (node, key, transform = (v) => v) => {
        node.addEventListener("input", () => (meta[key] = transform(node.value)));
        node.addEventListener("change", () => scheduleSave(200));
        return node;
      };
      const title = bind(input({ value: meta.title, disabled, placeholder: quote.amendmentNo ? "Objet de l'avenant" : "Rénovation salle de bain" }), "title");
      const validDays = bind(input({ type: "number", min: 1, max: 365, value: meta.validDays, disabled }), "validDays");
      const workStart = bind(input({ type: "date", value: meta.workStartOn, disabled }), "workStartOn");
      const notes = bind(el("textarea", { rows: 2, value: meta.notes, disabled, placeholder: "Conditions particulières imprimées sur le devis" }), "notes");

      const scheduleRows = el("div", { class: "schedule-edit" });
      const scheduleTotal = el("small");
      const renderSchedule = () => {
        const total = P.round2(meta.schedule.reduce((sum, step) => sum + (P.num(step.percent) || 0), 0));
        scheduleTotal.textContent = total === 100 ? "Total 100 %" : `Total ${fr(total)} % : l'échéancier doit faire 100 %`;
        scheduleTotal.className = total === 100 ? "muted" : "error-text";
        fill(scheduleRows, 
          ...meta.schedule.map((step, index) => {
            const label = input({ value: step.label, disabled, "aria-label": `Échéance ${index + 1}` });
            const percent = numberInput(step.percent, { disabled, "aria-label": `Pourcentage échéance ${index + 1}` });
            label.addEventListener("input", () => (step.label = label.value));
            percent.addEventListener("input", () => {
              step.percent = P.num(percent.value) ?? 0;
              const t = P.round2(meta.schedule.reduce((sum, s) => sum + (P.num(s.percent) || 0), 0));
              scheduleTotal.textContent = t === 100 ? "Total 100 %" : `Total ${fr(t)} % : l'échéancier doit faire 100 %`;
              scheduleTotal.className = t === 100 ? "muted" : "error-text";
            });
            const commit = () => {
              const t = P.round2(meta.schedule.reduce((sum, s) => sum + (P.num(s.percent) || 0), 0));
              if (t === 100) scheduleSave(200);
            };
            label.addEventListener("change", commit);
            percent.addEventListener("change", commit);
            return el("div", { class: "row" }, [label, percent, editable && meta.schedule.length > 1 ? el("button", { class: "icon-btn", type: "button", title: "Retirer", "aria-label": "Retirer l'échéance", text: "×", onclick: () => { meta.schedule.splice(index, 1); renderSchedule(); } }) : el("span")]);
          }),
          editable ? el("button", { class: "link", type: "button", text: "+ Ajouter une échéance", onclick: () => { meta.schedule.push({ label: "Échéance", percent: 0 }); renderSchedule(); } }) : null,
        );
      };
      renderSchedule();

      const scheduleMode = quote.amendmentNo
        ? el("select", { disabled }, options([["separate", "Payé à part"], ["merge", "Ajouté aux échéances du devis"]], meta.scheduleMode))
        : null;
      scheduleMode?.addEventListener("change", () => {
        meta.scheduleMode = scheduleMode.value;
        scheduleSave(0);
      });

      fill(metaCard, 
        el("div", { class: "card-head" }, [el("h2", { text: quote.amendmentNo ? "Avenant" : "Conditions" })]),
        el("div", { class: "meta-grid" }, [
          el("label", { class: "span-2" }, [el("span", { text: "Objet" }), title]),
          el("label", {}, [el("span", { text: "Commercial" }), commercial]),
          el("label", {}, [el("span", { text: "Validité (jours)" }), validDays]),
          el("label", {}, [el("span", { text: "Début des travaux prévu" }), workStart]),
          scheduleMode ? el("label", {}, [el("span", { text: "Paiement de l'avenant" }), scheduleMode]) : null,
          el("div", { class: "field span-2" }, [el("span", { text: "Échéancier de paiement" }), scheduleRows, scheduleTotal]),
          el("label", { class: "span-2" }, [el("span", { text: "Conditions particulières" }), notes]),
        ]),
      );
    }

    // ---------- Lignes ----------
    function lotOrder() {
      const order = [];
      lines.forEach((line) => {
        const lot = line.lotName || "Divers";
        if (!order.includes(lot)) order.push(lot);
      });
      return order;
    }

    function costTag(line, result) {
      if (!P.includesLabor(line)) return null;
      if (line.stScope === "none") return el("span", { class: "cost-tag", text: "MO interne" });
      const grid = P.num(line.gridLaborCost);
      if (grid === null) return line.forced ? el("span", { class: "cost-tag warn", text: "Forcé (admin)" }) : el("span", { class: "cost-tag bad", text: line.subcontractorId ? "Aucun prix ST signé" : "ST à choisir" });
      const exception = result.exceptions.find((item) => item.kind === "cost");
      if (exception) return el("span", { class: "cost-tag warn", text: `Hors grille ${exception.diff > 0 ? "+" : ""}${money(exception.diff)} (${exception.diffRate > 0 ? "+" : ""}${fr(exception.diffRate)} %)` });
      return el("span", { class: "cost-tag ok", text: `Grille ${money(grid)}` });
    }

    function bindLine(node, line, key, { numeric = NUMERIC.includes(key), structural = false } = {}) {
      node.dataset.k = `${line._k}:${key}`;
      const read = () => (node.type === "checkbox" ? node.checked : numeric ? P.num(node.value) : node.value);
      if (node.tagName === "SELECT" || node.type === "checkbox") {
        node.addEventListener("change", () => {
          line[key] = read();
          if (key === "subcontractorId" || key === "stScope") line.laborCostSource = "grid";
          structural ? renderLines() : updateComputed();
          scheduleSave(structural ? 0 : 500);
        });
      } else {
        node.addEventListener("input", () => {
          line[key] = read();
          if (key === "laborCost") line.laborCostSource = "manual";
          updateComputed();
        });
        node.addEventListener("change", () => {
          // Après la sortie du champ (le focus est déjà sur le suivant) : badges grille / hors grille et motif.
          if (structural || RERENDER.includes(key)) setTimeout(renderLines, 0);
          scheduleSave(structural ? 0 : 700);
        });
      }
      return node;
    }

    function renderLines() {
      const active = document.activeElement?.dataset?.k;
      const caret = active && document.activeElement.selectionStart !== undefined ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
      const result = computed();
      const byLine = new Map(lines.map((line, index) => [line._k, result.lines[index]]));
      const lotStats = new Map((result.lots || []).map((lot) => [lot.name, lot]));
      const columns = costs
        ? ["", "Ouvrage", "Qté", "Unité", "Prestation", "Sous-traitant", "Coût MO", "Marge MO", "Fourn. pro", "Marge F.", "TVA", "PU HT", "Total HT", ""]
        : ["Ouvrage", "Qté", "Unité", "TVA", "PU HT", "Total HT"];
      const rows = [];
      for (const lot of lotOrder()) {
        const stats = lotStats.get(lot);
        const lotLines = lines.filter((line) => (line.lotName || "Divers") === lot);
        rows.push(el("tr", { class: "group" }, el("td", { colspan: columns.length }, [
          lot,
          el("span", { class: "lot-stats", dataset: { outLot: lot }, text: lotStatsText(stats) }),
          editable && costs ? el("button", { class: "link small", type: "button", style: "margin-left:12px", text: "Marge du lot", onclick: () => marginSheet(lotLines, `lot ${lot}`) }) : null,
        ])));
        lotLines.forEach((line) => rows.push(...lineRows(line, byLine.get(line._k), columns.length)));
      }
      const table = lines.length
        ? el("div", { class: "lines-wrap" }, el("table", { class: "lines", style: costs ? "" : "min-width:640px" }, [
            el("thead", {}, el("tr", {}, columns.map((label, index) => el("th", { class: (costs ? index >= 11 && index <= 12 : index >= 4) ? "num" : "", text: label })))),
            el("tbody", {}, rows),
          ]))
        : el("div", { class: "empty", text: editable ? "Devis vide. Ajoutez des ouvrages depuis la bibliothèque : prix ST de la grille signée et marges sont repris automatiquement." : "Aucune ligne." });

      fill(linesCard, 
        el("div", { class: "card-head row" }, [
          el("div", {}, [el("h2", { text: "Ouvrages" }), costs ? el("p", { class: "muted small", text: "Vente = coût ÷ (1 − marge). Le prix ST vient de la grille signée du sous-traitant ; tout écart exige un motif." }) : null]),
          editable ? el("div", { class: "actions" }, [
            el("button", { class: "secondary", type: "button", text: "Ligne libre", onclick: addFreeLine }),
            el("button", { class: "secondary", type: "button", text: "Marge du devis", onclick: () => marginSheet(lines, "devis entier") }),
            el("button", { class: "primary", type: "button", text: "Ajouter depuis la bibliothèque", onclick: addFromLibrary }),
          ]) : null,
        ]),
        editable && selected.size ? bulkBar() : null,
        table,
      );
      updateComputed(result);
      if (active) {
        const node = linesCard.querySelector(`[data-k="${CSS.escape(active)}"]`);
        if (node) {
          node.focus();
          if (caret && node.setSelectionRange) try { node.setSelectionRange(...caret); } catch {}
        }
      }
    }

    function lotStatsText(stats) {
      if (!stats) return "";
      return `  ·  ${money(stats.sale)} HT${costs && stats.marginRate !== undefined ? `  ·  marge ${pct(stats.marginRate)}` : ""}`;
    }

    function lineRows(line, result, span) {
      if (!costs) {
        return [el("tr", {}, [
          el("td", { class: "label-cell" }, [el("strong", { text: line.label }), line.description ? el("span", { class: "sub muted small", text: line.description }) : null]),
          el("td", { class: "computed", text: fr(line.quantity) }),
          el("td", { text: line.unit }),
          el("td", { text: `${fr(line.vatRate)} %` }),
          el("td", { class: "computed", text: money(result?.unitPrice) }),
          el("td", { class: "computed strong", text: money(result?.sale) }),
        ])];
      }
      const d = !editable;
      const isSelected = selected.has(line._k);
      const withLabor = P.includesLabor(line);
      const withSupply = P.includesSupply(line);
      const check = el("input", { type: "checkbox", checked: isSelected, disabled: d, "aria-label": `Sélectionner ${line.label}` });
      check.addEventListener("change", () => {
        check.checked ? selected.add(line._k) : selected.delete(line._k);
        renderLines();
      });
      const stSelect = bindLine(el("select", { disabled: d || line.stScope === "none", "aria-label": "Sous-traitant" }, options([["", "— à choisir —"], ...subcontractors.map((st) => [st.id, `${st.name}${st.compliance?.blocked ? " ⚠" : ""}`])], line.subcontractorId)), line, "subcontractorId", { structural: true });
      const scope = bindLine(el("select", { disabled: d, "aria-label": "Portée ST" }, options(Object.entries(SCOPE_LABELS), line.stScope)), line, "stScope", { structural: true });
      const expanded = openDetails.has(line._k);
      const exceptionNeeded = result.exceptions.length > 0;
      const row = el("tr", { class: isSelected ? "selected" : "" }, [
        el("td", {}, check),
        el("td", { class: "label-cell" }, [bindLine(input({ value: line.label, disabled: d, "aria-label": "Libellé" }), line, "label"), el("span", { class: "code", text: [line.code, line.subcontractorName && !line.subcontractorId ? line.subcontractorName : ""].filter(Boolean).join(" · ") })]),
        el("td", {}, bindLine(numberInput(line.quantity, { class: "n", disabled: d, "aria-label": "Quantité" }), line, "quantity")),
        el("td", {}, bindLine(input({ value: line.unit, disabled: d, style: "width:62px", "aria-label": "Unité" }), line, "unit")),
        el("td", {}, bindLine(el("select", { disabled: d, "aria-label": "Prestation" }, options(Object.entries(MODE_LABELS), line.mode)), line, "mode", { structural: true })),
        el("td", {}, el("div", { style: "display:grid;gap:4px;min-width:170px" }, [stSelect, scope])),
        el("td", {}, withLabor ? [bindLine(numberInput(line.laborCost, { class: "n wide", disabled: d, "aria-label": "Coût main-d'œuvre unitaire" }), line, "laborCost"), costTag(line, result)] : el("span", { class: "muted", text: "—" })),
        el("td", {}, withLabor ? [bindLine(numberInput(line.laborMargin, { class: "n", disabled: d, "aria-label": "Marge prestation %" }), line, "laborMargin"), el("span", { class: "cost-tag", text: `→ ${money(result.laborUnit)}` })] : el("span", { class: "muted", text: "—" })),
        el("td", {}, withSupply ? bindLine(numberInput(line.supplyProCost, { class: "n wide", disabled: d, "aria-label": "Coût fourniture pro" }), line, "supplyProCost") : el("span", { class: "muted", text: "—" })),
        el("td", {}, withSupply ? [bindLine(numberInput(line.supplyMargin, { class: "n", disabled: d || supplyUsesPublic(line), "aria-label": "Marge fourniture %" }), line, "supplyMargin"), el("span", { class: "cost-tag", text: supplyUsesPublic(line) ? "prix public" : `→ ${money(result.supplyUnit)}` })] : el("span", { class: "muted", text: "—" })),
        el("td", {}, bindLine(el("select", { disabled: d, "aria-label": "TVA" }, options(vatRates.map((rate) => [rate, `${fr(rate)} %`]), line.vatRate)), line, "vatRate", { numeric: true })),
        el("td", { class: "computed", dataset: { out: `${line._k}:unit` } }),
        el("td", { class: "computed strong", dataset: { out: `${line._k}:total` } }),
        el("td", { class: "nowrap" }, [
          el("button", { class: "icon-btn", type: "button", title: "Détails", "aria-label": "Détails de la ligne", "aria-expanded": String(expanded), text: exceptionNeeded && !line.exceptionReason ? "!" : "⋯", onclick: () => { expanded ? openDetails.delete(line._k) : openDetails.add(line._k); renderLines(); } }),
          editable ? el("button", { class: "icon-btn", type: "button", title: "Supprimer", "aria-label": "Supprimer la ligne", text: "×", style: "margin-left:4px", onclick: () => removeLines([line._k]) }) : null,
        ]),
      ]);
      const out = [row];
      if (exceptionNeeded && !String(line.exceptionReason || "").trim() && editable) openDetails.add(line._k);
      if (openDetails.has(line._k)) out.push(detailsRow(line, result, span));
      return out;
    }

    function supplyUsesPublic(line) {
      const publicPrice = P.num(line.supplyPublicPrice);
      return line.supplyPricing === "public" || (line.supplyPricing !== "margin" && publicPrice !== null && publicPrice > 0);
    }

    function detailsRow(line, result, span) {
      const d = !editable;
      const exceptionNeeded = result.exceptions.length > 0;
      const reason = bindLine(input({ value: line.exceptionReason || "", disabled: d, placeholder: "Ex. accès difficile, urgence, négociation client" }), line, "exceptionReason");
      const fields = [
        el("label", { class: "span-2" }, [el("span", { text: "Description (imprimée sur le devis)" }), bindLine(el("textarea", { rows: 2, value: line.description || "", disabled: d }), line, "description")]),
        el("label", {}, [el("span", { text: "Lot" }), bindLine(input({ value: line.lotName || "", disabled: d, list: "lotNames" }), line, "lotName", { structural: true })]),
        el("label", {}, [el("span", { text: "Code" }), bindLine(input({ value: line.code || "", disabled: d }), line, "code")]),
      ];
      if (P.includesSupply(line)) {
        fields.push(
          el("label", {}, [el("span", { text: "Prix public fourniture" }), bindLine(numberInput(line.supplyPublicPrice, { disabled: d }), line, "supplyPublicPrice", { structural: true })]),
          el("label", {}, [el("span", { text: "Vente fourniture" }), bindLine(el("select", { disabled: d }, options([["auto", "Prix public s'il existe"], ["public", "Prix public"], ["margin", "Coût pro + marge"]], line.supplyPricing)), line, "supplyPricing", { structural: true })]),
          el("label", {}, [el("span", { text: "Fournisseur" }), bindLine(input({ value: line.supplier || "", disabled: d }), line, "supplier")]),
          el("label", {}, [el("span", { text: "PU fourniture forcé" }), bindLine(numberInput(line.supplyPriceOverride, { disabled: d, placeholder: money(result.supplyUnit) }), line, "supplyPriceOverride")]),
        );
      }
      if (P.includesLabor(line)) {
        fields.push(el("label", {}, [el("span", { text: "PU prestation forcé" }), bindLine(numberInput(line.laborPriceOverride, { disabled: d, placeholder: money(P.saleFromMargin(line.laborCost, line.laborMargin)) }), line, "laborPriceOverride")]));
      }
      if (exceptionNeeded || line.exceptionReason) {
        fields.push(el("label", { class: "span-2" }, [el("span", { text: exceptionNeeded ? "Motif de l'exception (obligatoire)" : "Motif" }), reason, el("small", { text: result.exceptions.map((item) => `${item.label} : ${money(item.reference)} → ${money(item.actual)} (${item.diffTotal > 0 ? "+" : ""}${money(item.diffTotal)} sur la ligne)`).join(" · ") })]));
      }
      const actions = [];
      if (editable && line.laborCostSource === "manual" && P.num(line.gridLaborCost) !== null) {
        actions.push(el("button", { class: "secondary mini", type: "button", text: `Revenir au prix de la grille (${money(line.gridLaborCost)})`, onclick: () => {
          line.laborCost = line.gridLaborCost;
          line.laborCostSource = "grid";
          renderLines();
          scheduleSave(0);
        } }));
      }
      if (line.gridEndsOn) actions.push(el("span", { class: "muted small", text: `Grille valable jusqu'au ${dateFr(line.gridEndsOn)}` }));
      if (can("quotes.force") && P.includesLabor(line) && line.stScope !== "none" && P.num(line.gridLaborCost) === null) {
        const forced = bindLine(el("input", { type: "checkbox", checked: line.forced, disabled: d }), line, "forced", { structural: true });
        actions.push(el("label", { class: "check" }, [forced, el("span", { text: "Forcer sans prix ST validé (administrateur, tracé)" })]));
      }
      return el("tr", { class: "details" }, el("td", { colspan: span }, [
        el("div", { class: "detail-grid" }, fields),
        actions.length ? el("div", { class: "actions", style: "margin-top:10px;justify-content:flex-start" }, actions) : null,
      ]));
    }

    function bulkBar() {
      const st = el("select", { "aria-label": "Sous-traitant des lignes sélectionnées" }, options([["", "Attribuer un sous-traitant…"], ...subcontractors.map((s) => [s.id, s.name])], ""));
      st.addEventListener("change", () => {
        if (!st.value) return;
        lines.filter((line) => selected.has(line._k)).forEach((line) => {
          line.subcontractorId = st.value;
          if (line.stScope === "none") line.stScope = "labor";
          line.laborCostSource = "grid";
        });
        renderLines();
        scheduleSave(0);
      });
      const scope = el("select", { "aria-label": "Portée ST des lignes sélectionnées" }, options([["", "Portée ST…"], ...Object.entries(SCOPE_LABELS)], ""));
      scope.addEventListener("change", () => {
        if (!scope.value) return;
        lines.filter((line) => selected.has(line._k)).forEach((line) => {
          line.stScope = scope.value;
          line.laborCostSource = "grid";
        });
        renderLines();
        scheduleSave(0);
      });
      return el("div", { class: "bulk" }, [
        `${selected.size} ligne(s)`,
        st,
        scope,
        el("button", { class: "secondary mini", type: "button", text: "Marge…", onclick: () => marginSheet(lines.filter((line) => selected.has(line._k)), `${selected.size} ligne(s)`) }),
        el("button", { class: "secondary mini", type: "button", text: "Supprimer", onclick: () => removeLines([...selected]) }),
        el("button", { class: "link", type: "button", text: "Désélectionner", onclick: () => { selected.clear(); renderLines(); } }),
      ]);
    }

    function removeLines(keys) {
      const set = new Set(keys);
      const count = lines.filter((line) => set.has(line._k)).length;
      if (count > 1 && !window.confirm(`Supprimer ${count} lignes du devis ?`)) return;
      lines = lines.filter((line) => !set.has(line._k));
      keys.forEach((key) => {
        selected.delete(key);
        openDetails.delete(key);
      });
      renderLines();
      scheduleSave(0);
    }

    function marginSheet(target, scopeLabel) {
      const labor = numberInput("", { placeholder: fr(ctx.company.margins.labor) });
      const supply = numberInput("", { placeholder: fr(ctx.company.margins.supply) });
      sheet({
        title: `Appliquer une marge · ${scopeLabel}`,
        intro: "Taux sur le prix de vente. Laisser vide pour ne pas changer. Les prix forcés de ces lignes sont retirés ; la fourniture passe en « coût pro + marge ».",
        body: [el("div", { class: "fields-2" }, [field("Marge prestation (%)", labor), field("Marge fourniture (%)", supply)])],
        actions: [{ label: "Appliquer", primary: true, onClick: () => {
          const keys = new Set(target.map((line) => line._k));
          const values = { labor: P.num(labor.value), supply: P.num(supply.value) };
          if (values.labor === null && values.supply === null) return toast("Indiquez au moins un taux.", "error"), false;
          if ([values.labor, values.supply].some((v) => v !== null && (v < 0 || v >= 95))) return toast("Le taux doit être compris entre 0 et 95 %.", "error"), false;
          const updated = P.applyMargin(lines.filter((line) => keys.has(line._k)), values);
          const byKey = new Map(updated.map((line) => [line._k, line]));
          lines = lines.map((line) => byKey.get(line._k) || line);
          renderLines();
          scheduleSave(0);
        } }],
      });
    }

    function addFreeLine() {
      const line = withKey({ id: null, itemId: null, code: "", lotName: lotOrder().slice(-1)[0] || "Divers", label: "Nouvelle ligne", description: "", unit: "u", quantity: 1, mode: "both", subcontractorId: null, stScope: "labor", laborCost: null, laborCostSource: "manual", laborMargin: ctx.company.margins.labor, supplyProCost: null, supplyPublicPrice: null, supplyPricing: "auto", supplyMargin: ctx.company.margins.supply, vatRate: ctx.company.billing.defaultVatRate ?? 20, exceptionReason: "", forced: false });
      lines.push(line);
      openDetails.add(line._k);
      renderLines();
      linesCard.querySelector(`[data-k="${line._k}:label"]`)?.select();
      scheduleSave();
    }

    async function addFromLibrary() {
      const choice = await libraryPicker({ withSubcontractor: true, subcontractors });
      if (!choice) return;
      try {
        await flush();
        const keys = lines.map((line) => line._k);
        ({ quote } = await api(`/api/quotes/${id}/lines-from-library`, { method: "POST", body: { itemIds: choice.items.map((item) => item.id), subcontractorId: choice.subcontractorId } }));
        lines = quote.lines.map((line, index) => ({ ...line, _k: keys[index] || `k${++keySeq}` }));
        renderLines();
        toast(`${choice.items.length} ouvrage(s) ajouté(s).`);
      } catch (error) {
        fail(error);
      }
    }

    // ---------- Totaux en direct ----------
    function updateComputed(result = computed()) {
      lines.forEach((line, index) => {
        const r = result.lines[index];
        const unit = linesCard.querySelector(`[data-out="${line._k}:unit"]`);
        const total = linesCard.querySelector(`[data-out="${line._k}:total"]`);
        if (unit) unit.textContent = money(r?.unitPrice);
        if (total) fill(total, money(r?.sale), costs && r ? el("small", { text: `marge ${pct(r.marginRate)}` }) : "");
      });
      const lots = new Map((result.lots || []).map((lot) => [lot.name, lot]));
      linesCard.querySelectorAll("[data-out-lot]").forEach((node) => (node.textContent = lotStatsText(lots.get(node.dataset.outLot))));
      renderSummary(result);
    }

    function renderSaveState(state) {
      if (!saveStateNode) return;
      if (!editable) saveStateNode.textContent = quote.status === "draft" ? "Lecture seule" : "Version figée";
      else if (saveError) {
        saveStateNode.textContent = `Non enregistré : ${saveError}`;
        saveStateNode.className = "save-state error";
        return;
      } else saveStateNode.textContent = state === "saving" ? "Enregistrement…" : state === "pending" || dirty ? "Modifications en cours…" : "Enregistré";
      saveStateNode.className = "save-state";
    }

    function renderSummary(result) {
      const rows = [
        ["Total HT", money(result.sale)],
        ...(result.vatLines || []).map((entry) => [`TVA ${fr(entry.rate)} % sur ${money(entry.base)}`, money(entry.vat)]),
      ];
      const totals = el("dl", { class: "totals" }, [
        ...rows.map(([label, value]) => el("div", {}, [el("dt", { text: label }), el("dd", { text: value })])),
        el("div", { class: "big" }, [el("dt", { text: "Total TTC" }), el("dd", { text: money(result.total) })]),
      ]);
      const blocks = [el("section", { class: "card" }, [el("h3", { text: "Montants client" }), totals])];
      if (costs && result.cost !== undefined) {
        const good = (rate) => (rate >= minimumNet ? "margin-good" : "margin-bad");
        const margins = el("dl", { class: "totals" }, [
          el("div", {}, [el("dt", { text: "Coût ST + fournitures" }), el("dd", { text: money(result.cost) })]),
          el("div", { class: good(result.marginRate) }, [el("dt", { text: "Marge brute" }), el("dd", { text: `${money(result.margin)} · ${pct(result.marginRate)}` })]),
          el("div", {}, [el("dt", { text: "Main-d'œuvre" }), el("dd", { text: result.laborSale ? pct(((result.laborSale - result.laborCost) / result.laborSale) * 100) : "—" })]),
          el("div", {}, [el("dt", { text: "Fournitures" }), el("dd", { text: result.supplySale ? pct(((result.supplySale - result.supplyCost) / result.supplySale) * 100) : "—" })]),
          result.commission !== null && result.commission !== undefined ? el("div", {}, [el("dt", { text: `Commission ${fr(result.commissionRate)} %` }), el("dd", { text: `− ${money(result.commission)}` })]) : null,
          result.net !== null && result.net !== undefined ? el("div", { class: `big ${good(result.netRate)}` }, [el("dt", { text: "Marge nette" }), el("dd", { text: `${money(result.net)} · ${pct(result.netRate)}` })]) : null,
        ]);
        blocks.push(el("section", { class: "card" }, [el("h3", { text: "Rentabilité (interne)" }), margins, el("p", { class: "muted small", text: `Minimum fixé : ${fr(minimumNet)} % de marge nette.` })]));
      }
      const alerts = result.alerts || [];
      if (costs) {
        blocks.push(el("section", { class: "card" }, [
          el("h3", { text: alerts.length ? `Alertes (${alerts.length})` : "Contrôles" }),
          el("div", { class: "alerts" }, alerts.length ? alerts.map((alert) => el("p", { class: alert.level, text: alert.message })) : [el("p", { class: "fine", text: "Prix ST validés, marges au-dessus du minimum." })]),
          result.blocking?.length && editable ? el("p", { class: "muted small", text: "Les alertes rouges bloquent la signature." }) : null,
        ]));
      }
      saveStateNode = el("p", { class: "save-state", role: "status" });
      blocks.push(saveStateNode);
      fill(summary, ...blocks);
      renderSaveState();
    }

    // ---------- Après signature : bons de commande et historique ----------
    function renderAfter() {
      const parts = [];
      if (quote.purchaseOrders?.length) {
        parts.push(el("section", { class: "card" }, [
          el("div", { class: "card-head" }, [el("h2", { text: "Bons de commande sous-traitants" }), el("p", { class: "muted small", text: "Au coût ST figé à la signature, sans le prix client. Un ST sans décennale, Kbis ou URSSAF à jour reste bloqué." })]),
          el("div", { class: "table-wrap" }, el("table", { class: "table" }, [
            el("thead", {}, el("tr", {}, ["N°", "Sous-traitant", "Statut", "Total HT", ""].map((label, index) => el("th", { class: index === 3 ? "num" : "", text: label })))),
            el("tbody", {}, quote.purchaseOrders.map((order) => el("tr", {}, [
              el("td", { class: "nowrap", text: order.number }),
              el("td", {}, [order.subcontractorName, order.blockedReason ? el("span", { class: "sub error-text", text: order.blockedReason }) : null]),
              el("td", {}, statusBadge(order.status, order.statusLabel)),
              el("td", { class: "num", text: money(order.total) }),
              el("td", { class: "actions" }, [
                order.status !== "blocked" ? el("a", { class: "secondary mini", href: `/api/orders/${order.id}/pdf`, target: "_blank", rel: "noopener", text: "PDF" }) : null,
                order.status === "blocked" ? el("button", { class: "secondary mini", type: "button", text: "Revérifier les documents", onclick: async (event) => {
                  await busy(event.currentTarget, async () => {
                    await api(`/api/orders/${order.id}/recheck`, { method: "POST", body: {} });
                    toast("Documents à jour : bon de commande débloqué.");
                    await views.quote(id);
                  }).catch(fail);
                } }) : null,
              ]),
            ]))),
          ])),
        ]));
      }
      if (quote.events?.length) {
        parts.push(el("section", { class: "card" }, [
          el("div", { class: "card-head" }, [el("h2", { text: "Historique du document" })]),
          el("ul", { class: "list" }, quote.events.map((event) => el("li", {}, [
            el("span", { class: "name" }, [EVENT_LABELS[event.event] || event.event, el("small", { text: [event.recipient, event.method === "onsite" ? "sur place" : event.method === "upload" ? "document déposé" : null, event.details?.reason].filter(Boolean).join(" · ") })]),
            el("span", { class: "meta", title: event.document_sha256 ? `Empreinte SHA-256 ${event.document_sha256}` : "", text: dateTimeFr(event.at) }),
          ]))),
        ]));
      }
      fill(after, ...parts);
    }

    // ---------- Signature ----------
    async function signSheet() {
      try {
        await flush();
      } catch (error) {
        return fail(error);
      }
      const result = computed();
      const blocking = result.blocking || [];
      if (blocking.length && !can("quotes.force")) {
        sheet({ title: "Signature impossible", body: [el("div", { class: "alerts" }, blocking.map((alert) => el("p", { class: "blocking", text: alert.message })))], actions: [] });
        return;
      }
      let method = "onsite";
      const pad = signaturePad();
      const signer = input({ value: quote.dossier.clientName });
      const accepted = el("input", { type: "checkbox" });
      const early = el("input", { type: "checkbox" });
      const file = el("input", { type: "file", accept: "application/pdf,image/*" });
      const force = el("input", { type: "checkbox" });
      const onsite = el("div", { class: "panel" }, [
        field("Nom du signataire", signer),
        pad.node,
        el("button", { class: "link", type: "button", text: "Effacer la signature", onclick: () => pad.clear() }),
        el("label", { class: "check" }, [accepted, el("span", { text: `Bon pour accord : j'accepte ${quote.amendmentNo ? "l'avenant" : "le devis"} n° ${quote.number} d'un montant de ${money(result.total)} TTC et ses conditions.` })]),
        quote.dossier.offPremises ? el("label", { class: "check" }, [early, el("span", { text: "Je demande expressément que les travaux commencent avant la fin du délai de rétractation de 14 jours." })]) : null,
      ]);
      const upload = el("div", { class: "panel", hidden: true }, [field("Devis signé (PDF ou photo)", file, "Signature papier ou via un prestataire de signature électronique.")]);
      const tabs = el("div", { class: "segmented", role: "group", "aria-label": "Mode de signature" });
      const setMethod = (value) => {
        method = value;
        onsite.hidden = value !== "onsite";
        upload.hidden = value !== "upload";
        tabs.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.value === value)));
      };
      tabs.append(
        el("button", { type: "button", dataset: { value: "onsite" }, "aria-pressed": "true", text: "Signature sur place", onclick: () => setMethod("onsite") }),
        el("button", { type: "button", dataset: { value: "upload" }, "aria-pressed": "false", text: "Déposer le devis signé", onclick: () => setMethod("upload") }),
      );
      sheet({
        title: `Signature · ${quote.displayNumber}`,
        intro: `${money(result.sale)} HT · ${money(result.total)} TTC. La signature fige le devis, crée les bons de commande ST et le chantier.`,
        body: [
          tabs,
          onsite,
          upload,
          quote.dossier.offPremises ? el("p", { class: "muted small", text: "Contrat hors établissement : le formulaire de rétractation est joint au PDF, aucun paiement n'est demandé avant 7 jours." }) : null,
          blocking.length ? el("div", { class: "alerts" }, [...blocking.map((alert) => el("p", { class: "blocking", text: alert.message })), el("label", { class: "check" }, [force, el("span", { text: "Forcer la signature malgré ces alertes (administrateur, tracé dans le journal)" })])]) : null,
        ],
        actions: [{ label: "Valider la signature", primary: true, onClick: async () => {
          const body = { method, signerName: signer.value, force: force.checked };
          if (method === "onsite") {
            if (pad.isEmpty()) return toast("Le client doit signer dans le cadre.", "error"), false;
            if (!accepted.checked) return toast("Le client doit cocher « Bon pour accord ».", "error"), false;
            Object.assign(body, { signatureImage: pad.toDataUrl(), accepted: true, earlyStartRequested: early.checked });
          } else {
            if (!file.files[0]) return toast("Joignez le devis signé.", "error"), false;
            body.file = await filePayload(file.files[0]);
          }
          const outcome = await api(`/api/quotes/${id}/sign`, { method: "POST", body });
          await views.quote(id);
          signedSheet(outcome);
        } }],
      });
    }

    function signedSheet({ orders = [], chantier }) {
      const blocked = orders.filter((order) => order.status === "blocked");
      sheet({
        title: "Devis signé",
        body: [
          el("div", { class: "alerts" }, [
            el("p", { class: "fine", text: chantier?.created ? "Chantier créé dans le suivi des chantiers avec ses lots, son échéancier et le devis signé." : chantier?.projectId ? "Chantier du suivi mis à jour." : "Signature enregistrée." }),
            orders.length ? el("p", { class: blocked.length ? "warning" : "fine", text: `${orders.length} bon(s) de commande ST créé(s)${blocked.length ? `, dont ${blocked.length} bloqué(s) : documents du ST à mettre à jour` : ""}.` }) : null,
          ]),
        ],
        cancelLabel: "Fermer",
        actions: [{ label: "Voir le dossier", primary: true, onClick: () => (window.location.hash = `#dossier/${quote.dossierId}`) }],
      });
    }

    // Liste des lots existants pour la saisie libre.
    const lotList = el("datalist", { id: "lotNames" });
    api("/api/library/lots").then(({ lots }) => fill(lotList, ...lots.map((lot) => el("option", { value: lot.name })))).catch(() => {});
    view.appendChild(lotList);
  };
})();

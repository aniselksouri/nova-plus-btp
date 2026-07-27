const STORAGE_KEY = "nova-plus-mvp-state-v3";
const SERVER_STORAGE_ENABLED = window.location.protocol !== "file:";
let serverSaveTimer = null;
let pendingProjectDocumentFiles = [];

const defaultState = {
  activeView: "dashboard",
  activeProjectId: "maison-delcourt",
  calendarMonth: "",
  pendingImport: null,
  settings: {
    targetMargin: 28,
    redThreshold: 12,
    invoiceWarningDays: 5,
    vatRate: 20,
  },
  subcontractors: [
    {
      id: "nord-elec-services",
      companyName: "Nord Elec Services",
      trade: "Électricité",
      maxProjects: 1,
      documents: {
        kbis: null,
        insurance: null,
        idCard: null,
      },
      createdAt: "2026-07-16T08:00:00.000Z",
    },
    {
      id: "bati-second-oeuvre",
      companyName: "Bati Second Oeuvre",
      trade: "Second oeuvre",
      maxProjects: 2,
      documents: {
        kbis: null,
        insurance: null,
        idCard: null,
      },
      createdAt: "2026-07-16T08:00:00.000Z",
    },
  ],
  suppliers: [
    {
      id: "cedeo-lille",
      companyName: "CEDEO Lille",
      referent: "Service comptoir",
      phone: "03 20 00 00 00",
      email: "lille@cedeo.fr",
      createdAt: "2026-07-16T08:00:00.000Z",
    },
    {
      id: "rexel-lens",
      companyName: "Rexel Lens",
      referent: "Référent pro",
      phone: "03 21 00 00 00",
      email: "lens@rexel.fr",
      createdAt: "2026-07-16T08:00:00.000Z",
    },
  ],
  projects: [
    {
      id: "maison-delcourt",
      name: "Maison Delcourt - Extension et rénovation",
      client: "Famille Delcourt",
      address: "Marcq-en-Baroeul",
      startDate: "2026-07-02",
      endDate: "2026-09-18",
      status: "En cours",
      quoteFile: "devis-delcourt-extension.pdf",
      lots: [
        {
          id: "gros-oeuvre",
          name: "Gros oeuvre",
          source: "Démolition, reprise dalle, seuils",
          sale: 18400,
          material: 5200,
          labor: 6100,
          commercial: 920,
          other: 1480,
          real: 13950,
        },
        {
          id: "plomberie",
          name: "Plomberie",
          source: "PER, nourrices, sanitaires, chauffe-eau",
          sale: 12800,
          material: 4400,
          labor: 3100,
          commercial: 640,
          other: 380,
          real: 9100,
        },
        {
          id: "electricite",
          name: "Électricité",
          source: "Tableau, appareillage, prises, VMC",
          sale: 9600,
          material: 2850,
          labor: 2600,
          commercial: 480,
          other: 240,
          real: 5850,
        },
        {
          id: "menuiserie",
          name: "Menuiserie",
          source: "Châssis alu, portes intérieures",
          sale: 15100,
          material: 9100,
          labor: 1800,
          commercial: 755,
          other: 520,
          real: 13280,
        },
        {
          id: "placo-isolation",
          name: "Placo isolation",
          source: "Rails, BA13, laine, bandes",
          sale: 11200,
          material: 3300,
          labor: 4100,
          commercial: 560,
          other: 610,
          real: 7950,
        },
        {
          id: "peinture",
          name: "Peinture",
          source: "Préparation, impression, finitions",
          sale: 6800,
          material: 980,
          labor: 2350,
          commercial: 340,
          other: 180,
          real: 3220,
        },
        {
          id: "frais",
          name: "Frais chantier",
          source: "Décharge, carburant, location matériel",
          sale: 4200,
          material: 0,
          labor: 0,
          commercial: 210,
          other: 2680,
          real: 3510,
        },
      ],
      invoices: [
        {
          id: "inv-acompte",
          label: "Acompte signature",
          action: "Facture 30% envoyée",
          percent: 30,
          date: "2026-07-02",
          status: "done",
        },
        {
          id: "inv-demarrage",
          label: "Situation démarrage",
          action: "Facture 30% à envoyer",
          percent: 30,
          date: "2026-07-16",
          status: "pending",
        },
        {
          id: "inv-mi-chantier",
          label: "Situation mi-chantier",
          action: "Facture 30% à préparer",
          percent: 30,
          date: "2026-08-14",
          status: "pending",
        },
        {
          id: "inv-solde",
          label: "Solde réception",
          action: "Facture solde 10%",
          percent: 10,
          date: "2026-09-18",
          status: "pending",
        },
      ],
    },
    {
      id: "local-motte",
      name: "Local Motte - Aménagement cellule",
      client: "SARL Motte Distribution",
      address: "Villeneuve-d'Ascq",
      startDate: "2026-07-20",
      endDate: "2026-08-28",
      status: "Devis signé",
      quoteFile: "devis-local-motte.pdf",
      lots: [
        { id: "placo", name: "Placo isolation", source: "Cloisons, doublage, plafond", sale: 14600, material: 4200, labor: 5100, commercial: 730, other: 600, real: 9900 },
        { id: "electricite", name: "Électricité", source: "Tableau divisionnaire, éclairage", sale: 11800, material: 4100, labor: 2400, commercial: 590, other: 340, real: 0 },
        { id: "peinture", name: "Peinture", source: "Finitions murs et plafonds", sale: 7200, material: 1100, labor: 2600, commercial: 360, other: 190, real: 0 },
      ],
      invoices: [
        { id: "motte-acompte", label: "Acompte", action: "Facture 40% à envoyer", percent: 40, date: "2026-07-20", status: "pending" },
        { id: "motte-solde", label: "Solde réception", action: "Facture solde 60%", percent: 60, date: "2026-08-28", status: "pending" },
      ],
    },
  ],
  library: [
    { name: "Gros oeuvre", keywords: ["dalle", "seuil", "démolition", "maçonnerie", "béton"] },
    { name: "Plomberie", keywords: ["PER", "nourrice", "sanitaire", "chauffe-eau", "robinet"] },
    { name: "Électricité", keywords: ["tableau", "prise", "disjoncteur", "VMC", "gaine"] },
    { name: "Menuiserie", keywords: ["porte", "châssis", "fenêtre", "alu", "bois"] },
    { name: "Placo isolation", keywords: ["BA13", "rail", "laine", "bande", "cloison"] },
    { name: "Peinture", keywords: ["impression", "finition", "enduit", "ponçage", "murs"] },
    { name: "Frais chantier", keywords: ["décharge", "location", "carburant", "transport", "nacelle"] },
  ],
  extractedLines: [
    { label: "Pose réseau PER + nourrice sanitaire", lot: "Plomberie", amount: 3280, confidence: 94 },
    { label: "Tableau électrique divisionnaire", lot: "Électricité", amount: 2140, confidence: 91 },
    { label: "Évacuation gravats et benne", lot: "Frais chantier", amount: 780, confidence: 82 },
    { label: "Préparation supports peinture", lot: "Peinture", amount: 1260, confidence: 88 },
  ],
};

let state = loadState();

const formatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 1,
});

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const ORDER_STATUSES = {
  to_order: { label: "À commander", tone: "warning" },
  in_progress: { label: "En cours", tone: "active" },
  received: { label: "Reçu", tone: "done" },
  delayed: { label: "Retard", tone: "late" },
};

const PROJECT_COLORS = [
  { color: "#5347CE", bg: "#F1EFFF" },
  { color: "#1FC8C7", bg: "#E9FBFA" },
  { color: "#4896FB", bg: "#EEF5FF" },
  { color: "#DC5A70", bg: "#FFF2F5" },
  { color: "#C99121", bg: "#FFFAF0" },
  { color: "#6D688A", bg: "#F4F5F8" },
];

const today = new Date();
today.setHours(0, 0, 0, 0);

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const elements = {
  targetMarginInput: document.querySelector("#targetMargin"),
  targetMarginLabel: document.querySelector("#targetMarginLabel"),
  targetMarginSetting: document.querySelector("#targetMarginSetting"),
  redThreshold: document.querySelector("#redThreshold"),
  invoiceWarningDays: document.querySelector("#invoiceWarningDays"),
  vatRate: document.querySelector("#vatRate"),
  lotsTable: document.querySelector("#lotsTable"),
  invoiceTimeline: document.querySelector("#invoiceTimeline"),
  recommendationList: document.querySelector("#recommendationList"),
  simulateImportButton: document.querySelector("#simulateImport"),
  pdfInput: document.querySelector("#pdfInput"),
  pdfInputSecondary: document.querySelector("#pdfInputSecondary"),
  pdfStatus: document.querySelector("#pdfStatus"),
  extractedLines: document.querySelector("#extractedLines"),
  importReview: document.querySelector("#importReview"),
  projectsGrid: document.querySelector("#projectsGrid"),
  billingList: document.querySelector("#billingList"),
  billingSummary: document.querySelector("#billingSummary"),
  orderPdfInput: document.querySelector("#orderPdfInput"),
  orderStatus: document.querySelector("#orderStatus"),
  orderProjectContext: document.querySelector("#orderProjectContext"),
  ordersDashboard: document.querySelector("#ordersDashboard"),
  ordersList: document.querySelector("#ordersList"),
  exportOrdersButton: document.querySelector("#exportOrdersButton"),
  projectDocumentsStatus: document.querySelector("#projectDocumentsStatus"),
  projectDocumentsContext: document.querySelector("#projectDocumentsContext"),
  projectDocumentForm: document.querySelector("#projectDocumentForm"),
  projectDocumentFilesInput: document.querySelector("#projectDocumentFilesInput"),
  pendingProjectDocumentsSummary: document.querySelector("#pendingProjectDocumentsSummary"),
  pendingProjectDocumentsList: document.querySelector("#pendingProjectDocumentsList"),
  documentPreviewModal: document.querySelector("#documentPreviewModal"),
  documentPreviewTitle: document.querySelector("#documentPreviewTitle"),
  documentPreviewBody: document.querySelector("#documentPreviewBody"),
  projectDocumentsList: document.querySelector("#projectDocumentsList"),
  calendarProjectFilter: document.querySelector("#calendarProjectFilter"),
  calendarTypeFilter: document.querySelector("#calendarTypeFilter"),
  calendarStats: document.querySelector("#calendarStats"),
  calendarLegend: document.querySelector("#calendarLegend"),
  calendarGrid: document.querySelector("#calendarGrid"),
  calendarList: document.querySelector("#calendarList"),
  libraryGrid: document.querySelector("#libraryGrid"),
  suppliersGrid: document.querySelector("#suppliersGrid"),
  supplierSummary: document.querySelector("#supplierSummary"),
  supplierForm: document.querySelector("#supplierForm"),
  supplierNameOptions: document.querySelector("#supplierNameOptions"),
  subcontractorsGrid: document.querySelector("#subcontractorsGrid"),
  subcontractorSummary: document.querySelector("#subcontractorSummary"),
  subcontractorForm: document.querySelector("#subcontractorForm"),
  lotSubcontractorSelect: document.querySelector("#lotSubcontractorSelect"),
  resetDataButton: document.querySelector("#resetDataButton"),
  newProjectButton: document.querySelector("#newProjectButton"),
  globalSearch: document.querySelector("#globalSearch"),
  viewTitle: document.querySelector("#viewTitle"),
  exportButton: document.querySelector("#exportButton"),
  projectPaymentSchedule: document.querySelector("#projectPaymentSchedule"),
  lotForm: document.querySelector("#lotForm"),
  projectForm: document.querySelector("#projectForm"),
  invoiceForm: document.querySelector("#invoiceForm"),
  libraryForm: document.querySelector("#libraryForm"),
};

function searchTerm() {
  return (elements.globalSearch.value || "").trim().toLowerCase();
}

function includesSearch(...values) {
  const term = searchTerm();
  if (!term) return true;
  return values.join(" ").toLowerCase().includes(term);
}

document.querySelector("#todayLabel").textContent = `Aujourd'hui ${dateFormatter.format(today)}`;

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return hydrateSupplyOrders(structuredClone(defaultState));
    return hydrateSupplyOrders(mergeState(structuredClone(defaultState), JSON.parse(saved)));
  } catch {
    return hydrateSupplyOrders(structuredClone(defaultState));
  }
}

function mergeState(base, saved) {
  return {
    ...base,
    ...saved,
    settings: { ...base.settings, ...(saved.settings || {}) },
    projects: Array.isArray(saved.projects) ? saved.projects : base.projects,
    library: Array.isArray(saved.library) ? saved.library : base.library,
    subcontractors: Array.isArray(saved.subcontractors) ? saved.subcontractors : base.subcontractors,
    suppliers: Array.isArray(saved.suppliers) ? saved.suppliers : base.suppliers,
    extractedLines: Array.isArray(saved.extractedLines) ? saved.extractedLines : base.extractedLines,
    pendingImport: saved.pendingImport || base.pendingImport,
  };
}

function hydrateSupplyOrders(nextState) {
  (nextState.projects || []).forEach((project) => {
    if (!Array.isArray(project.documents)) project.documents = [];
    if (project.archived === undefined) project.archived = false;
    (project.supplyOrders || []).forEach((line) => {
      if (line.purchasePrice === undefined) line.purchasePrice = Number(line.finalPrice ?? line.totalHT ?? line.ttc ?? line.unitHT ?? 0);
      if (line.salePrice === undefined) line.salePrice = 0;
      if (line.deliveryPrice === undefined) line.deliveryPrice = 0;
    });
  });
  (nextState.subcontractors || []).forEach((subcontractor) => {
    if (subcontractor.trade === undefined) subcontractor.trade = "";
    if (subcontractor.maxProjects === undefined) subcontractor.maxProjects = 1;
  });
  if (!Array.isArray(nextState.suppliers)) nextState.suppliers = [];
  (nextState.suppliers || []).forEach((supplier) => {
    if (supplier.referent === undefined) supplier.referent = "";
    if (supplier.phone === undefined) supplier.phone = "";
    if (supplier.email === undefined) supplier.email = "";
  });
  return nextState;
}

function saveState() {
  let savedLocally = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    savedLocally = false;
    console.warn("Sauvegarde navigateur impossible, tentative serveur.", error);
  }
  scheduleServerSave();
  return savedLocally;
}

function trySaveState() {
  const savedLocally = saveState();
  return SERVER_STORAGE_ENABLED || savedLocally;
}

function scheduleServerSave() {
  if (!SERVER_STORAGE_ENABLED) return;
  clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(() => {
    saveStateToServer();
  }, 350);
}

async function saveStateToServer() {
  if (!SERVER_STORAGE_ENABLED) return;
  try {
    await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
  } catch (error) {
    console.warn("Sauvegarde serveur indisponible.", error);
  }
}

async function hydrateStateFromServer() {
  if (!SERVER_STORAGE_ENABLED) return;
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) return;
    const serverState = await response.json();
    if (!serverState || !Array.isArray(serverState.projects)) return;
    state = hydrateSupplyOrders(mergeState(structuredClone(defaultState), serverState));
  } catch (error) {
    console.warn("Chargement serveur indisponible, fallback navigateur.", error);
  }
}

function activeProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || state.projects[0];
}

function money(value) {
  return formatter.format(Math.round(value || 0));
}

function supplyPurchasePrice(line) {
  return Number(line.purchasePrice ?? line.finalPrice ?? line.totalHT ?? line.ttc ?? line.unitHT ?? 0);
}

function supplySalePrice(line) {
  return Number(line.salePrice || 0);
}

function supplyDeliveryPrice(line) {
  return Number(line.deliveryPrice || 0);
}

function supplyRealMargin(line) {
  return supplySalePrice(line) - supplyPurchasePrice(line) - supplyDeliveryPrice(line);
}

function supplyMarginRate(line) {
  const sale = supplySalePrice(line);
  if (!sale) return null;
  return (supplyRealMargin(line) / sale) * 100;
}

function supplyMarginTone(line) {
  const sale = supplySalePrice(line);
  if (!sale) return "empty";
  return supplyRealMargin(line) >= 0 ? "positive" : "negative";
}

function supplyMarginHtml(line) {
  const sale = supplySalePrice(line);
  if (!sale) {
    return "<strong>À renseigner</strong><small>Prix de vente manquant</small>";
  }
  const margin = supplyRealMargin(line);
  const rate = supplyMarginRate(line);
  return `<strong>${money(margin)}</strong><small>${percentFormatter.format(rate)}% de marge réelle</small>`;
}

function plannedCost(lot) {
  const planned = Number(lot.planned || 0);
  return planned > 0 ? planned : 0;
}

function realCost(lot) {
  return Number(lot.material || 0) + Number(lot.labor || 0) + commercialCost(lot) + Number(lot.other || 0);
}

function commercialRate(lot) {
  if (lot.commercialRate !== undefined) return Number(lot.commercialRate || 0);
  const sale = Number(lot.sale || 0);
  if (!sale) return 0;
  return (Number(lot.commercial || 0) / sale) * 100;
}

function commercialCost(lot) {
  return Number(lot.sale || 0) * (commercialRate(lot) / 100);
}

function laborType(lot) {
  return lot.laborType === "subcontractor" ? "subcontractor" : "employee";
}

function subcontractorName(id) {
  return state.subcontractors.find((item) => item.id === id)?.companyName || "Sous-traitant non renseigné";
}

function supplierOrderHistory(supplier) {
  const supplierName = normalizeForMatch(supplier.companyName);
  if (!supplierName) return [];
  return state.projects
    .flatMap((project) =>
      (project.supplyOrders || [])
        .filter((line) => supplierMatches(line.supplier, supplier.companyName))
        .map((line) => ({
          projectId: project.id,
          projectName: project.name,
          category: line.category || "Commande",
          label: line.label || "Ligne sans nom",
          amount: Number(line.finalPrice || line.purchasePrice || line.totalHT || line.ttc || 0),
          status: line.status || "to_order",
          sourceFile: line.sourceFile || project.supplyOrderFile || "",
        }))
    )
    .sort((a, b) => b.amount - a.amount);
}

function supplierMatches(lineSupplier = "", supplierName = "") {
  const lineValue = normalizeForMatch(lineSupplier);
  const supplierValue = normalizeForMatch(supplierName);
  if (!lineValue || !supplierValue) return false;
  return lineValue === supplierValue || lineValue.includes(supplierValue) || supplierValue.includes(lineValue);
}

function subcontractorAssignments(subcontractorId) {
  const assignments = [];
  state.projects.forEach((project) => {
    (project.lots || []).forEach((lot) => {
      if (laborType(lot) !== "subcontractor" || lot.subcontractorId !== subcontractorId) return;
      assignments.push({
        projectId: project.id,
        projectName: project.name,
        client: project.client,
        lotName: lot.name,
        startDate: project.startDate || "",
        endDate: project.endDate || project.startDate || "",
        progress: lotProgress(lot),
        sale: Number(lot.sale || 0),
        amount: Number(lot.labor || 0),
      });
    });
  });
  return assignments.sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
}

function subcontractorInvoiceProjects(subcontractorId) {
  const targetMargin = Number(state.settings.targetMargin || 0);
  return state.projects
    .map((project) => {
      const lots = (project.lots || [])
        .filter((lot) => laborType(lot) === "subcontractor" && lot.subcontractorId === subcontractorId)
        .map((lot) => {
          const subcontractorAmount = Number(lot.labor || 0);
          const marginDeduction = subcontractorAmount * (targetMargin / 100);
          return {
            id: lot.id,
            name: lot.name,
            source: lot.source || "",
            progress: lotProgress(lot),
            subcontractorAmount,
            marginDeduction,
            netHt: Math.max(0, subcontractorAmount - marginDeduction),
          };
        });
      const totalSubcontractor = lots.reduce((sum, lot) => sum + lot.subcontractorAmount, 0);
      const totalMarginDeduction = lots.reduce((sum, lot) => sum + lot.marginDeduction, 0);
      const totalNetHt = lots.reduce((sum, lot) => sum + lot.netHt, 0);
      return {
        projectId: project.id,
        projectName: project.name,
        client: project.client,
        address: project.address,
        startDate: project.startDate,
        endDate: project.endDate,
        lots,
        totalSubcontractor,
        totalMarginDeduction,
        totalNetHt,
      };
    })
    .filter((project) => project.lots.length)
    .sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
}

function subcontractorInvoiceReminders(subcontractorId) {
  return state.projects.flatMap((project) => {
    const subcontractorLots = (project.lots || []).filter((lot) => laborType(lot) === "subcontractor" && lot.subcontractorId === subcontractorId);
    if (!subcontractorLots.length) return [];
    const baseAmount = subcontractorLots.reduce((sum, lot) => sum + Number(lot.labor || 0), 0);
    return (project.invoices || []).map((invoice) => {
      const meta = invoiceMeta(invoice);
      return {
        projectId: project.id,
        projectName: project.name,
        client: project.client,
        date: invoice.date,
        label: invoice.label,
        percent: Number(invoice.percent || 0),
        amount: baseAmount * (Number(invoice.percent || 0) / 100),
        lots: subcontractorLots.map((lot) => lot.name),
        tone: meta.color,
        note: invoice.status === "done" ? "Échéance client envoyée" : meta.note,
      };
    });
  }).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

function maxSimultaneousAssignments(assignments) {
  const dated = assignments.filter((assignment) => assignment.startDate && assignment.endDate);
  if (!dated.length) return 0;
  const points = dated
    .flatMap((assignment) => [assignment.startDate, assignment.endDate])
    .filter(Boolean);
  return Math.max(
    ...points.map((date) => dated.filter((assignment) => assignment.startDate <= date && assignment.endDate >= date).length)
  );
}

function subcontractorCapacity(subcontractor) {
  return Math.max(1, Number(subcontractor.maxProjects || 1));
}

function projectSale(project) {
  return project.lots.reduce((sum, lot) => sum + Number(lot.sale || 0), 0);
}

function projectPlanned(project) {
  return project.lots.reduce((sum, lot) => sum + plannedCost(lot), 0);
}

function projectReal(project) {
  return project.lots.reduce((sum, lot) => sum + effectiveCost(lot), 0);
}

function lotProgress(lot) {
  return Math.max(0, Math.min(100, Number(lot.progress || 0)));
}

function projectProgress(project) {
  const totalSale = projectSale(project);
  if (totalSale > 0) {
    return project.lots.reduce((sum, lot) => sum + lotProgress(lot) * Number(lot.sale || 0), 0) / totalSale;
  }
  if (!project.lots.length) return 0;
  return project.lots.reduce((sum, lot) => sum + lotProgress(lot), 0) / project.lots.length;
}

function progressState(progress) {
  if (progress >= 100) return { label: "Terminé", tone: "done" };
  if (progress >= 70) return { label: "Finalisation", tone: "high" };
  if (progress >= 15) return { label: "En cours", tone: "active" };
  if (progress > 0) return { label: "Démarré", tone: "low" };
  return { label: "À lancer", tone: "idle" };
}

function effectiveCost(lot) {
  return realCost(lot);
}

function marginRate(sale, cost) {
  if (!sale) return 0;
  return ((sale - cost) / sale) * 100;
}

function statusFromMargin(rate) {
  if (rate < Number(state.settings.redThreshold)) return "red";
  if (rate < Number(state.settings.targetMargin)) return "yellow";
  return "green";
}

function statusLabel(status) {
  if (status === "neutral") return "À saisir";
  if (status === "green") return "Rentable";
  if (status === "yellow") return "Limite";
  return "Danger";
}

function advisedPrice(cost) {
  return cost / (1 - Number(state.settings.targetMargin) / 100);
}

function invoiceMeta(invoice) {
  const fallbackDate = activeProject()?.startDate || today.toISOString().slice(0, 10);
  const due = new Date(`${invoice.date || fallbackDate}T00:00:00`);
  const diffDays = Math.round((due - today) / 86400000);
  let color = "green";
  let note = "Validé";

  if (invoice.status !== "done") {
    if (diffDays <= 0) {
      color = "red";
      note = diffDays === 0 ? "À faire aujourd'hui" : `En retard de ${Math.abs(diffDays)} jour(s)`;
    } else if (diffDays <= Number(state.settings.invoiceWarningDays)) {
      color = "yellow";
      note = `À préparer dans ${diffDays} jour(s)`;
    } else {
      color = "green";
      note = `Prévu dans ${diffDays} jour(s)`;
    }
  }

  return { due, diffDays, color, note };
}

function setView(view) {
  state.activeView = view;
  saveState();
  renderAll();
}

function renderNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.activeView);
  });

  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.viewPanel !== state.activeView);
  });

  const titles = {
    dashboard: "Pilotage marge, facturation et coûts réels",
    projects: "Chantiers et rentabilité par dossier",
    pdf: "Import devis PDF et tri automatique par lot",
    billing: "Facturation dynamique et rappels d'échéance",
    orders: "Suivi commande fournisseur par chantier",
    documents: "Documents stockés par chantier actif",
    calendar: "Calendrier global des chantiers",
    suppliers: "Fournisseurs et contacts achat",
    library: "Bibliothèque de lots et mots-clés",
    subcontractors: "Sous-traitants, KBIS, assurance et identité",
    settings: "Réglages de marge et seuils d'alerte",
  };
  elements.viewTitle.textContent = titles[state.activeView] || titles.dashboard;
}

function renderSettingsControls() {
  elements.targetMarginInput.value = state.settings.targetMargin;
  elements.targetMarginLabel.textContent = state.settings.targetMargin;
  elements.targetMarginSetting.value = state.settings.targetMargin;
  elements.redThreshold.value = state.settings.redThreshold;
  elements.invoiceWarningDays.value = state.settings.invoiceWarningDays;
  elements.vatRate.value = state.settings.vatRate;
  renderLotSubcontractorSelect();
}

function renderLotSubcontractorSelect() {
  if (!elements.lotSubcontractorSelect) return;
  elements.lotSubcontractorSelect.innerHTML = subcontractorOptions("");
}

function renderLots() {
  const project = activeProject();
  elements.lotsTable.innerHTML = "";

  project.lots.filter((lot) => includesSearch(lot.name, lot.source)).forEach((lot) => {
    const planned = plannedCost(lot);
    const real = effectiveCost(lot);
    const hasCost = real > 0;
    const margin = hasCost ? marginRate(lot.sale, real) : null;
    const profit = hasCost ? Number(lot.sale || 0) - real : null;
    const status = hasCost ? statusFromMargin(margin) : "neutral";
    const suggested = hasCost ? advisedPrice(real) : null;
    const currentLaborType = laborType(lot);
    const currentCommercialRate = commercialRate(lot);
    const progress = lotProgress(lot);
    const progressInfo = progressState(progress);

    const row = document.createElement("tr");
    row.dataset.lotId = lot.id;
    row.innerHTML = `
      <td class="lot-name">
        <div class="lot-title-row">
          <strong>${lot.name}</strong>
          <button type="button" data-delete-lot="${lot.id}" aria-label="Supprimer ${escapeHtml(lot.name)}">Supprimer</button>
        </div>
        <span class="small-note">${lot.source}</span>
        ${renderLotDetails(lot)}
      </td>
      <td>
        <div class="progress-control" style="--progress: ${progress}%" data-progress-tone="${progressInfo.tone}">
          <div class="progress-readout">
            <strong data-row-field="progress">${progress}%</strong>
            <span data-row-field="progressStatus">${progressInfo.label}</span>
          </div>
          <input type="range" min="0" max="100" step="5" value="${progress}" data-lot-id="${lot.id}" data-lot-field="progress" aria-label="Avancement ${lot.name}" />
        </div>
      </td>
      <td class="number">${money(lot.sale)}</td>
      <td>
        <div class="money-control">
          <input class="cost-input" type="number" min="0" step="50" value="${lot.material || 0}" data-lot-id="${lot.id}" data-lot-field="material" aria-label="Matériaux ${lot.name}" />
          <span class="calculated-note spacer" aria-hidden="true">&nbsp;</span>
        </div>
      </td>
      <td>
        <div class="stacked-control labor-control">
          <label class="labor-amount">
            <span>Montant</span>
            <input class="cost-input" type="number" min="0" step="50" value="${lot.labor || 0}" data-lot-id="${lot.id}" data-lot-field="labor" aria-label="Montant main d'oeuvre ${lot.name}" />
          </label>
          <label class="select-shell">
            <span>Type</span>
            <select data-lot-id="${lot.id}" data-lot-field="laborType" aria-label="Type main d'oeuvre ${lot.name}">
              <option value="employee"${currentLaborType === "employee" ? " selected" : ""}>Salarié</option>
              <option value="subcontractor"${currentLaborType === "subcontractor" ? " selected" : ""}>Sous-traitant</option>
            </select>
          </label>
          <label class="select-shell subcontractor-shell">
            <span>Sous-traitant</span>
            <select data-lot-id="${lot.id}" data-lot-field="subcontractorId" ${currentLaborType === "subcontractor" ? "" : "disabled"} aria-label="Sous-traitant ${lot.name}">
              ${subcontractorOptions(lot.subcontractorId)}
            </select>
          </label>
        </div>
      </td>
      <td>
        <div class="money-control">
          <input class="cost-input" type="number" min="0" max="100" step="0.5" value="${roundCurrency(currentCommercialRate)}" data-lot-id="${lot.id}" data-lot-field="commercialRate" aria-label="Pourcentage commercial ${lot.name}" />
          <span class="calculated-note" data-row-field="commercialCost">${money(commercialCost(lot))}</span>
        </div>
      </td>
      <td>
        <div class="money-control">
          <input class="cost-input" type="number" min="0" step="50" value="${lot.other || 0}" data-lot-id="${lot.id}" data-lot-field="other" aria-label="Autres frais ${lot.name}" />
          <span class="calculated-note spacer" aria-hidden="true">&nbsp;</span>
        </div>
      </td>
      <td>
        <div class="money-control">
          <input class="cost-input" type="number" min="0" step="50" value="${lot.planned || 0}" data-lot-id="${lot.id}" data-lot-field="planned" aria-label="Coût prévu ${lot.name}" />
          <span class="calculated-note spacer" aria-hidden="true">&nbsp;</span>
        </div>
      </td>
      <td class="number"><span class="value-align" data-row-field="real">${money(real)}</span></td>
      <td class="number"><span class="value-align" data-row-field="margin">${hasCost ? `${percentFormatter.format(margin)}%` : "—"}</span></td>
      <td class="number"><span class="value-align" data-row-field="profit">${hasCost ? money(profit) : "—"}</span></td>
      <td class="number"><span class="value-align" data-row-field="suggested">${hasCost ? money(suggested) : "À renseigner"}</span></td>
      <td><span class="value-align" data-row-field="status"><span class="badge ${status}">${statusLabel(status)}</span></span></td>
    `;
    elements.lotsTable.appendChild(row);
  });
}

function renderLotDetails(lot) {
  if (!Array.isArray(lot.extractedLines) || !lot.extractedLines.length) return "";
  return `
    <details class="lot-details">
      <summary>${lot.extractedLines.length} ligne(s) du devis</summary>
      <div class="lot-detail-list">
        ${lot.extractedLines
          .map(
            (line, index) => `
              <div class="lot-detail-line">
                <span>${escapeHtml(line.code ? `${line.code} - ${line.label}` : line.label)}</span>
                <strong>${money(line.amount)}</strong>
                <select data-detail-lot-id="${lot.id}" data-detail-line-index="${index}">
                  ${lotOptions(lot.name)}
                </select>
              </div>
            `
          )
          .join("")}
      </div>
    </details>
  `;
}

function updateLotRow(row, lot) {
  const real = effectiveCost(lot);
  const hasCost = real > 0;
  const margin = hasCost ? marginRate(lot.sale, real) : null;
  const profit = hasCost ? Number(lot.sale || 0) - real : null;
  const status = hasCost ? statusFromMargin(margin) : "neutral";
  const suggested = hasCost ? advisedPrice(real) : null;

  const commercialCell = row.querySelector('[data-row-field="commercialCost"]');
  if (commercialCell) commercialCell.textContent = money(commercialCost(lot));
  const progressCell = row.querySelector('[data-row-field="progress"]');
  if (progressCell) progressCell.textContent = `${lotProgress(lot)}%`;
  const progressInfo = progressState(lotProgress(lot));
  const progressStatus = row.querySelector('[data-row-field="progressStatus"]');
  if (progressStatus) progressStatus.textContent = progressInfo.label;
  const progressControl = row.querySelector(".progress-control");
  if (progressControl) {
    progressControl.style.setProperty("--progress", `${lotProgress(lot)}%`);
    progressControl.dataset.progressTone = progressInfo.tone;
  }
  row.querySelector('[data-row-field="real"]').textContent = money(real);
  row.querySelector('[data-row-field="margin"]').textContent = hasCost ? `${percentFormatter.format(margin)}%` : "—";
  row.querySelector('[data-row-field="profit"]').textContent = hasCost ? money(profit) : "—";
  row.querySelector('[data-row-field="suggested"]').textContent = hasCost ? money(suggested) : "À renseigner";
  row.querySelector('[data-row-field="status"]').innerHTML = `<span class="badge ${status}">${statusLabel(status)}</span>`;
}

function renderSummary() {
  const project = activeProject();
  const totalSale = projectSale(project);
  const totalPlanned = projectPlanned(project);
  const totalReal = projectReal(project);
  const hasRealCosts = totalReal > 0;
  const realMargin = hasRealCosts ? marginRate(totalSale, totalReal) : null;
  const delta = totalReal - totalPlanned;
  const status = hasRealCosts ? statusFromMargin(realMargin) : "neutral";
  const missingSale = hasRealCosts ? Math.max(0, advisedPrice(totalReal) - totalSale) : 0;
  const progress = projectProgress(project);

  document.querySelector("#totalSale").textContent = money(totalSale);
  document.querySelector("#vatEstimate").textContent = `TVA estimée à récupérer : ${money(totalSale * (Number(state.settings.vatRate || 0) / 100))}`;
  document.querySelector("#totalRealCost").textContent = money(totalReal);
  document.querySelector("#realCostDelta").textContent = `Écart prévu : ${delta >= 0 ? "+" : ""}${money(delta)}`;
  document.querySelector("#realMargin").textContent = hasRealCosts ? `${percentFormatter.format(realMargin)}%` : "À renseigner";
  document.querySelector("#marginGap").textContent = hasRealCosts
    ? `Objectif : ${state.settings.targetMargin}% | écart ${percentFormatter.format(realMargin - state.settings.targetMargin)} pts`
    : `Objectif : ${state.settings.targetMargin}%`;
  document.querySelector("#globalStatus").textContent = statusLabel(status);
  document.querySelector("#projectProgressPill").textContent = `Avancement chantier : ${percentFormatter.format(progress)}%`;

  const statusCard = document.querySelector("#globalStatusCard");
  statusCard.className = `metric alert ${status}`;

  if (!hasRealCosts) {
    document.querySelector("#globalAdvice").textContent = "Renseignez matériaux, main d’œuvre, commercial % ou autres frais pour calculer la rentabilité.";
  } else if (status === "green") {
    document.querySelector("#globalAdvice").textContent = "Chantier rentable. Marge au-dessus de l'objectif.";
  } else if (status === "yellow") {
    document.querySelector("#globalAdvice").textContent = `Rentable mais trop serré. Il manque ${money(missingSale)} de vente cible.`;
  } else {
    document.querySelector("#globalAdvice").textContent = "Marge dangereuse. Revoir prix, coûts ou avenant rapidement.";
  }
}

function renderProjectHeader() {
  const project = activeProject();
  document.querySelector(".project-panel h3").textContent = project.name;
  document.querySelector(".status-pill").textContent = project.status;

  const meta = document.querySelectorAll(".project-meta div strong");
  meta[0].textContent = project.client;
  meta[1].textContent = project.address;
  meta[2].textContent = formatShortDate(project.startDate);
  meta[3].textContent = formatShortDate(project.endDate);
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${date}T00:00:00`));
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderTimeline() {
  const project = activeProject();
  const totalSale = projectSale(project);
  elements.invoiceTimeline.innerHTML = "";

  project.invoices.forEach((invoice) => {
    const meta = invoiceMeta(invoice);
    const amount = totalSale * (invoice.percent / 100);
    const item = document.createElement("div");
    item.className = "timeline-item";
    item.innerHTML = `
      <i class="bar ${meta.color}"></i>
      <div>
        <h4>${invoice.label}</h4>
        <p>${invoice.action} - ${dateFormatter.format(meta.due)} - ${meta.note}</p>
      </div>
      <strong>${money(amount)}</strong>
    `;
    elements.invoiceTimeline.appendChild(item);
  });
}

function renderRecommendations() {
  const project = activeProject();
  const lotsWithMargin = project.lots
    .filter((lot) => Number(lot.sale || 0) > 0 && effectiveCost(lot) > 0)
    .map((lot) => {
      const real = effectiveCost(lot);
      const margin = marginRate(lot.sale, real);
      return { ...lot, margin, real, gap: advisedPrice(real) - lot.sale };
    })
    .sort((a, b) => a.margin - b.margin);

  const invoiceToday = project.invoices.find((invoice) => {
    const meta = invoiceMeta(invoice);
    return invoice.status !== "done" && meta.diffDays <= 0;
  });

  let recommendations;
  if (!lotsWithMargin.length) {
    recommendations = [
      {
        color: "yellow",
        title: "Coûts réels à renseigner",
        text: "Complétez matériaux, main d'œuvre, commercial % et autres frais pour obtenir la marge réelle du chantier.",
      },
      {
        color: "green",
        title: "Commandes liées au chantier actif",
        text: "Importez une liste fournisseur dans Suivi commande pour piloter les achats ligne par ligne.",
      },
      {
        color: invoiceToday ? "red" : "green",
        title: invoiceToday ? "Facturation urgente" : "Facturation sous contrôle",
        text: invoiceToday ? `${invoiceToday.action} aujourd'hui.` : "Aucune facture critique à envoyer aujourd'hui.",
      },
    ];
  } else {
    const weakest = lotsWithMargin[0];
    const strongest = lotsWithMargin[lotsWithMargin.length - 1];
    recommendations = [
      {
        color: weakest.margin < state.settings.redThreshold ? "red" : "yellow",
        title: `${weakest.name} tire la marge vers le bas`,
        text: `Marge réelle ${percentFormatter.format(weakest.margin)}%. Prix futur conseillé : ${money(advisedPrice(weakest.real))}, soit ${money(Math.max(0, weakest.gap))} à récupérer.`,
      },
      {
        color: "green",
        title: `${strongest.name} supporte plus de marge`,
        text: `Marge réelle ${percentFormatter.format(strongest.margin)}%. Ce lot peut servir de référence pour les prochains devis similaires.`,
      },
      {
        color: invoiceToday ? "red" : "green",
        title: invoiceToday ? "Facturation urgente" : "Facturation sous contrôle",
        text: invoiceToday ? `${invoiceToday.action} aujourd'hui. L'alerte doit remonter dès l'ouverture du logiciel.` : "Aucune facture critique à envoyer aujourd'hui.",
      },
    ];
  }

  elements.recommendationList.innerHTML = "";
  recommendations.forEach((recommendation) => {
    const item = document.createElement("div");
    item.className = "recommendation";
    item.innerHTML = `
      <i class="bar ${recommendation.color}"></i>
      <div>
        <h4>${recommendation.title}</h4>
        <p>${recommendation.text}</p>
      </div>
    `;
    elements.recommendationList.appendChild(item);
  });
}

function renderProjects() {
  elements.projectsGrid.innerHTML = "";
  const filteredProjects = state.projects.filter((project) => includesSearch(project.name, project.client, project.address, project.status, project.archived ? "archive archivé" : "actif"));
  const activeProjects = filteredProjects.filter((project) => !project.archived);
  const archivedProjects = filteredProjects.filter((project) => project.archived);
  elements.projectsGrid.innerHTML = `
    ${renderProjectGroup("Chantiers actifs", activeProjects, "Les dossiers en cours de pilotage apparaissent ici.")}
    ${renderProjectGroup("Archives", archivedProjects, "Les chantiers archivés restent consultables et restaurables.")}
  `;
  renderProjectForm();
}

function renderProjectGroup(title, projects, emptyText) {
  if (!projects.length) {
    return `
      <section class="project-group">
        <div class="project-group-head">
          <h4>${title}</h4>
          <span>0</span>
        </div>
        <div class="empty-review">
          <strong>Aucun chantier</strong>
          <span>${emptyText}</span>
        </div>
      </section>
    `;
  }
  return `
    <section class="project-group">
      <div class="project-group-head">
        <h4>${title}</h4>
        <span>${projects.length}</span>
      </div>
      <div class="project-group-grid">
        ${projects.map(renderProjectCard).join("")}
      </div>
    </section>
  `;
}

function renderProjectCard(project) {
    const sale = projectSale(project);
    const real = projectReal(project);
    const hasCost = real > 0;
    const margin = hasCost ? marginRate(sale, real) : null;
    const status = hasCost ? statusFromMargin(margin) : "neutral";
    const progress = projectProgress(project);
    const progressInfo = progressState(progress);
    return `
      <article class="data-card project-card ${project.id === state.activeProjectId ? "selected" : ""} ${project.archived ? "is-archived" : ""}">
      <div class="card-topline">
        <span class="badge ${project.archived ? "neutral" : status}">${project.archived ? "Archivé" : statusLabel(status)}</span>
        <span>${project.archived ? `Archivé le ${formatShortDate(project.archivedAt?.slice(0, 10))}` : project.status}</span>
      </div>
      <h4>${escapeHtml(project.name)}</h4>
      <p>${escapeHtml(project.client)} - ${escapeHtml(project.address)}</p>
      <p class="quote-file">${project.quoteFile ? `Devis : ${escapeHtml(project.quoteFile)}` : "Aucun devis attaché"}</p>
      <div class="card-metrics">
        <strong>${money(sale)}</strong>
        <span>${hasCost ? `${percentFormatter.format(margin)}% marge` : "Coûts à saisir"}</span>
      </div>
      <div class="card-progress" aria-label="Avancement chantier ${project.name}">
        <div>
          <span>${progressInfo.label}</span>
          <strong>${percentFormatter.format(progress)}%</strong>
        </div>
        <i style="--progress: ${progress}%"><b></b></i>
      </div>
      <div class="project-card-actions">
        <button type="button" data-select-project="${project.id}">Ouvrir le chantier</button>
        <button type="button" class="${project.archived ? "restore-button" : "archive-button"}" data-toggle-project-archive="${project.id}">${project.archived ? "Restaurer" : "Archiver"}</button>
        <button type="button" class="danger-button" data-delete-project="${project.id}">Supprimer</button>
      </div>
    </article>
  `;
}

function renderProjectForm() {
  const project = activeProject();
  project.invoices = Array.isArray(project.invoices) ? project.invoices : [];
  const form = elements.projectForm;
  form.elements.name.value = project.name;
  form.elements.client.value = project.client;
  form.elements.address.value = project.address;
  form.elements.startDate.value = project.startDate;
  form.elements.endDate.value = project.endDate;
  form.elements.status.value = project.status;
  renderProjectPaymentSchedule(project);
}

function renderProjectPaymentSchedule(project = activeProject()) {
  if (!elements.projectPaymentSchedule) return;
  project.invoices = Array.isArray(project.invoices) ? project.invoices : [];

  if (!project.invoices.length) {
    elements.projectPaymentSchedule.innerHTML = `
      <div class="empty-review compact-empty">
        <strong>Aucune échéance paiement</strong>
        <span>Ajoutez une date pour que Nova+ déclenche les rappels facture sur ce chantier.</span>
      </div>
    `;
    return;
  }

  elements.projectPaymentSchedule.innerHTML = project.invoices
    .map((invoice) => {
      const meta = invoiceMeta(invoice);
      return `
        <article class="payment-schedule-row ${meta.color}">
          <label>
            <span>Libellé</span>
            <input type="text" value="${escapeHtml(invoice.label)}" data-payment-id="${invoice.id}" data-payment-field="label" />
          </label>
          <label class="wide-payment-field">
            <span>Rappel affiché</span>
            <input type="text" value="${escapeHtml(invoice.action)}" data-payment-id="${invoice.id}" data-payment-field="action" />
          </label>
          <label>
            <span>% facture</span>
            <input type="number" min="1" max="100" step="1" value="${Number(invoice.percent || 0)}" data-payment-id="${invoice.id}" data-payment-field="percent" />
          </label>
          <label>
            <span>Date lancement</span>
            <input type="date" value="${escapeHtml(invoice.date || "")}" data-payment-id="${invoice.id}" data-payment-field="date" />
          </label>
          <div class="payment-schedule-status">
            <span>${invoice.status === "done" ? "Envoyée" : meta.note}</span>
            <button type="button" data-delete-project-invoice="${invoice.id}" aria-label="Supprimer ${escapeHtml(invoice.label)}">Supprimer</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderPdf() {
  renderImportReview();
  elements.extractedLines.innerHTML = "";
  const lines = (state.pendingImport?.lines || state.extractedLines).filter((line) => includesSearch(line.label, line.lot, line.amount));

  lines.forEach((line, index) => {
    const item = document.createElement("div");
    item.className = "extract-row";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(line.label)}</strong>
        <span>${line.code ? `Ligne ${escapeHtml(line.code)} - ` : ""}${line.page ? `page ${line.page}` : "ligne détectée"} - ${money(line.amount)}</span>
      </div>
      <div>
        <select data-import-line-index="${index}" aria-label="Changer le lot de ${escapeHtml(line.label)}">
          ${lotOptions(line.lot)}
        </select>
        <span>${line.confidence || 80}% confiance</span>
      </div>
    `;
    elements.extractedLines.appendChild(item);
  });
}

function renderImportReview() {
  const pending = state.pendingImport;
  if (!pending) {
    elements.importReview.innerHTML = `
      <div class="empty-review">
        <strong>Aucun devis en attente</strong>
        <span>Importez un PDF pour contrôler les lignes avant création du chantier.</span>
      </div>
    `;
    return;
  }

  const extractedTotal = pending.lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const gap = extractedTotal - Number(pending.detectedTotal || extractedTotal);
  const ok = Math.abs(gap) < 1;

  elements.importReview.innerHTML = `
    <div class="review-grid">
      <article>
        <span>Fichier</span>
        <strong>${escapeHtml(pending.fileName)}</strong>
      </article>
      <article>
        <span>Lignes détectées</span>
        <strong>${pending.lines.length}</strong>
      </article>
      <article>
        <span>Total détecté</span>
        <strong>${money(pending.detectedTotal)}</strong>
      </article>
      <article>
        <span>Total importé</span>
        <strong>${money(extractedTotal)}</strong>
      </article>
      <article class="${ok ? "ok" : "danger"}">
        <span>Écart</span>
        <strong>${ok ? "OK" : money(gap)}</strong>
      </article>
    </div>
    <div class="review-actions">
      <button class="upload-button compact" type="button" data-cancel-import>Annuler</button>
      <button class="primary-button compact" type="button" data-validate-import>Valider et créer le chantier</button>
    </div>
  `;
}

function lotOptions(selectedLot) {
  const names = [...new Set([...state.library.map((lot) => lot.name), "Frais chantier", "Gros oeuvre", "Électricité", "Plomberie", "Salle de bain", "Placo isolation", "Revêtements", "Menuiserie", "Peinture", "À classer"])];
  return names
    .map((name) => `<option value="${escapeHtml(name)}"${name === selectedLot ? " selected" : ""}>${escapeHtml(name)}</option>`)
    .join("");
}

function renderBilling() {
  let pendingAmount = 0;
  elements.billingList.innerHTML = "";

  state.projects.forEach((project) => {
    const sale = projectSale(project);
    project.invoices.forEach((invoice) => {
      if (!includesSearch(project.name, project.client, invoice.label, invoice.action, invoice.date)) return;
      const amount = sale * (invoice.percent / 100);
      const meta = invoiceMeta(invoice);
      if (invoice.status !== "done") pendingAmount += amount;

      const item = document.createElement("div");
      item.className = "billing-row";
      item.innerHTML = `
        <i class="bar ${meta.color}"></i>
        <div>
          <h4>${project.name}</h4>
          <p>${invoice.label} - ${invoice.action} - ${dateFormatter.format(meta.due)} - ${meta.note}</p>
        </div>
        <strong>${money(amount)}</strong>
        <button type="button" data-toggle-invoice="${project.id}:${invoice.id}">${invoice.status === "done" ? "Marquer à faire" : "Marquer envoyée"}</button>
      `;
      elements.billingList.appendChild(item);
    });
  });

  elements.billingSummary.textContent = `${money(pendingAmount)} à facturer`;
}

function renderOrders() {
  if (!elements.ordersList) return;
  const project = activeProject();
  const orders = Array.isArray(project.supplyOrders) ? project.supplyOrders : [];
  const filtered = orders.filter((line) =>
    includesSearch(line.category, line.label, line.supplier, line.reference, line.packageReference, line.deliveryLocation, line.status, line.deliveryDate)
  );
  const totalFinal = filtered.reduce((sum, line) => sum + Number(line.finalPrice || 0), 0);
  const totalPurchase = filtered.reduce((sum, line) => sum + supplyPurchasePrice(line), 0);
  const totalSale = filtered.reduce((sum, line) => sum + supplySalePrice(line), 0);
  const totalMargin = filtered.reduce((sum, line) => sum + (supplySalePrice(line) ? supplyRealMargin(line) : 0), 0);
  const totalHt = filtered.reduce((sum, line) => sum + Number(line.totalHT || 0), 0);
  const received = filtered.filter((line) => line.status === "received").length;
  const inProgress = filtered.filter((line) => line.status === "in_progress").length;
  const toOrder = filtered.filter((line) => line.status === "to_order").length;
  const delayed = filtered.filter((line) => line.status === "delayed").length;

  elements.orderStatus.textContent = project.supplyOrderFile ? `Import chantier actif : ${project.supplyOrderFile}` : "Aucun PDF commande importé";
  elements.orderProjectContext.innerHTML = `
    <div>
      <span>Chantier actif</span>
      <strong>${escapeHtml(project.name)}</strong>
      <small>${escapeHtml(project.client)} · ${escapeHtml(project.address)}</small>
    </div>
    <p>Les commandes importées, les prix modifiés et les statuts ci-dessous sont enregistrés uniquement sur ce chantier.</p>
  `;
  elements.ordersDashboard.innerHTML = `
    <article>
      <span>Lignes</span>
      <strong>${filtered.length}</strong>
    </article>
    <article>
      <span>À commander</span>
      <strong>${toOrder}</strong>
    </article>
    <article>
      <span>En cours</span>
      <strong>${inProgress}</strong>
    </article>
    <article>
      <span>Reçu</span>
      <strong>${received}</strong>
    </article>
    <article>
      <span>Retard</span>
      <strong>${delayed}</strong>
    </article>
    <article>
      <span>Prix final</span>
      <strong>${money(totalFinal)}</strong>
    </article>
    <article>
      <span>Prix d'achat</span>
      <strong>${money(totalPurchase)}</strong>
    </article>
    <article>
      <span>Prix vente</span>
      <strong>${money(totalSale)}</strong>
    </article>
    <article class="${totalSale && totalMargin >= 0 ? "ok" : totalSale ? "danger" : ""}">
      <span>Marge réelle</span>
      <strong>${totalSale ? money(totalMargin) : "À saisir"}</strong>
    </article>
    <article>
      <span>Total HT importé</span>
      <strong>${money(totalHt)}</strong>
    </article>
  `;

  elements.ordersList.innerHTML = "";
  if (!filtered.length) {
    elements.ordersList.innerHTML = `
      <div class="empty-review">
        <strong>Aucune ligne commande</strong>
        <span>Importez une liste fournisseur PDF pour obtenir les catégories, lignes, prix et statuts.</span>
      </div>
    `;
    return;
  }

  groupedOrders(filtered).forEach(([category, lines]) => {
    const categoryTotal = lines.reduce((sum, line) => sum + Number(line.finalPrice || 0), 0);
    const card = document.createElement("article");
    card.className = "supply-category";
    card.innerHTML = `
      <div class="supply-category-head">
        <div>
          <p class="eyebrow">${escapeHtml(category)}</p>
          <h4>${lines.length} ligne(s)</h4>
        </div>
        <strong>${money(categoryTotal)}</strong>
      </div>
      <div class="supply-lines">
        ${lines
          .map((line) => {
            const status = orderStatus(line.status);
            const marginTone = supplyMarginTone(line);
            return `
              <div class="supply-line">
                <div class="supply-line-main">
                  <span class="order-dot ${status.tone}"></span>
                  <div>
                    <label class="supply-name-field">
                      <span>Ligne</span>
                      <input type="text" value="${escapeHtml(line.label)}" data-supply-field="label" data-supply-id="${line.id}" />
                    </label>
                    <small>${supplyLineMeta(line)}</small>
                  </div>
                </div>
                <label class="supply-supplier-field">
                  <span>Fournisseur</span>
                  <select data-supply-field="supplier" data-supply-id="${line.id}">
                    ${supplierOptions(line.supplier || "")}
                  </select>
                </label>
                <label class="supply-logistics-field">
                  <span>Réf. colis</span>
                  <input type="text" value="${escapeHtml(line.packageReference || "")}" placeholder="Ex : COL-1234" data-supply-field="packageReference" data-supply-id="${line.id}" />
                </label>
                <label class="supply-logistics-field">
                  <span>Lieu livraison</span>
                  <input type="text" value="${escapeHtml(line.deliveryLocation || "")}" placeholder="Dépôt, chantier..." data-supply-field="deliveryLocation" data-supply-id="${line.id}" />
                </label>
                <label class="supply-price-field">
                  <span>Prix final</span>
                  <input type="number" min="0" step="0.01" value="${roundCurrency(line.finalPrice || 0)}" data-supply-field="finalPrice" data-supply-id="${line.id}" />
                </label>
                <label class="supply-price-field">
                  <span>Prix d'achat</span>
                  <input type="number" min="0" step="0.01" value="${roundCurrency(supplyPurchasePrice(line))}" data-supply-field="purchasePrice" data-supply-id="${line.id}" />
                </label>
                <label class="supply-price-field">
                  <span>Prix de vente</span>
                  <input type="number" min="0" step="0.01" value="${roundCurrency(supplySalePrice(line))}" data-supply-field="salePrice" data-supply-id="${line.id}" />
                </label>
                <label class="supply-price-field">
                  <span>Prix livraison</span>
                  <input type="number" min="0" step="0.01" value="${roundCurrency(line.deliveryPrice || 0)}" data-supply-field="deliveryPrice" data-supply-id="${line.id}" />
                </label>
                <div class="supply-margin-field ${marginTone}" data-supply-margin-id="${line.id}">
                  <span>Marge réelle</span>
                  ${supplyMarginHtml(line)}
                </div>
                <label class="supply-status-field ${status.tone}">
                  <span>${status.label}</span>
                  <select data-supply-field="status" data-supply-id="${line.id}">
                    ${orderStatusOptions(line.status)}
                  </select>
                </label>
                <label class="supply-date-field ${line.status === "in_progress" ? "is-visible active" : ""}">
                  <span>Date commande</span>
                  <input type="date" value="${escapeHtml(line.orderDate || "")}" data-supply-field="orderDate" data-supply-id="${line.id}" ${line.status === "in_progress" ? "" : "disabled"} />
                </label>
                <label class="supply-date-field ${line.status === "received" ? "is-visible done" : ""}">
                  <span>Date réception</span>
                  <input type="date" value="${escapeHtml(line.receivedDate || "")}" data-supply-field="receivedDate" data-supply-id="${line.id}" ${line.status === "received" ? "" : "disabled"} />
                </label>
                <label class="supply-date-field ${line.status === "delayed" ? "is-visible late" : ""}">
                  <span>Nouvelle livraison</span>
                  <input type="date" value="${escapeHtml(line.deliveryDate || "")}" data-supply-field="deliveryDate" data-supply-id="${line.id}" ${line.status === "delayed" ? "" : "disabled"} />
                </label>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
    elements.ordersList.appendChild(card);
  });
}

function renderProjectDocuments() {
  if (!elements.projectDocumentsList) return;
  const project = activeProject();
  const documents = Array.isArray(project.documents) ? project.documents : [];
  const filtered = documents.filter((document) => includesSearch(document.label, document.category, ...projectDocumentFiles(document).map((file) => file.name), project.name, project.client));
  const totalSize = filtered.reduce((sum, document) => sum + projectDocumentSize(document), 0);
  const totalFiles = filtered.reduce((sum, document) => sum + projectDocumentFiles(document).length, 0);
  elements.projectDocumentsStatus.textContent = `${filtered.length} ligne(s) · ${totalFiles} fichier(s) · ${formatFileSize(totalSize)}`;
  elements.projectDocumentsContext.innerHTML = `
    <div>
      <span>Chantier actif</span>
      <strong>${escapeHtml(project.name)}</strong>
      <small>${escapeHtml(project.client)} · ${escapeHtml(project.address)}</small>
    </div>
    <p>Les fichiers importés ici restent attachés à ce chantier et peuvent être téléchargés depuis cette page.</p>
  `;

  if (!filtered.length) {
    elements.projectDocumentsList.innerHTML = `
      <div class="empty-review">
        <strong>Aucun document chantier</strong>
        <span>Importez plans, photos, factures, PV ou documents administratifs pour les centraliser dans ce dossier.</span>
      </div>
    `;
    return;
  }

  elements.projectDocumentsList.innerHTML = groupedProjectDocuments(filtered)
    .map(
      ([category, items]) => `
        <section class="documents-category">
          <div class="documents-category-head">
            <div>
              <p class="eyebrow">${escapeHtml(category)}</p>
              <h4>${items.length} document(s)</h4>
            </div>
            <strong>${items.reduce((sum, document) => sum + projectDocumentFiles(document).length, 0)} fichier(s) · ${formatFileSize(items.reduce((sum, document) => sum + projectDocumentSize(document), 0))}</strong>
          </div>
          <div class="documents-listing">
            ${items
              .map(
                (document) => `
                  <article class="project-document-row">
                    <div class="document-file-icon">${projectDocumentFiles(document).length > 1 ? `${projectDocumentFiles(document).length}F` : documentIcon(projectDocumentFiles(document)[0]?.type || projectDocumentFiles(document)[0]?.name)}</div>
                    <div>
                      <strong>${escapeHtml(document.label)}</strong>
                      <span>${projectDocumentFiles(document).length} fichier(s) · ${formatFileSize(projectDocumentSize(document))} · ajouté le ${formatShortDate(document.uploadedAt?.slice(0, 10))}</span>
                      <div class="document-file-list">
                        ${projectDocumentFiles(document)
                          .map(
                            (file) => `
                              <a href="${file.url || file.dataUrl || "#"}" download="${escapeHtml(file.name || document.label)}">
                                <b>${documentIcon(file.type || file.name)}</b>
                                <span>${escapeHtml(file.name || "Fichier")} · ${formatFileSize(file.size || 0)}</span>
                              </a>
                            `
                          )
                          .join("")}
                      </div>
                    </div>
                    <button class="upload-button compact danger-button" type="button" data-delete-project-document="${document.id}">Supprimer</button>
                  </article>
                `
              )
              .join("")}
          </div>
        </section>
      `
    )
    .join("");
}

function addPendingProjectDocumentFiles(fileList) {
  const incoming = [...(fileList || [])].filter((file) => file?.name && file.size > 0);
  if (!incoming.length) {
    renderPendingProjectDocuments();
    return;
  }
  incoming.forEach((file) => {
    const alreadyExists = pendingProjectDocumentFiles.some(
      (item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified
    );
    if (!alreadyExists) pendingProjectDocumentFiles.push(file);
  });
  renderPendingProjectDocuments();
}

function clearPendingProjectDocumentFiles() {
  pendingProjectDocumentFiles = [];
  if (elements.projectDocumentFilesInput) elements.projectDocumentFilesInput.value = "";
  renderPendingProjectDocuments();
}

function removePendingProjectDocumentFile(index) {
  pendingProjectDocumentFiles.splice(index, 1);
  if (elements.projectDocumentFilesInput) elements.projectDocumentFilesInput.value = "";
  renderPendingProjectDocuments();
}

function renderPendingProjectDocuments() {
  if (!elements.pendingProjectDocumentsList || !elements.pendingProjectDocumentsSummary) return;
  const totalSize = pendingProjectDocumentFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
  elements.pendingProjectDocumentsSummary.textContent = pendingProjectDocumentFiles.length
    ? `${pendingProjectDocumentFiles.length} fichier(s) prêts · ${formatFileSize(totalSize)}`
    : "Aucun fichier sélectionné";

  if (!pendingProjectDocumentFiles.length) {
    elements.pendingProjectDocumentsList.innerHTML = `
      <div class="pending-files-empty">
        Cliquez sur “Choisir des fichiers” autant de fois que nécessaire. Rien n'est ajouté au chantier avant validation.
      </div>
    `;
    return;
  }

  elements.pendingProjectDocumentsList.innerHTML = pendingProjectDocumentFiles
    .map(
      (file, index) => `
        <article class="pending-file-row">
          <button class="document-file-icon preview-trigger" type="button" data-preview-pending-project-document="${index}" aria-label="Aperçu ${escapeHtml(file.name)}">${documentIcon(file.type || file.name)}</button>
          <div>
            <strong>${escapeHtml(file.name)}</strong>
            <span>${escapeHtml(file.type || "Type non détecté")} · ${formatFileSize(file.size || 0)}</span>
          </div>
          <button class="upload-button compact danger-button" type="button" data-remove-pending-project-document="${index}">Retirer</button>
        </article>
      `
    )
    .join("");
}

function openPendingProjectDocumentPreview(index) {
  const file = pendingProjectDocumentFiles[index];
  if (!file || !elements.documentPreviewModal || !elements.documentPreviewTitle || !elements.documentPreviewBody) return;
  const fileUrl = URL.createObjectURL(file);
  const icon = documentIcon(file.type || file.name);
  elements.documentPreviewTitle.textContent = `${file.name} · ${formatFileSize(file.size || 0)}`;
  elements.documentPreviewBody.innerHTML = "";

  if (icon === "IMG") {
    elements.documentPreviewBody.innerHTML = `<img src="${fileUrl}" alt="${escapeHtml(file.name)}" />`;
  } else if (icon === "PDF") {
    elements.documentPreviewBody.innerHTML = `<iframe src="${fileUrl}" title="Aperçu ${escapeHtml(file.name)}"></iframe>`;
  } else if (file.type?.startsWith("text/") || /\.(txt|csv)$/i.test(file.name)) {
    file.text().then((content) => {
      if (!elements.documentPreviewModal.open) URL.revokeObjectURL(fileUrl);
      elements.documentPreviewBody.innerHTML = `<pre>${escapeHtml(content.slice(0, 12000))}${content.length > 12000 ? "\n\n..." : ""}</pre>`;
    });
  } else {
    elements.documentPreviewBody.innerHTML = `
      <div class="document-preview-empty">
        <strong>Aperçu non disponible</strong>
        <span>${escapeHtml(file.name)} · ${escapeHtml(file.type || "Type non détecté")} · ${formatFileSize(file.size || 0)}</span>
      </div>
    `;
  }

  elements.documentPreviewModal.dataset.previewUrl = fileUrl;
  if (typeof elements.documentPreviewModal.showModal === "function") {
    elements.documentPreviewModal.showModal();
  } else {
    elements.documentPreviewModal.setAttribute("open", "");
  }
}

function closeDocumentPreview() {
  if (!elements.documentPreviewModal) return;
  const previewUrl = elements.documentPreviewModal.dataset.previewUrl;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  delete elements.documentPreviewModal.dataset.previewUrl;
  if (elements.documentPreviewModal.open && typeof elements.documentPreviewModal.close === "function") {
    elements.documentPreviewModal.close();
  } else {
    elements.documentPreviewModal.removeAttribute("open");
  }
  if (elements.documentPreviewBody) elements.documentPreviewBody.innerHTML = "";
}

function projectDocumentFiles(document) {
  if (Array.isArray(document.files)) return document.files.filter(Boolean);
  return document.file ? [document.file] : [];
}

function projectDocumentSize(document) {
  return projectDocumentFiles(document).reduce((sum, file) => sum + Number(file.size || 0), 0);
}

function groupedProjectDocuments(documents) {
  const groups = new Map();
  documents.forEach((document) => {
    const category = document.category || "Autre";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(document);
  });
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"));
}

function documentIcon(typeOrName = "") {
  const value = String(typeOrName).toLowerCase();
  if (value.includes("pdf")) return "PDF";
  if (value.includes("image") || /\.(png|jpe?g|webp|gif)$/i.test(value)) return "IMG";
  if (value.includes("sheet") || /\.(xls|xlsx|csv)$/i.test(value)) return "XLS";
  if (value.includes("word") || /\.(doc|docx)$/i.test(value)) return "DOC";
  return "FIC";
}

function formatFileSize(size) {
  const bytes = Number(size || 0);
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

function renderCalendar() {
  if (!elements.calendarGrid) return;
  renderCalendarFilters();
  const selectedProject = elements.calendarProjectFilter.value || "all";
  const selectedType = elements.calendarTypeFilter.value || "all";
  const events = calendarEvents()
    .filter((event) => selectedProject === "all" || event.projectId === selectedProject)
    .filter((event) => selectedType === "all" || event.type === selectedType)
    .filter((event) => includesSearch(event.title, event.projectName, event.detail, event.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const todayIso = isoDate(today);
  const overdue = events.filter((event) => event.date < todayIso && event.tone === "red").length;
  const nextEvent = events.find((event) => event.date >= todayIso);

  elements.calendarStats.innerHTML = `
    <article>
      <span>Événements</span>
      <strong>${events.length}</strong>
    </article>
    <article>
      <span>En retard</span>
      <strong>${overdue}</strong>
    </article>
    <article>
      <span>Prochain</span>
      <strong>${nextEvent ? formatShortDate(nextEvent.date) : "Aucun"}</strong>
    </article>
  `;
  elements.calendarLegend.innerHTML = state.projects
    .filter((project) => selectedProject === "all" || project.id === selectedProject)
    .map((project) => {
      const color = projectColor(project.id);
      return `<span style="--project-color: ${color.color}; --project-bg: ${color.bg}"><i></i>${escapeHtml(project.name)}</span>`;
    })
    .join("");

  const monthStart = calendarMonthDate();
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - ((monthStart.getDay() + 6) % 7));
  const monthLabel = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(monthStart);
  const eventsByDate = events.reduce((map, event) => {
    if (!map.has(event.date)) map.set(event.date, []);
    map.get(event.date).push(event);
    return map;
  }, new Map());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const iso = isoDate(date);
    const dayEvents = eventsByDate.get(iso) || [];
    return `
      <div class="calendar-day ${date.getMonth() === monthStart.getMonth() ? "" : "is-muted"} ${iso === todayIso ? "is-today" : ""}">
        <span>${date.getDate()}</span>
        <div>
          ${dayEvents
            .slice(0, 3)
            .map((event) => `<p class="${event.tone}" style="--project-color: ${event.projectColor}; --project-bg: ${event.projectBg}">${escapeHtml(event.shortTitle)}</p>`)
            .join("")}
          ${dayEvents.length > 3 ? `<small>+${dayEvents.length - 3}</small>` : ""}
        </div>
      </div>
    `;
  }).join("");

  elements.calendarGrid.innerHTML = `
    <div class="calendar-month-head">
      <div>
        <h4>${titleCase(monthLabel)}</h4>
        <span>${events.length} événement(s) filtré(s)</span>
      </div>
      <div class="calendar-month-actions">
        <button type="button" data-calendar-month="-1">Précédent</button>
        <button type="button" data-calendar-today>Aujourd'hui</button>
        <button type="button" data-calendar-month="1">Suivant</button>
      </div>
    </div>
    <div class="calendar-weekdays">
      <span>Lun</span><span>Mar</span><span>Mer</span><span>Jeu</span><span>Ven</span><span>Sam</span><span>Dim</span>
    </div>
    <div class="calendar-month-grid">${days}</div>
  `;

  elements.calendarList.innerHTML = events.length
    ? events
        .map(
          (event) => `
            <article class="calendar-event ${event.tone}" style="--project-color: ${event.projectColor}; --project-bg: ${event.projectBg}">
              <i aria-hidden="true"></i>
              <time>${formatShortDate(event.date)}</time>
              <div>
                <strong>${escapeHtml(event.title)}</strong>
                <span>${escapeHtml(event.projectName)}</span>
                <p>${escapeHtml(event.detail)}</p>
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="empty-review"><strong>Aucun événement</strong><span>Modifiez les filtres ou ajoutez des dates chantier, factures ou livraisons.</span></div>`;
}

function renderCalendarFilters() {
  if (!elements.calendarProjectFilter) return;
  const previousProject = elements.calendarProjectFilter.value || "all";
  elements.calendarProjectFilter.innerHTML = `
    <option value="all">Tous les chantiers</option>
    ${state.projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join("")}
  `;
  elements.calendarProjectFilter.value = state.projects.some((project) => project.id === previousProject) ? previousProject : "all";
}

function calendarMonthDate() {
  const [year, month] = String(state.calendarMonth || "").split("-").map(Number);
  if (year && month) return new Date(year, month - 1, 1);
  return new Date(today.getFullYear(), today.getMonth(), 1);
}

function setCalendarMonth(offset) {
  const date = calendarMonthDate();
  date.setMonth(date.getMonth() + offset);
  state.calendarMonth = isoDate(date).slice(0, 7);
  saveState();
  renderCalendar();
}

function resetCalendarMonth() {
  state.calendarMonth = isoDate(today).slice(0, 7);
  saveState();
  renderCalendar();
}

function calendarEvents() {
  return state.projects.flatMap((project) => {
    const color = projectColor(project.id);
    const events = [
      {
        projectId: project.id,
        projectName: project.name,
        projectColor: color.color,
        projectBg: color.bg,
        type: "project",
        tone: "active",
        date: project.startDate,
        title: "Début chantier",
        shortTitle: "Début",
        detail: `${project.client} · ${project.address}`,
      },
      {
        projectId: project.id,
        projectName: project.name,
        projectColor: color.color,
        projectBg: color.bg,
        type: "project",
        tone: "done",
        date: project.endDate,
        title: "Fin prévue chantier",
        shortTitle: "Fin prévue",
        detail: `${project.client} · ${project.address}`,
      },
    ];

    (project.invoices || []).forEach((invoice) => {
      const meta = invoiceMeta(invoice);
      events.push({
        projectId: project.id,
        projectName: project.name,
        projectColor: color.color,
        projectBg: color.bg,
        type: "invoice",
        tone: meta.color,
        date: invoice.date,
        title: invoice.label,
        shortTitle: `${invoice.percent || 0}%`,
        detail: `${invoice.action} · ${invoice.status === "done" ? "envoyée" : meta.note}`,
      });
    });

    (project.lots || []).forEach((lot) => {
      if (laborType(lot) !== "subcontractor" || !lot.subcontractorId) return;
      const subcontractor = state.subcontractors.find((item) => item.id === lot.subcontractorId);
      const detail = `${lot.name} · ${subcontractor?.companyName || "Sous-traitant"}${subcontractor?.trade ? ` · ${subcontractor.trade}` : ""}`;
      events.push({
        projectId: project.id,
        projectName: project.name,
        projectColor: color.color,
        projectBg: color.bg,
        type: "project",
        tone: "active",
        date: project.startDate,
        title: "Début intervention sous-traitant",
        shortTitle: "ST début",
        detail,
      });
      events.push({
        projectId: project.id,
        projectName: project.name,
        projectColor: color.color,
        projectBg: color.bg,
        type: "project",
        tone: lotProgress(lot) >= 100 ? "done" : "yellow",
        date: project.endDate,
        title: "Fin intervention sous-traitant",
        shortTitle: "ST fin",
        detail,
      });

      (project.invoices || []).forEach((invoice) => {
        const meta = invoiceMeta(invoice);
        events.push({
          projectId: project.id,
          projectName: project.name,
          projectColor: color.color,
          projectBg: color.bg,
          type: "invoice",
          tone: meta.color,
          date: invoice.date,
          title: "Lancement facture sous-traitant",
          shortTitle: "Facture ST",
          detail: `${subcontractor?.companyName || "Sous-traitant"} · ${lot.name} · ${invoice.percent || 0}% · env. ${money(Number(lot.labor || 0) * (Number(invoice.percent || 0) / 100))}`,
        });
      });
    });

    (project.supplyOrders || []).forEach((line) => {
      const logistics = [line.supplier || "fournisseur à renseigner", line.packageReference ? `colis ${line.packageReference}` : "", line.deliveryLocation || ""].filter(Boolean).join(" · ");
      const baseOrderEvent = {
        projectId: project.id,
        projectName: project.name,
        projectColor: color.color,
        projectBg: color.bg,
        type: "order",
        detail: `${line.category || "Commande"} · ${line.label} · ${logistics}`,
      };
      if (line.status === "in_progress" && line.orderDate) {
        events.push({
          ...baseOrderEvent,
          tone: "active",
          date: line.orderDate,
          title: "Commande passée",
          shortTitle: "Commandé",
        });
      }
      if (line.status === "received" && line.receivedDate) {
        events.push({
          ...baseOrderEvent,
          tone: "done",
          date: line.receivedDate,
          title: "Commande reçue",
          shortTitle: "Reçu",
        });
      }
      if (line.status === "delayed" && line.deliveryDate) {
        events.push({
          ...baseOrderEvent,
          tone: "red",
          date: line.deliveryDate,
          title: "Livraison commande en retard",
          shortTitle: "Retard",
        });
      }
    });

    return events.filter((event) => event.date);
  });
}

function projectColor(projectId) {
  const index = Math.max(0, state.projects.findIndex((project) => project.id === projectId));
  return PROJECT_COLORS[index % PROJECT_COLORS.length];
}

function groupedOrders(lines) {
  const groups = new Map();
  lines.forEach((line) => {
    const category = line.category || "À classer";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(line);
  });
  return [...groups.entries()];
}

function orderStatus(value) {
  return ORDER_STATUSES[value] || ORDER_STATUSES.to_order;
}

function orderStatusOptions(selected = "to_order") {
  return Object.entries(ORDER_STATUSES)
    .map(([value, status]) => `<option value="${value}"${value === selected ? " selected" : ""}>${status.label}</option>`)
    .join("");
}

function supplyLineMeta(line) {
  return [
    line.quantity ? `Qté ${escapeHtml(line.quantity)}${line.unit ? ` ${escapeHtml(line.unit)}` : ""}` : "",
    line.totalHT ? `HT ${money(line.totalHT)}` : "",
    line.ttc ? `TTC ${money(line.ttc)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderLibrary() {
  elements.libraryGrid.innerHTML = "";
  state.library.filter((lot) => includesSearch(lot.name, ...lot.keywords)).forEach((lot) => {
    const card = document.createElement("article");
    card.className = "data-card";
    card.innerHTML = `
      <h4>${lot.name}</h4>
      <p>${lot.keywords.join(", ")}</p>
      <span class="soft-status">${lot.keywords.length} mots-clés</span>
    `;
    elements.libraryGrid.appendChild(card);
  });
}

function renderSuppliers() {
  if (!elements.suppliersGrid) return;
  renderSupplierNameOptions();
  elements.suppliersGrid.innerHTML = "";
  const filtered = (state.suppliers || []).filter((supplier) => includesSearch(supplier.companyName, supplier.referent, supplier.phone, supplier.email));
  elements.supplierSummary.textContent = `${filtered.length} fiche(s)`;

  if (!filtered.length) {
    elements.suppliersGrid.innerHTML = `
      <div class="empty-review">
        <strong>Aucun fournisseur</strong>
        <span>Ajoutez les contacts fournisseurs pour centraliser les référents achats.</span>
      </div>
    `;
    return;
  }

  filtered.forEach((supplier) => {
    const history = supplierOrderHistory(supplier);
    const historyTotal = history.reduce((sum, item) => sum + item.amount, 0);
    const card = document.createElement("article");
    card.className = "data-card supplier-card";
    card.innerHTML = `
      <div class="card-topline">
        <span class="badge neutral">Fournisseur</span>
        <span>${new Date(supplier.createdAt).toLocaleDateString("fr-FR")}</span>
      </div>
      <h4>${escapeHtml(supplier.companyName)}</h4>
      <div class="supplier-fields">
        <label>
          <span>Référent</span>
          <input type="text" value="${escapeHtml(supplier.referent || "")}" placeholder="Contact" data-supplier-field="referent" data-supplier-id="${supplier.id}" />
        </label>
        <label>
          <span>Téléphone</span>
          <input type="tel" value="${escapeHtml(supplier.phone || "")}" placeholder="Téléphone" data-supplier-field="phone" data-supplier-id="${supplier.id}" />
        </label>
        <label>
          <span>Email</span>
          <input type="email" value="${escapeHtml(supplier.email || "")}" placeholder="Email" data-supplier-field="email" data-supplier-id="${supplier.id}" />
        </label>
      </div>
      <div class="supplier-actions">
        <a class="upload-button compact" href="tel:${escapeHtml((supplier.phone || "").replace(/\s+/g, ""))}">Appeler</a>
        <a class="upload-button compact" href="mailto:${escapeHtml(supplier.email || "")}">Email</a>
        <button type="button" class="danger-button" data-delete-supplier="${supplier.id}">Supprimer</button>
      </div>
      <div class="supplier-history">
        <div class="supplier-history-head">
          <span>Historique commandes</span>
          <strong>${history.length} ligne(s) · ${money(historyTotal)}</strong>
        </div>
        ${renderSupplierHistory(history)}
      </div>
    `;
    elements.suppliersGrid.appendChild(card);
  });
}

function renderSupplierNameOptions() {
  if (!elements.supplierNameOptions) return;
  elements.supplierNameOptions.innerHTML = (state.suppliers || [])
    .map((supplier) => `<option value="${escapeHtml(supplier.companyName)}"></option>`)
    .join("");
}

function renderSupplierHistory(history) {
  if (!history.length) {
    return `<div class="supplier-history-empty">Aucune ligne commande associée pour le moment.</div>`;
  }
  return history
    .slice(0, 6)
    .map((item) => {
      const color = projectColor(item.projectId);
      const status = orderStatus(item.status);
      return `
        <article class="supplier-history-row" style="--project-color: ${color.color}; --project-bg: ${color.bg};">
          <i class="${status.tone}"></i>
          <div>
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.projectName)} · ${escapeHtml(item.category)}${item.sourceFile ? ` · ${escapeHtml(item.sourceFile)}` : ""}</span>
          </div>
          <small>${money(item.amount)}</small>
        </article>
      `;
    })
    .join("");
}

function renderSubcontractors() {
  if (!elements.subcontractorsGrid) return;
  elements.subcontractorsGrid.innerHTML = "";
  const overloaded = state.subcontractors.filter((subcontractor) => {
    const assignments = subcontractorAssignments(subcontractor.id);
    return maxSimultaneousAssignments(assignments) > subcontractorCapacity(subcontractor);
  }).length;
  elements.subcontractorSummary.textContent = `${state.subcontractors.length} fiche(s)${overloaded ? ` · ${overloaded} surcharge(s)` : ""}`;

  state.subcontractors.filter((subcontractor) => includesSearch(subcontractor.companyName, subcontractor.trade)).forEach((subcontractor) => {
    const assignments = subcontractorAssignments(subcontractor.id);
    const invoiceReminders = subcontractorInvoiceReminders(subcontractor.id);
    const invoiceProjects = subcontractorInvoiceProjects(subcontractor.id);
    const capacity = subcontractorCapacity(subcontractor);
    const simultaneous = maxSimultaneousAssignments(assignments);
    const overloaded = simultaneous > capacity;
    const card = document.createElement("article");
    card.className = `data-card subcontractor-card ${overloaded ? "is-overloaded" : ""}`;
    card.innerHTML = `
      <div class="card-topline">
        <span class="badge ${overloaded ? "red" : "green"}">${overloaded ? "Surcharge" : "Disponible"}</span>
        <span>${new Date(subcontractor.createdAt).toLocaleDateString("fr-FR")}</span>
      </div>
      <h4>${escapeHtml(subcontractor.companyName)}</h4>
      <div class="subcontractor-fields">
        <label>
          <span>Corps de métier</span>
          <input type="text" value="${escapeHtml(subcontractor.trade || "")}" placeholder="Métier à renseigner" data-subcontractor-field="trade" data-subcontractor-id="${subcontractor.id}" />
        </label>
        <label>
          <span>Capacité max</span>
          <input type="number" min="1" step="1" value="${capacity}" data-subcontractor-field="maxProjects" data-subcontractor-id="${subcontractor.id}" />
        </label>
      </div>
      <div class="subcontractor-capacity ${overloaded ? "danger" : "ok"}">
        <div>
          <span>Planning</span>
          <strong>${simultaneous}/${capacity} chantier(s) simultané(s)</strong>
        </div>
        <small>${overloaded ? "Capacité dépassée sur au moins une période." : assignments.length ? "Charge compatible avec sa capacité." : "Aucun chantier assigné pour le moment."}</small>
      </div>
      <div class="subcontractor-planning">
        ${renderSubcontractorPlanning(assignments)}
      </div>
      <div class="subcontractor-invoices">
        <div class="subcontractor-section-title">
          <span>Lancements factures</span>
          <strong>${invoiceReminders.length}</strong>
        </div>
        ${renderSubcontractorInvoices(invoiceReminders)}
      </div>
      <div class="subcontractor-invoices">
        <div class="subcontractor-section-title">
          <span>Factures HT par chantier</span>
          <strong>${invoiceProjects.length}</strong>
        </div>
        ${renderSubcontractorInvoiceExports(subcontractor, invoiceProjects)}
      </div>
      <div class="documents-list">
        ${renderDocumentLink("KBIS", subcontractor.documents?.kbis)}
        ${renderDocumentLink("Assurance", subcontractor.documents?.insurance)}
        ${renderDocumentLink("Carte d'identité", subcontractor.documents?.idCard)}
      </div>
      <button type="button" data-delete-subcontractor="${subcontractor.id}">Supprimer la fiche</button>
    `;
    elements.subcontractorsGrid.appendChild(card);
  });
}

function renderSubcontractorInvoiceExports(subcontractor, invoiceProjects) {
  if (!invoiceProjects.length) {
    return `<div class="subcontractor-empty">Aucun lot de chantier sélectionné pour ce sous-traitant.</div>`;
  }
  return invoiceProjects
    .map((invoiceProject) => {
      const color = projectColor(invoiceProject.projectId);
      const isActive = invoiceProject.projectId === activeProject().id;
      return `
        <article class="subcontractor-export-row ${isActive ? "is-active-project" : ""}" style="--project-color: ${color.color}; --project-bg: ${color.bg};">
          <div>
            <span>${isActive ? "Chantier actif" : "Chantier"}</span>
            <strong>${escapeHtml(invoiceProject.projectName)}</strong>
            <small>${invoiceProject.lots.length} lot(s) · ${escapeHtml(invoiceProject.client || "Client non renseigné")}</small>
          </div>
          <div class="subcontractor-export-metrics">
            <span>${money(invoiceProject.totalSubcontractor)}</span>
            <small>Montant ST</small>
          </div>
          <div class="subcontractor-export-metrics">
            <span>${money(invoiceProject.totalNetHt)}</span>
            <small>Net HT</small>
          </div>
          <button type="button" class="primary-button compact" data-export-subcontractor-invoice="${subcontractor.id}:${invoiceProject.projectId}">Exporter PDF</button>
        </article>
      `;
    })
    .join("");
}

function renderSubcontractorInvoices(reminders) {
  if (!reminders.length) {
    return `<div class="subcontractor-empty">Aucune échéance facture liée à ce sous-traitant.</div>`;
  }
  return reminders
    .slice(0, 6)
    .map((reminder) => {
      const color = projectColor(reminder.projectId);
      return `
        <article class="subcontractor-invoice-row ${reminder.tone}" style="--project-color: ${color.color}; --project-bg: ${color.bg};">
          <time>${formatShortDate(reminder.date)}</time>
          <div>
            <strong>${escapeHtml(reminder.label)} · ${reminder.percent}%</strong>
            <span>${escapeHtml(reminder.projectName)} · ${escapeHtml(reminder.lots.join(", "))}</span>
          </div>
          <small>${money(reminder.amount)}</small>
        </article>
      `;
    })
    .join("");
}

function renderSubcontractorPlanning(assignments) {
  if (!assignments.length) {
    return `<div class="subcontractor-empty">Aucun lot sous-traitant assigné.</div>`;
  }
  return assignments
    .map((assignment) => {
      const color = projectColor(assignment.projectId);
      return `
        <article class="subcontractor-planning-row" style="--project-color: ${color.color}; --project-bg: ${color.bg};">
          <i></i>
          <div>
            <strong>${escapeHtml(assignment.lotName)}</strong>
            <span>${escapeHtml(assignment.projectName)} · ${escapeHtml(assignment.client)}</span>
          </div>
          <time>${formatShortDate(assignment.startDate)} → ${formatShortDate(assignment.endDate)}</time>
          <small>${percentFormatter.format(assignment.progress)}%</small>
        </article>
      `;
    })
    .join("");
}

function exportSubcontractorInvoice(subcontractorId, projectId) {
  const subcontractor = state.subcontractors.find((item) => item.id === subcontractorId);
  const project = state.projects.find((item) => item.id === projectId);
  if (!subcontractor || !project) return;
  const invoiceProject = subcontractorInvoiceProjects(subcontractorId).find((item) => item.projectId === projectId);
  if (!invoiceProject || !invoiceProject.lots.length) {
    alert("Aucun lot sous-traitant à exporter sur ce chantier.");
    return;
  }
  const invoiceNumber = `ST-${project.id}-${subcontractor.id}`.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 48);
  const generatedAt = new Date().toLocaleDateString("fr-FR");
  const rows = invoiceProject.lots
    .map(
      (lot) => `
        <tr>
          <td>
            <strong>${escapeHtml(lot.name)}</strong>
            <span>${escapeHtml(lot.source || "Lot chantier")}</span>
          </td>
          <td>${percentFormatter.format(lot.progress)}%</td>
          <td>${money(lot.netHt)}</td>
        </tr>
      `
    )
    .join("");
  const html = `
    <!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(invoiceNumber)} - ${escapeHtml(subcontractor.companyName)}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 34px;
            color: #11131c;
            background: #eef2f7;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", sans-serif;
          }
          .page {
            max-width: 920px;
            min-height: 1180px;
            margin: 0 auto;
            padding: 44px;
            border-radius: 28px;
            background:
              radial-gradient(circle at 86% 8%, rgba(136, 124, 253, 0.2), transparent 26%),
              radial-gradient(circle at 14% 16%, rgba(28, 200, 199, 0.14), transparent 28%),
              #ffffff;
            box-shadow: 0 28px 70px rgba(34, 38, 72, 0.16);
          }
          header {
            display: flex;
            justify-content: space-between;
            gap: 28px;
            padding-bottom: 28px;
            border-bottom: 1px solid #e3e7f0;
          }
          .brand {
            display: flex;
            align-items: center;
            gap: 14px;
            color: #342a86;
            font-weight: 900;
            font-size: 26px;
          }
          .mark {
            width: 42px;
            height: 42px;
            border-radius: 14px;
            background: linear-gradient(135deg, #5347ce, #887cfd);
            box-shadow: 0 14px 30px rgba(83, 71, 206, 0.25);
          }
          h1 {
            max-width: 620px;
            margin: 30px 0 10px;
            font-size: 42px;
            line-height: 1;
            letter-spacing: 0;
          }
          .meta {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
            margin: 28px 0;
          }
          .box {
            padding: 16px;
            border: 1px solid #e2e6f0;
            border-radius: 18px;
            background: rgba(248, 250, 254, 0.84);
          }
          .box span, .summary span {
            display: block;
            color: #73788a;
            font-size: 11px;
            font-weight: 850;
            text-transform: uppercase;
          }
          .box strong {
            display: block;
            margin-top: 6px;
            font-size: 16px;
          }
          .summary {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
            margin: 26px 0;
          }
          .summary article {
            padding: 18px;
            border-radius: 20px;
            background: linear-gradient(180deg, #ffffff, #f7f8fd);
            border: 1px solid #e2e6f0;
          }
          .summary strong {
            display: block;
            margin-top: 8px;
            font-size: 24px;
          }
          .summary article:last-child {
            color: #ffffff;
            background: linear-gradient(135deg, #5347ce, #887cfd);
            border-color: transparent;
          }
          .summary article:last-child span { color: rgba(255,255,255,.78); }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            overflow: hidden;
            border-radius: 18px;
          }
          th {
            padding: 14px;
            color: #73788a;
            background: #f3f5fa;
            font-size: 11px;
            text-align: right;
            text-transform: uppercase;
          }
          th:first-child, td:first-child { text-align: left; }
          td {
            padding: 16px 14px;
            border-bottom: 1px solid #e7eaf2;
            font-size: 14px;
            font-weight: 780;
            text-align: right;
            vertical-align: top;
          }
          td span {
            display: block;
            margin-top: 5px;
            color: #73788a;
            font-size: 12px;
            font-weight: 650;
          }
          footer {
            display: flex;
            justify-content: space-between;
            gap: 20px;
            margin-top: 34px;
            color: #73788a;
            font-size: 12px;
          }
          .actions {
            position: sticky;
            top: 0;
            display: flex;
            justify-content: center;
            gap: 10px;
            margin: -14px auto 20px;
          }
          button {
            height: 42px;
            padding: 0 18px;
            border: 0;
            border-radius: 999px;
            color: #ffffff;
            background: #5347ce;
            font-weight: 850;
            cursor: pointer;
          }
          @media print {
            body { padding: 0; background: #ffffff; }
            .page { max-width: none; min-height: auto; border-radius: 0; box-shadow: none; }
            .actions { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="actions">
          <button onclick="window.print()">Exporter / enregistrer en PDF</button>
        </div>
        <main class="page">
          <header>
            <div class="brand"><i class="mark"></i>Nova+</div>
            <div>
              <strong>${escapeHtml(invoiceNumber)}</strong><br />
              <span>Généré le ${generatedAt}</span>
            </div>
          </header>
          <h1>Facture sous-traitant HT</h1>
          <section class="meta">
            <div class="box"><span>Chantier</span><strong>${escapeHtml(project.name)}</strong></div>
            <div class="box"><span>Client</span><strong>${escapeHtml(project.client || "Client non renseigné")}</strong></div>
            <div class="box"><span>Adresse</span><strong>${escapeHtml(project.address || "Adresse non renseignée")}</strong></div>
            <div class="box"><span>Sous-traitant</span><strong>${escapeHtml(subcontractor.companyName)}${subcontractor.trade ? ` · ${escapeHtml(subcontractor.trade)}` : ""}</strong></div>
          </section>
          <section class="summary">
            <article><span>Nombre de lots</span><strong>${invoiceProject.lots.length}</strong></article>
            <article><span>Total HT</span><strong>${money(invoiceProject.totalNetHt)}</strong></article>
          </section>
          <table>
            <thead>
              <tr>
                <th>Lot</th>
                <th>Avancement</th>
                <th>Montant HT</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <footer>
            <span>Document de préparation généré par Nova+.</span>
            <span>Total HT : ${money(invoiceProject.totalNetHt)}</span>
          </footer>
        </main>
        <script>setTimeout(() => window.print(), 450);</script>
      </body>
    </html>
  `;
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Le navigateur a bloqué l'ouverture de la facture. Autorisez les fenêtres pop-up pour Nova+.");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

function formatShortDate(value) {
  if (!value) return "Date à renseigner";
  return new Date(`${value}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

function renderDocumentLink(label, document) {
  if (!document?.dataUrl) {
    return `<span class="document-pill missing">${label} manquant</span>`;
  }
  return `<a class="document-pill" href="${document.dataUrl}" download="${escapeHtml(document.name)}">${label} · ${escapeHtml(document.name)}</a>`;
}

function subcontractorOptions(selectedId = "") {
  if (!state.subcontractors.length) {
    return `<option value="">Aucun sous-traitant</option>`;
  }
  return [
    `<option value="">Choisir</option>`,
    ...state.subcontractors.map(
      (subcontractor) =>
        `<option value="${subcontractor.id}"${subcontractor.id === selectedId ? " selected" : ""}>${escapeHtml(subcontractor.companyName)}${subcontractor.trade ? ` · ${escapeHtml(subcontractor.trade)}` : ""}</option>`
    ),
  ].join("");
}

function supplierOptions(selectedName = "") {
  const suppliers = state.suppliers || [];
  const selected = selectedName || "";
  const hasMatchingSupplier = suppliers.some((supplier) => supplierMatches(selected, supplier.companyName));
  return [
    `<option value="">Choisir</option>`,
    selected && !hasMatchingSupplier ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} · importé</option>` : "",
    ...suppliers.map(
      (supplier) =>
        `<option value="${escapeHtml(supplier.companyName)}"${supplierMatches(selected, supplier.companyName) ? " selected" : ""}>${escapeHtml(supplier.companyName)}${supplier.referent ? ` · ${escapeHtml(supplier.referent)}` : ""}</option>`
    ),
  ].join("");
}

function fileToStoredDocument(file) {
  if (!file || !file.name || file.size === 0) return Promise.resolve(null);
  if (SERVER_STORAGE_ENABLED) return uploadFileToServer(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: reader.result,
        uploadedAt: new Date().toISOString(),
      });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function uploadFileToServer(file) {
  try {
    const dataUrl = await fileToDataUrl(file);
    const response = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataUrl,
      }),
    });
    if (!response.ok) throw new Error(`Upload impossible (${response.status})`);
    return response.json();
  } catch (error) {
    console.warn("Upload serveur indisponible, fallback navigateur.", error);
    return {
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      dataUrl: await fileToDataUrl(file),
      uploadedAt: new Date().toISOString(),
    };
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  elements.targetMarginInput.addEventListener("input", (event) => {
    state.settings.targetMargin = Number(event.target.value);
    saveState();
    renderAll();
  });

  elements.targetMarginSetting.addEventListener("input", (event) => {
    state.settings.targetMargin = Number(event.target.value);
    saveState();
    renderAll();
  });

  elements.redThreshold.addEventListener("input", (event) => {
    state.settings.redThreshold = Number(event.target.value);
    saveState();
    renderAll();
  });

  elements.invoiceWarningDays.addEventListener("input", (event) => {
    state.settings.invoiceWarningDays = Number(event.target.value);
    saveState();
    renderAll();
  });

  elements.vatRate.addEventListener("input", (event) => {
    state.settings.vatRate = Number(event.target.value);
    saveState();
    renderAll();
  });

  elements.lotsTable.addEventListener("input", (event) => {
    if (!event.target.matches("[data-lot-id]")) return;
    const lot = activeProject().lots.find((item) => item.id === event.target.dataset.lotId);
    const field = event.target.dataset.lotField || "real";
    lot[field] = Number(event.target.value);
    saveState();
    updateLotRow(event.target.closest("tr"), lot);
    renderSummary();
    renderRecommendations();
    renderProjects();
  });

  elements.lotsTable.addEventListener("change", (event) => {
    if (!event.target.matches("select[data-lot-id]")) return;
    const lot = activeProject().lots.find((item) => item.id === event.target.dataset.lotId);
    if (!lot) return;
    const field = event.target.dataset.lotField;
    lot[field] = event.target.value;
    if (field === "laborType" && lot.laborType !== "subcontractor") {
      lot.subcontractorId = "";
    }
    if (field === "laborType" && lot.laborType === "subcontractor" && !lot.subcontractorId) {
      lot.subcontractorId = state.subcontractors[0]?.id || "";
    }
    saveState();
    renderLots();
    renderSummary();
    renderRecommendations();
    renderProjects();
  });

  document.body.addEventListener("click", (event) => {
    if (event.target.closest("[data-validate-import]")) {
      validatePendingImport();
      return;
    }

    if (event.target.closest("[data-cancel-import]")) {
      state.pendingImport = null;
      state.extractedLines = [];
      elements.pdfStatus.textContent = "Import annulé";
      saveState();
      renderAll();
      return;
    }

    const calendarMonthButton = event.target.closest("[data-calendar-month]");
    if (calendarMonthButton) {
      setCalendarMonth(Number(calendarMonthButton.dataset.calendarMonth));
      return;
    }

    if (event.target.closest("[data-calendar-today]")) {
      resetCalendarMonth();
      return;
    }

    const toggleProjectArchiveButton = event.target.closest("[data-toggle-project-archive]");
    if (toggleProjectArchiveButton) {
      const project = state.projects.find((item) => item.id === toggleProjectArchiveButton.dataset.toggleProjectArchive);
      if (!project) return;
      project.archived = !project.archived;
      project.archivedAt = project.archived ? new Date().toISOString() : "";
      if (project.archived && state.activeProjectId === project.id) {
        state.activeProjectId = state.projects.find((item) => !item.archived && item.id !== project.id)?.id || project.id;
      }
      state.activeView = "projects";
      saveState();
      renderAll();
      return;
    }

    const deleteLotButton = event.target.closest("[data-delete-lot]");
    if (deleteLotButton) {
      const project = activeProject();
      const lot = project.lots.find((item) => item.id === deleteLotButton.dataset.deleteLot);
      if (!lot) return;
      if (!confirm(`Supprimer le lot "${lot.name}" ?`)) return;
      project.lots = project.lots.filter((item) => item.id !== lot.id);
      saveState();
      renderAll();
      return;
    }

    const deleteProjectButton = event.target.closest("[data-delete-project]");
    if (deleteProjectButton) {
      const project = state.projects.find((item) => item.id === deleteProjectButton.dataset.deleteProject);
      if (!project) return;
      if (state.projects.length <= 1) {
        alert("Impossible de supprimer le dernier chantier.");
        return;
      }
      if (!confirm(`Supprimer le chantier "${project.name}" ?`)) return;
      state.projects = state.projects.filter((item) => item.id !== project.id);
      if (state.activeProjectId === project.id) {
        state.activeProjectId = state.projects[0]?.id || "";
      }
      state.activeView = "projects";
      saveState();
      renderAll();
      return;
    }

    const projectButton = event.target.closest("[data-select-project]");
    if (projectButton) {
      state.activeProjectId = projectButton.dataset.selectProject;
      state.activeView = "dashboard";
      saveState();
      renderAll();
    }

    const invoiceButton = event.target.closest("[data-toggle-invoice]");
    if (invoiceButton) {
      const [projectId, invoiceId] = invoiceButton.dataset.toggleInvoice.split(":");
      const project = state.projects.find((item) => item.id === projectId);
      const invoice = project.invoices.find((item) => item.id === invoiceId);
      invoice.status = invoice.status === "done" ? "pending" : "done";
      saveState();
      renderAll();
    }

    if (event.target.closest("[data-add-project-invoice]")) {
      const project = activeProject();
      project.invoices = Array.isArray(project.invoices) ? project.invoices : [];
      const due = new Date(`${project.startDate || today.toISOString().slice(0, 10)}T00:00:00`);
      due.setDate(due.getDate() + project.invoices.length * 30);
      const percent = project.invoices.length ? 20 : 30;
      project.invoices.push({
        id: `invoice-${Date.now()}`,
        label: project.invoices.length ? "Situation travaux" : "Acompte",
        action: `Facture ${percent}% à envoyer`,
        percent,
        date: due.toISOString().slice(0, 10),
        status: "pending",
      });
      saveState();
      renderProjectPaymentSchedule(project);
      renderTimeline();
      renderBilling();
      renderRecommendations();
      return;
    }

    const deleteProjectInvoiceButton = event.target.closest("[data-delete-project-invoice]");
    if (deleteProjectInvoiceButton) {
      const project = activeProject();
      project.invoices = (project.invoices || []).filter((invoice) => invoice.id !== deleteProjectInvoiceButton.dataset.deleteProjectInvoice);
      saveState();
      renderProjectPaymentSchedule(project);
      renderTimeline();
      renderBilling();
      renderRecommendations();
      return;
    }

    const deleteSubcontractorButton = event.target.closest("[data-delete-subcontractor]");
    if (deleteSubcontractorButton) {
      const subcontractor = state.subcontractors.find((item) => item.id === deleteSubcontractorButton.dataset.deleteSubcontractor);
      if (!subcontractor) return;
      if (!confirm(`Supprimer la fiche "${subcontractor.companyName}" ?`)) return;
      state.subcontractors = state.subcontractors.filter((item) => item.id !== subcontractor.id);
      state.projects.forEach((project) => {
        project.lots.forEach((lot) => {
          if (lot.subcontractorId === subcontractor.id) {
            lot.subcontractorId = "";
            lot.laborType = "employee";
          }
        });
      });
      saveState();
      renderAll();
    }

    const exportSubcontractorInvoiceButton = event.target.closest("[data-export-subcontractor-invoice]");
    if (exportSubcontractorInvoiceButton) {
      const [subcontractorId, projectId] = exportSubcontractorInvoiceButton.dataset.exportSubcontractorInvoice.split(":");
      exportSubcontractorInvoice(subcontractorId, projectId);
      return;
    }

    const removePendingDocumentButton = event.target.closest("[data-remove-pending-project-document]");
    if (removePendingDocumentButton) {
      removePendingProjectDocumentFile(Number(removePendingDocumentButton.dataset.removePendingProjectDocument));
      return;
    }

    const previewPendingDocumentButton = event.target.closest("[data-preview-pending-project-document]");
    if (previewPendingDocumentButton) {
      openPendingProjectDocumentPreview(Number(previewPendingDocumentButton.dataset.previewPendingProjectDocument));
      return;
    }

    if (event.target.closest("[data-close-document-preview]")) {
      closeDocumentPreview();
      return;
    }

    if (event.target === elements.documentPreviewModal) {
      closeDocumentPreview();
      return;
    }

    if (event.target.closest("[data-clear-pending-project-documents]")) {
      clearPendingProjectDocumentFiles();
      return;
    }

    const deleteProjectDocumentButton = event.target.closest("[data-delete-project-document]");
    if (deleteProjectDocumentButton) {
      const project = activeProject();
      const document = (project.documents || []).find((item) => item.id === deleteProjectDocumentButton.dataset.deleteProjectDocument);
      if (!document) return;
      if (!confirm(`Supprimer le document "${document.label}" ?`)) return;
      project.documents = (project.documents || []).filter((item) => item.id !== document.id);
      saveState();
      renderProjectDocuments();
      return;
    }

    const deleteSupplierButton = event.target.closest("[data-delete-supplier]");
    if (deleteSupplierButton) {
      const supplier = (state.suppliers || []).find((item) => item.id === deleteSupplierButton.dataset.deleteSupplier);
      if (!supplier) return;
      if (!confirm(`Supprimer le fournisseur "${supplier.companyName}" ?`)) return;
      state.suppliers = (state.suppliers || []).filter((item) => item.id !== supplier.id);
      saveState();
      renderSuppliers();
    }
  });

  document.body.addEventListener("input", (event) => {
    if (event.target.matches("[data-supplier-field]")) {
      updateSupplierField(event.target);
      return;
    }

    if (event.target.matches("[data-subcontractor-field]")) {
      updateSubcontractorField(event.target);
      return;
    }

    if (!event.target.matches("[data-supply-field]")) return;
    updateSupplyOrderLine(event.target);
    updateSupplyOrderMarginReadout(event.target);
    if (event.target.dataset.supplyField === "supplier") renderSupplierNameOptions();
  });

  document.body.addEventListener("change", (event) => {
    if (event.target.matches("[data-supplier-field]")) {
      updateSupplierField(event.target);
      renderSuppliers();
      return;
    }

    if (event.target.matches("[data-subcontractor-field]")) {
      updateSubcontractorField(event.target);
      renderLots();
      renderSubcontractors();
      return;
    }

    if (event.target.matches("[data-supply-field]")) {
      updateSupplyOrderLine(event.target);
      saveState();
      if (["status", "finalPrice", "purchasePrice", "salePrice", "deliveryPrice"].includes(event.target.dataset.supplyField)) {
        renderOrders();
      }
      if (event.target.dataset.supplyField === "supplier") renderSuppliers();
      return;
    }

    if (event.target.matches("[data-import-line-index]")) {
      const index = Number(event.target.dataset.importLineIndex);
      if (!state.pendingImport?.lines[index]) return;
      state.pendingImport.lines[index].lot = event.target.value;
      state.extractedLines = state.pendingImport.lines;
      saveState();
      renderAll();
      return;
    }

    if (event.target.matches("[data-detail-lot-id]")) {
      reassignProjectDetailLine(event.target.dataset.detailLotId, Number(event.target.dataset.detailLineIndex), event.target.value);
      saveState();
      renderAll();
    }
  });

  elements.simulateImportButton.addEventListener("click", () => {
    const project = createProjectFromPdf("devis-exemple-nova.pdf", defaultState.extractedLines);
    state.projects.unshift(project);
    state.activeProjectId = project.id;
    state.activeView = "projects";
    state.extractedLines = defaultState.extractedLines;
    saveState();
    renderAll();
  });
  elements.pdfInput.addEventListener("change", (event) => handlePdfChoice(event.target.files[0]));
  elements.pdfInputSecondary.addEventListener("change", (event) => handlePdfChoice(event.target.files[0]));
  elements.orderPdfInput.addEventListener("change", (event) => handleOrderPdfChoice(event.target.files[0]));
  elements.projectDocumentFilesInput.addEventListener("change", (event) => {
    addPendingProjectDocumentFiles(event.target.files);
    event.target.value = "";
  });

  elements.resetDataButton.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    state = structuredClone(defaultState);
    renderAll();
  });

  elements.newProjectButton.addEventListener("click", () => {
    const newProject = createNewProject();
    state.projects.push(newProject);
    state.activeProjectId = newProject.id;
    state.activeView = "dashboard";
    saveState();
    renderAll();
  });

  elements.globalSearch.addEventListener("input", renderAll);
  elements.calendarProjectFilter.addEventListener("change", renderCalendar);
  elements.calendarTypeFilter.addEventListener("change", renderCalendar);

  elements.projectForm.addEventListener("input", (event) => {
    if (event.target.matches("[data-payment-id]")) {
      updateProjectInvoiceField(event.target);
      return;
    }

    const field = event.target.name;
    if (!field) return;
    activeProject()[field] = event.target.value;
    saveState();
    renderProjectHeader();
    renderSummary();
    renderProjects();
  });

  elements.lotForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(elements.lotForm);
    activeProject().lots.push({
      id: `lot-${Date.now()}`,
      name: form.get("name").trim(),
      source: form.get("source").trim(),
      sale: Number(form.get("sale")) || 0,
      progress: Number(form.get("progress")) || 0,
      material: Number(form.get("material")) || 0,
      labor: Number(form.get("labor")) || 0,
      commercial: 0,
      commercialRate: Number(form.get("commercialRate")) || 0,
      other: 0,
      planned: Number(form.get("planned")) || 0,
      laborType: form.get("laborType") || "employee",
      subcontractorId: form.get("laborType") === "subcontractor" ? form.get("subcontractorId") || "" : "",
    });
    elements.lotForm.reset();
    elements.lotForm.elements.progress.value = 0;
    elements.lotForm.elements.material.value = 0;
    elements.lotForm.elements.labor.value = 0;
    elements.lotForm.elements.commercialRate.value = 0;
    elements.lotForm.elements.planned.value = 0;
    saveState();
    renderAll();
  });

  elements.subcontractorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(elements.subcontractorForm);
    state.subcontractors.push({
      id: `sub-${Date.now()}`,
      companyName: form.get("companyName").trim(),
      trade: form.get("trade").trim(),
      maxProjects: Number(form.get("maxProjects")) || 1,
      documents: {
        kbis: await fileToStoredDocument(form.get("kbis")),
        insurance: await fileToStoredDocument(form.get("insurance")),
        idCard: await fileToStoredDocument(form.get("idCard")),
      },
      createdAt: new Date().toISOString(),
    });
    elements.subcontractorForm.reset();
    saveState();
    renderAll();
  });

  elements.supplierForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(elements.supplierForm);
    state.suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
    state.suppliers.unshift({
      id: `supplier-${Date.now()}`,
      companyName: form.get("companyName").trim(),
      referent: form.get("referent").trim(),
      phone: form.get("phone").trim(),
      email: form.get("email").trim(),
      createdAt: new Date().toISOString(),
    });
    elements.supplierForm.reset();
    saveState();
    renderSuppliers();
  });

  elements.projectDocumentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const project = activeProject();
    const form = new FormData(elements.projectDocumentForm);
    const selectedFiles = pendingProjectDocumentFiles.filter((file, index, files) => file?.name && files.findIndex((item) => item?.name === file.name && item?.size === file.size && item?.lastModified === file.lastModified) === index);
    elements.projectDocumentsStatus.textContent = selectedFiles.length ? `Lecture de ${selectedFiles.length} fichier(s)...` : "Aucun fichier sélectionné";
    if (!selectedFiles.length) return;
    const storedFiles = await Promise.all(selectedFiles.map((file) => fileToStoredDocument(file)));
    const files = storedFiles.filter(Boolean);
    if (!files.length) {
      elements.projectDocumentsStatus.textContent = "Aucun fichier lisible";
      return;
    }
    project.documents = Array.isArray(project.documents) ? project.documents : [];
    const nextDocument = {
      id: `doc-${Date.now()}`,
      label: form.get("label").trim(),
      category: form.get("category") || "Autre",
      files,
      uploadedAt: new Date().toISOString(),
    };
    project.documents.unshift(nextDocument);
    if (!trySaveState()) {
      project.documents = project.documents.filter((document) => document.id !== nextDocument.id);
      alert("Les fichiers sont trop lourds pour être stockés dans cette version locale. Essaie avec moins de fichiers ou des fichiers plus légers.");
      renderProjectDocuments();
      elements.projectDocumentsStatus.textContent = "Fichiers trop lourds pour le stockage local du navigateur";
      return;
    }
    elements.projectDocumentForm.reset();
    clearPendingProjectDocumentFiles();
    renderProjectDocuments();
  });

  elements.invoiceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(elements.invoiceForm);
    activeProject().invoices.push({
      id: `invoice-${Date.now()}`,
      label: form.get("label").trim(),
      action: form.get("action").trim(),
      percent: Number(form.get("percent")) || 0,
      date: form.get("date"),
      status: "pending",
    });
    elements.invoiceForm.reset();
    saveState();
    renderAll();
  });

  elements.libraryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(elements.libraryForm);
    state.library.push({
      name: form.get("name").trim(),
      keywords: form
        .get("keywords")
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean),
    });
    elements.libraryForm.reset();
    saveState();
    renderAll();
  });

  elements.exportButton.addEventListener("click", exportActiveProjectCsv);
  elements.exportOrdersButton.addEventListener("click", exportSupplyOrdersCsv);
}

function updateProjectInvoiceField(input) {
  const project = activeProject();
  const invoice = (project.invoices || []).find((item) => item.id === input.dataset.paymentId);
  if (!invoice) return;
  const field = input.dataset.paymentField;
  invoice[field] = field === "percent" ? Number(input.value) || 0 : input.value;
  saveState();
  renderTimeline();
  renderBilling();
  renderRecommendations();
}

function updateSupplierField(input) {
  const supplier = (state.suppliers || []).find((item) => item.id === input.dataset.supplierId);
  if (!supplier) return;
  const field = input.dataset.supplierField;
  supplier[field] = input.value;
  saveState();
}

function updateSubcontractorField(input) {
  const subcontractor = state.subcontractors.find((item) => item.id === input.dataset.subcontractorId);
  if (!subcontractor) return;
  const field = input.dataset.subcontractorField;
  subcontractor[field] = field === "maxProjects" ? Math.max(1, Number(input.value) || 1) : input.value;
  saveState();
}

function updateSupplyOrderLine(input) {
  const project = activeProject();
  const line = (project.supplyOrders || []).find((item) => item.id === input.dataset.supplyId);
  if (!line) return;
  const field = input.dataset.supplyField;
  line[field] = ["finalPrice", "purchasePrice", "salePrice", "deliveryPrice"].includes(field) ? Number(input.value) || 0 : input.value;
  saveState();
}

function updateSupplyOrderMarginReadout(input) {
  const field = input.dataset.supplyField;
  if (!["purchasePrice", "salePrice", "deliveryPrice"].includes(field)) return;
  const project = activeProject();
  const line = (project.supplyOrders || []).find((item) => item.id === input.dataset.supplyId);
  const readout = document.querySelector(`[data-supply-margin-id="${CSS.escape(input.dataset.supplyId)}"]`);
  if (!line || !readout) return;
  readout.classList.remove("empty", "positive", "negative");
  readout.classList.add(supplyMarginTone(line));
  readout.innerHTML = `<span>Marge réelle</span>${supplyMarginHtml(line)}`;
}

function exportActiveProjectCsv() {
  const project = activeProject();
  const rows = [
    ["Nova+ bilan chantier"],
    ["Chantier", project.name],
    ["Client", project.client],
    ["Adresse", project.address],
    [],
    ["Lot", "Avancement %", "Vente HT", "Materiaux", "Main d'oeuvre", "Type MO", "Sous-traitant", "Commercial %", "Commercial montant", "Autres frais", "Cout prevu", "Cout reel", "Marge reelle", "Benefice reel", "Prix cible"],
    ...project.lots.map((lot) => {
      const real = realCost(lot);
      return [
        lot.name,
        lotProgress(lot),
        lot.sale,
        lot.material,
        lot.labor,
        laborType(lot) === "subcontractor" ? "Sous-traitant" : "Salarie",
        laborType(lot) === "subcontractor" ? subcontractorName(lot.subcontractorId) : "",
        commercialRate(lot),
        commercialCost(lot),
        lot.other,
        plannedCost(lot),
        real,
        `${percentFormatter.format(marginRate(lot.sale, real))}%`,
        Number(lot.sale || 0) - real,
        Math.round(advisedPrice(real)),
      ];
    }),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-bilan.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportSupplyOrdersCsv() {
  const project = activeProject();
  const rows = [
    ["Nova+ suivi commande"],
    ["Chantier", project.name],
    ["Fichier", project.supplyOrderFile || ""],
    [],
    ["Categorie", "Ligne", "Fournisseur", "Reference colis", "Lieu livraison", "Reference article", "Quantite", "Unite", "Prix unitaire HT", "Total HT", "TTC", "Prix final", "Prix achat", "Prix vente", "Prix livraison", "Marge reelle", "Marge reelle %", "Statut", "Date commande", "Date reception", "Nouvelle livraison"],
    ...(project.supplyOrders || []).map((line) => [
      line.category,
      line.label,
      line.supplier || "",
      line.packageReference || "",
      line.deliveryLocation || "",
      line.reference || "",
      line.quantity || "",
      line.unit || "",
      line.unitHT || "",
      line.totalHT || "",
      line.ttc || "",
      line.finalPrice || "",
      supplyPurchasePrice(line),
      supplySalePrice(line) || "",
      line.deliveryPrice || "",
      supplySalePrice(line) ? supplyRealMargin(line) : "",
      supplySalePrice(line) ? `${percentFormatter.format(supplyMarginRate(line))}%` : "",
      orderStatus(line.status).label,
      line.orderDate || "",
      line.receivedDate || "",
      line.deliveryDate || "",
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-suivi-commande.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

async function handlePdfChoice(file) {
  if (!file) return;
  if (!window.pdfjsLib) {
    elements.pdfStatus.textContent = "PDF.js indisponible. Vérifiez la connexion internet.";
    state.activeView = "pdf";
    saveState();
    renderAll();
    return;
  }

  elements.pdfStatus.textContent = `Lecture de ${file.name}...`;
  elements.simulateImportButton.textContent = "Analyse en cours...";
  elements.simulateImportButton.disabled = true;
  state.activeView = "pdf";
  renderAll();

  try {
    const analysis = await analyzePdfFile(file);
    state.extractedLines = analysis.lines;

    if (!analysis.text.trim()) {
      elements.pdfStatus.textContent = "Aucun texte détecté : devis probablement scanné, OCR requis.";
      saveState();
      renderAll();
      return;
    }

    if (!analysis.lines.length) {
      elements.pdfStatus.textContent = "Texte lu, mais aucune ligne avec montant exploitable détectée.";
      saveState();
      renderAll();
      return;
    }

    state.pendingImport = {
      fileName: file.name,
      lines: analysis.lines,
      rawText: analysis.text,
      detectedTotal: analysis.lines.reduce((sum, line) => sum + Number(line.amount || 0), 0),
      createdAt: new Date().toISOString(),
    };
    state.extractedLines = analysis.lines;
    state.activeView = "pdf";
    elements.pdfStatus.textContent = `${analysis.lines.length} ligne(s) détectée(s), validation requise`;
    saveState();
    renderAll();
  } catch (error) {
    console.error(error);
    elements.pdfStatus.textContent = "Impossible de lire ce PDF. Essayez un PDF texte ou exportez le devis en PDF non scanné.";
    state.activeView = "pdf";
    saveState();
    renderAll();
  } finally {
    elements.simulateImportButton.textContent = "Créer un exemple";
    elements.simulateImportButton.disabled = false;
  }
}

async function handleOrderPdfChoice(file) {
  if (!file) return;
  if (!window.pdfjsLib) {
    elements.orderStatus.textContent = "PDF.js indisponible. Vérifiez la connexion internet.";
    return;
  }

  elements.orderStatus.textContent = `Lecture de ${file.name}...`;
  state.activeView = "orders";
  renderAll();

  try {
    const analysis = await analyzeSupplyOrderPdfFile(file);
    const project = activeProject();
    project.supplyOrderFile = file.name;
    project.supplyOrders = analysis.lines;
    elements.orderStatus.textContent = `${analysis.lines.length} ligne(s) importée(s) sur ${project.name}`;
    saveState();
    renderAll();
  } catch (error) {
    console.error(error);
    elements.orderStatus.textContent = "Impossible de lire cette liste commande PDF.";
    renderAll();
  } finally {
    elements.orderPdfInput.value = "";
  }
}

function validatePendingImport() {
  if (!state.pendingImport?.lines?.length) return;
  const project = createProjectFromPdf(state.pendingImport.fileName, state.pendingImport.lines, state.pendingImport.rawText);
  state.projects.unshift(project);
  state.activeProjectId = project.id;
  state.extractedLines = state.pendingImport.lines;
  state.pendingImport = null;
  state.activeView = "projects";
  elements.pdfStatus.textContent = `${project.quoteFile} validé et créé dans Chantiers`;
  saveState();
  renderAll();
}

function simulateImport(message) {
  elements.simulateImportButton.textContent = message;
  elements.pdfStatus.textContent = message;
  elements.simulateImportButton.disabled = true;
  setTimeout(() => {
    elements.simulateImportButton.textContent = "Créer un exemple";
    elements.simulateImportButton.disabled = false;
  }, 1400);
}

function createNewProject() {
  const count = state.projects.length + 1;
  return {
    id: `chantier-${Date.now()}`,
    name: `Nouveau chantier ${count}`,
    client: "Client à renseigner",
    address: "Adresse à renseigner",
    startDate: "2026-07-20",
    endDate: "2026-09-15",
    status: "Devis",
    archived: false,
    archivedAt: "",
    quoteFile: "",
    documents: [],
    lots: [
      { id: "preparation", name: "Préparation chantier", source: "Ligne créée manuellement", sale: 5000, material: 1200, labor: 1600, commercial: 250, other: 300, planned: 3500, laborType: "employee", subcontractorId: "" },
    ],
    invoices: [
      { id: "acompte", label: "Acompte", action: "Facture acompte 30%", percent: 30, date: "2026-07-20", status: "pending" },
      { id: "solde", label: "Solde", action: "Facture solde 70%", percent: 70, date: "2026-09-15", status: "pending" },
    ],
  };
}

async function analyzePdfFile(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageLines = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    pageLines.push(...textItemsToLines(textContent.items, pageNumber));
  }

  const text = pageLines.map((line) => line.text).join("\n");
  return {
    text,
    lines: extractQuoteLines(pageLines),
  };
}

async function analyzeSupplyOrderPdfFile(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageLines = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    pageLines.push(...textItemsToLines(textContent.items, pageNumber));
  }

  return {
    lines: extractSupplyOrderLines(pageLines, file.name),
  };
}

function textItemsToLines(items, pageNumber) {
  const buckets = new Map();

  items.forEach((item) => {
    const text = normalizeSpaces(item.str);
    if (!text) return;
    const y = Math.round(item.transform[5] / 3) * 3;
    if (!buckets.has(y)) buckets.set(y, []);
    buckets.get(y).push({ text, x: item.transform[4] });
  });

  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, parts]) => ({
      page: pageNumber,
      y,
      text: normalizeSpaces(parts.sort((a, b) => a.x - b.x).map((part) => part.text).join(" ")),
    }))
    .filter((line) => line.text.length > 2);
}

function extractQuoteLines(pageLines) {
  const structured = extractStructuredQuoteLines(pageLines);
  if (structured.length) return structured;

  const ignored = /\b(total|sous[- ]?total|tva|acompt|net\s+a\s+payer|conditions|iban|bic|siret|validite|signature|bon\s+pour|page|devis\s+n|révision|revision|chantier|validité|validite|début|debut|durée|duree|siret|intracommunautaire)\b/i;
  const lines = [];

  pageLines.forEach((line) => {
    if (ignored.test(line.text)) return;
    if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(line.text)) return;
    const amount = extractLastAmount(line.text);
    if (!amount || amount < 1) return;
    const label = cleanLineLabel(line.text);
    if (label.length < 4) return;
    const lot = classifyLot(label);
    lines.push({
      label,
      lot,
      amount,
      confidence: lot === "À classer" ? 58 : 86,
      page: line.page,
      raw: line.text,
    });
  });

  return dedupeQuoteLines(lines).slice(0, 80);
}

function extractSupplyOrderLines(pageLines, fileName = "") {
  const ignored = /\b(total achat|attention|prix final|validation client|liens|automatique|image type|ht tva ttc|oseraie_liste|sdb familiale)\b/i;
  let currentCategory = "À classer";
  const lines = [];

  pageLines.forEach((line) => {
    const text = normalizeSpaces(line.text);
    if (!text || ignored.test(text)) return;
    const amounts = extractAllAmounts(text);
    const category = supplyCategoryFromHeading(text);
    if (!amounts.length && category) {
      currentCategory = category;
      return;
    }
    if (amounts.length < 2) return;
    if (/\b(total|tva|attention)\b/i.test(text)) return;

    const label = cleanSupplyOrderLabel(text);
    if (label.length < 3) return;
    const supplier = detectSupplier(text);
    const categoryName = classifySupplyCategory(`${currentCategory} ${label}`);
    const quantity = detectSupplyQuantity(text);
    const unit = detectSupplyUnit(text);
    const unitHT = amounts[0] || 0;
    const totalHT = amounts[1] || unitHT;
    const ttc = amounts[2] || 0;

    lines.push({
      id: `supply-${Date.now()}-${lines.length}`,
      category: categoryName || currentCategory,
      label,
      supplier,
      reference: detectSupplyReference(text),
      quantity,
      unit,
      unitHT,
      totalHT,
      ttc,
      finalPrice: totalHT || ttc || unitHT,
      purchasePrice: totalHT || ttc || unitHT,
      salePrice: 0,
      status: "to_order",
      packageReference: "",
      deliveryLocation: "",
      deliveryPrice: 0,
      orderDate: "",
      receivedDate: "",
      deliveryDate: "",
      sourceFile: fileName,
      page: line.page,
      raw: text,
    });
  });

  return dedupeSupplyOrders(lines).slice(0, 180);
}

function supplyCategoryFromHeading(text) {
  const normalized = normalizeForMatch(text);
  const headings = [
    ["WC", ["wc", "toilette"]],
    ["Revêtements de sol", ["revetements de sol", "carrelage sol"]],
    ["Faïence", ["faience", "carrelage mural"]],
    ["Maçonnerie", ["maconnerie"]],
    ["Plomberie", ["plomberie", "equipements"]],
    ["Meuble vasque", ["meuble vasque", "vasque"]],
    ["Menuiserie", ["menuiserie", "poignee", "placard", "claustra"]],
    ["Plan vasque", ["plan vasque", "plan de travail"]],
    ["Miroir / Rangement", ["miroir", "rangement"]],
    ["Éclairage", ["eclairage", "applique", "spot", "plafonnier"]],
  ];
  if (text.length > 48) return null;
  const match = headings.find(([, aliases]) => aliases.some((alias) => normalized === normalizeForMatch(alias) || normalized.includes(normalizeForMatch(alias))));
  return match ? match[0] : null;
}

function classifySupplyCategory(value) {
  const normalized = normalizeForMatch(value);
  const rules = [
    ["WC", ["wc", "toilette", "geberit", "duofix"]],
    ["Douche", ["receveur", "douche", "paroi", "colonne"]],
    ["Baignoire", ["baignoire", "mitigeur bain"]],
    ["Revêtements", ["carrelage", "faience", "joint", "profile", "revetement"]],
    ["Plomberie", ["bonde", "mitigeur", "seche-serviette", "seche serviette", "radiateur", "vasque"]],
    ["Meuble vasque", ["metod", "maximera", "caisson", "panneau", "sinarp", "ikea"]],
    ["Plan vasque", ["plan de travail", "plan vasque", "compact", "stratifie"]],
    ["Menuiserie", ["poignee", "placard", "claustra", "mdf", "tablette"]],
    ["Éclairage", ["applique", "spot", "plafonnier", "luminaire"]],
  ];
  const match = rules.find(([, keywords]) => keywords.some((keyword) => normalized.includes(normalizeForMatch(keyword))));
  return match ? match[0] : supplyCategoryFromHeading(value) || "À classer";
}

function cleanSupplyOrderLabel(text) {
  const beforeAmount = text.split(/(?:\d{1,3}(?:[ .]\d{3})+|\d+),\d{2}\s*€/)[0] || text;
  return normalizeSpaces(
    beforeAmount
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\b(U|Ens|m2|ml|cm|ok|client|HSM|OK)\b/gi, " ")
      .replace(/\b(La carotech|Leroy Merlin|Ikea|Tots|Create|Rea|Castorama|Plum|Miroiterie|Tiroco|Mexen|Agostini)\b/gi, " ")
      .replace(/\b\d{3,}[\d.]*\b/g, " ")
      .replace(/\s+/g, " ")
  ).slice(0, 150);
}

function detectSupplier(text) {
  const suppliers = ["La carotech", "Leroy Merlin", "Ikea", "Tots", "Create", "Rea", "Castorama", "Plum", "Miroiterie", "Tiroco", "Mexen", "Agostini"];
  return suppliers.find((supplier) => normalizeForMatch(text).includes(normalizeForMatch(supplier))) || "";
}

function detectSupplyUnit(text) {
  const match = text.match(/\b(m2|ml|U|Ens)\b/i);
  return match ? match[1] : "";
}

function detectSupplyQuantity(text) {
  const unitMatch = text.match(/\b(?:m2|ml|U|Ens)\s+(\d+(?:,\d+)?)\b/i);
  return unitMatch ? unitMatch[1] : "";
}

function detectSupplyReference(text) {
  const match = text.match(/\b(?:\d{3}\.\d{3}\.\d{2}|\d{6,}|[A-Z]\.\d{2}\s+[A-Z0-9]+)\b/);
  return match ? match[0] : "";
}

function extractAllAmounts(text) {
  return [...text.matchAll(/(?:^|\s)(-?(?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.]\d{2}))\s*€/gi)]
    .map((match) => parseFrenchNumber(match[1]))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function dedupeSupplyOrders(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    const key = `${line.category}:${normalizeForMatch(line.label)}:${Math.round(Number(line.totalHT || 0) * 100)}:${line.page}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractStructuredQuoteLines(pageLines) {
  const sectionPattern = /^(\d{1,2})\s+(.+?)\s+((?:\d{1,3}(?:[ .]\d{3})+|\d+),\d{2})$/;
  const itemPattern = /^(\d{1,2}\.\d+)\s+(.+?)\s+([A-Za-zÀ-ÿ0-9².,'’+()\/ -]{1,24})\s+(\d+(?:,\d+)?)\s+((?:\d{1,3}(?:[ .]\d{3})+|\d+),\d{2})\s+((?:\d{1,3}(?:[ .]\d{3})+|\d+),\d{2})(?:\s+(\d+(?:,\d+)?))?$/i;
  let currentSection = "";
  const sections = [];
  const itemLines = [];

  pageLines.forEach((line) => {
    const text = normalizeSpaces(line.text);
    const sectionMatch = text.match(sectionPattern);
    if (sectionMatch && !text.includes(".")) {
      currentSection = sectionMatch[2];
      const amount = parseFrenchNumber(sectionMatch[3]);
      if (amount && amount > 0) {
        sections.push({
          code: sectionMatch[1],
          label: currentSection,
          section: currentSection,
          lot: classifyLot(currentSection),
          amount,
          confidence: 96,
          page: line.page,
          raw: text,
          level: "section",
        });
      }
      return;
    }

    const itemMatch = text.match(itemPattern);
    if (!itemMatch) return;

    const amount = parseFrenchNumber(itemMatch[6]);
    if (!amount || amount <= 0) return;

    const code = itemMatch[1];
    const label = normalizeSpaces(itemMatch[2]);
    const context = normalizeSpaces(`${currentSection} ${label}`);
    const lot = classifyLot(context);

    itemLines.push({
      code,
      label,
      section: currentSection,
      lot,
      amount,
      confidence: lot === "À classer" ? 62 : 92,
      page: line.page,
      raw: text,
      level: "detail",
    });
  });

  const sectionTotal = sections.reduce((sum, line) => sum + line.amount, 0);
  const itemTotal = itemLines.reduce((sum, line) => sum + line.amount, 0);

  if (sections.length >= 3 && sectionTotal > 0) {
    const gapRate = Math.abs(sectionTotal - itemTotal) / sectionTotal;
    if (!itemLines.length || gapRate > 0.02) {
      return dedupeQuoteLines(sections);
    }
  }

  return dedupeQuoteLines(itemLines);
}

function extractLastAmount(text) {
  const matches = [...text.matchAll(/(?:^|\s)(-?(?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.]\d{2})?)\s*(?:€|eur|ht|ttc)?(?=\s|$)/gi)];
  if (!matches.length) return null;

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const value = parseFrenchNumber(matches[index][1]);
    if (value && value > 0) return value;
  }
  return null;
}

function parseFrenchNumber(value) {
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function cleanLineLabel(text) {
  return normalizeSpaces(
    text
      .replace(/(?:^|\s)-?(?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.]\d{2})?\s*(?:€|eur|ht|ttc)?(?=\s|$)/gi, " ")
      .replace(/\b(qte|qté|quantite|quantité|pu|p\.u\.|total|montant|prix|unite|unité)\b/gi, " ")
  ).slice(0, 140);
}

function classifyLot(label) {
  const source = normalizeForMatch(label);
  const taxonomy = [
    { name: "Frais chantier", keywords: ["mise en chantier", "manutention", "approvisionnement", "echafaudage", "nettoyage", "decharge", "dechets", "benne"] },
    { name: "Gros oeuvre", keywords: ["demolition", "depose", "toiture", "charpente", "bac acier", "dalle", "fondation", "maconnerie", "mur exterieur", "gouttiere", "ep en pvc", "terrasse", "cave"] },
    { name: "Électricité", keywords: ["electricite", "tableau", "prise", "courant", "interrupteur", "point lumineux", "spot", "32a", "20a"] },
    { name: "Plomberie", keywords: ["plomberie", "ventilation", "eau froide", "eau chaude", "ballon", "vmc", "radiateur", "seche serviette", "yutampo"] },
    { name: "Salle de bain", keywords: ["salle de bain", "receveur", "douche", "paroi", "meuble vasque", "mitigeur", "wc", "faience"] },
    { name: "Placo isolation", keywords: ["platrerie", "isolation", "ba13", "doublage", "cloison", "laine", "rails", "calicot"] },
    { name: "Revêtements", keywords: ["revetements", "revêtement", "carrelage", "sol", "parquet", "plinthe", "ragreage"] },
    { name: "Menuiserie", keywords: ["menuiserie", "menuiseries", "fenetre", "porte", "chassis", "velux"] },
    { name: "Peinture", keywords: ["peinture", "enduit", "ratissage", "poncage", "impression", "finition"] },
  ];

  const userLots = state.library.map((lot) => ({
    name: lot.name,
    keywords: lot.keywords,
  }));

  const match = [...taxonomy, ...userLots]
    .map((lot) => ({
      name: lot.name,
      score: lot.keywords.reduce((score, keyword) => score + (source.includes(normalizeForMatch(keyword)) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)[0];

  return match && match.score > 0 ? match.name : "À classer";
}

function dedupeQuoteLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    const key = `${line.page}:${line.label.toLowerCase()}:${Math.round(line.amount * 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value) {
  return normalizeSpaces(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function createProjectFromPdf(fileName, extractedLines = state.extractedLines, rawText = "") {
  const cleanName = fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  const title = cleanName ? titleCase(cleanName) : "Devis importé";
  const todayIso = today.toISOString().slice(0, 10);
  const end = new Date(today);
  end.setDate(end.getDate() + 60);
  const lots = buildLotsFromExtractedLines(extractedLines);

  return {
    id: `pdf-${Date.now()}`,
    name: `${title} - à qualifier`,
    client: "Client à renseigner",
    address: "Adresse à renseigner",
    startDate: todayIso,
    endDate: end.toISOString().slice(0, 10),
    status: "Devis importé",
    archived: false,
    archivedAt: "",
    quoteFile: fileName,
    documents: [],
    rawPdfText: rawText.slice(0, 15000),
    lots,
    invoices: [
      { id: `pdf-acompte-${Date.now()}`, label: "Acompte", action: "Facture acompte 30%", percent: 30, date: todayIso, status: "pending" },
      { id: `pdf-solde-${Date.now()}`, label: "Solde réception", action: "Facture solde 70%", percent: 70, date: end.toISOString().slice(0, 10), status: "pending" },
    ],
  };
}

function buildLotsFromExtractedLines(lines) {
  const groups = new Map();
  lines.forEach((line) => {
    const lotName = line.lot || "À classer";
    if (!groups.has(lotName)) groups.set(lotName, []);
    groups.get(lotName).push(line);
  });

  return [...groups.entries()].map(([lotName, group], index) => {
    const sale = group.reduce((sum, line) => sum + Number(line.amount || 0), 0);
    return {
      id: `pdf-lot-${Date.now()}-${index}`,
      name: lotName,
      source: summarizeExtractedGroup(group),
      sale: roundCurrency(sale),
      material: 0,
      labor: 0,
      progress: 0,
      commercial: 0,
      commercialRate: 0,
      other: 0,
      planned: 0,
      laborType: "employee",
      subcontractorId: "",
      extractedLines: group,
    };
  });
}

function reassignProjectDetailLine(lotId, lineIndex, newLotName) {
  const project = activeProject();
  const sourceLot = project.lots.find((lot) => lot.id === lotId);
  if (!sourceLot?.extractedLines?.[lineIndex]) return;

  const allLines = project.lots.flatMap((lot) => (lot.extractedLines || []).map((line) => ({ ...line })));
  const targetLine = sourceLot.extractedLines[lineIndex];
  const lineKey = detailLineKey(targetLine);
  allLines.forEach((line) => {
    if (detailLineKey(line) === lineKey) line.lot = newLotName;
  });

  const previousCosts = new Map(
    project.lots.map((lot) => [
      lot.name,
      {
        material: lot.material || 0,
        labor: lot.labor || 0,
        progress: lotProgress(lot),
        commercial: lot.commercial || 0,
        commercialRate: commercialRate(lot),
        laborType: laborType(lot),
        subcontractorId: lot.subcontractorId || "",
        other: lot.other || 0,
        planned: lot.planned || 0,
      },
    ])
  );

  project.lots = buildLotsFromExtractedLines(allLines).map((lot) => ({
    ...lot,
    ...(previousCosts.get(lot.name) || {}),
  }));
  state.extractedLines = allLines;
}

function detailLineKey(line) {
  return `${line.code || ""}:${line.label}:${line.amount}:${line.page || ""}`;
}

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function summarizeExtractedGroup(group) {
  const sections = [...new Set(group.map((line) => line.section).filter(Boolean))];
  if (sections.length) {
    return sections.slice(0, 5).join(" | ");
  }
  return group.map((line) => line.label).slice(0, 4).join(" | ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function titleCase(value) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function renderAll() {
  renderNavigation();
  renderSettingsControls();
  renderProjectHeader();
  renderSummary();
  renderTimeline();
  renderRecommendations();
  renderLots();
  renderProjects();
  renderPdf();
  renderBilling();
  renderOrders();
  renderProjectDocuments();
  renderPendingProjectDocuments();
  renderCalendar();
  renderLibrary();
  renderSuppliers();
  renderSubcontractors();
}

async function initApp() {
  bindEvents();
  await hydrateStateFromServer();
  renderAll();
}

initApp();

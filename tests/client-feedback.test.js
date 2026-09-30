const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');
function app() {
  const nodes = new Map();
  const document = { querySelector: (selector) => { if (!nodes.has(selector)) nodes.set(selector, { textContent: '', innerHTML: '', value: '', appendChild() {} }); return nodes.get(selector); }, createElement: () => ({}) };
  const context = vm.createContext({ window: { location: { protocol: 'file:' }, NovaQuoteParser: require('../quote-parser') }, document,
    localStorage: { getItem: () => null, setItem() {} }, structuredClone, Intl, Date, crypto, console, setTimeout, clearTimeout,
    alert: (message) => context.alerts.push(message), alerts: [] });
  vm.runInContext(fs.readFileSync(require.resolve('../app.js'), 'utf8').replace(/initApp\(\);\s*$/, ''), context);
  vm.runInContext('state = structuredClone(defaultState); renderAll = () => {};', context);
  return { context, run: (code) => JSON.parse(JSON.stringify(vm.runInContext(code, context))) };
}
test('un sous-traitant sur trois lots occupe un seul chantier', () => {
  const {run} = app();
  const result = run(`state.projects = [{id:'p1', name:'P1', startDate:'2026-09-01', endDate:'2026-10-01', lots: [1,2,3].map(i => ({name:'Lot '+i, laborType:'subcontractor', subcontractorId:'st', labor:100}))}, {id:'p2', archived:true, lots:[{laborType:'subcontractor',subcontractorId:'st'}]}];
    [subcontractorAssignments('st').length, maxSimultaneousAssignments(subcontractorAssignments('st'))]`);
  assert.deepEqual(result, [1,1]);
});
test('les remises et moins-values réduisent la vente sans modifier les coûts ni l’avancement', () => {
  const {run} = app();
  const result = run(`const p = {lots:[{sale:1000,material:200,labor:300,progress:50}]};
    addQuoteAdjustment(p,{type:'discount',unit:'percent',amount:10,label:'Geste'});
    addQuoteAdjustment(p,{type:'lesswork',unit:'amount',amount:100,label:'Porte retirée'});
    [projectSale(p),projectReal(p),projectProgress(p),marginRate(projectSale(p),projectReal(p))]`);
  assert.deepEqual(result, [800,500,50,37.5]);
});
test('échéancier 30/30/30/10 et migration idempotente préservant l’acompte envoyé', () => {
  const {run} = app();
  const result = run(`const saved = {projects:[{invoices:[{id:'a',percent:30,status:'done',date:'2026-09-01'},{id:'s',percent:70,status:'pending',date:'2026-10-01'}]}]};
    hydrateSupplyOrders(saved); hydrateSupplyOrders(saved);
    [saved.projects[0].invoices.map(i=>i.percent),saved.projects[0].invoices[0].id,saved.projects[0].invoices[0].status,saved.projects[0].invoiceScheduleHistory.length]`);
  assert.deepEqual(result, [[30,30,30,10],'a','done',1]);
  assert.deepEqual(run('createNewProject().invoices.map(i=>i.percent)'), [30,30,30,10]);
});
test('un solde déjà envoyé ne subit aucune migration', () => {
  const {run} = app();
  assert.deepEqual(run(`hydrateSupplyOrders({projects:[{invoices:[{percent:30,status:'done'},{percent:70,status:'done'}]}]}).projects[0].invoices.map(i=>i.percent)`), [30,70]);
});
test('les règlements du sous-traitant sont indépendants des factures client', () => {
  const {run} = app();
  const result = run(`subcontractorPaymentSummary({ invoices:[{percent:30,status:'done'}], subcontractorPayments:[{subcontractorId:'st',amount:175},{subcontractorId:'st',amount:250},{subcontractorId:'autre',amount:500}]},'st',1000)`);
  assert.equal(result.paid,425); assert.equal(result.percent,42.5); assert.equal(result.remaining,575);
});
test('un avenant reste dans le chantier cible et conserve devis, coûts et PDF', () => {
  const {run} = app();
  const result = run(`state.projects=[{id:'original',quoteFile:'initial.pdf',lots:[{id:'l',sale:1000,labor:400}],documents:[]},{id:'other',lots:[]}]; state.activeProjectId='other';
    state.pendingImport={mode:'amendment',targetProjectId:'original',fileName:'avenant.pdf',document:{name:'avenant.pdf'},lines:[{label:'Ajout',lot:'Menuiserie',amount:200},{label:'Retrait',lot:'Moins-value',amount:-50}],totalVerified:true,detectedTotal:150};
    validatePendingImport();
    [state.projects.length,state.activeProjectId,state.projects[0].quoteFile,projectSale(state.projects[0]),state.projects[0].lots[0].labor,state.projects[0].documents.length,state.pendingImport]`);
  assert.deepEqual(result,[2,'original','initial.pdf',1150,400,1,null]);
});
test('écart de total ou total non détecté bloque la validation sans contrôle explicite', () => {
  const {run,context} = app();
  assert.equal(run(`state.pendingImport={fileName:'x.pdf',lines:[{label:'Pose',amount:100}],totalVerified:true,detectedTotal:200}; validatePendingImport(); !!state.pendingImport`),true);
  assert.equal(context.alerts.length,1);
});
test('marge cible 60% donne le prix cible attendu', () => {
  const {run} = app();
  assert.equal(run('state.settings.targetMargin=60; advisedPrice(400)'),1000);
});
test('reclasser une seule ligne conserve les coûts, les doublons et les ajustements manuels', () => {
  const {run} = app();
  assert.deepEqual(run(`state.projects=[{id:'p',lots:[{id:'src',name:'Plomberie',sale:200,material:50,labor:40,extractedLines:[{label:'Pose',amount:100,lot:'Plomberie'},{label:'Pose',amount:100,lot:'Plomberie'}]},{id:'manual',name:'Remise',sale:-20}]}];state.activeProjectId='p';
    reassignProjectDetailLine('src',0,'Menuiserie');
    [projectSale(activeProject()),projectReal(activeProject()),activeProject().lots.find(l=>l.id==='manual').sale,activeProject().lots.find(l=>l.id==='src').extractedLines.length]`),[180,90,-20,1]);
});

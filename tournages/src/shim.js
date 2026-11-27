// Branche la page du suivi (écrite pour claude.ai) sur le serveur Nova+ :
// window.claude.use("db" | "user" | "assets" | "downloads") reproduit ce que la page utilise.
(function () {
  "use strict";
  const K = new URLSearchParams(location.search).get("k") || "";
  window.__K = K;
  const WHO = "px-tournages-qui";
  const fail = (code) => Object.assign(new Error(code), { code });

  async function call(method, url, body) {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "X-Tournages-Key": K },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch (e) {
      throw fail("unavailable");
    }
    if (response.status === 401) throw fail("revoked");
    if (response.status === 404) throw fail("not_found");
    if (response.status === 413) throw fail("resource_exhausted");
    if (!response.ok) throw fail("unavailable");
    return response.json();
  }

  // ---------- Données : relève toutes les 5 s quand l'app est à l'écran, mise à jour immédiate de l'écran ----------
  function merge(a, b) {
    const o = Array.isArray(a) ? a.slice() : { ...(a || {}) };
    for (const k in b) {
      const v = b[k];
      o[k] = v && typeof v === "object" && !Array.isArray(v) && a && a[k] && typeof a[k] === "object" && !Array.isArray(a[k]) ? merge(a[k], v) : v;
    }
    return o;
  }
  let rev = "";
  let docs = null;
  let subs = [];
  let timer = null;
  let polling = null;
  let gen = 0; // incrémenté à chaque écriture : une relève lancée avant est ignorée
  const emit = () => {
    const snap = { docs: (docs || []).map((d) => ({ id: d.id, data: () => d.data })) };
    subs.forEach((s) => s.ok(snap));
  };
  function poll() {
    if (polling) return polling;
    polling = (async () => {
      const started = gen;
      try {
        const j = await call("GET", "/api/tournages" + (rev ? "?rev=" + encodeURIComponent(rev) : ""));
        if (started !== gen) return;
        if (!j.same) {
          rev = j.rev;
          docs = j.docs;
          emit();
        }
      } catch (e) {
        if (e.code === "revoked") subs.forEach((s) => s.err && s.err(e));
      } finally {
        polling = null;
      }
    })();
    return polling;
  }
  function loop() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (document.visibilityState === "visible") await poll();
      loop();
    }, 5000);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") poll();
  });
  window.addEventListener("focus", () => poll());

  async function write(method, id, body, local) {
    gen++;
    if (docs) {
      docs = local(docs);
      emit();
    }
    try {
      await call(method, "/api/tournages/" + encodeURIComponent(id), body);
    } finally {
      gen++;
      await (polling || Promise.resolve());
      rev = "";
      poll();
    }
  }
  const collection = {
    onSnapshot(ok, err) {
      subs.push({ ok, err });
      if (docs) setTimeout(emit, 0);
      poll().then(loop);
      return () => (subs = subs.filter((s) => s.ok !== ok));
    },
    doc(id) {
      return {
        update: (patch) => write("PATCH", id, { patch }, (all) => all.map((d) => (d.id === id ? { id, data: merge(d.data, patch) } : d))),
        set: (data) => write("PUT", id, { data }, (all) => [...all.filter((d) => d.id !== id), { id, data }]),
        delete: () => write("DELETE", id, undefined, (all) => all.filter((d) => d.id !== id)),
      };
    },
  };
  const db = { collection: () => collection };

  // ---------- Qui utilise l'app (demandé une fois par téléphone) ----------
  const who = () => {
    try {
      return localStorage.getItem(WHO) || "";
    } catch (e) {
      return "";
    }
  };
  const user = {
    id: async () => who(),
    can: async () => true,
    isOwner: async () => false,
    profiles: async (ids) => Object.fromEntries(ids.map((i) => [i, { name: i === "nova" ? "Nova+" : i }])),
  };
  function askWho() {
    if (who()) return;
    const box = document.createElement("div");
    box.className = "who-ask";
    box.innerHTML =
      '<div class="who-card" role="dialog" aria-modal="true" aria-labelledby="who-t"><p class="who-eb">Tournages chantiers</p><h2 id="who-t">Qui es-tu&nbsp;?</h2>' +
      "<p>Ton prénom apparaît dans l'historique des chantiers.</p><div class=\"who-btns\">" +
      ["Anis", "Otar", "Tommy"].map((n) => '<button type="button" data-n="' + n + '">' + n + "</button>").join("") +
      '<button type="button" data-n="">Autre</button></div></div>';
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      let name = b.dataset.n;
      if (!name) name = (prompt("Ton prénom ?") || "").trim().slice(0, 40);
      if (!name) return;
      try {
        localStorage.setItem(WHO, name);
      } catch (err) {}
      box.remove();
      if (window.__setUid) window.__setUid(name);
    });
    document.body.appendChild(box);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", askWho);
  else askWho();

  // ---------- Photos ----------
  const assets = {
    async upload(blob) {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(fail("unavailable"));
        r.readAsDataURL(blob);
      });
      const j = await call("POST", "/api/tournages/photos", { type: blob.type || "image/jpeg", dataUrl });
      return { id: j.id, url: j.url + "?k=" + encodeURIComponent(K) };
    },
    async delete() {
      return {}; // Les photos sont gardées sur le serveur (sauvegardes Nova+), seule la fiche les retire.
    },
    async list() {
      return { assets: [], usage: {} };
    },
  };

  // ---------- Export agenda (.ics) ----------
  const downloads = {
    async save({ filename, data }) {
      const blob = new Blob([data], { type: "text/calendar;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1500);
    },
  };

  // ---------- Feed Insta (planning validé + médias du volume Nova+) ----------
  const media = (name, extra) => "/tournages/feed/" + encodeURIComponent(name) + "?k=" + encodeURIComponent(K) + extra;
  const feed = {
    list: () => call("GET", "/api/tournages/feed"),
    src: (name, v) => media(name, v ? "&v=" + encodeURIComponent(v) : ""),
    dl: (name) => media(name, "&dl=1"),
  };

  const caps = { db, user, assets, downloads, feed };
  window.claude = { use: async (name) => caps[name] || null };
})();

"use strict";

// Session côté navigateur : utilisateur connecté, déconnexion, bandeau d'état de la synchronisation.
// Chargé avant app.js dans index.html.

window.NovaSession = (() => {
  let currentUser = null;

  function initials(name) {
    return String(name || "?")
      .split(/\s+/)
      .filter((part) => /\p{L}/u.test(part))
      .slice(0, 2)
      .map((part) => (part.match(/\p{L}/u) || ["?"])[0].toUpperCase())
      .join("");
  }

  function toLogin() {
    window.location.replace("/login.html");
  }

  async function load() {
    if (window.location.protocol === "file:") return null;
    try {
      const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return null;
      const me = await response.json();
      if (!me.user || me.mfaPending || me.mustChangePassword) return toLogin();
      currentUser = me.user;
      render();
      await loadCompany();
      return currentUser;
    } catch {
      return null;
    }
  }

  function render() {
    if (!currentUser) return;
    const set = (selector, value) => {
      const node = document.querySelector(selector);
      if (node) node.textContent = value;
    };
    set("#accountAvatar", initials(currentUser.displayName));
    set("#accountName", currentUser.displayName);
    set("#accountRole", currentUser.roleLabel || currentUser.role);
    const link = document.querySelector("#accountLink");
    if (link) link.title = currentUser.role === "admin" ? "Compte et administration" : "Mon compte";
  }

  // Profil de l'entreprise (réglages par défaut : échéancier, TVA, marges) exposé à app.js.
  async function loadCompany() {
    try {
      const response = await fetch("/api/company", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return;
      const { company } = await response.json();
      window.NovaCompany = company;
      const schedule = company.billing?.invoiceSchedule || [];
      document.querySelectorAll("[data-apply-client-schedule]").forEach((button) => {
        button.textContent = `Échéancier ${schedule.map((step) => String(step.percent).replace(".", ",")).join(" / ")}`;
        button.title = schedule.map((step) => `${step.label} ${String(step.percent).replace(".", ",")} %`).join(" · ");
      });
      if (company.name) document.title = `${company.name} · Nova+`;
    } catch {
      // Hors ligne : app.js garde l'échéancier standard.
    }
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
    } finally {
      toLogin();
    }
  }

  // Bandeau unique en haut de l'écran pour les problèmes d'enregistrement.
  function banner(options) {
    const { tone = "warning", message, actionLabel, onAction } = options || {};
    let node = document.querySelector("#syncBanner");
    if (!message) {
      node?.remove();
      return;
    }
    if (!node) {
      node = document.createElement("div");
      node.id = "syncBanner";
      node.setAttribute("role", "alert");
      document.body.appendChild(node);
    }
    node.className = `sync-banner ${tone}`;
    node.innerHTML = "";
    const text = document.createElement("p");
    text.textContent = message;
    node.appendChild(text);
    if (actionLabel && onAction) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = actionLabel;
      button.addEventListener("click", onAction);
      node.appendChild(button);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelector("#logoutButton")?.addEventListener("click", logout);
  });

  return {
    load,
    logout,
    banner,
    toLogin,
    get user() {
      return currentUser;
    },
  };
})();

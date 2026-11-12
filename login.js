"use strict";

(() => {
  const forms = {
    credentials: document.querySelector("#credentialsForm"),
    enroll: document.querySelector("#enrollForm"),
    totp: document.querySelector("#totpForm"),
    password: document.querySelector("#passwordForm"),
  };
  const dots = {
    credentials: document.querySelector('[data-step-dot="credentials"]'),
    mfa: document.querySelector('[data-step-dot="mfa"]'),
    password: document.querySelector('[data-step-dot="password"]'),
  };
  let knownPassword = null;
  let enrollmentSecret = null;

  function show(step) {
    Object.entries(forms).forEach(([name, form]) => form.classList.toggle("hidden", name !== step));
    const order = ["credentials", "mfa", "password"];
    const current = step === "enroll" || step === "totp" ? "mfa" : step;
    order.forEach((name, index) => {
      dots[name].classList.toggle("active", name === current);
      dots[name].classList.toggle("done", index < order.indexOf(current));
    });
    if (step === "password") {
      const current = forms.password.querySelector(".current-password");
      current.classList.toggle("hidden", Boolean(knownPassword));
      if (knownPassword) forms.password.elements.currentPassword.value = knownPassword;
    }
    const first = [...forms[step].querySelectorAll("input")].find((input) => !input.closest(".hidden"));
    setTimeout(() => first?.focus(), 30);
  }

  async function api(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body || {}),
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const error = new Error(payload.error || "Connexion au serveur impossible. Vérifiez votre accès internet.");
      error.code = payload.code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function route(next) {
    if (next === "done") return window.location.replace("/");
    if (next === "change_password") return show("password");
    if (next === "totp") return show("totp");
    if (next === "enroll") return show("enroll");
    return show("credentials");
  }

  function bind(form, handler) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const error = form.querySelector(".form-error");
      const button = form.querySelector(".submit-button");
      const label = button.textContent;
      error.textContent = "";
      button.disabled = true;
      button.textContent = "Vérification…";
      try {
        await handler(form);
      } catch (failure) {
        error.textContent = failure.message;
        if (failure.code === "session_closed") setTimeout(() => restart(failure.message), 1600);
      } finally {
        button.disabled = false;
        button.textContent = label;
      }
    });
  }

  function restart(message) {
    knownPassword = null;
    enrollmentSecret = null;
    forms.credentials.reset();
    show("credentials");
    if (message) forms.credentials.querySelector(".form-error").textContent = message;
  }

  bind(forms.credentials, async (form) => {
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    if (!email || !password) throw new Error("Saisissez votre adresse e-mail et votre mot de passe.");
    const result = await api("/api/auth/login", { email, password });
    knownPassword = password;
    if (result.next === "enroll") renderEnrollment(result.enrollment, email);
    route(result.next);
  });

  [forms.enroll, forms.totp].forEach((form) => {
    const input = form.elements.code;
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 6);
      if (input.value.length === 6) form.requestSubmit();
    });
    bind(form, async () => {
      if (!/^\d{6}$/.test(input.value)) throw new Error("Le code contient 6 chiffres.");
      try {
        const result = await api("/api/auth/2fa", { code: input.value });
        route(result.next);
      } catch (error) {
        input.value = "";
        throw error;
      }
    });
  });

  bind(forms.password, async (form) => {
    const currentPassword = form.elements.currentPassword.value;
    const newPassword = form.elements.newPassword.value;
    if (newPassword.length < 12) throw new Error("12 caractères minimum.");
    if (newPassword !== form.elements.confirmPassword.value) throw new Error("Les deux mots de passe ne correspondent pas.");
    const result = await api("/api/auth/password", { currentPassword, newPassword });
    knownPassword = null;
    route(result.next);
  });

  const strength = forms.password.querySelector(".strength");
  forms.password.elements.newPassword.addEventListener("input", (event) => {
    const length = event.target.value.length;
    strength.textContent = length >= 12 ? `${length} caractères ✓` : `${12 - length} caractère${12 - length > 1 ? "s" : ""} de plus.`;
  });

  function renderEnrollment(enrollment, email) {
    enrollmentSecret = enrollment.secret;
    document.querySelector("#secretText").textContent = enrollment.secret.replace(/(.{4})/g, "$1 ").trim();
    const target = document.querySelector("#qrcode");
    target.innerHTML = "";
    if (window.QRCode) {
      // eslint-disable-next-line no-new
      new window.QRCode(target, { text: enrollment.otpauthUrl, width: 132, height: 132, correctLevel: window.QRCode.CorrectLevel.M });
    } else {
      target.textContent = "QR indisponible : saisissez la clé.";
    }
    target.setAttribute("title", `Nova+ · ${email}`);
  }

  document.querySelector("#copySecret").addEventListener("click", async (event) => {
    if (!enrollmentSecret) return;
    try {
      await navigator.clipboard.writeText(enrollmentSecret);
      event.target.textContent = "Clé copiée ✓";
      setTimeout(() => (event.target.textContent = "Copier la clé"), 1800);
    } catch {
      event.target.textContent = "Copie impossible : recopiez la clé.";
    }
  });

  document.querySelectorAll("[data-reveal]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.reveal);
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      button.textContent = reveal ? "Masquer" : "Afficher";
      button.setAttribute("aria-label", reveal ? "Masquer le mot de passe" : "Afficher le mot de passe");
    });
  });

  document.querySelectorAll("[data-restart]").forEach((button) =>
    button.addEventListener("click", async () => {
      await api("/api/auth/logout").catch(() => {});
      restart();
    }),
  );

  // Reprise d'une connexion commencée (ex. rechargement de la page).
  (async () => {
    try {
      const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
      const me = response.ok ? await response.json() : {};
      if (!me.user) return show("credentials");
      if (me.mfaPending && me.user.mfaEnabled) return show("totp");
      if (me.mfaPending) {
        // La clé de configuration n'est affichée qu'une fois : on recommence proprement.
        await api("/api/auth/logout").catch(() => {});
        return show("credentials");
      }
      if (me.mustChangePassword) return show("password");
      window.location.replace("/");
    } catch {
      show("credentials");
    }
  })();

  // Nom et logo de l'entreprise utilisatrice (aucune donnée sensible : affichés avant connexion).
  (async () => {
    try {
      const response = await fetch("/api/public/branding", { cache: "no-store" });
      if (!response.ok) return;
      const { name, hasLogo, logoVersion } = await response.json();
      if (name) {
        document.querySelector("#companyEyebrow").textContent = `${name} · Pilotage BTP`;
        document.title = `Connexion · ${name} · Nova+`;
      }
      if (hasLogo) {
        const logo = document.querySelector("#companyLogo");
        logo.alt = name ? `Logo ${name}` : "Logo de l'entreprise";
        logo.src = `/api/public/logo${logoVersion ? `?v=${encodeURIComponent(logoVersion)}` : ""}`;
        logo.onload = () => (logo.hidden = false);
      }
    } catch {
      // Sans branding, la page reste générique.
    }
  })();
})();

const form = document.querySelector("#loginForm");
const identifierInput = document.querySelector("#identifier");
const passwordInput = document.querySelector("#password");
const errorOutput = document.querySelector("#loginError");
const submitButton = document.querySelector("#submitButton");
const togglePassword = document.querySelector("#togglePassword");
const registerForm = document.querySelector("#registerForm");
const registerError = document.querySelector("#registerError");
const registerButton = document.querySelector("#registerButton");

document.querySelectorAll("[data-auth-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.authView;
    document.querySelectorAll("[data-auth-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.authPanel !== view));
    document.querySelectorAll(".auth-switch [data-auth-view]").forEach((tab) => {
      const selected = tab.dataset.authView === view;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    const targetForm = view === "register" ? registerForm : form;
    targetForm.querySelector("input")?.focus();
  });
});

togglePassword.addEventListener("click", () => {
  const reveal = passwordInput.type === "password";
  passwordInput.type = reveal ? "text" : "password";
  togglePassword.textContent = reveal ? "Masquer" : "Afficher";
  togglePassword.setAttribute("aria-label", reveal ? "Masquer le mot de passe" : "Afficher le mot de passe");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorOutput.textContent = "";
  if (!identifierInput.value.trim() || !passwordInput.value) {
    errorOutput.textContent = "Saisissez votre identifiant et votre mot de passe.";
    return;
  }
  submitButton.disabled = true;
  submitButton.textContent = "Connexion…";
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: identifierInput.value.trim(), password: passwordInput.value }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Connexion impossible.");
    window.location.replace("/");
  } catch (error) {
    errorOutput.textContent = error.message || "Connexion impossible. Vérifiez votre accès internet.";
    passwordInput.select();
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Accéder à Nova+";
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  registerError.textContent = "";
  const fields = new FormData(registerForm);
  const password = String(fields.get("password") || "");
  if (password !== String(fields.get("passwordConfirm") || "")) {
    registerError.textContent = "Les deux mots de passe ne correspondent pas.";
    return;
  }
  registerButton.disabled = true;
  registerButton.textContent = "Création de votre espace…";
  try {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: String(fields.get("displayName") || "").trim(),
        identifier: String(fields.get("identifier") || "").trim(),
        password,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Création impossible.");
    window.location.replace("/");
  } catch (error) {
    registerError.textContent = error.message || "Création impossible. Réessayez.";
  } finally {
    registerButton.disabled = false;
    registerButton.textContent = "Créer mon espace Nova+";
  }
});

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { createApp } = require("../lib/app");

const silentLogger = { log() {}, warn() {}, error() {} };

async function startTestServer({ env = {}, stateJson, uploads = {}, dataDir, ...options } = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-"));
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
  if (stateJson !== undefined) fs.writeFileSync(path.join(dir, "state.json"), typeof stateJson === "string" ? stateJson : JSON.stringify(stateJson));
  for (const [name, content] of Object.entries(uploads)) fs.writeFileSync(path.join(dir, "uploads", name), content);

  const app = await createApp({
    dataDir: dir,
    memoryDb: true,
    logger: silentLogger,
    env: { NOVA_SECRET_KEY: "cle-de-test", ...env },
    ...options,
  });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    app,
    base,
    dataDir: dir,
    client: () => createClient(base),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function createClient(base) {
  let cookie = null;
  async function request(method, url, { body, headers = {} } = {}) {
    const response = await fetch(base + url, {
      method,
      redirect: "manual",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      const [pair] = setCookie.split(";");
      cookie = pair.endsWith("=") ? null : pair;
    }
    const type = response.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await response.json() : await response.text();
    return { status: response.status, headers: response.headers, data };
  }
  return {
    get: (url, options) => request("GET", url, options),
    post: (url, body, options = {}) => request("POST", url, { ...options, body }),
    put: (url, body, options = {}) => request("PUT", url, { ...options, body }),
    patch: (url, body, options = {}) => request("PATCH", url, { ...options, body }),
    del: (url, options) => request("DELETE", url, options),
    get cookie() {
      return cookie;
    },
  };
}

// Crée un compte et le connecte complètement (mot de passe changé, 2FA configurée si exigée).
async function loggedInClient(server, { email = "admin@hsm.test", role = "admin", name = "Admin Test" } = {}) {
  const security = require("../lib/security");
  const temporary = security.generateTemporaryPassword();
  const created = await server.app.auth.createUser({ email, displayName: name, role, password: temporary, mustChangePassword: true });
  const client = server.client();
  const login = await client.post("/api/auth/login", { email, password: temporary });
  if (login.status !== 200) throw new Error(`login ${login.status} ${JSON.stringify(login.data)}`);
  if (login.data.next === "enroll") {
    const code = security.totpAt(login.data.enrollment.secret, security.currentStep());
    const verified = await client.post("/api/auth/2fa", { code });
    if (verified.status !== 200) throw new Error(`2fa ${verified.status}`);
  }
  const password = "Chantier-Solide-2026!";
  const changed = await client.post("/api/auth/password", { currentPassword: temporary, newPassword: password });
  if (changed.status !== 200) throw new Error(`password ${changed.status} ${JSON.stringify(changed.data)}`);
  const totpSecret = login.data.enrollment?.secret || null;
  return { client, user: created, password, totpSecret };
}

module.exports = { startTestServer, loggedInClient, silentLogger };

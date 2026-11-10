"use strict";

const security = require("./security");

const { httpError } = security;

// Rôles standards d'une entreprise du BTP. La 2FA est imposée aux rôles qui touchent
// aux réglages, aux paiements ou aux factures.
const ROLES = {
  admin: { label: "Administrateur", description: "Dirigeant : accès complet, réglages, équipe et sécurité des données.", mfa: true },
  direction_commerciale: { label: "Direction commerciale", description: "Pilote l'équipe commerciale, les devis et le suivi des affaires.", mfa: false },
  commercial: { label: "Commercial", description: "Prospects, visites et devis.", mfa: false },
  conducteur_travaux: { label: "Chargé de projet", description: "Conducteur de travaux : chantiers, planning, sous-traitants et commandes.", mfa: false },
  secretariat: { label: "Secrétariat", description: "Assistant(e) : dossiers clients, documents, factures et relances.", mfa: true },
  comptabilite: { label: "Comptabilité", description: "Paiements, factures fournisseurs et sous-traitants, exports comptables.", mfa: true },
};

const SESSION_ABSOLUTE_MS = 7 * 24 * 3600 * 1000;
const SESSION_IDLE_MS = 12 * 3600 * 1000;
const LOCK_AFTER_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const MAX_MFA_FAILURES = 5;

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    throw httpError(400, "Adresse e-mail invalide.");
  }
  return email;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    roleLabel: ROLES[row.role]?.label || row.role,
    roleDescription: ROLES[row.role]?.description || "",
    commissionRate: row.commission_rate === null || row.commission_rate === undefined ? null : Number(row.commission_rate),
    active: row.active,
    mustChangePassword: row.must_change_password,
    mfaRequired: Boolean(ROLES[row.role]?.mfa),
    mfaEnabled: row.totp_enabled,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

function createAuth(db, { secretBox, now = () => Date.now() } = {}) {
  async function audit(entry, client = db) {
    const { user, action, entity = null, entityId = null, details = {}, ip = null } = entry;
    await client.query(
      `INSERT INTO audit_log (user_id, user_label, action, entity, entity_id, details, ip)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [user?.id || null, user ? `${user.display_name || user.displayName} <${user.email}>` : null, action, entity, entityId, JSON.stringify(details), ip],
    );
  }

  async function countUsers() {
    const [row] = await db.query("SELECT count(*)::int AS n FROM users");
    return row.n;
  }

  async function findByEmail(email) {
    const [row] = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    return row || null;
  }

  async function findById(id) {
    const [row] = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    return row || null;
  }

  async function createUser({ email, displayName, role, password, commissionRate = null, mustChangePassword = true }, actor = null, ip = null) {
    const safeEmail = normalizeEmail(email);
    const name = String(displayName || "").trim().slice(0, 80);
    if (!name) throw httpError(400, "Le nom est obligatoire.");
    if (!ROLES[role]) throw httpError(400, "Rôle inconnu.");
    security.validatePassword(password, { email: safeEmail, displayName: name });
    if (await findByEmail(safeEmail)) throw httpError(409, "Un compte existe déjà avec cette adresse.");
    const rate = parseRate(commissionRate);
    const hash = await security.hashPassword(password);
    const [row] = await db.query(
      `INSERT INTO users (email, display_name, role, commission_rate, password_hash, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [safeEmail, name, role, rate, hash, mustChangePassword],
    );
    await audit({ user: actor, action: "user.create", entity: "user", entityId: row.id, details: { email: safeEmail, role }, ip });
    return row;
  }

  async function updateUser(id, changes, actor, ip) {
    const user = await findById(id);
    if (!user) throw httpError(404, "Compte introuvable.");
    const next = {
      display_name: changes.displayName !== undefined ? String(changes.displayName).trim().slice(0, 80) : user.display_name,
      role: changes.role !== undefined ? changes.role : user.role,
      active: changes.active !== undefined ? Boolean(changes.active) : user.active,
      commission_rate: changes.commissionRate !== undefined ? parseRate(changes.commissionRate) : user.commission_rate,
    };
    if (!next.display_name) throw httpError(400, "Le nom est obligatoire.");
    if (!ROLES[next.role]) throw httpError(400, "Rôle inconnu.");
    const losesAdmin = user.role === "admin" && user.active && (next.role !== "admin" || !next.active);
    if (losesAdmin && (await countActiveAdmins()) <= 1) {
      throw httpError(409, "Impossible : il doit rester au moins un administrateur actif.");
    }
    const [row] = await db.query(
      `UPDATE users SET display_name = $2, role = $3, active = $4, commission_rate = $5, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, next.display_name, next.role, next.active, next.commission_rate],
    );
    if (!next.active) await db.query("DELETE FROM sessions WHERE user_id = $1", [id]);
    const changed = Object.keys(next).filter((key) => String(next[key]) !== String(user[key]));
    await audit({ user: actor, action: "user.update", entity: "user", entityId: id, details: { email: user.email, changed }, ip });
    return row;
  }

  async function countActiveAdmins() {
    const [row] = await db.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active");
    return row.n;
  }

  async function resetPassword(id, actor, ip) {
    const user = await findById(id);
    if (!user) throw httpError(404, "Compte introuvable.");
    const temporary = security.generateTemporaryPassword();
    await db.query(
      `UPDATE users SET password_hash = $2, must_change_password = true, failed_attempts = 0, locked_until = NULL, updated_at = now()
       WHERE id = $1`,
      [id, await security.hashPassword(temporary)],
    );
    await db.query("DELETE FROM sessions WHERE user_id = $1", [id]);
    await audit({ user: actor, action: "user.reset_password", entity: "user", entityId: id, details: { email: user.email }, ip });
    return temporary;
  }

  async function resetMfa(id, actor, ip) {
    const user = await findById(id);
    if (!user) throw httpError(404, "Compte introuvable.");
    await db.query(
      `UPDATE users SET totp_secret = NULL, totp_enabled = false, totp_pending_secret = NULL, totp_last_step = NULL, updated_at = now()
       WHERE id = $1`,
      [id],
    );
    await db.query("DELETE FROM sessions WHERE user_id = $1", [id]);
    await audit({ user: actor, action: "user.reset_2fa", entity: "user", entityId: id, details: { email: user.email }, ip });
  }

  async function unlock(id, actor, ip) {
    await db.query("UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1", [id]);
    await audit({ user: actor, action: "user.unlock", entity: "user", entityId: id, ip });
  }

  // ---------- Connexion ----------

  async function login({ email, password, ip, userAgent }) {
    let safeEmail;
    try {
      safeEmail = normalizeEmail(email);
    } catch {
      await security.dummyVerify(password);
      throw httpError(401, "Identifiants incorrects.");
    }
    const user = await findByEmail(safeEmail);
    if (!user || !user.active) {
      await security.dummyVerify(password);
      await audit({ action: "auth.login.failure", details: { email: safeEmail, reason: user ? "inactive" : "unknown" }, ip });
      throw httpError(401, "Identifiants incorrects.");
    }
    if (user.locked_until && new Date(user.locked_until).getTime() > now()) {
      await audit({ user, action: "auth.login.blocked", details: { reason: "locked" }, ip });
      throw httpError(423, "Compte temporairement verrouillé après plusieurs essais. Réessayez dans 15 minutes ou contactez l'administrateur.");
    }
    if (!(await security.verifyPassword(password, user.password_hash))) {
      const failures = user.failed_attempts + 1;
      const lock = failures >= LOCK_AFTER_FAILURES ? new Date(now() + LOCK_DURATION_MS) : null;
      await db.query("UPDATE users SET failed_attempts = $2, locked_until = $3 WHERE id = $1", [
        user.id,
        lock ? 0 : failures,
        lock ? lock.toISOString() : null,
      ]);
      await audit({ user, action: lock ? "auth.lockout" : "auth.login.failure", details: { failures }, ip });
      throw httpError(401, "Identifiants incorrects.");
    }

    const mfaRequired = Boolean(ROLES[user.role]?.mfa);
    const token = security.randomToken();
    await db.query(
      `INSERT INTO sessions (id, user_id, mfa_verified, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6)`,
      [security.sha256(token), user.id, !mfaRequired, new Date(now() + SESSION_ABSOLUTE_MS).toISOString(), ip, String(userAgent || "").slice(0, 300)],
    );
    await db.query("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1", [user.id]);

    let next = "done";
    let enrollment = null;
    if (mfaRequired && user.totp_enabled) next = "totp";
    else if (mfaRequired) {
      next = "enroll";
      enrollment = await startEnrollment(user);
    } else if (user.must_change_password) next = "change_password";

    if (next === "done" || next === "change_password") await markLogin(user, ip);
    else await audit({ user, action: "auth.password.ok", details: { next }, ip });
    return { token, next, enrollment, user: publicUser(user) };
  }

  async function startEnrollment(user) {
    const secret = security.generateTotpSecret();
    await db.query("UPDATE users SET totp_pending_secret = $2 WHERE id = $1", [user.id, secretBox.seal(secret)]);
    return { secret, otpauthUrl: security.otpauthUrl({ secret, email: user.email }) };
  }

  async function markLogin(user, ip) {
    await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
    await audit({ user, action: "auth.login.success", ip });
  }

  async function verifyMfa(session, code, ip) {
    if (session.mfa_verified) return { next: session.user.must_change_password ? "change_password" : "done" };
    const user = await findById(session.user.id);
    const enrolling = !user.totp_enabled;
    const sealed = enrolling ? user.totp_pending_secret : user.totp_secret;
    if (!sealed) throw httpError(400, "Aucune configuration 2FA en cours. Reconnectez-vous.");
    const step = security.verifyTotp(secretBox.open(sealed), code, { now: now(), lastStep: user.totp_last_step });
    if (step === null) {
      const [row] = await db.query("UPDATE sessions SET mfa_failures = mfa_failures + 1 WHERE id = $1 RETURNING mfa_failures", [session.id]);
      await audit({ user, action: "auth.2fa.failure", details: { failures: row?.mfa_failures }, ip });
      if ((row?.mfa_failures || 0) >= MAX_MFA_FAILURES) {
        await db.query("DELETE FROM sessions WHERE id = $1", [session.id]);
        throw httpError(401, "Trop de codes incorrects. Reconnectez-vous.", { code: "session_closed" });
      }
      throw httpError(401, "Code incorrect ou expiré. Vérifiez l'heure de votre téléphone.");
    }
    if (enrolling) {
      await db.query(
        `UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled = true,
         totp_last_step = $2, updated_at = now() WHERE id = $1`,
        [user.id, step],
      );
      await audit({ user, action: "auth.2fa.enabled", ip });
    } else {
      await db.query("UPDATE users SET totp_last_step = $2 WHERE id = $1", [user.id, step]);
    }
    await db.query("UPDATE sessions SET mfa_verified = true, mfa_failures = 0 WHERE id = $1", [session.id]);
    await markLogin(user, ip);
    return { next: user.must_change_password ? "change_password" : "done" };
  }

  async function changePassword(session, { currentPassword, newPassword }, ip) {
    const user = await findById(session.user.id);
    if (!(await security.verifyPassword(currentPassword, user.password_hash))) {
      throw httpError(400, "Mot de passe actuel incorrect.");
    }
    if (currentPassword === newPassword) throw httpError(400, "Choisissez un mot de passe différent de l'actuel.");
    security.validatePassword(newPassword, { email: user.email, displayName: user.display_name });
    await db.query("UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1", [
      user.id,
      await security.hashPassword(newPassword),
    ]);
    // Les autres sessions ouvertes de ce compte sont fermées.
    await db.query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2", [user.id, session.id]);
    await audit({ user, action: "auth.password.changed", ip });
  }

  async function resolveSession(token) {
    if (!token) return null;
    const id = security.sha256(String(token));
    const [session] = await db.query("SELECT * FROM sessions WHERE id = $1", [id]);
    if (!session) return null;
    const user = await findById(session.user_id);
    const lastSeen = new Date(session.last_seen_at).getTime();
    if (!user || !user.active || new Date(session.expires_at).getTime() <= now() || lastSeen + SESSION_IDLE_MS <= now()) {
      await db.query("DELETE FROM sessions WHERE id = $1", [id]);
      return null;
    }
    if (now() - lastSeen > 5 * 60 * 1000) {
      await db.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [id]);
    }
    return { id, mfa_verified: session.mfa_verified, user };
  }

  async function logout(session, ip) {
    if (!session) return;
    await db.query("DELETE FROM sessions WHERE id = $1", [session.id]);
    await audit({ user: session.user, action: "auth.logout", ip });
  }

  async function purgeExpiredSessions() {
    await db.query("DELETE FROM sessions WHERE expires_at < now() OR last_seen_at < now() - interval '12 hours'");
  }

  async function bootstrapAdmin({ email, password, displayName = "Administrateur" }) {
    if (!email || !password) return null;
    if ((await countUsers()) > 0) return null;
    const row = await createUser({ email, displayName, role: "admin", password, mustChangePassword: true });
    await audit({ action: "user.bootstrap_admin", entity: "user", entityId: row.id, details: { email: row.email } });
    return row;
  }

  return {
    ROLES,
    audit,
    countUsers,
    findByEmail,
    findById,
    createUser,
    updateUser,
    resetPassword,
    resetMfa,
    unlock,
    login,
    verifyMfa,
    changePassword,
    resolveSession,
    logout,
    purgeExpiredSessions,
    bootstrapAdmin,
    publicUser,
  };
}

function parseRate(value) {
  if (value === null || value === undefined || value === "") return null;
  const rate = Number(String(value).replace(",", "."));
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw httpError(400, "Taux de commission invalide (0 à 100 %).");
  return Math.round(rate * 100) / 100;
}

module.exports = { createAuth, ROLES, publicUser, normalizeEmail };

"use strict";

// Accès base de données Nova+.
// Production : PostgreSQL (DATABASE_URL, ex. Railway). Développement et tests : PGlite,
// un vrai moteur PostgreSQL embarqué, pour exécuter exactement le même SQL sans installation.

const fs = require("fs");
const path = require("path");

async function createDb({ databaseUrl, dataDir, memory = false, ssl } = {}) {
  if (databaseUrl) return createPgDb(databaseUrl, ssl);
  return createPgliteDb({ dataDir, memory });
}

function createPgDb(databaseUrl, ssl) {
  const { Pool, types } = require("pg");
  // bigint (int8) : nos compteurs restent bien en dessous de 2^53.
  types.setTypeParser(20, (value) => Number(value));
  // numeric → nombre (montants à 2 décimales) ; date → « AAAA-MM-JJ » sans décalage de fuseau.
  types.setTypeParser(1700, (value) => Number(value));
  types.setTypeParser(1082, (value) => value);
  const pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.NOVA_DB_POOL_MAX || 8),
    ssl: resolveSsl(databaseUrl, ssl),
  });
  pool.on("error", (error) => console.error("[db] connexion PostgreSQL perdue :", error.message));

  const wrap = (client) => ({
    async query(sql, params = []) {
      const result = await client.query(sql, params);
      return result.rows;
    },
    // Plusieurs instructions SQL d'un coup (migrations), sans paramètre.
    async exec(sql) {
      await client.query(sql);
    },
  });

  return {
    kind: "postgres",
    ...wrap(pool),
    async tx(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work(wrap(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

function resolveSsl(databaseUrl, ssl) {
  if (ssl !== undefined) return ssl;
  // Le réseau privé Railway (*.railway.internal) n'utilise pas TLS ; le proxy public, si.
  if (/\.railway\.internal|localhost|127\.0\.0\.1/.test(databaseUrl)) return false;
  if (/sslmode=disable/.test(databaseUrl)) return false;
  return { rejectUnauthorized: false };
}

async function createPgliteDb({ dataDir, memory }) {
  const { PGlite } = require("@electric-sql/pglite");
  let target;
  if (!memory) {
    target = path.join(dataDir, "pglite");
    fs.mkdirSync(target, { recursive: true });
  }
  const options = { parsers: { 20: (value) => Number(value), 1700: (value) => Number(value), 1082: (value) => value } };
  const pg = target ? new PGlite(target, options) : new PGlite(options);
  await pg.waitReady;

  const wrap = (client) => ({
    async query(sql, params = []) {
      const result = await client.query(sql, params);
      return result.rows;
    },
    async exec(sql) {
      await client.exec(sql);
    },
  });

  return {
    kind: memory ? "pglite-memory" : "pglite",
    ...wrap(pg),
    async tx(work) {
      return pg.transaction((tx) => work(wrap(tx)));
    },
    async close() {
      await pg.close();
    },
  };
}

module.exports = { createDb };

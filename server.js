"use strict";

const http = require("http");
const { createApp } = require("./lib/app");

async function main() {
  const app = await createApp();
  const port = Number(process.env.PORT || 4173);
  const server = http.createServer(app.handler);
  server.requestTimeout = 5 * 60 * 1000;

  server.listen(port, () => {
    const status = app.health;
    console.log(`Nova+ prêt : http://localhost:${port}`);
    console.log(`Base : ${app.db.kind} · Données : ${app.dataDir} · Sauvegardes : ${app.backupDir}`);
    console.log(`Stockage : ${status.storage.ok ? "OK" : "ERREUR"} (${status.storage.reason}) · Volume : ${status.volume.ok ? "OK" : "ERREUR"} (${status.volume.reason})`);
    if (status.import && status.import.status !== "absent") console.log(`Import state.json : ${status.import.status}`);
    status.warnings.forEach((warning) => console.warn(`Attention : ${warning}`));
  });
  app.startBackgroundJobs();

  const shutdown = (signal) => {
    console.log(`${signal} reçu, arrêt propre…`);
    server.close(async () => {
      await app.close().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("Démarrage de Nova+ impossible :", error);
  process.exit(1);
});

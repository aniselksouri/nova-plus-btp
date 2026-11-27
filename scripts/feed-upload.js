#!/usr/bin/env node
"use strict";

// Envoie les photos et vidéos du feed Insta HSM sur le serveur Nova+ (volume DATA_DIR/tournages-feed).
// Seuls les fichiers absents ou de taille différente sont envoyés : relançable sans risque.
//
//   NOVA_TOURNAGES_KEY=… node scripts/feed-upload.js https://URL "/chemin/dashboard-web"

const fs = require("fs");
const path = require("path");

async function main() {
  const [base, dir] = process.argv.slice(2);
  const key = process.env.NOVA_TOURNAGES_KEY;
  if (!base || !dir || !key) {
    console.error('Usage : NOVA_TOURNAGES_KEY=… node scripts/feed-upload.js https://URL "/dossier/des/medias"');
    process.exit(1);
  }
  const root = base.replace(/\/+$/, "");
  const headers = { "X-Tournages-Key": key };
  const response = await fetch(`${root}/api/tournages/feed`, { headers });
  if (!response.ok) throw new Error(`Lecture du feed impossible (${response.status}).`);
  const feed = await response.json();

  const wanted = [];
  for (const post of feed.posts || []) {
    if (post.thumb) wanted.push({ name: post.thumb, size: post.thumbV ? null : -1 });
    for (const item of post.media || []) {
      wanted.push({ name: item.file, size: item.ok ? item.size : -1 });
      if (item.cover) wanted.push({ name: item.cover, size: item.coverOk ? null : -1 });
    }
  }

  let sent = 0;
  let missing = 0;
  for (const { name, size } of wanted) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      console.warn(`absent en local : ${name}`);
      missing++;
      continue;
    }
    const local = fs.statSync(file).size;
    if (size === null || size === local) continue; // déjà en ligne (couverture : présence seule)
    const put = await fetch(`${root}/api/tournages/feed/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Length": String(local) },
      body: fs.createReadStream(file),
      duplex: "half",
    });
    if (!put.ok) throw new Error(`${name} : envoi refusé (${put.status}) ${await put.text()}`);
    sent++;
    console.log(`envoyé : ${name} (${(local / 1048576).toFixed(1)} Mo)`);
  }
  console.log(`${sent} fichier(s) envoyé(s), ${wanted.length - sent - missing} déjà en ligne, ${missing} absent(s) en local.`);
  if (missing) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

#!/usr/bin/env python3
"""Construit tournages/index.html (servi par Nova+ sur /tournages) à partir de la page du suivi.

page.src.html = même source que la version claude.ai (placeholder __LOGO__), shim.js = branchement sur Nova+.
Usage : python3 tournages/src/build.py
"""
import base64, pathlib

here = pathlib.Path(__file__).resolve().parent
src = (here / "page.src.html").read_text(encoding="utf8")
shim = (here / "shim.js").read_text(encoding="utf8")
logo = base64.b64encode((here / "logo.png").read_bytes()).decode()

def swap(text, old, new):
    assert text.count(old) == 1, f"motif introuvable ou multiple : {old[:60]}"
    return text.replace(old, new)

page = src.replace("__LOGO__", logo)
# Photos servies par Nova+ (clé du lien en paramètre, une balise <img> ne peut pas envoyer d'en-tête).
page = swap(page, 'const photoSrc=p=>/^(blob:|data:|https?:)/.test(p)?p:"/_blob/"+encodeURIComponent(p);',
            'const photoSrc=p=>/^(blob:|data:|https?:|\\/)/.test(p)?p:"/tournages/photo/"+encodeURIComponent(p)+"?k="+encodeURIComponent(window.__K||"");')
# Le prénom choisi après l'ouverture devient l'auteur des modifications.
page = swap(page, "if(user){try{S.uid=await user.id();}catch(e){}",
            "window.__setUid=v=>{S.uid=v;render();};if(user){try{S.uid=await user.id();}catch(e){}")
page = swap(page, "Connecte-toi à claude.ai pour voir et modifier le suivi.", "Lien invalide : redemande le lien du suivi à Anis.")
page = swap(page, "Tu es en lecture seule. Demande à Anis un accès Éditeur.", "Lien invalide : redemande le lien du suivi à Anis.")

who_css = """<style>
.who-ask{position:fixed;inset:0;z-index:90;display:grid;place-items:center;padding:24px;background:rgba(22,22,23,.55);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
.who-card{width:min(400px,100%);background:#fff;color:#1d1d1f;border-radius:28px;padding:30px 24px 24px;box-shadow:0 30px 80px rgba(0,0,0,.35);font-family:"Inter Tight",-apple-system,system-ui,sans-serif}
.who-eb{margin:0 0 6px;font-size:13px;font-weight:600;color:#8b12ca}
.who-card h2{margin:0;font-size:38px;line-height:.9;letter-spacing:-.045em;font-weight:800}
.who-card>p:not(.who-eb){margin:10px 0 22px;color:#6e6e73;font-size:15px;line-height:1.35}
.who-btns{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.who-btns button{font:inherit;font-size:17px;font-weight:700;letter-spacing:-.02em;min-height:52px;border:0;border-radius:999px;background:#f5f5f7;color:#1d1d1f;cursor:pointer}
.who-btns button:first-child{background:#8b12ca;color:#fff}
.who-btns button:active{transform:scale(.97)}
</style>"""

head = (
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    '<meta name="robots" content="noindex,nofollow">'
    '<link rel="manifest" href="__MANIFEST__">'
    '<link rel="apple-touch-icon" href="/tournages/icon-180.png">'
    '<link rel="icon" type="image/png" href="/tournages/icon-180.png">'
    '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">'
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
    '<meta name="apple-mobile-web-app-title" content="Tournages"><meta name="theme-color" content="#161617">'
    "<style>:root{box-sizing:border-box}*,*::before,*::after{box-sizing:inherit}body{margin:0;padding:0;background:#f5f5f7}img{max-width:100%}[hidden]{display:none!important}</style>"
    + who_css + "</head><body><script>" + shim + "</script>"
)
out = head + page + "</body></html>"
target = here.parent / "index.html"
target.write_text(out, encoding="utf8")
print(f"{target} : {len(out) // 1024} Ko")

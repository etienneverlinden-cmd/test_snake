# Transfert : pragmatict.be/test → loic-kine.be

Le site Loïc est déjà dans le dossier `test/`. Ce guide le publie sur **Cloudflare Pages** à la racine de **loic-kine.be**.

## Préparation repo (déjà faite sur `feature/loic-kine-pages`)

```bash
npm run build:loic-pages   # → ./dist (contenu de test/ à la racine)
```

Réglages Cloudflare Pages :

| Setting | Value |
|---------|--------|
| Project name | `loic-kine` |
| Production branch | `feature/loic-kine-pages` (puis `main` après merge) |
| Build command | `npm run build:loic-pages` |
| Build output directory | `dist` |

## À faire dans Cloudflare + OVH

### 1. Domaine

1. Cloudflare → **Add a domain** → `loic-kine.be` → Free  
2. DNSSEC off chez OVH si activé  
3. Copier les 2 nameservers Cloudflare  
4. OVH → `loic-kine.be` → **Serveurs DNS** → coller les 2 nameservers  
5. Attendre le statut **Active**

### 2. Pages

1. **Workers & Pages** → **Create application** → **Pages** → Connect Git  
2. Repo `etienneverlinden-cmd/test_snake`  
3. Branche `feature/loic-kine-pages`  
4. Build : `npm run build:loic-pages` / output `dist`  
5. Deploy  
6. **Custom domains** → `loic-kine.be` + `www.loic-kine.be`

### 3. Convex (rabbit)

Déjà prévu : `SITE_URL=https://loic-kine.be`  
Redirect Google inchangée : `https://wary-rabbit-413.convex.site/google/callback`

### 4. Tests

- https://loic-kine.be/  
- https://loic-kine.be/rdv.html  
- https://loic-kine.be/admin.html  

### 5. Ancien /test

Quand le nouveau site est OK, remplacer `pragmatict.be/test` par une redirection vers `https://loic-kine.be` (fichier prêt : `scripts/loic-test-redirect.html`).

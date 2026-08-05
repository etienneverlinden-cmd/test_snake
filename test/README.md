# Site Loïc Verlinden (test) — projet Convex séparé de PragmatICT

## Local

```bash
cd test
npm install
npx convex dev
```

Projet Convex dédié : **loic-verlinden** / déploiement `wary-rabbit-413`
(distinct de PragmatICT `limitless-duck-213`).

```js
// déjà renseigné dans js/convex-config.js
window.LOIC_CONVEX_URL = "https://wary-rabbit-413.convex.cloud";
```

Puis ouvrez `http://localhost:8080/test/` (depuis la racine du repo).

## Pages

| URL | Rôle |
|-----|------|
| `/test/` | Vitrine |
| `/test/rdv.html` | Prise de RDV |
| `/test/admin.html` | Agenda praticien |

## Variables d’environnement Convex (`cd test && npx convex env set …`)

| Variable | Rôle |
|----------|------|
| `ADMIN_PASSWORD` | Mot de passe admin (déjà défini en test) |
| `SITE_URL` | Base front pour le retour OAuth, ex. `http://localhost:8080/test` ou `https://pragmatict.be/test` |
| `GOOGLE_CLIENT_ID` | OAuth client Google Cloud |
| `GOOGLE_CLIENT_SECRET` | Secret OAuth Google |
| `RESEND_API_KEY` | Clé API Resend (emails) |
| `EMAIL_FROM` | Expéditeur, ex. `Loïc Verlinden <onboarding@resend.dev>` |

### Google Calendar

1. Créez un projet Google Cloud → APIs → activez **Google Calendar API**.
2. Identifiants → **OAuth 2.0 Client ID** (type Web).
3. URI de redirection autorisée :
   `https://wary-rabbit-413.convex.site/google/callback`
4. Dans l’admin : entrez l’email Google du cabinet → **Connecter Google Calendar**.

Chaque nouveau RDV crée un événement sur ce calendrier ; une annulation le supprime.

### Emails (confirmation + rappel J-1)

- À la réservation : email de confirmation au patient.
- 24 h avant : rappel automatique (scheduler + filet de sécurité cron horaire).
- Avec `onboarding@resend.dev`, Resend n’envoie qu’à l’adresse du compte Resend tant qu’aucun domaine n’est vérifié.

## Migration future

Copier le dossier `test/` vers le nouvel hébergement. Le backend Convex reste le même (même URL) tant que vous ne changez pas de déploiement. Mettez à jour `SITE_URL` et les redirect URIs Google.

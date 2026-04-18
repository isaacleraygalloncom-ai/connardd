# ⚜ GENESIS — Simulation de Civilisation IA

Monde unique partagé entre tous les visiteurs. La simulation tourne 24h/24 même quand personne ne regarde.

## Architecture

```
GitHub Action (cron ttes les 5min)
    → Fait avancer la sim (60 ticks/run)
    → Appelle Gemini IA si événement notable
    → Écrit dans Supabase
         ↓
Supabase (état du monde partagé)
    ← Le frontend lit en temps réel
         ↓
Tous les visiteurs voient le même monde
```

## 🚀 Déploiement — Étapes

### 1. Supabase — Créer les tables

1. Va sur https://supabase.com → ton projet
2. **SQL Editor** → colle tout le contenu de `supabase_setup.sql` → **Run**

### 2. GitHub — Configurer les secrets

Dans ton repo GitHub → **Settings → Secrets and variables → Actions → New repository secret**

Ajouter ces 3 secrets :

| Nom | Valeur |
|-----|--------|
| `SUPABASE_URL` | `https://dfrdzmofrldeqzlyvjrh.supabase.co` |
| `SUPABASE_SERVICE_KEY` | `eyJhbGciOi...` (ta clé service_role) |
| `GEMINI_API_KEY` | `AQ.Ab8RN6IW0fBAUhS1fUB7...` |

### 3. Push sur GitHub

```bash
git init
git add .
git commit -m "feat: Genesis civilization sim"
git remote add origin https://github.com/isaacleraygalloncom-ai/Civilapplimo.git
git push -u origin main
```

### 4. Activer GitHub Actions

- Va dans l'onglet **Actions** du repo
- Active les workflows si demandé
- Le premier tick se lancera dans les 5 prochaines minutes
- Tu peux aussi déclencher manuellement : **Actions → Genesis Tick Runner → Run workflow**

### 5. Héberger le frontend

**Option A — Netlify (recommandé)**
1. https://app.netlify.com → Add new site → Deploy manually
2. Glisse-dépose UNIQUEMENT le dossier racine (avec `index.html`)
3. Ton site est en ligne !

**Option B — GitHub Pages**
1. Settings → Pages → Source: Deploy from branch → main
2. URL: `https://isaacleraygalloncom-ai.github.io/Civilapplimo`

## 🎮 Comment jouer

- **Monde partagé** : tous les visiteurs voient la même civilisation en temps réel
- **Pouvoirs divins** (panneau gauche) : Manne, Révélation, Or, Désastre, Épidémie
  - Cooldown 30s entre chaque action
  - L'action est mise en file et appliquée au prochain tick (max 5 min)
- **Chroniques IA** : les événements importants génèrent une narration épique via Gemini
- **Carte** : hover sur un humain pour voir ses stats détaillées

## 📊 Tables Supabase

- `world_state` : 1 ligne = tout l'état du monde (JSON)
- `chronicles` : historique de tous les événements
- `god_actions` : file d'attente des actions visiteurs

## ⚡ Limites gratuites

- GitHub Actions : 2000 min/mois → ~400 runs/jour → largement suffisant
- Supabase : 500MB, 2GB bandwidth → très largement suffisant  
- Gemini : 1500 req/jour → on en fait max ~10-20/jour

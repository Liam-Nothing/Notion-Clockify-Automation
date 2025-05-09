# Notion-Clockify Automation

Ce projet permet d'automatiser la synchronisation entre Notion et Clockify pour le suivi du temps.

## Prérequis

- Node.js (v14 ou supérieur)
- PostgreSQL
- Compte Clockify
- Compte Notion

## Installation

1. Cloner le repository :
```bash
git clone [URL_DU_REPO]
cd Notion-Clockify-Automation
```

2. Installer les dépendances :
```bash
npm install
```

3. Configurer les variables d'environnement :
- Copier le fichier `.env.example` en `.env`
- Remplir les variables d'environnement avec vos informations :
  - `DATABASE_URL` : URL de connexion à votre base de données PostgreSQL
  - `CLOCKIFY_API_KEY` : Votre clé API Clockify
  - `CLOCKIFY_WORKSPACE_ID` : ID de votre espace de travail Clockify
  - `NOTION_WEBHOOK_SECRET` : Secret de votre webhook Notion

## Lancement

Pour lancer le projet en mode développement (avec rechargement automatique) :
```bash
npm run dev
```

Pour lancer le projet en mode production :
```bash
npm start
```

## Configuration des webhooks Notion

1. Dans votre base de données Notion, allez dans les paramètres
2. Configurez les webhooks pour les événements suivants :
   - Création de projet
   - Mise à jour de projet
   - Création de tâche
   - Mise à jour de tâche
3. Utilisez l'URL de votre serveur suivie de `/webhook` pour les tâches et `/project-webhook` pour les projets

## Structure du projet

```
src/
├── config/          # Configuration (base de données, Clockify)
├── controllers/     # Contrôleurs pour gérer les requêtes
├── middleware/      # Middleware (authentification)
├── routes/          # Routes de l'API
├── services/        # Services (Clockify, base de données)
└── index.js         # Point d'entrée de l'application
```

## API Endpoints

- `POST /webhook` : Webhook pour les tâches Notion
- `POST /project-webhook` : Webhook pour les projets Notion
- `GET /projects` : Liste tous les projets
- `DELETE /projects/:id` : Supprime un projet

## Support

Pour toute question ou problème, veuillez ouvrir une issue sur le repository. 
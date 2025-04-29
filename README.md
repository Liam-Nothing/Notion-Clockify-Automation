# Notion to Clockify Automation

Ce projet permet d'automatiser le suivi du temps dans Clockify en fonction des changements de statut des tâches dans Notion.

## Fonctionnalités

- Détection automatique des changements de statut des tâches dans Notion
- Création automatique des projets dans Clockify si ils n'existent pas
- Démarrage automatique du suivi du temps quand une tâche passe en "In Progress"
- Arrêt automatique du suivi du temps quand une tâche change de statut
- Format des entrées de temps : "ID: Nom de la tâche"
- Mapping automatique des IDs de projets Notion vers Clockify
- Synchronisation des projets entre Notion et Clockify
- Persistance du mapping des projets entre les redémarrages du serveur

## Prérequis

- Node.js (v14 ou supérieur)
- Un compte Notion avec une base de données de tâches et de projets
- Un compte Clockify avec une clé API
- Un workspace Clockify

## Installation

1. Clonez ce dépôt
2. Installez les dépendances :
   ```bash
   npm install
   ```
3. Créez un fichier `.env` à la racine du projet avec les variables suivantes :
   ```
   CLOCKIFY_API_KEY=votre_clé_api_clockify
   CLOCKIFY_WORKSPACE_ID=votre_id_workspace_clockify
   NOTION_WEBHOOK_SECRET=votre_secret_webhook_notion
   PORT=3000
   ```

## Configuration de Notion

1. Dans votre base de données Notion, allez dans les paramètres
2. Activez les webhooks
3. Ajoutez deux nouvelles intégrations webhook :
   - Pour les tâches : `https://votre-domaine.com/webhook`
   - Pour les projets : `https://votre-domaine.com/project-webhook`
4. Pour chaque webhook, sélectionnez les événements à surveiller :
   - Webhook tâches : changements de propriétés
   - Webhook projets : création et mise à jour de pages

## Démarrage

```bash
npm start
```

Le serveur démarrera sur le port spécifié dans le fichier .env (par défaut 3000).

## Utilisation

1. Assurez-vous que votre base de données Notion contient :
   - Une base de données de tâches avec :
     - Une colonne "Status" avec une option "In Progress"
     - Une colonne "Project" qui fait référence à la base de données de projets
     - Une colonne "Name" pour le nom de la tâche
   - Une base de données de projets avec :
     - Une colonne "Name" pour le nom du projet

2. Quand un projet est créé ou mis à jour dans Notion :
   - Le projet sera créé dans Clockify s'il n'existe pas
   - Le mapping entre l'ID Notion et l'ID Clockify sera sauvegardé dans le fichier `project-mapping.json`

3. Quand vous changez le statut d'une tâche en "In Progress" :
   - Le projet associé sera récupéré via le mapping
   - Un nouveau time entry sera démarré avec le format "ID: Nom de la tâche"

4. Quand vous changez le statut d'une tâche vers un autre statut :
   - Le time entry en cours sera automatiquement arrêté

## Fichiers de données

- `project-mapping.json` : Stocke le mapping entre les IDs de projets Notion et Clockify
  - Ce fichier est créé automatiquement lors de la première utilisation
  - Il est mis à jour à chaque création ou mise à jour de projet
  - Il permet de conserver le mapping entre les redémarrages du serveur 
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

// Stockage temporaire des tâches en cours
const activeTasks = new Map();

// Fichier de stockage du mapping
const MAPPING_FILE = path.join(__dirname, 'project-mapping.json');

// Configuration du niveau de verbosité
const VERBOSE = process.env.VERBOSE === 'true';

// Fonction de log conditionnelle
function log(message, data = null) {
    if (VERBOSE) {
        if (data) {
            console.log(message, data);
        } else {
            console.log(message);
        }
    }
}

// Fonction pour formater les erreurs de manière concise
function formatError(error) {
    const message = error.response?.data?.message || error.message;
    console.error(`❌ Erreur: ${message}`);
    return message;
}

// Middleware pour vérifier le secret
function secretMiddleware(req, res, next) {
    log('Headers reçus:', req.headers);
    const secretHeader = req.headers['secret'];
    
    if (secretHeader !== process.env.NOTION_WEBHOOK_SECRET) {
        console.log('❌ Secret invalide');
        return res.status(401).send('Secret invalide');
    }
    
    console.log('✅ Secret valide');
    next();
}

// Fonction pour charger le mapping depuis le fichier
function loadProjectMapping() {
    try {
        if (fs.existsSync(MAPPING_FILE)) {
            const data = fs.readFileSync(MAPPING_FILE, 'utf8');
            log('Mapping chargé:', data);
            return new Map(Object.entries(JSON.parse(data)));
        }
    } catch (error) {
        formatError(error);
    }
    return new Map();
}

// Fonction pour sauvegarder le mapping dans le fichier
function saveProjectMapping(mapping) {
    try {
        const data = JSON.stringify(Object.fromEntries(mapping));
        fs.writeFileSync(MAPPING_FILE, data, 'utf8');
        log('Mapping sauvegardé:', data);
    } catch (error) {
        formatError(error);
    }
}

// Stockage du mapping des projets Notion -> Clockify
const projectMapping = loadProjectMapping();

// Configuration de l'API Clockify
const clockifyConfig = {
    baseURL: 'https://api.clockify.me/api/v1',
    headers: {
        'X-Api-Key': process.env.CLOCKIFY_API_KEY,
        'Content-Type': 'application/json'
    }
};

// Fonction pour formater l'ID de la tâche
function formatTaskId(properties) {
    if (properties.ID && properties.ID.unique_id) {
        const { prefix, number } = properties.ID.unique_id;
        return `${prefix}-${number}`;
    }
    return null;
}

// Fonction pour créer ou récupérer un projet dans Clockify
async function getOrCreateProject(notionProjectId) {
    try {
        log(`Recherche/création du projet avec ID: ${notionProjectId}`);
        
        if (projectMapping.has(notionProjectId)) {
            const existingMapping = projectMapping.get(notionProjectId);
            log('Projet trouvé dans le mapping:', existingMapping);
            return existingMapping;
        }

        log('Recherche du projet dans Clockify...');
        const response = await axios.get(`${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/projects`, {
            headers: clockifyConfig.headers
        });

        const existingProject = response.data.find(p => p.name.includes(notionProjectId));
        if (existingProject) {
            console.log('✅ Projet existant trouvé');
            projectMapping.set(notionProjectId, existingProject);
            saveProjectMapping(projectMapping);
            return existingProject;
        }

        console.log('🆕 Création d\'un nouveau projet');
        const newProject = await axios.post(
            `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/projects`,
            {
                name: `Project ${notionProjectId}`,
                color: "#000000"
            },
            { headers: clockifyConfig.headers }
        );

        log('Nouveau projet créé:', newProject.data);
        projectMapping.set(notionProjectId, newProject.data);
        saveProjectMapping(projectMapping);
        return newProject.data;
    } catch (error) {
        formatError(error);
        throw error;
    }
}

// Fonction pour démarrer un time entry dans Clockify
async function startTimeEntry(taskId, taskName, projectId, formattedId) {
    try {
        console.log(`▶️ Démarrage: ${formattedId || taskId} - ${taskName}`);
        const description = formattedId ? `${formattedId} : ${taskName}` : `${taskId} : ${taskName}`;
        
        const timeEntryData = {
            start: new Date().toISOString(),
            description: description
        };

        if (projectId) {
            timeEntryData.projectId = projectId;
        }

        const response = await axios.post(
            `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/time-entries`,
            timeEntryData,
            { headers: clockifyConfig.headers }
        );
        log('Time entry créé:', response.data);
        return response.data;
    } catch (error) {
        formatError(error);
        throw error;
    }
}

// Fonction pour créer une tâche dans Clockify si elle n'existe pas
async function getOrCreateClockifyTask(taskName, projectId) {
    try {
        if (!projectId) {
            console.log('Pas de projet spécifié, impossible de créer/rechercher la tâche');
            return null;
        }

        console.log(`Recherche/création de la tâche: ${taskName}`);
        
        // Rechercher la tâche existante
        const tasksResponse = await axios.get(
            `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/projects/${projectId}/tasks`,
            { headers: clockifyConfig.headers }
        );

        const existingTask = tasksResponse.data.find(t => t.name === taskName);
        if (existingTask) {
            console.log('Tâche existante trouvée:', existingTask);
            return existingTask;
        }

        // Créer la nouvelle tâche
        console.log('Création d\'une nouvelle tâche');
        const newTask = await axios.post(
            `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/projects/${projectId}/tasks`,
            {
                name: taskName,
                projectId: projectId
            },
            { headers: clockifyConfig.headers }
        );

        console.log('Nouvelle tâche créée:', newTask.data);
        return newTask.data;
    } catch (error) {
        formatError(error);
        return null;
    }
}

// Fonction pour arrêter un time entry dans Clockify
async function stopTimeEntry(timeEntryId) {
    try {
        console.log(`⏹️ Arrêt du time entry: ${timeEntryId}`);
        const response = await axios.patch(
            `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/time-entries/${timeEntryId}`,
            {
                end: new Date().toISOString()
            },
            { headers: clockifyConfig.headers }
        );
        log('Time entry arrêté:', response.data);
        return response.data;
    } catch (error) {
        formatError(error);
        throw error;
    }
}

// Fonction pour récupérer l'ID de l'utilisateur Clockify
async function getCurrentUserId() {
    try {
        const response = await axios.get(
            `${clockifyConfig.baseURL}/user`,
            { headers: clockifyConfig.headers }
        );
        return response.data.id;
    } catch (error) {
        formatError(error);
        throw error;
    }
}

// Fonction pour arrêter tous les time entries actifs dans Clockify
async function stopAllTimeEntries() {
    try {
        console.log('⏹️ Arrêt de tous les time entries actifs');
        const userId = await getCurrentUserId();
        const response = await axios.patch(
            `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/user/${userId}/time-entries`,
            {
                end: new Date().toISOString()
            },
            { headers: clockifyConfig.headers }
        );
        console.log('✅ Tous les time entries arrêtés');
        return response.data;
    } catch (error) {
        formatError(error);
        throw error;
    }
}

// Endpoint pour recevoir les webhooks de projets Notion
app.post('/project-webhook', secretMiddleware, async (req, res) => {
    try {
        console.log('--- Traitement webhook projet ---');
        const payload = req.body.data;
        console.log('Payload reçu:', JSON.stringify(payload, null, 2));

        // Extraire les informations du projet
        const notionProjectId = payload.id;
        const projectName = payload.properties['Project name'].title[0].text.content;
        const emoji = payload.icon?.type === 'emoji' ? payload.icon.emoji : null;

        // Mettre à jour le nom du projet dans Clockify si nécessaire
        const project = await getOrCreateProject(notionProjectId);
        
        // Si le projet existe dans Clockify mais a un nom différent, le mettre à jour
        if (project && project.name !== projectName) {
            const displayName = emoji ? `${emoji} ${projectName}` : projectName;
            try {
                const updatedProject = await axios.put(
                    `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/projects/${project.id}`,
                    {
                        name: displayName,
                        color: project.color
                    },
                    { headers: clockifyConfig.headers }
                );
                console.log('Projet mis à jour dans Clockify:', updatedProject.data);
                
                // Mettre à jour le mapping
                const mappingInfo = {
                    ...updatedProject.data,
                    emoji: emoji
                };
                projectMapping.set(notionProjectId, mappingInfo);
                saveProjectMapping(projectMapping);
            } catch (error) {
                console.error('Erreur lors de la mise à jour du nom du projet:', error);
            }
        }

        res.status(200).send('Webhook projet reçu avec succès');
    } catch (error) {
        const message = formatError(error);
        res.status(500).send(`Erreur lors du traitement du webhook projet: ${message}`);
    }
});

// Endpoint pour recevoir les webhooks de tâches Notion
app.post('/webhook', secretMiddleware, async (req, res) => {
    try {
        const payload = req.body.data;
        log('Payload reçu:', payload);

        const taskId = payload.id;
        const taskName = payload.properties['Task name'].title[0].text.content;
        const projectRelation = payload.properties.Project.relation[0];
        const notionProjectId = projectRelation ? projectRelation.id : null;
        const formattedId = formatTaskId(payload.properties);
        const status = payload.properties.Status?.status;

        console.log(`📋 ${formattedId || taskId} - ${taskName}`);
        console.log(`📊 Status: ${status ? status.name : 'Non défini'}`);

        const activeTask = activeTasks.get(taskId);
        const isTaskActive = !!activeTask;

        if (status && status.id === 'in-progress') {
            if (!isTaskActive) {
                let project = null;
                let clockifyTask = null;

                if (notionProjectId) {
                    project = await getOrCreateProject(notionProjectId);
                    clockifyTask = await getOrCreateClockifyTask(taskName, project.id);
                }

                const timeEntry = await startTimeEntry(
                    taskId, 
                    taskName, 
                    project ? project.id : null,
                    formattedId
                );
                
                activeTasks.set(taskId, {
                    timeEntryId: timeEntry.id,
                    projectId: project ? project.id : null,
                    taskId: clockifyTask ? clockifyTask.id : null,
                    taskName: taskName
                });
            } else {
                log('La tâche est déjà en cours de suivi:', activeTask);
            }
        } else if (status && status.id !== 'in-progress' && isTaskActive) {
            // Si c'est la dernière tâche active qui change d'état, on arrête tous les time entries
            if (activeTasks.size === 1) {
                console.log('Dernière tâche active, arrêt de tous les time entries');
                await stopAllTimeEntries();
                activeTasks.clear();
            } else {
                // Sinon on arrête uniquement le time entry de cette tâche
                if (activeTask.taskName === taskName || 
                    (activeTask.taskId && clockifyTask && activeTask.taskId === clockifyTask.id)) {
                    await stopTimeEntry(activeTask.timeEntryId);
                    activeTasks.delete(taskId);
                    console.log('✅ Suivi arrêté');
                } else {
                    log('Le changement de statut concerne une tâche différente');
                }
            }
        }

        res.status(200).send('Webhook reçu avec succès');
    } catch (error) {
        const message = formatError(error);
        res.status(500).send(`Erreur lors du traitement du webhook: ${message}`);
    }
});

// Endpoint pour lister tous les projets
app.get('/projects', (req, res) => {
    try {
        const projects = Array.from(projectMapping.entries()).map(([notionId, clockifyProject], index) => ({
            id: index + 1,
            notionId: notionId,
            name: clockifyProject.name,
            clockifyId: clockifyProject.id
        }));
        
        res.json(projects);
    } catch (error) {
        const message = formatError(error);
        res.status(500).send(`Erreur lors de la récupération des projets: ${message}`);
    }
});

// Endpoint pour supprimer un projet
app.delete('/projects/:id', (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const projects = Array.from(projectMapping.entries());
        
        if (projectId < 1 || projectId > projects.length) {
            return res.status(404).send('Projet non trouvé');
        }

        const [notionId] = projects[projectId - 1];
        projectMapping.delete(notionId);
        saveProjectMapping(projectMapping);
        
        res.status(200).send('Projet supprimé avec succès');
    } catch (error) {
        const message = formatError(error);
        res.status(500).send(`Erreur lors de la suppression du projet: ${message}`);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
}); 
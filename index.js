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
    console.error(`❌ Error: ${message}`);
    return message;
}

// Middleware pour vérifier le secret
function secretMiddleware(req, res, next) {
    log('Received headers:', req.headers);
    const secretHeader = req.headers['secret'];
    
    if (secretHeader !== process.env.NOTION_WEBHOOK_SECRET) {
        console.log('❌ Invalid secret');
        return res.status(401).send('Invalid secret');
    }
    
    console.log('✅ Valid secret');
    next();
}

// Fonction pour charger le mapping depuis le fichier
function loadProjectMapping() {
    try {
        if (fs.existsSync(MAPPING_FILE)) {
            const data = fs.readFileSync(MAPPING_FILE, 'utf8');
            log('Mapping loaded:', data);
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
        log('Mapping saved:', data);
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
        log(`Searching/creating project with ID: ${notionProjectId}`);
        
        if (projectMapping.has(notionProjectId)) {
            const existingMapping = projectMapping.get(notionProjectId);
            log('Project found in mapping:', existingMapping);
            return existingMapping;
        }

        log('Searching project in Clockify...');
        const response = await axios.get(`${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/projects`, {
            headers: clockifyConfig.headers
        });

        const existingProject = response.data.find(p => p.name.includes(notionProjectId));
        if (existingProject) {
            console.log('✅ Existing project found');
            projectMapping.set(notionProjectId, existingProject);
            saveProjectMapping(projectMapping);
            return existingProject;
        }

        console.log('🆕 Creating a new project');
        const newProject = await axios.post(
            `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/projects`,
            {
                name: `Project ${notionProjectId}`,
                color: "#000000"
            },
            { headers: clockifyConfig.headers }
        );

        log('New project created:', newProject.data);
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
        console.log(`▶️ Starting: ${formattedId || taskId} - ${taskName}`);
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
        log('Time entry created:', response.data);
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
            console.log('No project specified, unable to create/search task');
            return null;
        }

        console.log(`Searching/creating task: ${taskName}`);
        
        // Search for existing task
        const tasksResponse = await axios.get(
            `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/projects/${projectId}/tasks`,
            { headers: clockifyConfig.headers }
        );

        const existingTask = tasksResponse.data.find(t => t.name === taskName);
        if (existingTask) {
            console.log('Existing task found:', existingTask);
            return existingTask;
        }

        // Create new task
        console.log('Creating a new task');
        const newTask = await axios.post(
            `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/projects/${projectId}/tasks`,
            {
                name: taskName,
                projectId: projectId
            },
            { headers: clockifyConfig.headers }
        );

        console.log('New task created:', newTask.data);
        return newTask.data;
    } catch (error) {
        formatError(error);
        return null;
    }
}

// Fonction pour arrêter un time entry dans Clockify
async function stopTimeEntry(timeEntryId) {
    try {
        console.log(`⏹️ Stopping time entry: ${timeEntryId}`);
        const response = await axios.patch(
            `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/time-entries/${timeEntryId}`,
            {
                end: new Date().toISOString()
            },
            { headers: clockifyConfig.headers }
        );
        log('Time entry stopped:', response.data);
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
        console.log('⏹️ Stopping all active time entries');
        const userId = await getCurrentUserId();
        const response = await axios.patch(
            `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/user/${userId}/time-entries`,
            {
                end: new Date().toISOString()
            },
            { headers: clockifyConfig.headers }
        );
        console.log('✅ All time entries stopped');
        return response.data;
    } catch (error) {
        formatError(error);
        throw error;
    }
}

// Endpoint pour recevoir les webhooks de projets Notion
app.post('/project-webhook', secretMiddleware, async (req, res) => {
    try {
        console.log('📥 Project webhook received');
        const payload = req.body.data;
        //log('Received payload:', payload);

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
                console.log('✅ Project updated:', displayName);
                
                // Mettre à jour le mapping
                const mappingInfo = {
                    ...updatedProject.data,
                    emoji: emoji
                };
                projectMapping.set(notionProjectId, mappingInfo);
                saveProjectMapping(projectMapping);
            } catch (error) {
                console.error('❌ Project update error:', error.message);
            }
        }

        res.status(200).send('Project webhook received successfully');
    } catch (error) {
        const message = formatError(error);
        res.status(500).send(`Error processing project webhook: ${message}`);
    }
});

// Endpoint pour recevoir les webhooks de tâches Notion
app.post('/webhook', secretMiddleware, async (req, res) => {
    try {
        const payload = req.body.data;
        //log('Received payload:', payload);

        const taskId = payload.id;
        const taskName = payload.properties['Task name'].title[0].text.content;
        const projectRelation = payload.properties.Project.relation[0];
        const notionProjectId = projectRelation ? projectRelation.id : null;
        const formattedId = formatTaskId(payload.properties);
        const status = payload.properties.Status?.status;

        console.log(`📋 Task: ${formattedId || taskId} - ${taskName}`);
        console.log(`📊 Status: ${status ? status.name : 'Undefined'}`);

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
                console.log('▶️ Tracking started');
            } else {
                log('Task is already being tracked:', activeTask);
            }
        } else if (status && status.id !== 'in-progress' && isTaskActive) {
            // Si c'est la dernière tâche active qui change d'état, on arrête tous les time entries
            if (activeTasks.size === 1) {
                console.log('⏹️ Stopping all time entries');
                await stopAllTimeEntries();
                activeTasks.clear();
            } else {
                // Sinon on arrête uniquement le time entry de cette tâche
                if (activeTask.taskName === taskName || 
                    (activeTask.taskId && clockifyTask && activeTask.taskId === clockifyTask.id)) {
                    await stopTimeEntry(activeTask.timeEntryId);
                    activeTasks.delete(taskId);
                    console.log('⏹️ Tracking stopped');
                } else {
                    log('Status change for a different task');
                }
            }
        }

        res.status(200).send('Webhook received successfully');
    } catch (error) {
        const message = formatError(error);
        res.status(500).send(`Error processing webhook: ${message}`);
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
        res.status(500).send(`Error retrieving projects: ${message}`);
    }
});

// Endpoint pour supprimer un projet
app.delete('/projects/:id', (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const projects = Array.from(projectMapping.entries());
        
        if (projectId < 1 || projectId > projects.length) {
            return res.status(404).send('Project not found');
        }

        const [notionId] = projects[projectId - 1];
        projectMapping.delete(notionId);
        saveProjectMapping(projectMapping);
        
        res.status(200).send('Project deleted successfully');
    } catch (error) {
        const message = formatError(error);
        res.status(500).send(`Error deleting project: ${message}`);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
}); 
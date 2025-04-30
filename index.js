const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(express.json());

// Stockage temporaire des tâches en cours
const activeTasks = new Map();

// Configuration du niveau de verbosité
const VERBOSE = process.env.VERBOSE === 'true';

// Configuration de la base de données PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Initialisation de la base de données
async function initDatabase() {
    try {
        // Création de la table projects si elle n'existe pas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                notion_id TEXT UNIQUE NOT NULL,
                clockify_id TEXT NOT NULL,
                name TEXT NOT NULL,
                emoji TEXT,
                color TEXT DEFAULT '#000000',
                billable BOOLEAN DEFAULT true,
                public BOOLEAN DEFAULT false,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Database initialized');
    } catch (error) {
        console.error('❌ Database initialization error:', error);
        throw error;
    }
}

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

// Fonction pour charger le mapping depuis la base de données
async function loadProjectMapping() {
    try {
        const result = await pool.query('SELECT * FROM projects');
        const mapping = new Map();
        result.rows.forEach(row => {
            mapping.set(row.notion_id, {
                id: row.clockify_id,
                name: row.name,
                emoji: row.emoji,
                color: row.color,
                billable: row.billable,
                public: row.public
            });
        });
        log('Mapping loaded from database:', mapping.size);
        return mapping;
    } catch (error) {
        formatError(error);
        return new Map();
    }
}

// Fonction pour sauvegarder le mapping dans la base de données
async function saveProjectMapping(mapping) {
    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            for (const [notionId, project] of mapping) {
                await client.query(`
                    INSERT INTO projects (notion_id, clockify_id, name, emoji, color, billable, public)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (notion_id) 
                    DO UPDATE SET 
                        clockify_id = $2,
                        name = $3,
                        emoji = $4,
                        color = $5,
                        billable = $6,
                        public = $7,
                        updated_at = CURRENT_TIMESTAMP
                `, [
                    notionId,
                    project.id,
                    project.name,
                    project.emoji,
                    project.color,
                    project.billable,
                    project.public
                ]);
            }
            
            await client.query('COMMIT');
            log('Mapping saved to database');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        formatError(error);
    }
}

// Stockage du mapping des projets Notion -> Clockify
let projectMapping = new Map();

// Initialisation de la base de données et chargement du mapping
initDatabase().then(async () => {
    projectMapping = await loadProjectMapping();
}).catch(error => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
});

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
        // Initializing with generic name, will be updated later if needed
        const newProject = await axios.post(
            `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/projects`,
            {
                name: `Project ${notionProjectId}`,
                color: "#000000",
                billable: true, // Adding required fields for Clockify API
                public: false
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
        log('Received payload:', payload);

        // Extraire les informations du projet
        const notionProjectId = payload.id;
        
        // Handle different property formats in Notion API
        let projectName = "";
        if (payload.properties && payload.properties['Project name'] && 
            payload.properties['Project name'].title && 
            payload.properties['Project name'].title.length > 0) {
            projectName = payload.properties['Project name'].title[0].text.content;
        } else if (payload.properties && payload.properties.Name && 
                  payload.properties.Name.title && 
                  payload.properties.Name.title.length > 0) {
            projectName = payload.properties.Name.title[0].text.content;
        } else if (payload.title && payload.title.length > 0) {
            projectName = payload.title[0].text.content;
        }
        
        // Fallback if we can't find a name
        if (!projectName) {
            projectName = `Project ${notionProjectId}`;
            console.log('⚠️ Unable to find project name, using ID as fallback');
        }
        
        console.log('📝 Project Name:', projectName);
        
        const emoji = payload.icon?.type === 'emoji' ? payload.icon.emoji : null;
        const customIcon = payload.icon?.type === 'external' ? true : false;
        
        if (emoji) {
            console.log('🎨 Project emoji:', emoji);
        } else if (customIcon) {
            console.log('🎨 Project has custom icon');
        }

        // Mettre à jour le nom du projet dans Clockify si nécessaire
        const project = await getOrCreateProject(notionProjectId);
        
        // Si le projet existe dans Clockify mais a un nom différent, le mettre à jour
        const displayName = emoji ? `${emoji} ${projectName}` : projectName;
        if (project && project.name !== displayName) {
            try {
                console.log('🔄 Updating project name:', { current: project.name, new: displayName });
                
                // Prepare all required fields for Clockify API to avoid 400 errors
                const updateData = {
                    name: displayName,
                    color: project.color || "#000000",
                    billable: project.billable === undefined ? true : project.billable,
                    public: project.public === undefined ? false : project.public
                };
                
                log('Update project request data:', updateData);
                
                const updatedProject = await axios.put(
                    `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/projects/${project.id}`,
                    updateData,
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
                // More detailed error logging
                if (error.response) {
                    log('Error response data:', error.response.data);
                }
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
app.get('/projects', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM projects ORDER BY id');
        const projects = result.rows.map(row => ({
            id: row.id,
            notionId: row.notion_id,
            name: row.name,
            clockifyId: row.clockify_id,
            emoji: row.emoji
        }));
        
        res.json(projects);
    } catch (error) {
        const message = formatError(error);
        res.status(500).send(`Error retrieving projects: ${message}`);
    }
});

// Endpoint pour supprimer un projet
app.delete('/projects/:id', async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const result = await pool.query('DELETE FROM projects WHERE id = $1 RETURNING *', [projectId]);
        
        if (result.rows.length === 0) {
            return res.status(404).send('Project not found');
        }

        // Mettre à jour le mapping en mémoire
        const deletedProject = result.rows[0];
        projectMapping.delete(deletedProject.notion_id);
        
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
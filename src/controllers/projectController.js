const clockifyService = require('../services/clockifyService');
const databaseService = require('../services/databaseService');

// Stockage temporaire des tâches en cours
const activeTasks = new Map();

// Fonction pour formater l'ID de la tâche
function formatTaskId(properties) {
    if (properties.ID && properties.ID.unique_id) {
        const { prefix, number } = properties.ID.unique_id;
        return `${prefix}-${number}`;
    }
    return null;
}

// Fonction pour extraire le nom du projet depuis les propriétés Notion
function extractProjectName(payload) {
    if (payload.properties && payload.properties['Project name'] && 
        payload.properties['Project name'].title && 
        payload.properties['Project name'].title.length > 0) {
        return payload.properties['Project name'].title[0].text.content;
    } else if (payload.properties && payload.properties.Name && 
              payload.properties.Name.title && 
              payload.properties.Name.title.length > 0) {
        return payload.properties.Name.title[0].text.content;
    } else if (payload.title && payload.title.length > 0) {
        return payload.title[0].text.content;
    }
    return null;
}

// Fonction pour vérifier si un projet existe dans la base de données
async function checkProjectExists(notionId) {
    try {
        const mapping = await databaseService.loadProjectMapping();
        return mapping.has(notionId);
    } catch (error) {
        console.error('Erreur lors de la vérification du projet:', error);
        throw error;
    }
}

// Fonction pour vérifier si un projet est une icône
function isProjectIcon(projectRelation) {
    if (!projectRelation) return false;
    
    // Vérifier si le projet a une icône
    return projectRelation.icon?.type === 'emoji' || projectRelation.icon?.type === 'external';
}

// Gestionnaire du webhook de projet
async function handleProjectWebhook(req, res) {
    try {
        console.log('📥 Project webhook received');
        const payload = req.body.data;

        // Extraire les informations du projet
        const notionProjectId = payload.id;
        const projectName = extractProjectName(payload);
        
        if (!projectName) {
            console.log('⚠️ Nom du projet non trouvé, utilisation de l\'ID comme fallback');
            projectName = `Project ${notionProjectId}`;
        }
        
        console.log('📝 Project Name:', projectName);
        
        const emoji = payload.icon?.type === 'emoji' ? payload.icon.emoji : null;
        const customIcon = payload.icon?.type === 'external' ? true : false;
        
        if (emoji) {
            console.log('🎨 Project emoji:', emoji);
        } else if (customIcon) {
            console.log('🎨 Project has custom icon');
        }

        // Vérifier si le projet existe déjà dans la base de données
        const projectExists = await checkProjectExists(notionProjectId);
        
        if (!projectExists) {
            console.log('🆕 Projet non trouvé dans la base de données, création dans Clockify...');
            
            // Créer le projet dans Clockify
            const project = await clockifyService.getOrCreateProject(notionProjectId, projectName);
            console.log('✅ Projet créé dans Clockify:', project.id);
            
            // Sauvegarder le mapping dans la base de données
            const mapping = new Map();
            mapping.set(notionProjectId, {
                id: project.id,
                name: projectName,
                emoji: emoji,
                color: project.color,
                billable: project.billable,
                public: project.public
            });
            
            await databaseService.saveProjectMapping(mapping);
            console.log('✅ Mapping sauvegardé dans la base de données');
        } else {
            console.log('✅ Projet déjà existant dans la base de données');
        }

        res.status(200).json({
            message: 'Project webhook processed successfully',
            projectId: notionProjectId,
            projectName: projectName,
            created: !projectExists
        });
    } catch (error) {
        const message = error.response?.data?.message || error.message;
        console.error(`❌ Error: ${message}`);
        res.status(500).send(`Error processing project webhook: ${message}`);
    }
}

// Gestionnaire du webhook de tâche
async function handleTaskWebhook(req, res) {
    try {
        const payload = req.body.data;

        const taskId = payload.id;
        const taskName = payload.properties['Task name'].title[0].text.content;
        const projectRelation = payload.properties.Project.relation[0];
        const notionProjectId = projectRelation ? projectRelation.id : null;
        const formattedId = formatTaskId(payload.properties);
        const status = payload.properties.Status?.status;
        let project = null;

        console.log(`📋 Task: ${formattedId || taskId} - ${taskName}`);
        console.log(`📊 Status: ${status ? status.name : 'Undefined'}`);

        const activeTask = activeTasks.get(taskId);
        const isTaskActive = !!activeTask;

        if (status && status.id === 'in-progress') {
            if (!isTaskActive) {
                let clockifyTask = null;

                // Vérifier si le projet existe et n'est pas une icône
                if (notionProjectId && !isProjectIcon(projectRelation)) {
                    console.log('🔍 Recherche du projet dans la base de données...');
                    const mapping = await databaseService.loadProjectMapping();
                    const projectData = mapping.get(notionProjectId);
                    
                    if (projectData) {
                        console.log('✅ Projet trouvé dans la base de données:', projectData.id);
                        // Utiliser le projet existant au lieu d'en créer un nouveau
                        project = {
                            id: projectData.id,
                            name: projectData.name
                        };
                        clockifyTask = await clockifyService.getOrCreateClockifyTask(taskName, project.id);
                    } else {
                        console.log('⚠️ Projet non trouvé dans la base de données');
                    }
                } else if (isProjectIcon(projectRelation)) {
                    console.log('⚠️ Projet ignoré car c\'est une icône');
                }

                const timeEntry = await clockifyService.startTimeEntry(
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
            }
        } else if (status && status.id !== 'in-progress' && isTaskActive) {
            if (activeTasks.size === 1) {
                console.log('⏹️ Stopping all time entries');
                await clockifyService.stopAllTimeEntries();
                activeTasks.clear();
            } else {
                if (activeTask.taskName === taskName) {
                    await clockifyService.stopTimeEntry(activeTask.timeEntryId);
                    activeTasks.delete(taskId);
                    console.log('⏹️ Tracking stopped');
                }
            }
        }

        res.status(200).json({
            message: 'Task webhook processed successfully',
            taskId: taskId,
            taskName: taskName,
            projectId: notionProjectId,
            isProjectIcon: isProjectIcon(projectRelation),
            clockifyProjectId: project ? project.id : null
        });
    } catch (error) {
        const message = error.response?.data?.message || error.message;
        console.error(`❌ Error: ${message}`);
        res.status(500).send(`Error processing webhook: ${message}`);
    }
}

// Récupérer tous les projets
async function getAllProjects(req, res) {
    try {
        console.log('📋 GET /projects - Fetching all projects');
        const projects = await databaseService.getAllProjects();
        console.log(`✅ Found ${projects.length} projects`);
        res.json(projects);
    } catch (error) {
        const message = error.response?.data?.message || error.message;
        console.error('❌ Error fetching projects:', message);
        res.status(500).send(`Error retrieving projects: ${message}`);
    }
}

// Supprimer un projet
async function deleteProject(req, res) {
    try {
        const projectId = parseInt(req.params.id);
        console.log(`🗑️ Suppression du projet ID: ${projectId}`);
        
        const deletedProject = await databaseService.deleteProject(projectId);
        
        if (!deletedProject) {
            console.log('❌ Projet non trouvé');
            return res.status(404).send('Project not found');
        }
        
        console.log('✅ Projet supprimé avec succès:', {
            id: deletedProject.id,
            notionId: deletedProject.notion_id,
            name: deletedProject.name
        });
        
        res.status(200).json({
            message: 'Project deleted successfully',
            deletedProject: {
                id: deletedProject.id,
                notionId: deletedProject.notion_id,
                name: deletedProject.name
            }
        });
    } catch (error) {
        const message = error.response?.data?.message || error.message;
        console.error('❌ Erreur lors de la suppression:', message);
        res.status(500).send(`Error deleting project: ${message}`);
    }
}

module.exports = {
    handleProjectWebhook,
    handleTaskWebhook,
    getAllProjects,
    deleteProject
}; 
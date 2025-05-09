const axios = require('axios');
const clockifyConfig = require('../config/clockify');
require('dotenv').config();

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
        return response.data;
    } catch (error) {
        throw error;
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
        return response.data;
    } catch (error) {
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
        throw error;
    }
}

// Fonction pour créer ou récupérer un projet dans Clockify
async function getOrCreateProject(notionProjectId, projectName) {
    try {
        console.log(`Searching/creating project with ID: ${notionProjectId}`);
        
        const response = await axios.get(`${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/projects`, {
            headers: clockifyConfig.headers
        });

        const existingProject = response.data.find(p => p.name.includes(notionProjectId));
        if (existingProject) {
            console.log('✅ Existing project found');
            return existingProject;
        }

        console.log('🆕 Creating a new project');
        const newProject = await axios.post(
            `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/projects`,
            {
                name: projectName || `Project ${notionProjectId}`,
                color: "#000000",
                billable: true,
                public: false
            },
            { headers: clockifyConfig.headers }
        );

        return newProject.data;
    } catch (error) {
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
        
        const tasksResponse = await axios.get(
            `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/projects/${projectId}/tasks`,
            { headers: clockifyConfig.headers }
        );

        const existingTask = tasksResponse.data.find(t => t.name === taskName);
        if (existingTask) {
            console.log('Existing task found:', existingTask);
            return existingTask;
        }

        console.log('Creating a new task');
        const newTask = await axios.post(
            `${clockifyConfig.baseURL}/workspaces/${process.env.CLOCKIFY_WORKSPACE_ID}/projects/${projectId}/tasks`,
            {
                name: taskName,
                projectId: projectId
            },
            { headers: clockifyConfig.headers }
        );

        return newTask.data;
    } catch (error) {
        throw error;
    }
}

module.exports = {
    startTimeEntry,
    stopTimeEntry,
    getCurrentUserId,
    stopAllTimeEntries,
    getOrCreateProject,
    getOrCreateClockifyTask
}; 
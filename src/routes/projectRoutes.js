const express = require('express');
const router = express.Router();
const { secretMiddleware } = require('../middleware/auth');
const projectController = require('../controllers/projectController');

// Route pour le webhook de projet
router.post('/project-webhook', secretMiddleware, projectController.handleProjectWebhook);

// Route pour le webhook de tâche
router.post('/webhook', secretMiddleware, projectController.handleTaskWebhook);

// Route pour récupérer tous les projets
router.get('/projects', projectController.getAllProjects);

// Route pour supprimer un projet
router.delete('/projects/:id', projectController.deleteProject);

module.exports = router; 
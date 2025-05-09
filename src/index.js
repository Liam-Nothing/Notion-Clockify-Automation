const express = require('express');
require('dotenv').config();
const databaseService = require('./services/databaseService');
const projectRoutes = require('./routes/projectRoutes');

const app = express();
app.use(express.json());

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

// Initialisation de la base de données
databaseService.initDatabase().catch(error => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
});

// Utilisation des routes
app.use('/', projectRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
}); 
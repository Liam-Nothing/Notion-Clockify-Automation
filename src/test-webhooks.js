const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const API_URL = 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.NOTION_WEBHOOK_SECRET;

// Fonction pour extraire les données de la requête du format HAR
function extractRequestData(harData) {
    try {
        // Extraire la première entrée du HAR
        const entry = harData.log.entries[0];
        if (!entry || !entry.request || !entry.request.postData) {
            throw new Error('Format HAR invalide');
        }

        // Extraire les données JSON de la requête
        const requestData = JSON.parse(entry.request.postData.text);
        
        // Extraire les headers
        const headers = {};
        entry.request.headers.forEach(header => {
            headers[header.name] = header.value;
        });

        return {
            data: requestData,
            headers: headers
        };
    } catch (error) {
        console.error('Erreur lors de l\'extraction des données HAR:', error.message);
        throw error;
    }
}

async function testWebhook(filePath, endpoint) {
    try {
        // Lire le fichier JSON
        const harData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        // Extraire les données de la requête
        const { data, headers } = extractRequestData(harData);
        
        console.log('\n📤 Envoi de la requête avec les données:');
        console.log(JSON.stringify(data, null, 2));
        
        // Envoyer la requête
        const response = await axios.post(`${API_URL}${endpoint}`, data, {
            headers: {
                'Content-Type': 'application/json',
                'secret': WEBHOOK_SECRET,
                'user-agent': headers['user-agent'] || 'NotionAutomation'
            }
        });

        console.log(`\n✅ Test réussi pour ${path.basename(filePath)}`);
        console.log('Réponse:', response.data);
        return true;
    } catch (error) {
        console.error(`\n❌ Erreur pour ${path.basename(filePath)}:`);
        console.error('Message:', error.response?.data || error.message);
        return false;
    }
}

// Vérifier que le serveur est en cours d'exécution
async function checkServer() {
    try {
        await axios.get(`${API_URL}/projects`);
        return true;
    } catch (error) {
        console.error('❌ Le serveur ne semble pas être en cours d\'exécution sur', API_URL);
        console.error('Assurez-vous que le serveur est démarré avec `npm run dev` ou `npm start`');
        return false;
    }
}

// Fonction principale
async function main() {
    // Récupérer le nom du fichier depuis les arguments de la ligne de commande
    const fileName = process.argv[2];
    
    if (!fileName) {
        console.error('❌ Veuillez spécifier un fichier à tester');
        console.error('Usage: npm run test:webhooks -- nom_du_fichier.json');
        process.exit(1);
    }

    if (!await checkServer()) {
        process.exit(1);
    }

    const webhooksDir = path.join(__dirname, '..', 'webhooks');
    const filePath = path.join(webhooksDir, fileName);

    if (!fs.existsSync(filePath)) {
        console.error(`❌ Le fichier ${fileName} n'existe pas dans le dossier webhooks`);
        process.exit(1);
    }

    console.log(`\n🚀 Test du webhook: ${fileName}`);
    
    // Déterminer l'endpoint en fonction du nom du fichier
    const endpoint = fileName.startsWith('project_') ? '/project-webhook' : '/webhook';
    
    await testWebhook(filePath, endpoint);
}

main().catch(console.error); 
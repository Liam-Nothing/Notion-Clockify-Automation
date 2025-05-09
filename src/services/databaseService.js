const pool = require('../config/database');

// Initialisation de la base de données
async function initDatabase() {
    try {
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
        return mapping;
    } catch (error) {
        throw error;
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
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        throw error;
    }
}

// Fonction pour récupérer tous les projets
async function getAllProjects() {
    try {
        const result = await pool.query('SELECT * FROM projects ORDER BY id');
        return result.rows.map(row => ({
            id: row.id,
            notionId: row.notion_id,
            name: row.name,
            clockifyId: row.clockify_id,
            emoji: row.emoji
        }));
    } catch (error) {
        throw error;
    }
}

// Fonction pour supprimer un projet
async function deleteProject(projectId) {
    try {
        const result = await pool.query('DELETE FROM projects WHERE id = $1 RETURNING *', [projectId]);
        return result.rows[0];
    } catch (error) {
        throw error;
    }
}

module.exports = {
    initDatabase,
    loadProjectMapping,
    saveProjectMapping,
    getAllProjects,
    deleteProject
}; 
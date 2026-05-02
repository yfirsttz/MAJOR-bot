const fs = require("fs");
const path = require("path");
const { pool } = require("./create");
const log = require("../services/logger");

const BACKUP_DIR = path.join(__dirname, "../../backups");
const TABLES = ["test_player_votes", "player_game_progress"];

async function backupTable(tableName) {
    if (!TABLES.includes(tableName)) {
        throw new Error(`Tabela de backup nao permitida: ${tableName}`);
    }

    const { rows } = await pool.query(`SELECT * FROM ${tableName}`);
    const filePath = path.join(BACKUP_DIR, `${tableName}_${Date.now()}.json`);

    fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));
    log.ok(`Backup salvo: ${filePath}`);
}

async function runBackup() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    try {
        for (const tableName of TABLES) {
            await backupTable(tableName);
        }

        log.ok("Backup concluido com sucesso.");
    } catch (error) {
        log.error("Erro durante o backup:", error.message);
        throw error;
    }
}

module.exports = { runBackup };

const fs = require("fs");
const path = require("path");
const config = require("./config");
const log = require("../services/logger");

const DATA_DIR = path.join(__dirname, "../../data");
const LEGACY_JSON_DIR = path.join(__dirname, "../../json");

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function cloneDefaultValue(value) {
    if (value == null || typeof value !== "object") {
        return value;
    }

    return JSON.parse(JSON.stringify(value));
}

function getScopedFileName(name) {
    const baseName = name.endsWith(".json") ? name.slice(0, -5) : name;
    return `${baseName}_${config.RUNTIME_STATE_SUFFIX}.json`;
}

function getFilePath(name) {
    return path.join(DATA_DIR, getScopedFileName(name));
}

function getLegacyCandidates(name) {
    const candidates = [];

    if (name === "pending_polls") {
        candidates.push(
            path.join(LEGACY_JSON_DIR, "pending_polls.json"),
            path.join(LEGACY_JSON_DIR, "pending_pool.json"),
            path.join(__dirname, "../../pending_polls.json"),
            path.join(__dirname, "../../pending_pool.json")
        );
    } else if (name === "queue_watch_state") {
        candidates.push(
            path.join(LEGACY_JSON_DIR, "queue_watch_state.json"),
            path.join(__dirname, "../../queue_watch_state.json")
        );
    }

    return candidates;
}

function migrateLegacyFile(name, targetPath) {
    if (config.PROFILE_NAME !== "official") {
        return false;
    }

    for (const legacyPath of getLegacyCandidates(name)) {
        if (!fs.existsSync(legacyPath)) {
            continue;
        }

        try {
            const raw = fs.readFileSync(legacyPath, "utf8");
            JSON.parse(raw);
            fs.writeFileSync(targetPath, raw);
            log.info(
                `Estado legado migrado: ${path.basename(legacyPath)} -> ${path.relative(process.cwd(), targetPath)}`
            );
            return true;
        } catch (error) {
            log.warn(`Falha ao migrar arquivo legado ${legacyPath}:`, error.message);
        }
    }

    return false;
}

function readJson(name, defaultValue = {}) {
    ensureDataDir();

    const filePath = getFilePath(name);
    if (!fs.existsSync(filePath)) {
        migrateLegacyFile(name, filePath);
    }

    if (!fs.existsSync(filePath)) {
        return cloneDefaultValue(defaultValue);
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        log.warn(`Erro ao ler ${path.basename(filePath)}:`, error.message);
        return cloneDefaultValue(defaultValue);
    }
}

function saveJson(name, value) {
    ensureDataDir();

    try {
        fs.writeFileSync(getFilePath(name), JSON.stringify(value, null, 2));
    } catch (error) {
        log.error(`Erro ao salvar ${name}.json:`, error.message);
    }
}

module.exports = {
    DATA_DIR,
    readJson,
    saveJson,
};

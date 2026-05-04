function getString(name, fallback = "") {
    const value = process.env[name];
    return value == null ? fallback : resolveEnvReference(value);
}

function resolveEnvReference(value) {
    const text = String(value).trim();
    const match = text.match(/^\$\(([^)]+)\)$/) || text.match(/^\$\{([^}]+)\}$/);

    if (!match) {
        return text;
    }

    const resolved = process.env[match[1]];
    return resolved == null ? "" : String(resolved).trim();
}

function parseBoolean(value, fallback = false) {
    if (value == null || String(value).trim() === "") {
        return fallback;
    }

    return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseInteger(name, fallback, options = {}) {
    const raw = process.env[name];
    const { min = Number.NEGATIVE_INFINITY } = options;

    if (raw == null || String(raw).trim() === "") {
        return fallback;
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < min) {
        throw new Error(`Valor invalido para ${name}: ${raw}`);
    }

    return parsed;
}

function parseIdList(raw) {
    return [...new Set(String(raw || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean))];
}

function getProfileValue(prefix, key, fallback = "") {
    return getString(`${prefix}_${key}`, fallback);
}

function parseProfileIdList(prefix, key) {
    return parseIdList(getProfileValue(prefix, key));
}

function parseProfileInteger(prefix, key, fallback, options = {}) {
    return parseInteger(`${prefix}_${key}`, fallback, options);
}

function parseProfileBoolean(prefix, key, fallback = false) {
    return parseBoolean(process.env[`${prefix}_${key}`], fallback);
}

function buildProfile(prefix) {
    return {
        PREFIX: prefix,
        NAME: prefix === "OFFICIAL" ? "official" : "test",
        BOT_TOKEN: getProfileValue(prefix, "BOT_TOKEN"),
        CLIENT_ID: getProfileValue(prefix, "CLIENT_ID"),
        SERVER_ID: getProfileValue(prefix, "SERVER_ID"),
        CHANNEL_ID: getProfileValue(prefix, "CHANNEL_ID"),
        STARTUP_CHANNEL_ID: getProfileValue(prefix, "STARTUP_CHANNEL_ID"),
        QUEUE_CHANNEL_ID: getProfileValue(prefix, "QUEUE_CHANNEL_ID"),
        QUEUE_NAME: getProfileValue(prefix, "QUEUE_NAME"),
        NEATQUEUE_API_TOKEN: getProfileValue(prefix, "NEATQUEUE_API_TOKEN"),
        NEATQUEUE_WEBHOOK_TOKEN: getProfileValue(prefix, "NEATQUEUE_WEBHOOK_TOKEN"),
        AUTO_FORCESTART_ENABLED: parseProfileBoolean(prefix, "AUTO_FORCESTART_ENABLED", false),
        AUTO_FORCESTART_DELAY_SECONDS: parseProfileInteger(prefix, "AUTO_FORCESTART_DELAY_SECONDS", 180, { min: 1 }),
        AUTO_FORCESTART_MIN_GK: parseProfileInteger(prefix, "AUTO_FORCESTART_MIN_GK", 1, { min: 0 }),
        AUTO_FORCESTART_MIN_LINHA: parseProfileInteger(prefix, "AUTO_FORCESTART_MIN_LINHA", 10, { min: 0 }),
        AUTO_FORCESTART_NOTIFY_CHANNEL_ID: getProfileValue(prefix, "AUTO_FORCESTART_NOTIFY_CHANNEL_ID"),
        RESULTS_CHANNEL_ID: getProfileValue(prefix, "RESULTS_CHANNEL_ID"),
        ROLES_MAJOR: parseProfileIdList(prefix, "ROLES_MAJOR"),
        ROLES_GKMAJOR: parseProfileIdList(prefix, "ROLES_GKMAJOR"),
        ROLES_TEST_MAJOR: parseProfileIdList(prefix, "ROLES_TEST_MAJOR"),
        ROLES_TEST_GKMAJOR: parseProfileIdList(prefix, "ROLES_TEST_GKMAJOR"),
    };
}

const DEBUG_MODE = parseBoolean(process.env.DEBUG_MODE, false);
const ACTIVE_PROFILE_PREFIX = DEBUG_MODE ? "TEST" : "OFFICIAL";
const OFFICIAL_PROFILE = buildProfile("OFFICIAL");
const TEST_PROFILE = buildProfile("TEST");
const activeProfile = DEBUG_MODE ? TEST_PROFILE : OFFICIAL_PROFILE;

const config = {
    DEBUG_MODE,
    DEBUG: DEBUG_MODE,
    PROFILE_NAME: activeProfile.NAME,
    ACTIVE_PROFILE_PREFIX,
    OFFICIAL_PROFILE,
    TEST_PROFILE,
    OFFICIAL_SERVER_ID: OFFICIAL_PROFILE.SERVER_ID,
    DATABASE_URL: getString("DATABASE_URL"),
    NODE_ENV: getString("NODE_ENV", "development"),
    WEBHOOK_PORT: parseInteger("WEBHOOK_PORT", parseInteger("PORT", 3000, { min: 1 }), { min: 1 }),
    PUBLIC_WEBHOOK_PATH: getString("PUBLIC_WEBHOOK_PATH", "/neatqueue-webhook"),
    POLL_THRESHOLD_GAMES: parseInteger("POLL_THRESHOLD_GAMES", 10, { min: 1 }),
    SMART_PING_MIN_PLAYERS: parseInteger("SMART_PING_MIN_PLAYERS", 7, { min: 1 }),
    SMART_PING_COOLDOWN_SECONDS: parseInteger("SMART_PING_COOLDOWN_SECONDS", 300, { min: 1 }),
    NEATQUEUE_BOT_ID: getString("NEATQUEUE_BOT_ID", "857633321064595466"),
    RESULTS_ALERT_USER_ID: getString("RESULTS_ALERT_USER_ID", "1055925368055410759"),
    ...activeProfile,
};

config.STARTUP_CHANNEL_ID = config.STARTUP_CHANNEL_ID || config.CHANNEL_ID;
config.AUTO_FORCESTART_NOTIFY_CHANNEL_ID =
    config.AUTO_FORCESTART_NOTIFY_CHANNEL_ID || config.QUEUE_CHANNEL_ID || config.CHANNEL_ID;
config.AUTO_FORCESTART_DELAY_MS = config.AUTO_FORCESTART_DELAY_SECONDS * 1_000;
config.TARGET_PLAYERS = config.AUTO_FORCESTART_MIN_GK + config.AUTO_FORCESTART_MIN_LINHA;
config.FULL_PLAYERS = config.TARGET_PLAYERS + 1;
config.POLL_DURATION_MS = config.DEBUG_MODE ? 60_000 : 24 * 60 * 60 * 1_000;
config.SMART_PING_COOLDOWN_MS = config.SMART_PING_COOLDOWN_SECONDS * 1_000;
config.SMART_PING_ENABLED = Boolean(
    config.QUEUE_CHANNEL_ID &&
    config.NEATQUEUE_BOT_ID &&
    config.ROLES_MAJOR.length &&
    config.ROLES_TEST_MAJOR.length &&
    config.ROLES_GKMAJOR.length &&
    config.ROLES_TEST_GKMAJOR.length
);
config.RESULT_AUDIT_ENABLED = Boolean(
    config.RESULTS_CHANNEL_ID &&
    config.RESULTS_ALERT_USER_ID &&
    config.NEATQUEUE_BOT_ID
);
config.WEBHOOK_FEATURES_ENABLED = config.AUTO_FORCESTART_ENABLED || config.SMART_PING_ENABLED;
config.RUNTIME_STATE_SUFFIX = `${config.PROFILE_NAME}_${config.SERVER_ID}`;

const missing = [];

if (!config.DATABASE_URL) {
    missing.push("DATABASE_URL");
}

if (!config.NEATQUEUE_BOT_ID) {
    missing.push("NEATQUEUE_BOT_ID");
}

if (!config.RESULTS_ALERT_USER_ID) {
    missing.push("RESULTS_ALERT_USER_ID");
}

if (!config.OFFICIAL_SERVER_ID) {
    missing.push("OFFICIAL_SERVER_ID");
}

for (const key of [
    "BOT_TOKEN",
    "SERVER_ID",
    "CHANNEL_ID",
    "QUEUE_CHANNEL_ID",
    "NEATQUEUE_API_TOKEN",
    "RESULTS_CHANNEL_ID",
]) {
    if (!config[key]) {
        missing.push(`${config.ACTIVE_PROFILE_PREFIX}_${key}`);
    }
}

for (const key of [
    "ROLES_MAJOR",
    "ROLES_GKMAJOR",
    "ROLES_TEST_MAJOR",
    "ROLES_TEST_GKMAJOR",
]) {
    if (!config[key].length) {
        missing.push(`${config.ACTIVE_PROFILE_PREFIX}_${key}`);
    }
}

if (missing.length) {
    throw new Error(`Variaveis obrigatorias ausentes no .env: ${missing.join(", ")}`);
}

module.exports = config;

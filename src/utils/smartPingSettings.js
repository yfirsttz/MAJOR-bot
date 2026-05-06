const config = require("./config");
const { readJson, saveJson } = require("./jsonStore");

const SETTINGS_FILE = "smart_ping_settings";
const MIN_COOLDOWN_SECONDS = 1;

const defaultSettings = {
    cooldownSeconds: config.SMART_PING_COOLDOWN_SECONDS,
};

function normalizeCooldownSeconds(value, fallback = defaultSettings.cooldownSeconds) {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < MIN_COOLDOWN_SECONDS) {
        return fallback;
    }

    return parsed;
}

let settings = {
    ...defaultSettings,
    ...readJson(SETTINGS_FILE, defaultSettings),
};

settings.cooldownSeconds = normalizeCooldownSeconds(settings.cooldownSeconds);

function saveSettings() {
    saveJson(SETTINGS_FILE, settings);
}

function getSmartPingCooldownSeconds() {
    return settings.cooldownSeconds;
}

function getSmartPingCooldownMs() {
    return getSmartPingCooldownSeconds() * 1_000;
}

function setSmartPingCooldownSeconds(seconds) {
    settings.cooldownSeconds = normalizeCooldownSeconds(seconds);
    saveSettings();
    return settings.cooldownSeconds;
}

function resetSmartPingCooldownSeconds() {
    settings.cooldownSeconds = defaultSettings.cooldownSeconds;
    saveSettings();
    return settings.cooldownSeconds;
}

function getDefaultSmartPingCooldownSeconds() {
    return defaultSettings.cooldownSeconds;
}

module.exports = {
    MIN_COOLDOWN_SECONDS,
    getDefaultSmartPingCooldownSeconds,
    getSmartPingCooldownMs,
    getSmartPingCooldownSeconds,
    resetSmartPingCooldownSeconds,
    setSmartPingCooldownSeconds,
};

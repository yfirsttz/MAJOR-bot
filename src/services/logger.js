function timestamp() {
    return new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
    });
}

function write(method, scope, args) {
    console[method](`[${timestamp()}] [${scope}]`, ...args);
}

const log = {
    info: (...args) => write("log", "INFO", args),
    ok: (...args) => write("log", "OK", args),
    warn: (...args) => write("warn", "WARN", args),
    error: (...args) => write("error", "ERROR", args),
    debug: (...args) => write("log", "DEBUG", args),
    poll: (...args) => write("log", "POLL", args),
    queue: (...args) => write("log", "QUEUE", args),
    force: (...args) => write("log", "FORCE", args),
};

module.exports = log;

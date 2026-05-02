function getBrazilNow() {
    return new Date(
        new Date().toLocaleString("en-US", {
            timeZone: "America/Sao_Paulo",
        })
    );
}

function formatBrazilNow() {
    return getBrazilNow().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
    });
}

function formatDurationMs(durationMs) {
    const totalSeconds = Math.floor(durationMs / 1_000);
    const totalMinutes = Math.floor(totalSeconds / 60);

    if (totalSeconds % 60 === 0) {
        return `${totalMinutes} minuto(s)`;
    }

    return `${totalSeconds} segundo(s)`;
}

function shouldSendRolePingNow() {
    const now = getBrazilNow();
    const day = now.getDay();
    const hour = now.getHours();

    const isFridayOrSaturday = day === 5 || day === 6;
    const stopHour = isFridayOrSaturday ? 4 : 1;

    return !(hour >= stopHour && hour < 12);
}

function msUntilNextHalfHour() {
    const now = new Date();
    const next = new Date(now);

    next.setSeconds(0, 0);
    next.setMinutes(now.getMinutes() < 30 ? 30 : 0);

    if (now.getMinutes() >= 30) {
        next.setHours(next.getHours() + 1);
    }

    return Math.max(next.getTime() - now.getTime(), 0);
}

function getNextHalfHourDate(fromDate = new Date()) {
    const next = new Date(fromDate);

    next.setSeconds(0, 0);
    next.setMinutes(fromDate.getMinutes() < 30 ? 30 : 0);

    if (fromDate.getMinutes() >= 30) {
        next.setHours(next.getHours() + 1);
    }

    return next;
}

module.exports = {
    getBrazilNow,
    formatBrazilNow,
    formatDurationMs,
    shouldSendRolePingNow,
    msUntilNextHalfHour,
    getNextHalfHourDate,
};

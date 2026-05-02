const { Pool } = require("pg");
const config = require("../utils/config");
const log = require("../services/logger");

if (!config.DATABASE_URL) {
    throw new Error("DATABASE_URL nao definida no .env");
}

const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS test_player_votes (
            id BIGSERIAL PRIMARY KEY,
            server_id TEXT NOT NULL,
            discord_user_id TEXT NOT NULL,
            discord_tag TEXT,
            role_track TEXT NOT NULL DEFAULT 'major',
            threshold_games INTEGER NOT NULL DEFAULT 10,
            total_games_when_triggered INTEGER NOT NULL,
            role_tracks TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
            vote_message_id TEXT,
            vote_channel_id TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            CONSTRAINT test_player_votes_server_user_threshold_track_key
                UNIQUE (server_id, discord_user_id, threshold_games, role_track)
        );
    `);

    await pool.query(`ALTER TABLE test_player_votes ADD COLUMN IF NOT EXISTS server_id TEXT;`);
    await pool.query(`ALTER TABLE test_player_votes ADD COLUMN IF NOT EXISTS role_track TEXT NOT NULL DEFAULT 'major';`);
    await pool.query(`ALTER TABLE test_player_votes ADD COLUMN IF NOT EXISTS role_tracks TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];`);
    await pool.query(
        `
        UPDATE test_player_votes
        SET server_id = $1
        WHERE server_id IS NULL OR server_id = '';
        `,
        [config.OFFICIAL_SERVER_ID]
    );
    await pool.query(`ALTER TABLE test_player_votes ALTER COLUMN server_id SET NOT NULL;`);
    await pool.query(`ALTER TABLE test_player_votes DROP CONSTRAINT IF EXISTS test_player_votes_discord_user_id_threshold_games_key;`);
    await pool.query(`ALTER TABLE test_player_votes DROP CONSTRAINT IF EXISTS test_player_votes_server_id_discord_user_id_threshold_games_key;`);
    await pool.query(`ALTER TABLE test_player_votes DROP CONSTRAINT IF EXISTS test_player_votes_server_id_discord_user_id_threshold_games_role_track_key;`);
    await pool.query(`ALTER TABLE test_player_votes DROP CONSTRAINT IF EXISTS test_player_votes_server_user_threshold_track_key;`);
    await pool.query(
        `
        ALTER TABLE test_player_votes
        ADD CONSTRAINT test_player_votes_server_user_threshold_track_key
        UNIQUE (server_id, discord_user_id, threshold_games, role_track);
        `
    );
    await pool.query(
        `
        CREATE INDEX IF NOT EXISTS idx_test_player_votes_server_message_id
        ON test_player_votes (server_id, vote_message_id);
        `
    );

    await pool.query(`
        CREATE TABLE IF NOT EXISTS player_game_progress (
            id BIGSERIAL PRIMARY KEY,
            server_id TEXT NOT NULL,
            discord_user_id TEXT NOT NULL,
            discord_tag TEXT,
            last_total_games INTEGER NOT NULL DEFAULT 0,
            last_major_games INTEGER NOT NULL DEFAULT 0,
            last_gkmajor_games INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE (server_id, discord_user_id)
        );
    `);

    await pool.query(`ALTER TABLE player_game_progress ADD COLUMN IF NOT EXISTS server_id TEXT;`);
    await pool.query(`ALTER TABLE player_game_progress ADD COLUMN IF NOT EXISTS last_major_games INTEGER NOT NULL DEFAULT 0;`);
    await pool.query(`ALTER TABLE player_game_progress ADD COLUMN IF NOT EXISTS last_gkmajor_games INTEGER NOT NULL DEFAULT 0;`);
    await pool.query(
        `
        UPDATE player_game_progress
        SET server_id = $1
        WHERE server_id IS NULL OR server_id = '';
        `,
        [config.OFFICIAL_SERVER_ID]
    );
    await pool.query(`ALTER TABLE player_game_progress ALTER COLUMN server_id SET NOT NULL;`);
    await pool.query(`ALTER TABLE player_game_progress DROP CONSTRAINT IF EXISTS player_game_progress_discord_user_id_key;`);
    await pool.query(`ALTER TABLE player_game_progress DROP CONSTRAINT IF EXISTS player_game_progress_server_id_discord_user_id_key;`);
    await pool.query(
        `
        ALTER TABLE player_game_progress
        ADD CONSTRAINT player_game_progress_server_id_discord_user_id_key
        UNIQUE (server_id, discord_user_id);
        `
    );

    log.ok(`Banco de dados inicializado para o servidor ${config.SERVER_ID}.`);
}

async function getVoteByUserAndThreshold(discordUserId, thresholdGames = 10, roleTrack = "major") {
    const { rows } = await pool.query(
        `
        SELECT *
        FROM test_player_votes
        WHERE server_id = $1
          AND discord_user_id = $2
          AND threshold_games = $3
          AND role_track = $4
        LIMIT 1;
        `,
        [config.SERVER_ID, discordUserId, thresholdGames, roleTrack]
    );

    return rows[0] ?? null;
}

async function getVoteByMessageId(messageId) {
    const { rows } = await pool.query(
        `
        SELECT *
        FROM test_player_votes
        WHERE server_id = $1
          AND vote_message_id = $2
        LIMIT 1;
        `,
        [config.SERVER_ID, messageId]
    );

    return rows[0] ?? null;
}

async function createVote({
    discordUserId,
    discordTag = null,
    roleTrack = "major",
    thresholdGames = 10,
    totalGamesWhenTriggered,
    roleTracks = [],
    voteMessageId = null,
    voteChannelId = null,
    status = "open",
}) {
    const { rows } = await pool.query(
        `
        INSERT INTO test_player_votes (
            server_id,
            discord_user_id,
            discord_tag,
            role_track,
            threshold_games,
            total_games_when_triggered,
            role_tracks,
            vote_message_id,
            vote_channel_id,
            status,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (server_id, discord_user_id, threshold_games, role_track)
        DO UPDATE SET
            discord_tag = EXCLUDED.discord_tag,
            total_games_when_triggered = EXCLUDED.total_games_when_triggered,
            role_tracks = EXCLUDED.role_tracks,
            vote_message_id = COALESCE(EXCLUDED.vote_message_id, test_player_votes.vote_message_id),
            vote_channel_id = COALESCE(EXCLUDED.vote_channel_id, test_player_votes.vote_channel_id),
            status = EXCLUDED.status,
            updated_at = NOW()
        RETURNING *;
        `,
        [
            config.SERVER_ID,
            discordUserId,
            discordTag,
            roleTrack,
            thresholdGames,
            totalGamesWhenTriggered,
            roleTracks.length ? roleTracks : [roleTrack],
            voteMessageId,
            voteChannelId,
            status,
        ]
    );

    return rows[0] ?? null;
}

async function updateVoteStatus(discordUserId, thresholdGames = 10, status, roleTrack = "major") {
    const { rows } = await pool.query(
        `
        UPDATE test_player_votes
        SET status = $5,
            updated_at = NOW()
        WHERE server_id = $1
          AND discord_user_id = $2
          AND threshold_games = $3
          AND role_track = $4
        RETURNING *;
        `,
        [config.SERVER_ID, discordUserId, thresholdGames, roleTrack, status]
    );

    return rows[0] ?? null;
}

async function updateVoteStatusByMessageId(messageId, status) {
    const { rows } = await pool.query(
        `
        UPDATE test_player_votes
        SET status = $3,
            updated_at = NOW()
        WHERE server_id = $1
          AND vote_message_id = $2
        RETURNING *;
        `,
        [config.SERVER_ID, messageId, status]
    );

    return rows[0] ?? null;
}

async function getPlayerProgress(discordUserId) {
    const { rows } = await pool.query(
        `
        SELECT *
        FROM player_game_progress
        WHERE server_id = $1
          AND discord_user_id = $2
        LIMIT 1;
        `,
        [config.SERVER_ID, discordUserId]
    );

    return rows[0] ?? null;
}

async function upsertPlayerProgress(discordUserId, discordTag = null, lastTotalGames = 0, roleGames = {}) {
    const { rows } = await pool.query(
        `
        INSERT INTO player_game_progress (
            server_id,
            discord_user_id,
            discord_tag,
            last_total_games,
            last_major_games,
            last_gkmajor_games,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (server_id, discord_user_id)
        DO UPDATE SET
            discord_tag = EXCLUDED.discord_tag,
            last_total_games = EXCLUDED.last_total_games,
            last_major_games = EXCLUDED.last_major_games,
            last_gkmajor_games = EXCLUDED.last_gkmajor_games,
            updated_at = NOW()
        RETURNING *;
        `,
        [
            config.SERVER_ID,
            discordUserId,
            discordTag,
            lastTotalGames,
            Number(roleGames.major || 0),
            Number(roleGames.gkmajor || 0),
        ]
    );

    return rows[0];
}

module.exports = {
    pool,
    initDb,
    getVoteByUserAndThreshold,
    getVoteByMessageId,
    createVote,
    updateVoteStatus,
    updateVoteStatusByMessageId,
    getPlayerProgress,
    upsertPlayerProgress,
};

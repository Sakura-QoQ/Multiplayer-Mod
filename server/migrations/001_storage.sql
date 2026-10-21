-- PostgreSQL online-storage schema. Applied only by the explicit --migrate command.
-- Personal days live in player_saves.payload; room clocks and online members stay in memory.
BEGIN;
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,32}$'),
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 64),
    password_hash text NOT NULL,
    auth_version bigint NOT NULL DEFAULT 0 CHECK (auth_version >= 0),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE player_saves (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    slot smallint NOT NULL DEFAULT 0 CHECK (slot BETWEEN 0 AND 9),
    schema_version integer NOT NULL CHECK (schema_version > 0),
    game_version text NOT NULL,
    game_binary_sha256 text NOT NULL CHECK (game_binary_sha256 ~ '^[a-f0-9]{64}$'),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    -- An indexed projection of the native value, not a second authoritative day.
    personal_day integer GENERATED ALWAYS AS ((payload #>> '{PlayerStatusData,day}')::integer) STORED NOT NULL,
    last_clock_epoch uuid,
    last_clock_cycle bigint CHECK (last_clock_cycle >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, slot),
    UNIQUE (id, user_id),
    CHECK (personal_day >= 0),
    CHECK ((last_clock_epoch IS NULL) = (last_clock_cycle IS NULL))
);

CREATE TABLE save_assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    save_id uuid NOT NULL,
    user_id uuid NOT NULL,
    photo_name text NOT NULL CHECK (photo_name ~ '^[A-Za-z0-9_-]{1,96}$'),
    mime_type text NOT NULL DEFAULT 'image/png' CHECK (mime_type = 'image/png'),
    sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
    content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 8388608),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (save_id, photo_name),
    FOREIGN KEY (save_id, user_id) REFERENCES player_saves(id, user_id) ON DELETE CASCADE
);

CREATE TABLE chat_conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL CHECK (kind IN ('room', 'direct')),
    -- Opaque room incarnation ID assigned by the in-memory room registry, not a public label.
    room_key uuid UNIQUE,
    direct_user_low uuid REFERENCES users(id),
    direct_user_high uuid REFERENCES users(id),
    next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (kind = 'room' AND room_key IS NOT NULL AND direct_user_low IS NULL AND direct_user_high IS NULL)
        OR
        (kind = 'direct' AND room_key IS NULL AND direct_user_low IS NOT NULL
            AND direct_user_high IS NOT NULL AND direct_user_low < direct_user_high)
    ),
    UNIQUE (direct_user_low, direct_user_high)
);

CREATE TABLE chat_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES chat_conversations(id),
    user_id uuid NOT NULL REFERENCES users(id),
    visible_from_sequence bigint NOT NULL DEFAULT 1 CHECK (visible_from_sequence > 0),
    last_visible_sequence bigint,
    last_read_sequence bigint NOT NULL DEFAULT 0 CHECK (last_read_sequence >= 0),
    joined_at timestamptz NOT NULL DEFAULT now(),
    left_at timestamptz,
    UNIQUE (conversation_id, user_id),
    CHECK (last_visible_sequence IS NULL OR last_visible_sequence >= visible_from_sequence - 1)
);
CREATE INDEX chat_members_user_idx ON chat_members(user_id, conversation_id);

CREATE TABLE chat_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL,
    sequence bigint NOT NULL CHECK (sequence > 0),
    sender_user_id uuid NOT NULL,
    client_message_id uuid NOT NULL,
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000 AND octet_length(body) <= 8192),
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (conversation_id, sequence),
    UNIQUE (conversation_id, sender_user_id, client_message_id),
    FOREIGN KEY (conversation_id, sender_user_id) REFERENCES chat_members(conversation_id, user_id)
);
CREATE INDEX chat_messages_created_at_idx ON chat_messages(created_at);

-- Required application invariants, deliberately not claimed as implemented here:
-- * Derive user_id from verified JWTs; check users.auth_version/status and save revision CAS.
-- * Login/logout increments auth_version; no refresh-session table or persistent connection lease.
-- * Bind writes to the current in-memory connection for each user (single server instance).
-- * Active room membership is required for room chat; direct membership must match the pair.
-- * Check token expiry/version, account status and chat visibility on every HTTP/WS operation.
-- * Allocate next_sequence while holding the conversation row lock, in the insert transaction.
-- * Commit before acknowledging/broadcasting; reconnect replays committed history by sequence.
-- * Commit personal day changes and the save clock cursor together; joining sets a baseline only.
-- * New room/server incarnations get a new epoch and room_key; stale epochs cannot advance days.
COMMIT;

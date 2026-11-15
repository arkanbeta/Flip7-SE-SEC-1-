
-- 1. Create the database
CREATE DATABASE flip7_online
CHARACTER SET utf8mb4
COLLATE utf8mb4_0900_ai_ci;

USE flip7_online;


-- 2. Users
CREATE TABLE Users (
    user_id BIGINT UNSIGNED AUTO_INCREMENT,
    google_id VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    nickname VARCHAR(30) NOT NULL,
    avatar VARCHAR(100) NOT NULL,
    total_points BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (user_id),
    UNIQUE (google_id),
    UNIQUE (email),
    UNIQUE (nickname)
) ENGINE = InnoDB;


-- 3. GameModes
CREATE TABLE GameModes (
    game_mode_id BIGINT UNSIGNED AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    description VARCHAR(255) NOT NULL,

    PRIMARY KEY (game_mode_id),
    UNIQUE (name)
) ENGINE = InnoDB;


-- 4. MatchHistories
CREATE TABLE MatchHistories (
    match_id BIGINT UNSIGNED AUTO_INCREMENT,
    game_mode_id BIGINT UNSIGNED NOT NULL,
    started_at DATETIME(3) NOT NULL,
    finished_at DATETIME(3) NOT NULL,
    number_of_rounds INT UNSIGNED NOT NULL,
    status ENUM('Completed', 'Abandoned') NOT NULL,

    PRIMARY KEY (match_id),

    CONSTRAINT fk_match_game_mode
        FOREIGN KEY (game_mode_id)
        REFERENCES GameModes(game_mode_id)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT
) ENGINE = InnoDB;


-- 5. MatchPlayers
CREATE TABLE MatchPlayers (
    match_player_id BIGINT UNSIGNED AUTO_INCREMENT,
    match_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    final_points INT NOT NULL,
    ranking_points INT UNSIGNED NOT NULL,
    hits INT UNSIGNED NOT NULL DEFAULT 0,
    busts INT UNSIGNED NOT NULL DEFAULT 0,

    PRIMARY KEY (match_player_id),

    UNIQUE (match_id, user_id),

    CONSTRAINT fk_matchplayers_match
        FOREIGN KEY (match_id)
        REFERENCES MatchHistories(match_id)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT,

    CONSTRAINT fk_matchplayers_user
        FOREIGN KEY (user_id)
        REFERENCES Users(user_id)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT
) ENGINE = InnoDB;


-- 6. GameRooms
CREATE TABLE GameRooms (
    room_id BIGINT UNSIGNED AUTO_INCREMENT,
    room_code VARCHAR(10) NOT NULL,
    creator_id BIGINT UNSIGNED NOT NULL,
    game_mode_id BIGINT UNSIGNED NOT NULL,
    max_players TINYINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    status ENUM('Waiting', 'In Progress') NOT NULL DEFAULT 'Waiting',

    PRIMARY KEY (room_id),

    UNIQUE (room_code),

    CONSTRAINT chk_room_capacity
        CHECK (max_players BETWEEN 3 AND 7),

    CONSTRAINT fk_room_creator
        FOREIGN KEY (creator_id)
        REFERENCES Users(user_id)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT,

    CONSTRAINT fk_room_game_mode
        FOREIGN KEY (game_mode_id)
        REFERENCES GameModes(game_mode_id)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT,

    INDEX idx_room_status (status)
) ENGINE = InnoDB;


-- 7. Insert the initial game mode
INSERT INTO GameModes (name, description)
VALUES (
    'Normal',
    'Standard Flip 7 game mode.'
);


-- =====================================================================
-- Card tables: cards, game_cards
-- =====================================================================
-- What a card is, and where every card sits in each game.
-- Depends on the lobby tables (games, players) from the previous file.
-- The 36 card rows themselves are loaded by supabase/seed.sql.
--
-- Relationships:
--   game_cards.game_id    -> games.id
--   game_cards.card_id    -> cards.id
--   game_cards.matched_by -> players.id
-- =====================================================================
-- cards
-- ---------------------------------------------------------------------
-- Reference data: the 36 unique cards, identical in every game. Never
-- changes while a game is being played.
--   * 3 numbers x 4 colors x 4 categories would be 48 cards; the deck
--     uses 36 of them (each number has 12 cards, and each
--     number + color pair appears with 3 of the 4 categories).
--   * name is what is drawn on the card (e.g. 'frogs', 'pencil').
--   * Colors and categories are plain text on purpose, so adding a new
--     one later is a seed change, not a schema change.
-- =====================================================================
create table
  cards (
    id smallint generated always as identity primary key,
    number smallint not null check (number > 0),
    color varchar(20) not null,
    category varchar(20) not null,
    name varchar(30) not null,
    unique (number, color, category)
  );

comment on table cards is 'The 36 unique cards. Reference data loaded by seed.sql; identical in every game.';

comment on column cards.name is 'What is pictured on the card, e.g. frog, spoons, pencil.';

-- =====================================================================
-- game_cards
-- ---------------------------------------------------------------------
-- The board for one game: 36 rows per game, one per slot (a 6 x 6 grid).
-- All 36 cards are on the table from the start, so there is no deck and
-- no refilling. The slot IS the shuffle: it is assigned once, when the
-- host starts the game, and never changes.
--   * slot         1..36, read left to right, top to bottom.
--   * is_face_up   true only while flipped during the current turn.
--   * matched_at   set when a player takes the card. A card with
--                  matched_at set is off the board.
--   * matched_by   who took it. Together with matched_at this is the
--                  history that per-game stats and replays can use.
-- SECURITY: never send a face-down card's number, color or category to
-- the browser. Only reveal cards that are face up.
-- =====================================================================
create table
  game_cards (
    game_id uuid not null references games (id) on delete cascade,
    slot smallint not null check (slot between 1 and 36),
    card_id smallint not null references cards (id),
    is_face_up boolean not null default false,
    matched_by uuid references players (id) on delete set null,
    matched_at timestamptz,
    primary key (game_id, slot), -- one card per board spot
    unique (game_id, card_id), -- each card appears once per game
    constraint game_cards_matched_by_has_time check (
      matched_by is null
      or matched_at is not null
    ),
    constraint game_cards_face_up_only_on_board check (
      not is_face_up
      or matched_at is null
    ) -- matched cards are never face up
  );

comment on table game_cards is 'The board for one game, one row per slot. Never send face-down card values to clients.';

comment on column game_cards.slot is 'Board spot 1 to 36, fixed when the game starts.';

comment on column game_cards.matched_at is 'When a player took this card. Null while the card is still on the board.';

comment on column game_cards.matched_by is 'The player who matched this card. Set to null only if that player row is deleted.';

-- ---------------------------------------------------------------------
-- Security: block Supabase's public API (anon key).
-- ---------------------------------------------------------------------
alter table cards enable row level security;

alter table game_cards enable row level security;
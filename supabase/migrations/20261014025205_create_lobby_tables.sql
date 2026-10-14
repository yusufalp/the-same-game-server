-- =====================================================================
-- Lobby tables: games, profiles, players
-- =====================================================================
-- Everything needed to host a game, fill its seats and know who is who.
-- Migrations run in filename order, so this file comes first and the
-- later files (cards, statistics) point back at these tables.
--
--   games      one row per game
--   profiles   one row per logged-in account (the only people with stats)
--   players    one row per seat in a game: accounts, guests and AI
--
-- Relationships:
--   players.game_id     -> games.id
--   players.profile_id  -> profiles.id    (logged-in players only)
--
-- Guests have no profile. They are identified inside a game by
-- players.anonymous_user_id, so their games are saved but never
-- counted in statistics.

-- ---------------------------------------------------------------------
-- Shared trigger function: keeps updated_at current.
-- Used by games, profiles and (in a later file) statistics.
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- games
-- ---------------------------------------------------------------------
-- One row per game, from the lobby through the final result.
--   * game_code is the short public label used in invite links.
--     Other tables reference games.id, never the code.
--   * status moves: waiting -> ready -> playing -> finished.
--       waiting   seats are still open
--       ready     every seat is filled, the host can start
--   * current_seat / current_spin hold the live turn and the spinner
--     result. Both are null unless the game is playing.
--   * Playing time is finished_at - started_at (created_at includes
--     the time spent waiting in the lobby).
-- =====================================================================
create table games (
  id            uuid primary key default gen_random_uuid(),
  game_code     varchar(6) not null unique
                check (game_code ~ '^[A-Z0-9]{6}$'),
  max_players   smallint not null
                check (max_players between 1 and 4),
  status        varchar(20) not null default 'waiting'
                check (status in ('waiting', 'ready', 'playing', 'finished')),
  current_seat  smallint
                check (current_seat between 1 and 4),
  current_spin  varchar(10)
                check (current_spin in ('number', 'color', 'category')),
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint games_finished_after_started
    check (finished_at is null or started_at is null or finished_at >= started_at),
  constraint games_turn_only_while_playing
    check (current_seat is null or status = 'playing'),
  constraint games_spin_only_while_playing
    check (current_spin is null or status = 'playing')
);

create trigger games_set_updated_at
  before update on games
  for each row execute function set_updated_at();

comment on table  games is 'One row per game. Other tables reference games.id; game_code is only the public, shareable label.';
comment on column games.game_code    is 'Unique 6-character code used in invite links, e.g. X7K9PQ.';
comment on column games.status       is 'waiting = seats open, ready = all seats filled (host can start), playing, finished.';
comment on column games.current_seat is 'Seat of the player whose turn it is. Null unless the game is playing.';
comment on column games.current_spin is 'Attribute the spinner landed on this turn. Null until the current player spins; cleared after a match or a miss.';
comment on column games.started_at   is 'When the host started the game (end of the lobby).';
comment on column games.finished_at  is 'When the game ended. Duration = finished_at - started_at.';

-- =====================================================================
-- profiles
-- ---------------------------------------------------------------------
-- One row per logged-in account, and nothing else. Guests do not get a
-- profile, so only accounts can have statistics. Name, email and
-- password stay in the separate auth server (MongoDB); user_id is the
-- link to that system.
-- =====================================================================
create table profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null unique
              check (user_id ~ '^[0-9a-f]{24}$'),    -- MongoDB ObjectId, lowercase hex
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

comment on table  profiles is 'One row per logged-in account. Guests do not get a profile, so only accounts have statistics.';
comment on column profiles.user_id is 'MongoDB ObjectId from the auth server, stored as text.';

-- =====================================================================
-- players
-- ---------------------------------------------------------------------
-- One row per seat in a game, holding facts about THAT game only
-- (lifetime totals live in statistics). Every player is exactly one of:
--   * an account  -> profile_id is set
--   * a guest     -> anonymous_user_id is set (the browser's id)
--   * an AI       -> is_ai = true, neither id is set
-- Seats run from 1 (the host) up to games.max_players.
-- =====================================================================
create table players (
  id                 uuid primary key default gen_random_uuid(),
  game_id            uuid not null references games(id) on delete cascade,
  profile_id         uuid references profiles(id),
  anonymous_user_id  uuid,
  display_name       varchar(50) not null,
  seat               smallint not null check (seat between 1 and 4),
  is_host            boolean not null default false,
  is_ai              boolean not null default false,
  is_active          boolean not null default true,
  score              integer not null default 0 check (score >= 0),
  placement          smallint check (placement between 1 and 4),
  joined_at          timestamptz not null default now(),

  unique (game_id, seat),                  -- one player per seat
  unique (game_id, display_name),          -- names are unique within a game
  unique (game_id, profile_id),            -- one seat per account per game
  unique (game_id, anonymous_user_id),     -- one seat per browser per game

  -- AI players have no identity. Humans have exactly one.
  constraint players_identity check (
    (is_ai and profile_id is null and anonymous_user_id is null)
    or
    (not is_ai and ((profile_id is null) <> (anonymous_user_id is null)))
  ),
  constraint players_host_is_human check (not (is_host and is_ai))
);

-- Exactly one host per game
create unique index players_one_host_per_game on players (game_id) where is_host;
create index players_profile_idx on players (profile_id);
create index players_anonymous_idx on players (anonymous_user_id) where anonymous_user_id is not null;

comment on table  players is 'One row per seat in a game. Holds facts about that game only.';
comment on column players.profile_id        is 'Set for logged-in players. Lifetime stats are looked up through the profile.';
comment on column players.anonymous_user_id is 'Set for guests. Private browser id, never expose in API responses.';
comment on column players.seat              is '1 to max_players. The database cannot check this against games.max_players, so the join code enforces it.';
comment on column players.is_active         is 'False when someone leaves after the game started. In a waiting or ready game, delete the row instead so the seat frees up.';
comment on column players.placement         is '1 = winner. Equal scores share a placement (1, 1, 3). Set once when the game finishes.';

-- ---------------------------------------------------------------------
-- Security: block Supabase's public API (anon key). The Node server
-- connects directly as the postgres role, which bypasses RLS.
-- ---------------------------------------------------------------------
alter table games    enable row level security;
alter table profiles enable row level security;
alter table players  enable row level security;
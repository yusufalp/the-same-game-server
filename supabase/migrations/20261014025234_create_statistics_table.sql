-- =====================================================================
-- Statistics table: statistics
-- =====================================================================
-- Lifetime totals per logged-in account. Depends on profiles and games
-- from the lobby file.
--
-- Relationships:
--   statistics.profile_id            -> profiles.id  (one row per profile)
--   statistics.highest_score_game_id -> games.id

-- =====================================================================
-- statistics
-- ---------------------------------------------------------------------
-- Running totals, updated in the same transaction that finishes a game.
--   * Only logged-in accounts have a row. Guests and AI are never counted.
--   * Solo games count toward total_games and total_scores only, not
--     placements, streaks or fastest_win_seconds.
--   * placement_first includes draws: tied for first is still first.
--   * Average score is not stored: compute
--     total_scores / nullif(total_games, 0).
--   * The duration of the highest-score game is not stored either:
--     it is games.finished_at - games.started_at for
--     highest_score_game_id.
-- A row is created automatically for every new profile (see the trigger
-- below), so finishing a game can always just update it.
-- =====================================================================
create table statistics (
  profile_id             uuid primary key references profiles(id) on delete cascade,
  total_games            integer not null default 0 check (total_games >= 0),
  total_scores           integer not null default 0 check (total_scores >= 0),
  highest_score          integer not null default 0 check (highest_score >= 0),
  highest_score_game_id  uuid references games(id) on delete set null,
  placement_first        integer not null default 0 check (placement_first >= 0),
  placement_second       integer not null default 0 check (placement_second >= 0),
  placement_third        integer not null default 0 check (placement_third >= 0),
  placement_fourth       integer not null default 0 check (placement_fourth >= 0),
  current_win_streak     integer not null default 0 check (current_win_streak >= 0),
  highest_win_streak     integer not null default 0 check (highest_win_streak >= 0),
  fastest_win_seconds    integer check (fastest_win_seconds > 0),
  updated_at             timestamptz not null default now(),

  constraint statistics_streak_order check (highest_win_streak >= current_win_streak)
);

create trigger statistics_set_updated_at
  before update on statistics
  for each row execute function set_updated_at();

-- Create the statistics row whenever a profile is created.
create or replace function create_statistics_for_profile()
returns trigger
language plpgsql
as $$
begin
  insert into statistics (profile_id) values (new.id);
  return new;
end;
$$;

create trigger profiles_create_statistics
  after insert on profiles
  for each row execute function create_statistics_for_profile();

comment on table  statistics is 'Lifetime totals per logged-in account. Guests and AI are not counted. Solo games count toward total_games and total_scores only.';
comment on column statistics.highest_score_game_id is 'Game where highest_score was reached.';
comment on column statistics.fastest_win_seconds   is 'Shortest multiplayer game won, in seconds. Null until the first win.';

-- ---------------------------------------------------------------------
-- Security: block Supabase's public API (anon key).
-- ---------------------------------------------------------------------
alter table statistics enable row level security;
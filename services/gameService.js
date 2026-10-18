import { buildGameState } from "../utils/gameState.js";
import { generateGameCode } from "../utils/gameCode.js";
import { HttpError } from "../utils/HttpError.js";

export async function insertGame(client, maxPlayers) {
  const status = maxPlayers === 1 ? "ready" : "waiting";

  for (let attempt = 0; attempt < 5; attempt++) {
    const { rows } = await client.query(
      `
      insert into games (game_code, max_players, status)
      values ($1, $2, $3)
      on conflict (game_code) do nothing
      returning *
      `,
      [generateGameCode(), maxPlayers, status],
    );
    if (rows[0]) return rows[0];
  }
  throw new HttpError(500, "Could not create a game code, please try again.");
}

export async function findOrCreateProfile(client, userId) {
  const {
    rows: [profile],
  } = await client.query(
    `
    insert into profiles (user_id)
    values ($1)
    on conflict (user_id) do update set user_id = excluded.user_id
    returning id
    `,
    [userId],
  );

  return profile.id;
}

export async function resolvePlayerIdentity(client, identity) {
  if (identity.type === "account") {
    return {
      profileId: await findOrCreateProfile(client, identity.userId),
      anonymousUserId: null,
    };
  }

  return { profileId: null, anonymousUserId: identity.anonymousUserId };
}

// Which player in this game is making the request? Null if none.
// Read-only: unlike resolvePlayerIdentity, this never creates a profile.
export async function findPlayerForIdentity(db, players, identity) {
  if (identity.type === "guest") {
    return (
      players.find((p) => p.anonymous_user_id === identity.anonymousUserId) ??
      null
    );
  }

  const {
    rows: [profile],
  } = await db.query(
    `
    select id from profiles where user_id = $1
    `,
    [identity.userId],
  );

  if (!profile) return null;

  return players.find((p) => p.profile_id === profile.id) ?? null;
}

export async function loadGameContext(client, gameCode, identity) {
  const {
    rows: [game],
  } = await client.query(
    `
    select * from games where game_code = $1 for update
    `,
    [gameCode],
  );
  if (!game) throw new HttpError(404, "Game not found.");

  const {
    rows: [players],
  } = await client.query(
    `
    select * from players where game_id = $1 order by seat
    `,
    [game.id],
  );

  const me = await findPlayerForIdentity(client, players, identity);
  if (!me) throw new HttpError(403, "You are not a player in this game");

  return { game, players, me };
}

export async function readGameState(db, gameId, identity = null) {
  const {
    rows: [game],
  } = await db.query(
    `
    select * from games where id = $1
    `,
    [gameId],
  );

  const {
    rows: [players],
  } = await db.query(
    `
    select * from players where game_id = $1 order by seat
    `,
    [gameId],
  );

  const { rows: cards } = await db.query(
    `
    select gc.slot, gc.is_face_up, gc.matched_by, gc.matched_at, 
    c.number, c.color, c.category, c.name
    from game_cards gc
    join cards c on c.id = gc.card_id
    where gc.game_id = $1
    order by gc.slot
    `,
    [gameId],
  );

  const viewer = identity
    ? await findPlayerForIdentity(db, players, identity)
    : null;
  return buildGameState(game, players, cards, viewer);
}

// The host starts the game: first player's turn, no spin yet.
export async function markGameStarted(client, gameId, firstSeat) {
  await client.query(
    `
    update games set status = 'playing', started_at = now(), current_seat = $2, current_spin = null, where id = $1
    `,
    [gameId, firstSeat],
  );
}

// The game ends: rank everyone, stamp the finish time, clear the turn.
// Equal scores share a placement (1, 1, 3), so a draw means both finish first.
export async function finishGame(client, gameId) {
  await client.query(
    `
    update players p
    set placement = r.placement::smallint
    from (select id, rank() over (order by score desc) as placement
    from players
    where game_id = $1) r
    where p.id = r.id
    `,
    [gameId],
  );

  await client.query(
    `
    update games set status = 'finished', finished_at = now(), current_seat = null, current_spin = null, where id = $1
    `,
    [gameId],
  );
}

import { withTransaction } from "../config/db.js";

import {
  insertGame,
  loadGameContext,
  readGameState,
  resolvePlayerIdentity,
} from "../services/gameService.js";

import { buildLobby } from "../utils/lobby.js";
import { pickDisplayName } from "../utils/displayName.js";
import { getIdentity, getOptionalIdentity } from "../utils/identity.js";
import { normalizeGameCode } from "../utils/gameCode.js";
import { HttpError } from "../utils/HttpError.js";
import {
  addComputers,
  computerStep,
  resolveTurn,
  spin,
  startGame,
} from "../services/gameplayService.js";

/** POST /api/games
 * Identity: Authorization: Bearer <token>  OR  X-Anonymous-Id: <uuid>
 * Body: { maxPlayers: 1-4, name?: string }
 */
export async function hostGame(req, res, next) {
  try {
    const identity = getIdentity(req);

    const maxPlayers = Number(req.body?.maxPlayers);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 4) {
      throw new HttpError(400, "Max players must be an integer from 1 to 4.");
    }

    const { game, host } = await withTransaction(async (client) => {
      const ids = await resolvePlayerIdentity(client, identity);
      const game = await insertGame(client, maxPlayers);

      const {
        rows: [host],
      } = await client.query(
        `
        insert into players (game_id, profile_id, anonymous_user_id, display_name, seat, is_host)
        values ($1, $2, $3, $4, 1, true)
        returning *
        `,
        [
          game.id,
          ids.profileId,
          ids.anonymousUserId,
          pickDisplayName(req.body?.name),
        ],
      );

      return { game, host };
    });

    res.status(201).json(buildLobby(game, [host], host));
  } catch (error) {
    next(error);
  }
}

/** POST /api/games/:gameCode/join
 * Identity: Authorization: Bearer <token> OR X-Anonymous-Id: <uuid>
 * Body: { name?: string }
 */
export async function joinGameByCode(req, res, next) {
  try {
    const identity = getIdentity(req);
    const gameCode = normalizeGameCode(req.params.gameCode);

    const result = await withTransaction(async (client) => {
      const {
        rows: [game],
      } = await client.query(
        `
        select * from games where game_code = $1 for update
        `,
        [gameCode],
      );

      if (!game) throw new HttpError(404, "Game not found");

      const ids = await resolvePlayerIdentity(client, identity);

      const { rows: players } = await client.query(
        `
        select * from players where game_id = $1 order by seat
        `,
        [game.id],
      );

      const existing = players.find((p) =>
        identity.type === "account"
          ? p.profile_id === ids.profileId
          : p.anonymous_user_id === ids.anonymousUserId,
      );

      if (existing) return { game, players, me: existing, created: false };

      if (game.status === "ready" || players.length >= game.max_players) {
        throw new HttpError(409, "The game is full.");
      }

      if (game.status !== "waiting") {
        throw new HttpError(409, "The game has already started");
      }

      const taken = new Set(players.map((p) => p.seat));
      let seat = 1;
      while (taken.has(seat)) seat++;

      const takenNames = players.map((p) => p.display_name);
      const name = pickDisplayName(req.body?.name, takenNames);
      if (takenNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
        throw new HttpError(409, "That name is already taken");
      }

      const {
        rows: [me],
      } = await client.query(
        `
        insert into players (game_id, profile_id, anonymous_user_id, display_name, seat)
        values ($1, $2, $3, $4, $5)
        returning *
        `,
        [game.id, ids.profileId, ids.anonymousUserId, name, seat],
      );
      players.push(me);

      if (players.length === game.max_players) {
        await client.query(
          `
          update games set status = 'ready' where id = $1
          `,
          [game.id],
        );
        game.status = "ready";
      }

      return { game, players, me, created: true };
    });

    res
      .status(result.created ? 201 : 200)
      .json(buildLobby(result.game, result.players, result.me));
  } catch (error) {
    if (error.code === "23505") {
      return next(
        new HttpError(409, "That spot was just taken, please try again."),
      );
    }
    next(error);
  }
}

/** GET /api/:gameCode
 * The current state of the game. Poll this to keep every player in sync.
 */
export async function getGameByCode(req, res, next) {
  try {
    const gameCode = normalizeGameCode(req.params.gameCode);
    const identity = getOptionalIdentity(req);

    const {
      rows: [game],
    } = await pool.query(
      `
      select id from games where game_code = $1
      `,
      [gameCode],
    );

    if (!game) throw new HttpError(404, "Game not found.");

    req.status(200).json(await readGameState(pool, game.id, identity));
  } catch (error) {
    next(error);
  }
}

// Shared flow for every action: identify the player, lock the game row,
// run the action, then respond with the fresh game state.
function gameAction(action, { hostOnly = false } = {}) {
  return async (req, res, next) => {
    try {
      const identity = getIdentity(req);
      const gameCode = normalizeGameCode(req.params.gameCode);

      const state = await withTransaction(async (client) => {
        const { game, players, me } = await loadGameContext(
          client,
          gameCode,
          identity,
        );

        if (hostOnly && !me.is_host) {
          throw new HttpError(403, "Only the host can do that.");
        }

        await action({ client, game, players, me, body: req.body ?? {} });
        return readGameState(client, game.id, identity);
      });

      res.json(state);
    } catch (error) {
      next(error);
    }
  };
}

/** POST /api/games/:gameCode/computers   (host)
 * Fills open seats with computer players. Default: every open seat.
 * Body: { count?: number }
 */
export const addComputerPlayers = gameAction(
  ({ client, game, players, body }) =>
    addComputers(client, game, players, body.count),
  { hostOnly: true },
);

/** POST /api/games/:gameCode/start   (host)
 * Shuffles the cards and starts the first turn. Needs every seat filled.
 */
export const startGameByCode = gameAction(
  ({ client, game, players }) => startGame(client, game, players),
  { hostOnly: true },
);

/** POST /api/games/:gameCode/spin   (current player)
 * Spin the spinner once per turn.
 */
export const performSpinByCode = gameAction(({ client, game, me }) =>
  spin(client, game, me),
);

/** POST /api/games/:gameCode/flip   (current player)   Body: { slot: 1-36 }
 */
export const flipCardByGameCode = gameAction(({ client, game, me, body }) =>
  flipCard(client, game, me, body.slot),
);

/** POST /api/games/:gameCode/end-turn   (current player)
 * After two cards are flipped: take them if they match, otherwise pass the turn.
 */
export const endTurnByCode = gameAction(({ client, game, players, me }) =>
  resolveTurn(client, game, players, me),
);

/** POST /api/games/:gameCode/computer-move   (host)
 * Performs one step of the computer player whose turn it is.
 */
export const computerMoveByGameCode = gameAction(
  ({ client, game, players }) => computerStep(client, game, players),
  { hostOnly: true },
);

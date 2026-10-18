import { withTransaction } from "../config/db.js";

import { insertGame, resolvePlayerIdentity } from "../services/gameService.js";

import { buildLobby } from "../utils/lobby.js";
import { pickDisplayName } from "../utils/displayName.js";
import { getIdentity } from "../utils/identity.js";
import { normalizeGameCode } from "../utils/gameCode.js";
import { HttpError } from "../utils/HttpError.js";

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

export function getGameById() {}
export function startGameById() {}
export function performSpinByGameId() {}
export function flipCardByGameId() {}
export function endTurnByGameId() {}
export function getPlayersByGameId() {}
export function computerMoveByGameId() {}
export function leaveGameById() {}

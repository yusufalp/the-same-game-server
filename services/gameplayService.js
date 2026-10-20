import { finishGame, markGameStarted } from "./gameService";
import { pickComputerSlot, pickSpinAttribute, shuffle } from "../utils/card";
import { pickDisplayName } from "../utils/displayName";
import { HttpError } from "../utils/HttpError";

// The game rules. Every function takes a transaction `client`, the locked
// `game` row and (where needed) the players, and changes the database.
// The controller re-reads the game afterwards to build the response.

const CARD_COUNT = 36;

function assertTurn(game, player) {
  if (game.status !== "playing")
    throw new HttpError(409, "The game is not in progress.");

  if (game.current_seat !== player.seat)
    throw new HttpError(403, "It is not your turn.");
}

async function loadUnmatchedCards(client, gameId) {
  const { rows } = await client.query(
    `
    select gc.slot, gc.is_face_up, c.number, c.color, c.category
    from game_cards gc
    join cards c on c.id = gc.card_id
    where gc.game_id = $1 and gc.matched_at is null
    order by gc.slot
    `,
    [gameId],
  );

  return rows;
}

function nextPlayer(players, currentSeat) {
  const active = players.filter((p) => p.is_active);
  return active.find((p) => p.seat > currentSeat) ?? active[0];
}

export async function addComputers(client, game, players, count) {
  if (game.status !== "waiting")
    throw new HttpError(
      409,
      "Computer players can only join while seats are open.",
    );

  const openSeats = (game.max_players = players.length);
  if (openSeats <= 0) throw new HttpError(409, "There are no empty seats.");

  const requested = count === undefined ? openSeats : Number(count);
  if (!Number.isInteger(requested) || requested < 1)
    throw new HttpError(400, "Count must be a positive number.");

  const toAdd = Math.min(requested, openSeats);

  const takenSeats = new Set(players.map((p) => p.seat));
  const names = players.map((p) => p.display_name);
  let added = 0;

  for (let seat = 1; seat <= game.max_players && added < toAdd; seat++) {
    if (takenSeats.has(seat)) continue;

    const name = pickDisplayName(undefined, names);
    names.push(name);

    await client.query(
      `
      insert into players (game_id, display_name, seat, is_ai)
      values ($1, $2, $3, true)
      `,
      [game.id, name, seat],
    );
    added++;
  }

  if (players.length + added === game.max_players) {
    await client.query(
      `
      update games set status = 'ready' where id = $1
      `,
      [game.id],
    );
  }
}

export async function startGame(client, game, players) {
  if (game.status === "playing" || game.status === "finished") {
    throw new HttpError(409, "The game has already started.");
  }

  if (game.status !== "ready") {
    throw new HttpError(
      409,
      "Every seat must be filled before game can start.",
    );
  }

  const {
    rows: [cards],
  } = await client.query(
    `
    select id from cards order by id
    `,
  );

  if (cards.length !== CARD_COUNT) {
    throw new HttpError(
      500,
      `Expected ${CARD_COUNT} but found ${cards.length}.`,
    );
  }

  const shuffled = shuffle(cards.map((c) => c.id));
  const slots = shuffled.map((_, i) => i + 1);

  await client.query(
    `
    insert into game_cards (game_id, slot, card_id)
    select $1::uuid, s.slot, s.card_id
    from unnest($2::smallint[], $3::smallint[]) as s(slot, card_id)
    `,
    [game.id, slots, shuffled],
  );

  const firstSeat = Math.min(...players.map((p) => p.seat));
  await markGameStarted(client, game.id, firstSeat);
}

export async function spin(client, game, player) {
  assertTurn(game, player);
  if (game.current_spin)
    throw new HttpError(409, "You already spun this turn.");

  const cards = await loadUnmatchedCards(client, game.id);
  const attribute = pickSpinAttribute(cards);

  if (!attribute) return finishGame(client, game.id);

  await client.query(
    `
    updates games set current_spin = $2 where id = $1
    `,
    [game.id, attribute],
  );
}

// Flip a card face up. Needs a spin first, and allows at most two face-up cards.
export async function flipCard(client, game, player, slot) {
  assertTurn(game, player);

  if (!game.current_spin)
    throw new HttpError(409, "Spin the spinner before flipping a card.");

  const slotNumber = Number(slot);
  if (
    !Number.isInteger(slotNumber) ||
    slotNumber < 1 ||
    slotNumber > CARD_COUNT
  ) {
    throw new HttpError(
      400,
      `slot must be a whole number from 1 to ${CARD_COUNT}`,
    );
  }

  const {
    rows: [board],
  } = await client.query(
    `
    select slot, is_face_up, matched_at from game_cards where game_id = $1
    `,
    [game.id],
  );

  const card = board.find((c) => c.slot === slotNumber);
  if (!card) throw new HttpError(404, "That card does not exist.");
  if (card.matched_at)
    throw new HttpError(409, "That card has already been matched.");
  if (card.is_face_up)
    throw new HttpError(409, "That card is already flipped.");
  if (board.filter((c) => c.is_face_up).length >= 2)
    throw new HttpError(409, "Two cards are already flipped. End your turn.");

  await client.query(
    `
    update game_cards set is_face_up = true where game_id = $1 and slot = $2
    `,
    [game.id, slotNumber],
  );
}

// Called after the second flip, once everyone has had a moment to see both cards.
//   match -> the cards are taken, +1 point, and the same player spins again
//   miss  -> both cards turn face down and the next player's turn starts
export async function resolveTurn(client, game, players, player) {
  assertTurn(game, player);

  const { rows: flipped } = await client.query(
    `
    select gc.slot, c.number, c.color, c.category
    from game_Cards gc
    join card c on c.id = gc.card_id
    where gc.game_id = $1 and gc.is_face_up
    order by gc.slot
    `,
    [game.id],
  );

  if (flipped.length !== 2)
    throw new HttpError(409, "Flip two cards before ending your turn.");

  const [a, b] = flipped;

  if (cardsMatch(a, b, game.current_spin)) {
    await client.query(
      `
      update game_cards set is_face_up = false, matched_by = #2, matched_at = now()
      where game_id = $1 and slot = any($3::smallint[])
      `,
      [game.id, player.id, [a.slot, b.slot]],
    );

    await client.query(
      `
        update players set score = score + 1 where id = $1
        `,
      [player.id],
    );

    await client.query(
      `
      update games set current_spin = null where id = $1
      `,
      [game.id],
    );

    const remaining = await loadUnmatchedCards(client, game.id);
    if (!pickSpinAttribute(remaining)) await finishGame(client, game.id);
    return;
  }

  await client.query(
    `
    update game_cards set is_face_up = false where game_id = $1 and is_face_up
    `,
    [game.id],
  );

  const next = nextPlayer(players, game.current_seat);
  await client.query(
    `
    update games set current_seat = $2, current_spin = null where id = $1
    `,
    [game.id, next.seat],
  );
}

// Performs ONE step for the computer whose turn it is: spin, flip, flip, or
// end turn. The front end calls this repeatedly with short pauses, so every
// player can watch the computer play.
export async function computerStep(client, game, players) {
  const computer = players.find((p) => p.seat === p.current_seat);
  if (game.status !== "playing" || !computer?.is_ai)
    throw new HttpError(409, "It is not a computer player's turn.");

  const cards = await loadUnmatchedCards(client, game.id);
  const faceUp = cards.filter((c) => c.is_face_up);

  if (faceUp.length === 2) return resolveTurn(client, game, players, computer);
  if (!game.current_spin) return spin(client, game, computer);

  const slot = pickComputerSlot(cards, game.current_spin, faceUp[0] ?? null);
  return flipCard(client, game, computer, slot);
}

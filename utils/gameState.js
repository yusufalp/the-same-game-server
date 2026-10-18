import { buildLobby } from "./lobby.js";

export function buildGameState(game, players, cards, viewer = null) {
  const lobby = buildLobby(game, players, viewer);
  const current = players.find((p) => p.seat === game.current_seat);

  return {
    game: {
      ...lobby.game,
      currentSeat: game.current_seat,
      currentPlayerId: current?.id ?? null,
      spin: game.current_spin,
      cardsLeft: cards.filter((c) => !c.matched_at).length,
      startedAt: game.started_at,
      finishedAt: game.finished_at,
    },
    you: lobby.you && {
      ...lobby.you,
      isYourTurn:
        game.status === "playing" && viewer.seat === game.current_seat,
    },
    boards: cards.map((c) => {
      const isMatched = Boolean(c.matched_at);

      const isFaceUp = c.is_face_up || isMatched;

      return {
        slot: c.slot,
        isFaceUp,
        isMatched,
        matchedBy: c.matched_by,
        card: isFaceUp
          ? {
              number: c.number,
              color: c.color,
              category: c.category,
              name: c.name,
            }
          : null,
      };
    }),
  };
}

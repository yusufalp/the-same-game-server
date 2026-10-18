// Seats and lobby info. `viewer` is the requesting player, or null for
// someone who is only looking at the game (e.g. before joining).
export function buildLobby(game, players, viewer) {
  const seats = Array.from({ length: game.max_players }, (_, i) => {
    const seat = i + 1;
    const p = players.find((player) => player.seat === seat);
    return {
      seat,
      status: p ? "filled" : "empty",
      player: p
        ? {
            id: p.id,
            displayName: p.display_name,
            isHost: p.is_host,
            isAi: p.is_ai,
            score: p.score,
            placement: p.placement,
          }
        : null,
    };
  });

  const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";

  return {
    game: {
      gameCode: game.game_code,
      status: game.status,
      maxPlayers: game.max_players,
      spotsLeft: game.max_players - players.length,
      joinUrl: `${clientUrl}/games/${game.game_code}`,
      seats,
    },
    you: viewer
      ? {
          playerId: viewer.id,
          seat: viewer.seat,
          isHost: viewer.is_host,
          canStart: viewer.is_host && game.status === "ready",
        }
      : null,
  };
}

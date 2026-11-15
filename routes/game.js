import { Router } from "express";
import {
  addComputerPlayers,
  computerMoveByGameCode,
  endGameByGameCode,
  endTurnByGameCode,
  flipCardByGameCode,
  getGameByCode,
  hostGame,
  joinGameByCode,
  performSpinByGameCode,
  startGameByCode,
} from "../controllers/gameController.js";

const router = Router();

router.get("/:gameCode", getGameByCode);

router.post("/", hostGame);
router.post("/:gameCode/join", joinGameByCode);
router.post("/:gameCode/computers", addComputerPlayers);
router.post("/:gameCode/start", startGameByCode);
router.post("/:gameCode/spin", performSpinByGameCode);
router.post("/:gameCode/flip", flipCardByGameCode);
router.post("/:gameCode/end-turn", endTurnByGameCode);
router.post("/:gameCode/computer-move", computerMoveByGameCode);
router.post("/:gameCode/end", endGameByGameCode);

// router.get("/:gameCode/players", getPlayersByGameId);
// router.post("/:gameCode/leave", leaveGameById);

export default router;

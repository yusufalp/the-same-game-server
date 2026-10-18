import { Router } from "express";
import {
  getPlayersByGameId,
  hostGame,
  joinGameByCode,
  leaveGameById,
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

router.get("/:gameCode/players", getPlayersByGameId);
router.post("/:gameCode/leave", leaveGameById);

export default router;

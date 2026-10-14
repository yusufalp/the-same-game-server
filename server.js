import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import gameRoutes from "./routes/game.js";

const server = express();
const port = process.env.PORT || 5151;

server.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
server.use(helmet());
server.use(morgan("dev"));

server.use(express.json());

server.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

server.use("/api/games", gameRoutes);

server.use((err, req, res, next) => {
  console.error(err);
  res
    .status(err.status || 500)
    .json({ error: err.status ? err.message : "Something went wrong" });
});

server.listen(port, () =>
  console.log(`Server listening on http://localhost:${port}`),
);

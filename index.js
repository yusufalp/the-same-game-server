import express from "express";

const server = express();
const PORT = 5151;

server.get("/", (req, res, next) => {
  res.status.json({ success: true, message: "Hello server" });
});

server.listen(PORT, () => {
  console.log(`Server is now listening on port ${PORT}`);
});

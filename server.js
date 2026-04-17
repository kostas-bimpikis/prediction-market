require("dotenv").config();

const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const game = require("./lib/game");
const { router: sseRouter, broadcast } = require("./routes/sse");
const studentRoutes = require("./routes/student");
const instructorRoutes = require("./routes/instructor");

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());

// Static files
app.use(express.static(path.join(__dirname, "public")));

// Serve instructor page (before API routes to avoid auth middleware)
app.get("/instructor", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "instructor.html"));
});

// SSE routes (must be before other routes to handle streaming)
app.use(sseRouter);

// API routes
app.use(studentRoutes);
app.use(instructorRoutes);

// Wire up SSE broadcast to game engine
game.setBroadcast(broadcast);

// Start server
const PORT = process.env.PORT || 3000;
const HOST = process.env.RENDER ? "0.0.0.0" : process.env.HOST || "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log(`Prediction Market running at http://${HOST}:${PORT}`);
  console.log(`Student page:     http://${HOST}:${PORT}/`);
  console.log(`Instructor page:  http://${HOST}:${PORT}/instructor`);
});

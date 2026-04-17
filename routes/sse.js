const express = require("express");
const { requireInstructor } = require("../lib/auth");

const router = express.Router();

const studentClients = new Set();
const instructorClients = new Set();

// Student SSE endpoint
router.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(":\n\n"); // comment to establish connection

  studentClients.add(res);
  req.on("close", () => studentClients.delete(res));
});

// Instructor SSE endpoint
router.get("/api/instructor-events", requireInstructor, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(":\n\n");

  instructorClients.add(res);
  req.on("close", () => instructorClients.delete(res));
});

function broadcastStudents(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of studentClients) {
    client.write(msg);
  }
}

function broadcastInstructor(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of instructorClients) {
    client.write(msg);
  }
}

function broadcast(event, data) {
  broadcastStudents(event, data);
  broadcastInstructor(event, data);
}

module.exports = { router, broadcast, broadcastStudents, broadcastInstructor };

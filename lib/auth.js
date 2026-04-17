const crypto = require("crypto");

// In-memory session store
const sessions = new Map();

const DEV_PASSWORD = "stanford2026";

function getPassword() {
  if (process.env.INSTRUCTOR_PASSWORD) {
    return process.env.INSTRUCTOR_PASSWORD;
  }
  if (process.env.RENDER) {
    console.error(
      "FATAL: INSTRUCTOR_PASSWORD not set in production. Set the environment variable."
    );
    process.exit(1);
  }
  console.warn(
    `WARNING: Using default instructor password "${DEV_PASSWORD}". Set INSTRUCTOR_PASSWORD env var for production.`
  );
  return DEV_PASSWORD;
}

function login(password) {
  if (password !== getPassword()) return null;
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

function requireInstructor(req, res, next) {
  const token =
    req.cookies?.instructor_token || req.headers["x-instructor-token"];
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

module.exports = { login, requireInstructor, getPassword };

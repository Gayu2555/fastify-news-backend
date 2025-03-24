import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import path from "path";
import { fileURLToPath } from "url";
import fastifyAuth from "@fastify/auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Fastify instance
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    transport: {
      target: "pino-pretty",
      options: {
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
        colorize: true,
      },
    },
  },
});

// Register CORS plugin
fastify.register(fastifyCors, {
  origin: "*",
});

// Register WebSocket plugin
fastify.register(fastifyWebsocket, {
  options: { maxPayload: 1048576 },
});

// Register Auth plugin dengan konfigurasi yang benar
fastify.register(fastifyAuth);

// HAPUS registrasi verifyAdmin di sini
// Pindahkan ke middleware/index.js

export { fastify };

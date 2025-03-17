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

// Register Auth plugin
fastify.register(fastifyAuth);

// Dekorasi untuk verifikasi admin
fastify.decorate("verifyAdmin", async (request, reply) => {
  // Implementasikan logika verifikasi admin di sini
  // Contoh sederhana:
  if (!request.user || !request.user.isAdmin) {
    return reply.code(403).send({
      success: false,
      error: "Akses ditolak. Hanya admin yang diizinkan.",
    });
  }
});

export { fastify };

"use strict";

import dotenv from "dotenv";
// Load environment variables
dotenv.config();

import { fastify } from "./src/config/server.js";
import { db } from "./src/config/database.js";
import { setupScheduledTasks } from "./src/services/scheduledTasks.js";
import { registerRoutes } from "./src/routes/index.js";
import { registerMiddleware } from "./src/middleware/index.js";
import { models } from "./src/models/index.js";

// Server startup
async function startServer() {
  try {
    // Set up scheduled tasks
    setupScheduledTasks(fastify, models);

    // Start the server
    const port = process.env.PORT || 3000;
    const host = process.env.HOST || "0.0.0.0";

    await fastify.listen({ port, host });
    fastify.log.info(`Server is running on ${host}:${port}`);

    // Generate initial API key if none exists
    const keysCount = await db("api_keys").count("id as count").first();

    if (keysCount.count === 0) {
      fastify.log.info("No API keys found. Generating initial API key...");
      const newKey = await models.ApiKey.rotateKeys();
      fastify.log.info(`Initial API key generated: ${newKey.key}`);
      fastify.log.info(
        `IMPORTANT: Store this key securely as it won't be shown again!`
      );
    }
  } catch (err) {
    fastify.log.error(`Server startup failed: ${err.message}`);
    process.exit(1);
  }
}

// Start the server
startServer();

// Graceful shutdown
process.on("SIGTERM", async () => {
  fastify.log.info("SIGTERM received, shutting down gracefully");
  await fastify.close();
  await db.destroy();
  process.exit(0);
});

process.on("SIGINT", async () => {
  fastify.log.info("SIGINT received, shutting down gracefully");
  await fastify.close();
  await db.destroy();
  process.exit(0);
});

export { fastify };

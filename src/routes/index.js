import { registerCategoryRoutes } from "./categories.js";
import { registerArticleRoutes } from "./articles.js";
import { registerPositionRoutes } from "./positions.js";
import { registerAuthRoutes } from "./auth.js";
import { registerWebSocketRoutes } from "./websocket.js";
import { registerApiKeyRoutes } from "./apiKeys.js";

function registerRoutes(fastify) {
  registerCategoryRoutes(fastify);
  registerArticleRoutes(fastify);
  registerPositionRoutes(fastify);
  registerAuthRoutes(fastify);
  registerWebSocketRoutes(fastify);
  registerApiKeyRoutes(fastify);
}

export { registerRoutes };

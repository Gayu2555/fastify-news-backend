import { verifyApiKey } from "../middleware/apiKeyAuth.js";
import { models } from "../models/index.js";

function registerPositionRoutes(fastify) {
  // Article positions API
  fastify.get(
    "/api/positions/:position",
    { preHandler: verifyApiKey },
    async (request, reply) => {
      try {
        const { position } = request.params;
        const articles = await models.ArticlePosition.getByPosition(position);

        return { success: true, data: articles };
      } catch (err) {
        fastify.log.error(`Error fetching position articles: ${err.message}`);
        return reply
          .code(500)
          .send({ success: false, message: "Internal server error" });
      }
    }
  );
}

export { registerPositionRoutes };

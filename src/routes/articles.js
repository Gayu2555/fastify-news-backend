import { verifyApiKey } from "../middleware/apiKeyAuth.js";
import { models } from "../models/index.js";

function registerArticleRoutes(fastify) {
  // Articles API
  fastify.get(
    "/api/articles",
    { preHandler: verifyApiKey },
    async (request, reply) => {
      try {
        const articles = await models.Article.getAll(request.query);
        return { success: true, data: articles };
      } catch (err) {
        fastify.log.error(`Error fetching articles: ${err.message}`);
        return reply
          .code(500)
          .send({ success: false, message: "Internal server error" });
      }
    }
  );

  fastify.get(
    "/api/articles/:slug",
    { preHandler: verifyApiKey },
    async (request, reply) => {
      try {
        const { slug } = request.params;
        const article = await models.Article.findBySlug(slug);

        if (!article) {
          return reply
            .code(404)
            .send({ success: false, message: "Article not found" });
        }

        return { success: true, data: article };
      } catch (err) {
        fastify.log.error(`Error fetching article: ${err.message}`);
        return reply
          .code(500)
          .send({ success: false, message: "Internal server error" });
      }
    }
  );
}

export { registerArticleRoutes };

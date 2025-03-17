import { verifyApiKey } from "../middleware/apiKeyAuth.js";

import { models } from "../models/index.js";

function registerCategoryRoutes(fastify) {
  // Categories API
  fastify.get(
    "/api/categories",
    { preHandler: verifyApiKey },
    async (request, reply) => {
      try {
        const categories = await models.Category.getAll();
        return { success: true, data: categories };
      } catch (err) {
        fastify.log.error(`Error fetching categories: ${err.message}`);
        return reply
          .code(500)
          .send({ success: false, message: "Internal server error" });
      }
    }
  );

  fastify.get(
    "/api/categories/:slug",
    { preHandler: verifyApiKey },
    async (request, reply) => {
      try {
        const { slug } = request.params;
        const category = await models.Category.findBySlug(slug);

        if (!category) {
          return reply
            .code(404)
            .send({ success: false, message: "Category not found" });
        }

        return { success: true, data: category };
      } catch (err) {
        fastify.log.error(`Error fetching category: ${err.message}`);
        return reply
          .code(500)
          .send({ success: false, message: "Internal server error" });
      }
    }
  );
}

export { registerCategoryRoutes };

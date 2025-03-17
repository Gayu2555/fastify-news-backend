import { verifyApiKey } from "../middleware/apiKeyAuth.js";
import { models } from "../models/index.js";

function registerAuthRoutes(fastify) {
  // Auth API
  fastify.post(
    "/api/auth/login",
    { preHandler: verifyApiKey },
    async (request, reply) => {
      try {
        const { email, password } = request.body;
        const user = await models.User.authenticate(email, password);

        if (!user) {
          return reply
            .code(401)
            .send({ success: false, message: "Email atau password salah" });
        }

        const token = fastify.jwt.sign({ id: user.id, role: user.role });
        return { success: true, data: { user, token } };
      } catch (err) {
        fastify.log.error(`Error saat login: ${err.message}`);
        return reply
          .code(500)
          .send({ success: false, message: "Terjadi kesalahan pada server" });
      }
    }
  );

  fastify.post(
    "/api/auth/register",
    { preHandler: verifyApiKey },
    async (request, reply) => {
      try {
        const userData = request.body;
        const existingUser = await models.User.findByEmail(userData.email);

        if (existingUser) {
          return reply
            .code(409)
            .send({ success: false, message: "Email sudah terdaftar" });
        }

        const user = await models.User.create(userData);
        const token = fastify.jwt.sign({ id: user.id, role: user.role });

        return { success: true, data: { user, token } };
      } catch (err) {
        fastify.log.error(`Error saat registrasi: ${err.message}`);
        return reply
          .code(500)
          .send({ success: false, message: "Terjadi kesalahan pada server" });
      }
    }
  );
}

export { registerAuthRoutes };

import { requestLogger } from "./requestLogger.js";
import { securityMiddleware } from "./security.js";
import { verifyApiKey } from "./apiKeyAuth.js";
import { wsAuthMiddleware } from "./wsAuth.js";

// Hapus salah satu fungsi registerMiddleware
// Gunakan fungsi yang kedua yang lebih lengkap
async function registerMiddleware(fastify) {
  fastify.log.info("Middleware registration started");

  // Tambahkan hooks
  fastify.addHook("onRequest", requestLogger);
  fastify.addHook("onRequest", securityMiddleware);

  // Daftarkan decorator verifyAdmin tanpa menggunakan plugin auth
  if (!fastify.hasDecorator("verifyAdmin")) {
    fastify.log.info("Registering verifyAdmin decorator...");
    fastify.decorate("verifyAdmin", async function (request, reply) {
      try {
        const apiKeyAuth = await verifyApiKey(request, reply);
        if (!apiKeyAuth) return false;

        if (!request.user || !request.user.isAdmin) {
          reply.code(403).send({
            success: false,
            message: "Forbidden: Admin access required",
          });
          return false;
        }
        return true;
      } catch (err) {
        fastify.log.error(err);
        reply.code(500).send({
          success: false,
          message: "Internal server error during admin verification",
        });
        return false;
      }
    });
  }

  fastify.log.info("Middleware registration completed");
}

export { registerMiddleware, verifyApiKey, wsAuthMiddleware };

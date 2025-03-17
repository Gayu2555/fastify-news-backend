import { requestLogger } from "./requestLogger.js";
import { securityMiddleware } from "./security.js";
import { verifyApiKey } from "./apiKeyAuth.js";
import { wsAuthMiddleware } from "./wsAuth.js";
import fastifyAuth from "@fastify/auth";

async function registerMiddleware(fastify) {
  // Register fastify-auth plugin
  await fastify.register(fastifyAuth);

  // Register global hooks
  fastify.addHook("onRequest", requestLogger);
  fastify.addHook("onRequest", securityMiddleware);

  // Definisikan decorator untuk verifikasi admin jika belum ada
  // Jika sudah ada di file lain, pastikan tidak didefinisikan ulang
  if (!fastify.hasDecorator("verifyAdmin")) {
    fastify.decorate("verifyAdmin", async function (request, reply) {
      // Implementasi sesuai kebutuhan aplikasi Anda
      // Contoh sederhana, dapat disesuaikan
      try {
        // Gunakan verifyApiKey jika sudah ada
        const apiKeyAuth = await verifyApiKey(request, reply);
        if (!apiKeyAuth) return false;

        // Periksa apakah pengguna adalah admin
        // Logika ini perlu disesuaikan dengan struktur data Anda
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
}

export { registerMiddleware, verifyApiKey, wsAuthMiddleware };

// routes/apiKeys.js
// Implementasi rute untuk manajemen API Keys

/**
 * Mendaftarkan rute-rute terkait manajemen API Keys
 *
 * @param {Object} fastify - Instansi fastify
 * @param {Object} options - Opsi konfigurasi
 */
export async function registerApiKeyRoutes(fastify, options) {
  const { models, db, encryptionUtils } = fastify;

  // Mendapatkan semua API keys (khusus admin)
  fastify.route({
    method: "GET",
    url: "/api/keys",
    schema: {
      tags: ["api-keys"],
      summary: "Mendapatkan daftar API keys",
      description:
        "Endpoint untuk mendapatkan daftar semua API keys yang aktif",
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  is_active: { type: "boolean" },
                  created_at: { type: "string", format: "date-time" },
                  expires_at: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      },
    },
    preHandler: fastify.verifyAdmin,
    handler: async (request, reply) => {
      try {
        const keys = await db(models.ApiKey.tableName)
          .select("id", "name", "is_active", "created_at", "expires_at")
          .where("is_active", true)
          .orderBy("created_at", "desc");

        return { success: true, data: keys };
      } catch (err) {
        fastify.log.error(`Error mengambil API keys: ${err.message}`);
        return reply.code(500).send({
          success: false,
          error: "Gagal mengambil API keys",
        });
      }
    },
  });

  // Membuat API key baru
  fastify.route({
    method: "POST",
    url: "/api/keys",
    schema: {
      tags: ["api-keys"],
      summary: "Membuat API key baru",
      description: "Endpoint untuk membuat API key baru",
      body: {
        type: "object",
        required: ["name", "expires_in_days"],
        properties: {
          name: { type: "string", description: "Nama untuk API key" },
          expires_in_days: {
            type: "integer",
            description: "Masa berlaku key dalam hari",
          },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                id: { type: "string" },
                key: { type: "string" },
                name: { type: "string" },
                expires_at: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
    },
    preHandler: fastify.verifyAdmin,
    handler: async (request, reply) => {
      try {
        const { name, expires_in_days } = request.body;

        // Validasi input
        if (!name || name.trim() === "") {
          return reply.code(400).send({
            success: false,
            error: "Nama API key tidak boleh kosong",
          });
        }

        if (
          !Number.isInteger(expires_in_days) ||
          expires_in_days < 1 ||
          expires_in_days > 365
        ) {
          return reply.code(400).send({
            success: false,
            error: "Masa berlaku key harus antara 1-365 hari",
          });
        }

        // Generate API key baru dan simpan ke database
        const newKey = await models.ApiKey.createKey({
          name: name.trim(),
          expiresInDays: expires_in_days,
          createdBy: request.user ? request.user.id : null,
        });

        // Log aktivitas
        fastify.log.info(
          `API key baru dibuat: ${newKey.id} oleh ${
            request.user ? request.user.email : "system"
          }`
        );

        return reply.code(201).send({
          success: true,
          data: newKey,
        });
      } catch (err) {
        fastify.log.error(`Error membuat API key: ${err.message}`);
        return reply.code(500).send({
          success: false,
          error: "Gagal membuat API key",
        });
      }
    },
  });

  // Menonaktifkan/mencabut API key
  fastify.route({
    method: "DELETE",
    url: "/api/keys/:id",
    schema: {
      tags: ["api-keys"],
      summary: "Menonaktifkan API key",
      description: "Endpoint untuk menonaktifkan/mencabut API key",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "ID API key" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            message: { type: "string" },
          },
        },
      },
    },
    preHandler: fastify.verifyAdmin,
    handler: async (request, reply) => {
      try {
        const { id } = request.params;

        // Periksa apakah key ada
        const keyExists = await models.ApiKey.exists(id);

        if (!keyExists) {
          return reply.code(404).send({
            success: false,
            error: "API key tidak ditemukan",
          });
        }

        // Nonaktifkan key
        await models.ApiKey.revokeKey(
          id,
          request.user ? request.user.id : null
        );

        // Log aktivitas
        fastify.log.info(
          `API key dinonaktifkan: ${id} oleh ${
            request.user ? request.user.email : "system"
          }`
        );

        return {
          success: true,
          message: "API key berhasil dinonaktifkan",
        };
      } catch (err) {
        fastify.log.error(`Error menonaktifkan API key: ${err.message}`);
        return reply.code(500).send({
          success: false,
          error: "Gagal menonaktifkan API key",
        });
      }
    },
  });

  // Rotasi API key (menonaktifkan key lama dan membuat key baru dengan properti yang sama)
  fastify.route({
    method: "POST",
    url: "/api/keys/:id/rotate",
    schema: {
      tags: ["api-keys"],
      summary: "Rotasi API key",
      description:
        "Endpoint untuk memutar (rotasi) API key - menonaktifkan yang lama dan membuat yang baru",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "ID API key" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                id: { type: "string" },
                key: { type: "string" },
                name: { type: "string" },
                expires_at: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
    },
    preHandler: fastify.verifyAdmin,
    handler: async (request, reply) => {
      try {
        const { id } = request.params;

        // Periksa apakah key ada
        const keyExists = await models.ApiKey.exists(id);

        if (!keyExists) {
          return reply.code(404).send({
            success: false,
            error: "API key tidak ditemukan",
          });
        }

        // Rotasi key
        const newKey = await models.ApiKey.rotateKey(
          id,
          request.user ? request.user.id : null
        );

        // Log aktivitas
        fastify.log.info(
          `API key dirotasi: ${id} -> ${newKey.id} oleh ${
            request.user ? request.user.email : "system"
          }`
        );

        return {
          success: true,
          data: newKey,
        };
      } catch (err) {
        fastify.log.error(`Error rotasi API key: ${err.message}`);
        return reply.code(500).send({
          success: false,
          error: "Gagal melakukan rotasi API key",
        });
      }
    },
  });

  // Memeriksa validitas dan status API key
  fastify.route({
    method: "GET",
    url: "/api/keys/verify",
    schema: {
      tags: ["api-keys"],
      summary: "Verifikasi API key",
      description: "Endpoint untuk memverifikasi API key yang valid",
      querystring: {
        type: "object",
        required: ["key"],
        properties: {
          key: { type: "string", description: "API key untuk diverifikasi" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            valid: { type: "boolean" },
            expires_at: { type: "string", format: "date-time" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        const { key } = request.query;

        if (!key) {
          return reply.code(400).send({
            success: false,
            error: "API key tidak disediakan",
          });
        }

        // Verifikasi key
        const result = await models.ApiKey.verifyKey(key);

        return {
          success: true,
          valid: result.valid,
          expires_at: result.valid ? result.expires_at : null,
        };
      } catch (err) {
        fastify.log.error(`Error verifikasi API key: ${err.message}`);
        return reply.code(500).send({
          success: false,
          error: "Gagal memverifikasi API key",
        });
      }
    },
  });

  // Mendapatkan key yang aktif saat ini
  fastify.route({
    method: "GET",
    url: "/api/keys/current",
    schema: {
      tags: ["api-keys"],
      summary: "Mendapatkan API key yang aktif",
      description:
        "Endpoint untuk mendapatkan informasi tentang API key yang aktif saat ini",
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                expires_at: { type: "string", format: "date-time" },
                days_remaining: { type: "integer" },
              },
            },
          },
        },
      },
    },
    preHandler: fastify.verifyAdmin,
    handler: async (request, reply) => {
      try {
        // Dapatkan key aktif terbaru
        const currentKey = await models.ApiKey.getCurrentKey();

        if (!currentKey) {
          return reply.code(404).send({
            success: false,
            error: "Tidak ada API key aktif ditemukan",
          });
        }

        // Hitung sisa hari
        const today = new Date();
        const expiresAt = new Date(currentKey.expires_at);
        const daysRemaining = Math.ceil(
          (expiresAt - today) / (1000 * 60 * 60 * 24)
        );

        return {
          success: true,
          data: {
            id: currentKey.id,
            name: currentKey.name,
            expires_at: currentKey.expires_at,
            days_remaining: daysRemaining,
          },
        };
      } catch (err) {
        fastify.log.error(`Error mendapatkan API key aktif: ${err.message}`);
        return reply.code(500).send({
          success: false,
          error: "Gagal mendapatkan API key aktif",
        });
      }
    },
  });
}

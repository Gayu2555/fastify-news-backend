import crypto from "crypto";
import { fastify } from "../config/server.js";

/**
 * Middleware untuk autentikasi WebSocket
 * @param {Object} connection - Objek koneksi WebSocket
 * @param {Object} request - Objek request HTTP
 * @returns {Promise<boolean>} - Status autentikasi
 */
async function wsAuthMiddleware(fastify, connection, request) {
  try {
    const { socket } = connection;
    const apiKey = request.headers["x-api-key"];

    if (!apiKey) {
      fastify.log.warn(`Autentikasi WebSocket gagal: API key tidak ada`);
      socket.send(
        JSON.stringify({
          type: "error",
          message:
            "Autentikasi diperlukan. Silakan berikan API key yang valid.",
        })
      );
      socket.close();
      return false;
    }

    const validKey = await models.ApiKey.findValidKey(apiKey);

    if (!validKey) {
      fastify.log.warn(`Autentikasi WebSocket gagal: API key tidak valid`);
      socket.send(
        JSON.stringify({
          type: "error",
          message: "API key tidak valid. Koneksi ditolak.",
        })
      );
      socket.close();
      return false;
    }

    return true;
  } catch (err) {
    fastify.log.error(`Error autentikasi WebSocket: ${err.message}`);
    connection.socket.close();
    return false;
  }
}

/**
 * Kirim pesan terenkripsi ke klien
 * @param {Object} connection - Objek koneksi WebSocket
 * @param {Object} data - Data yang akan dikirim
 * @returns {boolean} - Status pengiriman
 */
function kirimPesanTerenkripsi(connection, data) {
  try {
    const encryptedData = encryptionUtils.encrypt(JSON.stringify(data));
    connection.socket.send(
      JSON.stringify({
        encrypted: true,
        data: encryptedData,
      })
    );
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Fungsi untuk mendapatkan API key aktif terbaru
 * @returns {Promise<Object|null>} - Objek API key atau null jika tidak ditemukan
 */
async function dapatkanApiKeyTerbaru() {
  try {
    // Dapatkan API key aktif terbaru
    const db =
      models.ApiKey.tableName._knex ||
      models.ApiKey.tableName.knex ||
      require("knex")();
    const apiKey = await db(models.ApiKey.tableName)
      .where({ is_active: true })
      .where("expires_at", ">", db.fn.now())
      .orderBy("created_at", "desc")
      .first();

    return apiKey;
  } catch (err) {
    return null;
  }
}

/**
 * Mendaftarkan rute-rute WebSocket
 * @param {Object} fastify - Instance Fastify
 */
export async function registerWebSocketRoutes(fastify) {
  fastify.register(async function (fastify) {
    // Rute WebSocket utama
    fastify.get("/ws", { websocket: true }, async (connection, request) => {
      try {
        // Autentikasi koneksi WebSocket
        const isAuthenticated = await wsAuthMiddleware(
          fastify,
          connection,
          request
        );
        if (!isAuthenticated) return;

        // Generate ID klien
        const clientId = crypto.randomBytes(16).toString("hex");

        // Simpan koneksi
        models.ClientConnection.addConnection(clientId, connection);

        // Kirim pesan selamat datang dengan ID klien (terenkripsi)
        const welcomeMessage = {
          type: "system",
          action: "connected",
          clientId: clientId,
          message: "Koneksi berhasil dibuat",
          timestamp: new Date().toISOString(),
        };

        kirimPesanTerenkripsi(connection, welcomeMessage);

        // Tangani pesan masuk
        connection.socket.on("message", async (message) => {
          try {
            const msgData = JSON.parse(message.toString());

            // Tangani pesan terenkripsi
            if (msgData.encrypted && msgData.data) {
              try {
                // Dekripsi pesan
                const decrypted = encryptionUtils.decrypt(msgData.data);
                const decryptedData = JSON.parse(decrypted);

                fastify.log.debug(
                  `Menerima pesan terenkripsi dari klien ${clientId}: ${decrypted}`
                );

                // Proses pesan yang telah didekripsi berdasarkan tipenya
                switch (decryptedData.type) {
                  case "ping":
                    // Kirim respons pong terenkripsi
                    const pongResponse = {
                      type: "pong",
                      timestamp: new Date().toISOString(),
                    };
                    kirimPesanTerenkripsi(connection, pongResponse);
                    break;

                  case "request_api_key":
                    // Tangani permintaan API key
                    await handleRequestApiKey(fastify, connection, clientId);
                    break;

                  case "subscribe":
                    // Tangani langganan ke topik/channel
                    break;

                  default:
                    // Tangani tipe pesan lain
                    break;
                }
              } catch (decryptErr) {
                fastify.log.error(
                  `Gagal mendekripsi pesan dari klien ${clientId}: ${decryptErr.message}`
                );
                connection.socket.send(
                  JSON.stringify({
                    type: "error",
                    message: "Gagal mendekripsi pesan",
                  })
                );
              }
            } else {
              // Tangani pesan tidak terenkripsi (bisa ditolak untuk keamanan)
              fastify.log.warn(
                `Menerima pesan tidak terenkripsi dari klien ${clientId}`
              );
              connection.socket.send(
                JSON.stringify({
                  type: "error",
                  message: "Semua pesan harus dienkripsi",
                })
              );
            }
          } catch (msgErr) {
            fastify.log.error(
              `Error memproses pesan WebSocket: ${msgErr.message}`
            );
          }
        });

        // Tangani penutupan koneksi
        connection.socket.on("close", () => {
          models.ClientConnection.removeConnection(clientId);
        });
      } catch (err) {
        fastify.log.error(`Error koneksi WebSocket: ${err.message}`);
        if (connection.socket.readyState === 1) {
          // 1 = OPEN
          connection.socket.close();
        }
      }
    });

    // Endpoint khusus untuk meminta API key
    fastify.get(
      "/ws/request-api-key",
      { websocket: true },
      async (connection, request) => {
        try {
          // Generate ID klien tanpa autentikasi (karena ini adalah endpoint untuk mendapatkan API key)
          const clientId = crypto.randomBytes(16).toString("hex");

          // Simpan koneksi secara sementara
          models.ClientConnection.addConnection(clientId, connection);

          // Kirim pesan selamat datang
          connection.socket.send(
            JSON.stringify({
              type: "system",
              action: "api_key_request_ready",
              message: "Siap menerima permintaan API key",
              timestamp: new Date().toISOString(),
            })
          );

          // Tangani pesan masuk
          connection.socket.on("message", async (message) => {
            try {
              const msgData = JSON.parse(message.toString());

              if (msgData.type === "request_api_key") {
                // Proses permintaan API key
                await handleRequestApiKey(fastify, connection, clientId);
              }
            } catch (msgErr) {
              fastify.log.error(
                `Error memproses permintaan API key: ${msgErr.message}`
              );
            }
          });

          // Tangani penutupan koneksi
          connection.socket.on("close", () => {
            models.ClientConnection.removeConnection(clientId);
          });
        } catch (err) {
          fastify.log.error(`Error koneksi API key WebSocket: ${err.message}`);
          if (connection.socket.readyState === 1) {
            connection.socket.close();
          }
        }
      }
    );
  });
}

/**
 * Menangani permintaan API key dari klien
 * @param {Object} fastify - Instance Fastify
 * @param {Object} connection - Objek koneksi WebSocket
 * @param {string} clientId - ID klien
 */
async function handleRequestApiKey(fastify, connection, clientId) {
  try {
    fastify.log.info(`Klien ${clientId} meminta API key`);

    // Dapatkan API key aktif terbaru
    const apiKey = await dapatkanApiKeyTerbaru();

    if (!apiKey) {
      fastify.log.warn(
        `Tidak ada API key aktif yang tersedia untuk klien ${clientId}`
      );
      connection.socket.send(
        JSON.stringify({
          type: "error",
          action: "api_key_response",
          message: "Tidak ada API key aktif yang tersedia",
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    // Kirim API key terenkripsi ke klien
    const apiKeyResponse = {
      type: "system",
      action: "api_key_response",
      key: apiKey.key,
      expires_at: apiKey.expires_at,
      timestamp: new Date().toISOString(),
    };

    kirimPesanTerenkripsi(connection, apiKeyResponse);

    fastify.log.info(`API key berhasil dikirim ke klien ${clientId}`);
  } catch (err) {
    fastify.log.error(`Error menangani permintaan API key: ${err.message}`);
    connection.socket.send(
      JSON.stringify({
        type: "error",
        action: "api_key_response",
        message: "Gagal mendapatkan API key",
        timestamp: new Date().toISOString(),
      })
    );
  }
}

/**
 * Broadcast pesan ke semua klien yang terhubung
 * @param {Object} message - Pesan yang akan di-broadcast
 * @returns {number} - Jumlah klien yang menerima pesan
 */
export function broadcastMessage(message) {
  return models.ClientConnection.broadcastMessage(message);
}

// Ekspor fungsi tambahan yang mungkin berguna
export default {
  registerWebSocketRoutes,
  broadcastMessage,
  kirimPesanTerenkripsi,
};

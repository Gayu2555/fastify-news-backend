import crypto from "crypto";
import { fastify } from "../config/server.js";

// Import models yang diperlukan
import { models } from "../models/index.js";
import * as encryptionUtils from "../config/encryption.js";

/**
 *
 * @param {Object} fastify
 * @param {Object} connection
 * @param {Object} request
 * @returns {Promise<boolean>}
 */
async function wsAuthMiddleware(fastify, connection, request) {
  try {
    // Periksa apakah connection dan socket ada
    if (!connection || !connection.socket) {
      fastify.log.warn(
        `Autentikasi WebSocket gagal: Objek koneksi tidak valid`
      );
      return false;
    }

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

    // Periksa apakah models.ApiKey tersedia
    if (
      !models ||
      !models.ApiKey ||
      typeof models.ApiKey.findValidKey !== "function"
    ) {
      fastify.log.error(
        `Autentikasi WebSocket gagal: Model ApiKey tidak tersedia`
      );
      socket.send(
        JSON.stringify({
          type: "error",
          message: "Kesalahan sistem. Silakan coba lagi nanti.",
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
    if (connection && connection.socket) {
      connection.socket.close();
    }
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
    // Periksa apakah encryptionUtils dan koneksi valid
    if (
      !encryptionUtils ||
      !encryptionUtils.encrypt ||
      !connection ||
      !connection.socket
    ) {
      console.error("Enkripsi gagal: modul enkripsi atau koneksi tidak valid");
      return false;
    }

    const encryptedData = encryptionUtils.encrypt(JSON.stringify(data));
    connection.socket.send(
      JSON.stringify({
        encrypted: true,
        data: encryptedData,
      })
    );
    return true;
  } catch (err) {
    console.error(`Error saat mengirim pesan terenkripsi: ${err.message}`);
    return false;
  }
}

/**
 * Fungsi untuk mendapatkan API key aktif terbaru
 * @returns {Promise<Object|null>} - Objek API key atau null jika tidak ditemukan
 */
async function dapatkanApiKeyTerbaru() {
  try {
    // Periksa apakah models.ApiKey tersedia
    if (!models || !models.ApiKey || !models.ApiKey.tableName) {
      console.error("Model ApiKey tidak tersedia");
      return null;
    }

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
    console.error(`Error saat mendapatkan API key terbaru: ${err.message}`);
    return null;
  }
}

/**
 * Mendaftarkan rute-rute WebSocket
 * @param {Object} fastify - Instance Fastify
 */
export async function registerWebSocketRoutes(fastify) {
  // Pastikan semua dependensi ada
  if (!models || !models.ClientConnection) {
    fastify.log.error(
      "Models ClientConnection tidak tersedia. WebSocket routes tidak dapat didaftarkan."
    );

    // Inisialisasi models.ClientConnection jika belum ada
    if (!models) {
      global.models = {}; // Inisialisasi models sebagai objek global jika tidak ada
    }

    // Buat implementasi sederhana jika belum ada
    models.ClientConnection = {
      connections: new Map(),
      addConnection: function (clientId, connection) {
        this.connections.set(clientId, connection);
        fastify.log.info(`Koneksi klien ${clientId} ditambahkan`);
      },
      removeConnection: function (clientId) {
        this.connections.delete(clientId);
        fastify.log.info(`Koneksi klien ${clientId} dihapus`);
      },
      broadcastMessage: function (message) {
        let count = 0;
        this.connections.forEach((conn) => {
          try {
            if (conn && conn.socket && conn.socket.readyState === 1) {
              conn.socket.send(JSON.stringify(message));
              count++;
            }
          } catch (err) {
            fastify.log.error(`Error saat broadcast: ${err.message}`);
          }
        });
        return count;
      },
    };
  }

  // Mendaftarkan satu plugin WebSocket dengan semua rute-rute WebSocket
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
        if (
          models &&
          models.ClientConnection &&
          typeof models.ClientConnection.addConnection === "function"
        ) {
          models.ClientConnection.addConnection(clientId, connection);
        } else {
          fastify.log.warn(
            "models.ClientConnection.addConnection tidak tersedia"
          );
        }

        // Kirim pesan selamat datang dengan ID klien (terenkripsi)
        const welcomeMessage = {
          type: "system",
          action: "connected",
          clientId: clientId,
          message: "Koneksi berhasil dibuat",
          timestamp: new Date().toISOString(),
        };

        if (encryptionUtils && encryptionUtils.encrypt) {
          kirimPesanTerenkripsi(connection, welcomeMessage);
        } else {
          // Fallback jika enkripsi tidak tersedia
          connection.socket.send(
            JSON.stringify({
              ...welcomeMessage,
              message: "Koneksi berhasil dibuat (tidak terenkripsi)",
            })
          );
        }

        // Tangani pesan masuk
        connection.socket.on("message", async (message) => {
          try {
            const msgData = JSON.parse(message.toString());

            // Tangani pesan terenkripsi
            if (
              msgData.encrypted &&
              msgData.data &&
              encryptionUtils &&
              encryptionUtils.decrypt
            ) {
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
                if (connection && connection.socket) {
                  connection.socket.send(
                    JSON.stringify({
                      type: "error",
                      message: "Gagal mendekripsi pesan",
                    })
                  );
                }
              }
            } else {
              // Tangani pesan tidak terenkripsi (bisa ditolak untuk keamanan)
              fastify.log.warn(
                `Menerima pesan tidak terenkripsi dari klien ${clientId}`
              );
              if (connection && connection.socket) {
                connection.socket.send(
                  JSON.stringify({
                    type: "error",
                    message: "Semua pesan harus dienkripsi",
                  })
                );
              }
            }
          } catch (msgErr) {
            fastify.log.error(
              `Error memproses pesan WebSocket: ${msgErr.message}`
            );
          }
        });

        // Tangani penutupan koneksi
        connection.socket.on("close", () => {
          if (
            models &&
            models.ClientConnection &&
            typeof models.ClientConnection.removeConnection === "function"
          ) {
            models.ClientConnection.removeConnection(clientId);
          }
        });
      } catch (err) {
        fastify.log.error(`Error koneksi WebSocket: ${err.message}`);
        if (
          connection &&
          connection.socket &&
          connection.socket.readyState === 1
        ) {
          connection.socket.close();
        }
      }
    });

    // Endpoint khusus untuk meminta API key (dengan path yang berbeda untuk menghindari konflik)
    fastify.get(
      "/api-key-ws", // Ubah dari "/ws/request-api-key" menjadi "/api-key-ws"
      { websocket: true },
      async (connection, request) => {
        try {
          // Generate ID klien tanpa autentikasi (karena ini adalah endpoint untuk mendapatkan API key)
          const clientId = crypto.randomBytes(16).toString("hex");

          // Simpan koneksi secara sementara
          if (
            models &&
            models.ClientConnection &&
            typeof models.ClientConnection.addConnection === "function"
          ) {
            models.ClientConnection.addConnection(clientId, connection);
          }

          // Kirim pesan selamat datang
          if (connection && connection.socket) {
            connection.socket.send(
              JSON.stringify({
                type: "system",
                action: "api_key_request_ready",
                message: "Siap menerima permintaan API key",
                timestamp: new Date().toISOString(),
              })
            );
          }

          // Tangani pesan masuk
          if (connection && connection.socket) {
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
              if (
                models &&
                models.ClientConnection &&
                typeof models.ClientConnection.removeConnection === "function"
              ) {
                models.ClientConnection.removeConnection(clientId);
              }
            });
          }
        } catch (err) {
          fastify.log.error(`Error koneksi API key WebSocket: ${err.message}`);
          if (
            connection &&
            connection.socket &&
            connection.socket.readyState === 1
          ) {
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
      if (connection && connection.socket) {
        connection.socket.send(
          JSON.stringify({
            type: "error",
            action: "api_key_response",
            message: "Tidak ada API key aktif yang tersedia",
            timestamp: new Date().toISOString(),
          })
        );
      }
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

    if (encryptionUtils && encryptionUtils.encrypt) {
      kirimPesanTerenkripsi(connection, apiKeyResponse);
    } else {
      // Fallback tanpa enkripsi (tidak direkomendasikan untuk produksi)
      if (connection && connection.socket) {
        connection.socket.send(
          JSON.stringify({
            type: "system",
            action: "api_key_response",
            message:
              "API key tidak dapat dikirim karena enkripsi tidak tersedia",
            timestamp: new Date().toISOString(),
          })
        );
      }
    }

    fastify.log.info(`API key berhasil dikirim ke klien ${clientId}`);
  } catch (err) {
    fastify.log.error(`Error menangani permintaan API key: ${err.message}`);
    if (connection && connection.socket) {
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
}

/**
 * Broadcast pesan ke semua klien yang terhubung
 * @param {Object} message - Pesan yang akan di-broadcast
 * @returns {number} - Jumlah klien yang menerima pesan
 */
export function broadcastMessage(message) {
  if (
    models &&
    models.ClientConnection &&
    typeof models.ClientConnection.broadcastMessage === "function"
  ) {
    return models.ClientConnection.broadcastMessage(message);
  }
  return 0;
}

// Ekspor fungsi tambahan yang mungkin berguna
export default {
  registerWebSocketRoutes,
  broadcastMessage,
  kirimPesanTerenkripsi,
};

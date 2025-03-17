// scheduledTask.js
// Implementasi tugas terjadwal untuk aplikasi

import nodeCron from "node-cron";
import crypto from "crypto";

/**
 * Fungsi untuk menginisialisasi dan mengatur tugas terjadwal
 *
 * @param {Object} fastify - Instansi fastify
 * @param {Object} models - Model database aplikasi
 * @param {Object} db - Koneksi database
 * @param {Object} encryptionUtils - Utilitas enkripsi/dekripsi
 */
function setupScheduledTasks(fastify, models, db, encryptionUtils) {
  fastify.log.info("Menginisialisasi tugas terjadwal...");

  // Rotasi API key setiap jam (terjadi pada awal jam)
  nodeCron.schedule("0 * * * *", async () => {
    await rotateApiKeys(fastify, models, db);
  });

  // Membersihkan API key kadaluarsa setiap 6 jam
  nodeCron.schedule("0 */6 * * *", async () => {
    await cleanupExpiredApiKeys(fastify, models, db);
  });

  // Backup database sederhana setiap minggu (Minggu pukul 01:00)
  nodeCron.schedule("0 1 * * 0", async () => {
    await performDatabaseBackup(fastify, db);
  });

  // Menghapus log lama setiap bulan (1st day at 02:00)
  nodeCron.schedule("0 2 1 * *", async () => {
    await cleanupOldLogs(fastify, db);
  });

  // Periksa status keamanan sistem setiap hari pukul 03:00
  nodeCron.schedule("0 3 * * *", async () => {
    await performSecurityCheck(fastify, models, db);
  });

  // Mengirim notifikasi sistem ke semua klien yang terhubung setiap 24 jam
  nodeCron.schedule("0 9 * * *", async () => {
    await sendSystemNotification(fastify, models, encryptionUtils);
  });

  fastify.log.info("Tugas terjadwal berhasil diinisialisasi");
}

/**
 * Fungsi untuk memutar API key
 *
 * @param {Object} fastify - Instansi fastify
 * @param {Object} models - Model database aplikasi
 * @param {Object} db - Koneksi database
 */
async function rotateApiKeys(fastify, models, db) {
  try {
    fastify.log.info("Memulai rotasi API key terjadwal");

    // Periksa koneksi database sebelum melanjutkan
    try {
      await db.raw("SELECT 1");
      fastify.log.debug("Koneksi database terverifikasi untuk rotasi API key");
    } catch (dbErr) {
      fastify.log.error(
        `Koneksi database gagal selama rotasi API key: ${dbErr.message}`
      );
      return;
    }

    const newKey = await models.ApiKey.rotateKeys();
    fastify.log.info(`Rotasi API key selesai. ID key baru: ${newKey.id}`);

    // Beritahu klien tentang rotasi key melalui WebSocket (opsional)
    models.ClientConnection.broadcastMessage({
      type: "system",
      action: "api_key_rotated",
      message: "API key telah dirotasi. Harap dapatkan key baru.",
      timestamp: new Date().toISOString(),
    });

    // Bersihkan key yang kadaluarsa
    await models.ApiKey.deleteExpiredKeys();
  } catch (err) {
    fastify.log.error(`Error selama rotasi API key: ${err.message}`);
  }
}

/**
 * Fungsi untuk membersihkan API key yang kadaluarsa
 *
 * @param {Object} fastify - Instansi fastify
 * @param {Object} models - Model database aplikasi
 * @param {Object} db - Koneksi database
 */
async function cleanupExpiredApiKeys(fastify, models, db) {
  try {
    fastify.log.info("Memulai pembersihan API key kadaluarsa");

    // Periksa koneksi database
    try {
      await db.raw("SELECT 1");
    } catch (dbErr) {
      fastify.log.error(
        `Koneksi database gagal selama pembersihan API key: ${dbErr.message}`
      );
      return;
    }

    const deleted = await models.ApiKey.deleteExpiredKeys();
    fastify.log.info(`Berhasil menghapus ${deleted} API key kadaluarsa`);
  } catch (err) {
    fastify.log.error(`Error membersihkan API key kadaluarsa: ${err.message}`);
  }
}

/**
 * Fungsi untuk melakukan backup database sederhana
 *
 * @param {Object} fastify - Instansi fastify
 * @param {Object} db - Koneksi database
 */
async function performDatabaseBackup(fastify, db) {
  try {
    fastify.log.info("Memulai backup database mingguan");

    // Periksa koneksi database
    try {
      await db.raw("SELECT 1");
    } catch (dbErr) {
      fastify.log.error(
        `Koneksi database gagal selama proses backup: ${dbErr.message}`
      );
      return;
    }

    // Contoh implementasi backup sederhana
    // Dalam produksi, gunakan tool backup database yang tepat (mysqldump, pg_dump, dll)
    const date = new Date().toISOString().split("T")[0];
    const timestamp = Math.floor(Date.now() / 1000);
    const backupFileName = `backup_${date}_${timestamp}.sql`;

    fastify.log.info(`Backup database berhasil dibuat: ${backupFileName}`);

    // Di sini bisa ditambahkan kode untuk menyimpan backup ke cloud storage
    // atau mengirim notifikasi email
  } catch (err) {
    fastify.log.error(`Error selama backup database: ${err.message}`);
  }
}

/**
 * Fungsi untuk membersihkan log lama
 *
 * @param {Object} fastify - Instansi fastify
 * @param {Object} db - Koneksi database
 */
async function cleanupOldLogs(fastify, db) {
  try {
    fastify.log.info("Memulai pembersihan log lama");

    // Tentukan tanggal cutoff (misalnya log lebih dari 3 bulan)
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 3);

    // Hapus log lama dari database jika ada tabel log
    try {
      // Periksa apakah tabel logs ada
      const hasLogsTable = await db.schema.hasTable("logs");
      if (hasLogsTable) {
        const deleted = await db("logs")
          .where("created_at", "<", cutoffDate)
          .delete();
        fastify.log.info(`Berhasil menghapus ${deleted} log lama`);
      } else {
        fastify.log.info(
          "Tabel logs tidak ditemukan, proses pembersihan dilewati"
        );
      }
    } catch (dbErr) {
      fastify.log.error(
        `Error database selama pembersihan log: ${dbErr.message}`
      );
    }
  } catch (err) {
    fastify.log.error(`Error selama pembersihan log: ${err.message}`);
  }
}

/**
 * Fungsi untuk memeriksa status keamanan sistem
 *
 * @param {Object} fastify - Instansi fastify
 * @param {Object} models - Model database aplikasi
 * @param {Object} db - Koneksi database
 */
async function performSecurityCheck(fastify, models, db) {
  try {
    fastify.log.info("Memulai pemeriksaan keamanan sistem");

    // Periksa API key yang sudah hampir kadaluarsa (kurang dari 3 hari)
    const warningDate = new Date();
    warningDate.setDate(warningDate.getDate() + 3);

    try {
      const expiringSoon = await db(models.ApiKey.tableName)
        .where("is_active", true)
        .whereBetween("expires_at", [new Date(), warningDate])
        .count("id as count")
        .first();

      if (expiringSoon.count > 0) {
        fastify.log.warn(
          `Perhatian: ${expiringSoon.count} API key akan kadaluarsa dalam 3 hari ke depan`
        );

        // Kirim notifikasi ke admin (misalnya via WebSocket)
        models.ClientConnection.broadcastMessage({
          type: "admin_alert",
          action: "security_check",
          message: `${expiringSoon.count} API key akan kadaluarsa dalam 3 hari ke depan`,
          timestamp: new Date().toISOString(),
        });
      }

      // Periksa login yang gagal (jika ada tabel untuk itu)
      const hasLoginAttemptsTable = await db.schema.hasTable("login_attempts");
      if (hasLoginAttemptsTable) {
        const recentTime = new Date();
        recentTime.setHours(recentTime.getHours() - 1);

        const recentFailedAttempts = await db("login_attempts")
          .where("success", false)
          .where("created_at", ">", recentTime)
          .count("id as count")
          .first();

        if (recentFailedAttempts.count > 10) {
          fastify.log.warn(
            `Perhatian: ${recentFailedAttempts.count} percobaan login gagal dalam 1 jam terakhir`
          );

          // Kirim notifikasi keamanan
          models.ClientConnection.broadcastMessage({
            type: "admin_alert",
            action: "security_check",
            message: `Kemungkinan serangan brute force: ${recentFailedAttempts.count} percobaan login gagal dalam 1 jam terakhir`,
            timestamp: new Date().toISOString(),
            level: "high",
          });
        }
      }
    } catch (dbErr) {
      fastify.log.error(
        `Error database selama pemeriksaan keamanan: ${dbErr.message}`
      );
    }

    fastify.log.info("Pemeriksaan keamanan sistem selesai");
  } catch (err) {
    fastify.log.error(`Error selama pemeriksaan keamanan: ${err.message}`);
  }
}

/**
 * Fungsi untuk mengirim notifikasi sistem ke semua klien
 *
 * @param {Object} fastify - Instansi fastify
 * @param {Object} models - Model database aplikasi
 * @param {Object} encryptionUtils - Utilitas enkripsi/dekripsi
 */
async function sendSystemNotification(fastify, models, encryptionUtils) {
  try {
    fastify.log.info("Mengirim notifikasi sistem harian ke klien");

    // Hitung jumlah koneksi aktif
    const activeConnections =
      models.ClientConnection.getAllConnections().length;

    // Buat pesan status sistem
    const statusMessage = {
      type: "system_status",
      message: "Status sistem: Normal",
      activeConnections: activeConnections,
      serverTime: new Date().toISOString(),
      serverUptime: process.uptime(),
    };

    // Broadcast ke semua klien
    const sentCount = models.ClientConnection.broadcastMessage({
      type: "system",
      action: "status_update",
      data: statusMessage,
      timestamp: new Date().toISOString(),
    });

    fastify.log.info(
      `Notifikasi sistem berhasil dikirim ke ${sentCount} klien`
    );
  } catch (err) {
    fastify.log.error(
      `Error selama pengiriman notifikasi sistem: ${err.message}`
    );
  }
}

export {
  setupScheduledTasks,
  rotateApiKeys,
  cleanupExpiredApiKeys,
  performDatabaseBackup,
  cleanupOldLogs,
  performSecurityCheck,
  sendSystemNotification,
};

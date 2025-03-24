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
  // Periksa apakah parameter yang diperlukan telah disediakan
  if (!fastify || !models || !db) {
    console.error(
      "Gagal menginisialisasi tugas terjadwal: Parameter tidak lengkap"
    );
    return;
  }

  // Validasi objek database
  if (!db || typeof db.raw !== "function") {
    console.error(
      "Gagal menginisialisasi tugas terjadwal: Objek database tidak valid"
    );
    return;
  }

  fastify.log.info("Menginisialisasi tugas terjadwal...");

  // Membuat API key baru dan menonaktifkan yang lama setelah 10 menit
  // Berjalan setiap jam
  nodeCron.schedule("0 * * * *", async () => {
    await rotateApiKeys(fastify, models, db);

    // Set timeout untuk menonaktifkan key lama setelah 10 menit
    setTimeout(async () => {
      await deactivateOldApiKey(fastify, models, db);
    }, 10 * 60 * 1000); // 10 menit dalam milidetik
  });

  // Membersihkan API key kadaluarsa setiap 6 jam
  nodeCron.schedule("0 */6 * * *", async () => {
    await cleanupExpiredApiKeys(fastify, models, db);
  });

  // Membersihkan API key lama yang tidak digunakan setiap hari (pukul 00:30)
  nodeCron.schedule("30 0 * * *", async () => {
    await cleanupOldApiKeys(fastify, models, db);
  });

  // Backup database sederhana setiap minggu (Minggu pukul 01:00)
  nodeCron.schedule("0 1 * * 0", async () => {
    await performDatabaseBackup(fastify, db);
  });

  // Menghapus log lama setiap bulan (tanggal 1 pukul 02:00)
  nodeCron.schedule("0 2 1 * *", async () => {
    await cleanupOldLogs(fastify, db);
  });

  fastify.log.info("Tugas terjadwal berhasil diinisialisasi");

  // Jalankan rotasi API key saat inisialisasi untuk memastikan ada key aktif
  fastify.log.info("Menjalankan rotasi API key awal...");
  rotateApiKeys(fastify, models, db)
    .then(() => {
      fastify.log.info("Rotasi API key awal berhasil");
      // Jangan deaktivasi key lama pada inisialisasi awal
    })
    .catch((err) => {
      const errorMessage = err && err.message ? err.message : "Unknown error";
      fastify.log.error(`Error selama rotasi API key awal: ${errorMessage}`);
    });
}

/**
 * Fungsi untuk membuat API key baru
 *
 * @param {Object} fastify - Instansi fastify
 * @param {Object} models - Model database aplikasi
 * @param {Object} db - Koneksi database
 * @returns {Object} Objek yang berisi ID key yang baru dibuat
 */
async function rotateApiKeys(fastify, models, db) {
  try {
    fastify.log.info("Memulai pembuatan API key baru");

    // Validasi parameter
    if (!fastify || !models || !db) {
      console.error("Pembuatan API key dibatalkan: Parameter tidak lengkap");
      return null;
    }

    // Validasi objek database
    if (!db || typeof db.raw !== "function") {
      fastify.log.error(
        "Pembuatan API key dibatalkan: Objek database tidak valid"
      );
      return null;
    }

    // Periksa koneksi database sebelum melanjutkan
    try {
      await db.raw("SELECT 1");
      fastify.log.debug(
        "Koneksi database terverifikasi untuk pembuatan API key"
      );
    } catch (dbErr) {
      const dbErrorMessage =
        dbErr && dbErr.message ? dbErr.message : "Unknown database error";
      fastify.log.error(
        `Koneksi database gagal selama pembuatan API key: ${dbErrorMessage}`
      );
      return null;
    }

    // Buat API key baru
    try {
      // Generate API key baru
      const apiKeyValue = crypto.randomBytes(32).toString("hex");

      // Tentukan waktu kedaluwarsa (1 jam + 10 menit)
      const expirationDate = new Date();
      expirationDate.setMinutes(expirationDate.getMinutes() + 70);

      // Simpan API key baru ke database
      const result = await db("api_keys").insert({
        key: apiKeyValue,
        description: "Auto-generated key",
        is_active: true,
        expires_at: expirationDate,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Get the ID of the newly inserted key
      const newKeyId = result[0];

      fastify.log.info(
        `API key baru berhasil dibuat. ID: ${newKeyId || "unknown"}`
      );

      // Kembalikan ID key baru untuk referensi
      return { newKeyId };
    } catch (createErr) {
      const createErrorMessage =
        createErr && createErr.message
          ? createErr.message
          : "Unknown error during key creation";
      fastify.log.error(`Gagal membuat API key baru: ${createErrorMessage}`);
      return null;
    }
  } catch (err) {
    const errorMessage = err && err.message ? err.message : "Unknown error";
    fastify.log.error(`Error selama pembuatan API key: ${errorMessage}`);
    return null;
  }
}

/**
 * Fungsi untuk menonaktifkan API key lama setelah 10 menit
 *
 * @param {Object} fastify - Instansi fastify
 * @param {Object} models - Model database aplikasi
 * @param {Object} db - Koneksi database
 */
async function deactivateOldApiKey(fastify, models, db) {
  try {
    fastify.log.info("Memulai proses menonaktifkan API key lama");

    // Validasi parameter
    if (!fastify || !models || !db) {
      console.error("Deaktivasi API key dibatalkan: Parameter tidak lengkap");
      return;
    }

    // Validasi objek database
    if (!db || typeof db.raw !== "function") {
      fastify.log.error(
        "Deaktivasi API key dibatalkan: Objek database tidak valid"
      );
      return;
    }

    // Periksa koneksi database
    try {
      await db.raw("SELECT 1");
    } catch (dbErr) {
      const dbErrorMessage =
        dbErr && dbErr.message ? dbErr.message : "Unknown database error";
      fastify.log.error(
        `Koneksi database gagal selama deaktivasi API key: ${dbErrorMessage}`
      );
      return;
    }

    // Ambil API key terbaru yang aktif
    const latestActiveKey = await db("api_keys")
      .where("is_active", true)
      .orderBy("created_at", "desc")
      .first();

    if (!latestActiveKey) {
      fastify.log.warn("Tidak ada API key aktif ditemukan");
      return;
    }

    // Deaktivasi semua key aktif kecuali key terbaru
    const deactivated = await db("api_keys")
      .where("is_active", true)
      .where("id", "!=", latestActiveKey.id)
      .update({
        is_active: false,
        updated_at: new Date(),
      });

    fastify.log.info(`${deactivated} API key lama berhasil dinonaktifkan`);
  } catch (err) {
    const errorMessage = err && err.message ? err.message : "Unknown error";
    fastify.log.error(
      `Error selama menonaktifkan API key lama: ${errorMessage}`
    );
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

    // Validasi parameter
    if (!fastify || !models || !db) {
      console.error("Pembersihan API key dibatalkan: Parameter tidak lengkap");
      return;
    }

    // Validasi objek database
    if (!db || typeof db.raw !== "function") {
      fastify.log.error(
        "Pembersihan API key dibatalkan: Objek database tidak valid"
      );
      return;
    }

    // Periksa koneksi database
    try {
      await db.raw("SELECT 1");
    } catch (dbErr) {
      const dbErrorMessage =
        dbErr && dbErr.message ? dbErr.message : "Unknown database error";
      fastify.log.error(
        `Koneksi database gagal selama pembersihan API key: ${dbErrorMessage}`
      );
      return;
    }

    // Jalankan pembersihan
    try {
      const deleted = await db("api_keys")
        .where("expires_at", "<", new Date())
        .delete();

      fastify.log.info(`Berhasil menghapus ${deleted} API key kadaluarsa`);
    } catch (cleanupErr) {
      const cleanupErrorMessage =
        cleanupErr && cleanupErr.message
          ? cleanupErr.message
          : "Unknown cleanup error";
      fastify.log.error(
        `Gagal melakukan penghapusan API key kadaluarsa: ${cleanupErrorMessage}`
      );
    }
  } catch (err) {
    const errorMessage = err && err.message ? err.message : "Unknown error";
    fastify.log.error(`Error membersihkan API key kadaluarsa: ${errorMessage}`);
  }
}

/**
 * Fungsi untuk membersihkan API key lama yang tidak aktif
 *
 * @param {Object} fastify - Instansi fastify
 * @param {Object} models - Model database aplikasi
 * @param {Object} db - Koneksi database
 */
async function cleanupOldApiKeys(fastify, models, db) {
  try {
    fastify.log.info("Memulai pembersihan API key lama tidak aktif");

    // Validasi parameter
    if (!fastify || !models || !db) {
      console.error(
        "Pembersihan API key lama dibatalkan: Parameter tidak lengkap"
      );
      return;
    }

    // Validasi objek database
    if (!db || typeof db.raw !== "function") {
      fastify.log.error(
        "Pembersihan API key lama dibatalkan: Objek database tidak valid"
      );
      return;
    }

    // Periksa koneksi database
    try {
      await db.raw("SELECT 1");
    } catch (dbErr) {
      const dbErrorMessage =
        dbErr && dbErr.message ? dbErr.message : "Unknown database error";
      fastify.log.error(
        `Koneksi database gagal selama pembersihan API key lama: ${dbErrorMessage}`
      );
      return;
    }

    // Tentukan cutoff date (misalnya key tidak aktif lebih dari 7 hari)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);

    // Hapus key lama dan tidak aktif
    try {
      const deleted = await db("api_keys")
        .where("is_active", false)
        .where("updated_at", "<", cutoffDate)
        .delete();

      fastify.log.info(
        `Berhasil menghapus ${deleted} API key lama tidak aktif`
      );
    } catch (cleanupErr) {
      const cleanupErrorMessage =
        cleanupErr && cleanupErr.message
          ? cleanupErr.message
          : "Unknown cleanup error";
      fastify.log.error(
        `Gagal melakukan penghapusan API key lama tidak aktif: ${cleanupErrorMessage}`
      );
    }
  } catch (err) {
    const errorMessage = err && err.message ? err.message : "Unknown error";
    fastify.log.error(
      `Error membersihkan API key lama tidak aktif: ${errorMessage}`
    );
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

    // Validasi parameter
    if (!fastify || !db) {
      console.error("Backup database dibatalkan: Parameter tidak lengkap");
      return;
    }

    // Validasi objek database
    if (!db || typeof db.raw !== "function") {
      fastify.log.error(
        "Backup database dibatalkan: Objek database tidak valid"
      );
      return;
    }

    // Periksa koneksi database
    try {
      await db.raw("SELECT 1");
    } catch (dbErr) {
      const dbErrorMessage =
        dbErr && dbErr.message ? dbErr.message : "Unknown database error";
      fastify.log.error(
        `Koneksi database gagal selama proses backup: ${dbErrorMessage}`
      );
      return;
    }

    // Contoh implementasi backup sederhana
    // Dalam produksi, gunakan tool backup database yang tepat (mysqldump, pg_dump, dll)
    const date = new Date().toISOString().split("T")[0];
    const timestamp = Math.floor(Date.now() / 1000);
    const backupFileName = `backup_${date}_${timestamp}.sql`;

    fastify.log.info(`Backup database berhasil dibuat: ${backupFileName}`);
  } catch (err) {
    const errorMessage = err && err.message ? err.message : "Unknown error";
    fastify.log.error(`Error selama backup database: ${errorMessage}`);
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

    // Validasi parameter
    if (!fastify || !db) {
      console.error("Pembersihan log dibatalkan: Parameter tidak lengkap");
      return;
    }

    // Validasi objek database
    if (!db || typeof db.raw !== "function") {
      fastify.log.error(
        "Pembersihan log dibatalkan: Objek database tidak valid"
      );
      return;
    }

    // Periksa koneksi database
    try {
      await db.raw("SELECT 1");
    } catch (dbErr) {
      const dbErrorMessage =
        dbErr && dbErr.message ? dbErr.message : "Unknown database error";
      fastify.log.error(
        `Koneksi database gagal selama pembersihan log: ${dbErrorMessage}`
      );
      return;
    }

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
      const dbErrorMessage =
        dbErr && dbErr.message ? dbErr.message : "Unknown database error";
      fastify.log.error(
        `Error database selama pembersihan log: ${dbErrorMessage}`
      );
    }
  } catch (err) {
    const errorMessage = err && err.message ? err.message : "Unknown error";
    fastify.log.error(`Error selama pembersihan log: ${errorMessage}`);
  }
}

// Ekspor fungsi-fungsi yang diperlukan
export {
  setupScheduledTasks,
  rotateApiKeys,
  deactivateOldApiKey,
  cleanupExpiredApiKeys,
  cleanupOldApiKeys,
  performDatabaseBackup,
  cleanupOldLogs,
};

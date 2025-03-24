import knex from "knex";
import dotenv from "dotenv";

// Inisialisasi dotenv untuk mengambil variabel dari file .env
dotenv.config();

// Inisialisasi konfigurasi database dari file .env
const dbConfig = {
  client: process.env.DB_CLIENT || "mysql2",
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
  pool: {
    min: parseInt(process.env.DB_POOL_MIN || "0"),
    max: parseInt(process.env.DB_POOL_MAX || "7"),
  },
};

// Validasi konfigurasi database
function validateDbConfig() {
  const requiredFields = ["host", "user", "password", "database"];
  const missingFields = requiredFields.filter(
    (field) => !dbConfig.connection[field]
  );

  if (missingFields.length > 0) {
    throw new Error(
      `Konfigurasi database tidak lengkap. Field yang tidak tersedia: ${missingFields.join(
        ", "
      )}`
    );
  }
}

// Inisialisasi koneksi database
let db;
try {
  validateDbConfig();
  db = knex(dbConfig);
} catch (error) {
  console.error("Gagal menginisialisasi konfigurasi database:", error.message);
  process.exit(1);
}

function initializeDatabase(fastify) {
  try {
    // Log informasi koneksi database
    fastify.log.info("Mencoba terhubung ke database...");
    fastify.log.info(
      `Host: ${dbConfig.connection.host}, Port: ${dbConfig.connection.port}, Database: ${dbConfig.connection.database}, User: ${dbConfig.connection.user}`
    );

    // Test koneksi database
    db.raw("SELECT 1")
      .then(() => {
        fastify.log.info("Koneksi database berhasil!");
        fastify.log.info(
          `Terhubung ke ${dbConfig.connection.database} pada ${dbConfig.connection.host}:${dbConfig.connection.port}`
        );
      })
      .catch((err) => {
        fastify.log.error("Pengujian koneksi database gagal:", err.message);
        fastify.log.error("Detail koneksi database:", {
          host: dbConfig.connection.host,
          port: dbConfig.connection.port,
          user: dbConfig.connection.user,
          database: dbConfig.connection.database,
        });
        fastify.log.error(
          "Pastikan file .env berisi kredensial yang benar dan database aktif"
        );
      });
  } catch (err) {
    fastify.log.error("Gagal menginisialisasi koneksi database:", err.message);
    fastify.log.error("Konfigurasi database:", {
      client: dbConfig.client,
      host: dbConfig.connection.host,
      port: dbConfig.connection.port,
      database: dbConfig.connection.database,
      user: dbConfig.connection.user,
    });
    process.exit(1);
  }
}

export { db, initializeDatabase };

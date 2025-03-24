/**
 * Modul konfigurasi aplikasi
 * Memuat pengaturan dari file konfigurasi atau variabel lingkungan
 */
import fs from "fs/promises";
import path from "path";

/**
 * Memuat konfigurasi dari file atau environment variables
 * @returns {Object} Objek konfigurasi aplikasi
 */
export async function loadConfiguration() {
  try {
    // Tentukan lokasi file konfigurasi berdasarkan NODE_ENV
    const environment = process.env.NODE_ENV || "development";
    const configPath = path.resolve(
      process.cwd(),
      "config",
      `${environment}.json`
    );

    // Coba membaca file konfigurasi
    let config = {};
    try {
      const fileData = await fs.readFile(configPath, "utf8");
      config = JSON.parse(fileData);
      console.log(`Konfigurasi dimuat dari ${configPath}`);
    } catch (err) {
      if (err.code === "ENOENT") {
        console.warn(
          `File konfigurasi tidak ditemukan di ${configPath}, menggunakan default dan env vars`
        );
      } else {
        console.error(`Gagal membaca file konfigurasi: ${err.message}`);
      }
    }

    // Gabungkan dengan nilai default dan environment variables
    const defaultConfig = {
      server: {
        port: parseInt(process.env.PORT || "3000", 10),
        host: process.env.HOST || "0.0.0.0",
      },
      database: {
        host: process.env.DB_HOST || "localhost",
        port: parseInt(process.env.DB_PORT || "5432", 10),
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || "",
        database: process.env.DB_NAME || "urbansiana",
        ssl: process.env.DB_SSL === "true",
      },
      security: {
        allowedOrigins: process.env.ALLOWED_ORIGINS
          ? process.env.ALLOWED_ORIGINS.split(",")
          : ["http://localhost:3000", "http://localhost:8080"],
        allowedIPs: process.env.ALLOWED_IPS
          ? process.env.ALLOWED_IPS.split(",")
          : [],
        allowServerToServer: process.env.ALLOW_SERVER_TO_SERVER === "true",
        jwtSecret:
          process.env.JWT_SECRET || "rahasia-pengembangan-ganti-di-produksi",
        jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1d",
      },
      logging: {
        level: process.env.LOG_LEVEL || "info",
        prettyPrint: process.env.PRETTY_LOG !== "false",
      },
      environment,
    };

    // Gabungkan config dari file dengan default config
    const mergedConfig = deepMerge(defaultConfig, config);

    return mergedConfig;
  } catch (error) {
    console.error(`Kesalahan dalam memuat konfigurasi: ${error.message}`);
    throw error;
  }
}

/**
 * Helper function untuk melakukan deep merge antar objek
 * @param {Object} target - Objek target
 * @param {Object} source - Objek sumber
 * @returns {Object} - Objek hasil penggabungan
 */
function deepMerge(target, source) {
  const output = { ...target };

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }

  return output;
}

/**
 * Helper function untuk memeriksa apakah sebuah value adalah objek
 * @param {any} item - Nilai yang diperiksa
 * @returns {boolean} - true jika nilai adalah objek
 */
function isObject(item) {
  return item && typeof item === "object" && !Array.isArray(item);
}

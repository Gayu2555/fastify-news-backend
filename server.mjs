import dotenv from "dotenv";
import Fastify from "fastify";
import mysql from "mysql2/promise";
import FastifyRateLimit from "@fastify/rate-limit";
import FastifyCors from "@fastify/cors";
import FastifyJWT from "@fastify/jwt";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import crypto from "crypto";

// Mendapatkan path direktori untuk modul saat ini
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Memuat variabel lingkungan dengan path eksplisit
dotenv.config({ path: join(__dirname, ".env") });

// Log debug untuk memeriksa variabel lingkungan
console.log("Variabel lingkungan dimuat:");
console.log("DB_HOST:", process.env.DB_HOST || "Tidak diatur");
console.log("DB_USER:", process.env.DB_USER || "Tidak diatur");
console.log(
  "DB_PASSWORD:",
  process.env.DB_PASSWORD ? "Diatur (tersembunyi)" : "Tidak diatur"
);
console.log("DB_NAME:", process.env.DB_NAME || "Tidak diatur");

const fastify = Fastify({ logger: true });

// Fungsi untuk menghasilkan token acak
function generateRandomToken(length = 64) {
  return crypto.randomBytes(length).toString("hex");
}

// Fungsi untuk menghasilkan API Key acak
function generateApiKey(length = 32) {
  return crypto.randomBytes(length).toString("base64").replace(/[+/=]/g, "");
}

// Fungsi untuk mengatur tanggal kedaluwarsa (default 24 jam)
function getExpiryDate(hours = 24) {
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date;
}

async function startServer() {
  try {
    // Konfigurasi koneksi database
    const dbConfig = {
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "all_articles",
      port: parseInt(process.env.DB_PORT || "3306"),
    };

    console.log("Menghubungkan ke database dengan konfigurasi:", {
      ...dbConfig,
      password: dbConfig.password
        ? "[PASSWORD DIATUR]"
        : "[TIDAK ADA PASSWORD]",
    });

    // Koneksi ke Database
    const db = await mysql.createConnection(dbConfig);
    console.log("Koneksi database berhasil!");

    // Memeriksa dan menghasilkan API Key jika belum ada
    let apiKey;
    try {
      const [apiKeyRow] = await db.execute(
        "SELECT * FROM system_settings WHERE setting_key = 'api_key'"
      );

      if (apiKeyRow.length === 0) {
        // Jika tidak ada API Key, buat yang baru
        apiKey = generateApiKey();
        await db.execute(
          "INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)",
          ["api_key", apiKey]
        );
        console.log("API Key baru dibuat dan disimpan ke database");
      } else {
        apiKey = apiKeyRow[0].setting_value;
        console.log("API Key yang sudah ada dimuat dari database");
      }
    } catch (error) {
      console.error("Kesalahan saat mengakses tabel system_settings:", error);

      // Jika tabel tidak ada, coba buat tabelnya
      try {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS system_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            setting_key VARCHAR(50) NOT NULL UNIQUE,
            setting_value TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          )
        `);

        // Buat API Key baru dan simpan
        apiKey = generateApiKey();
        await db.execute(
          "INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)",
          ["api_key", apiKey]
        );
        console.log("Tabel system_settings dibuat dan API Key baru disimpan");
      } catch (createError) {
        console.error("Gagal membuat tabel system_settings:", createError);
        apiKey = process.env.API_KEY || generateApiKey();
        console.log(
          "Menggunakan API Key dari variabel lingkungan atau yang dibuat secara runtime"
        );
      }
    }

    // Mendaftarkan Plugin JWT
    const jwtSecret =
      process.env.JWT_SECRET || "urbansiana_jwt_secret_key_development_only";
    fastify.register(FastifyJWT, {
      secret: jwtSecret,
      sign: {
        expiresIn: "1d", // Token berlaku selama 1 hari
      },
    });

    // Mendaftarkan Plugin Rate Limit
    fastify.register(FastifyRateLimit, {
      max: parseInt(process.env.RATE_LIMIT_MAX || "100"),
      timeWindow: process.env.RATE_LIMIT_WINDOW || "1 minute",
      errorResponseBuilder: () => {
        return { error: "Terlalu banyak request, coba lagi nanti" };
      },
    });

    // Mendaftarkan Plugin CORS
    fastify.register(FastifyCors, {
      origin: process.env.CORS_ORIGIN || "https://urbansiana.id",
      methods: ["GET", "POST"],
      credentials: true,
    });

    // Middleware untuk verifikasi token JWT
    fastify.decorate("authenticate", async (request, reply) => {
      try {
        await request.jwtVerify();

        // Periksa apakah token masih valid di database
        const [tokenRows] = await db.execute(
          "SELECT * FROM user_tokens WHERE token = ? AND expires_at > NOW()",
          [request.headers.authorization.replace("Bearer ", "")]
        );

        if (tokenRows.length === 0) {
          throw new Error("Token tidak valid atau sudah kedaluwarsa");
        }

        // Tambahkan informasi token ke request
        request.userToken = tokenRows[0];
      } catch (err) {
        reply.status(401).send({ error: "Tidak terautentikasi" });
      }
    });

    // Middleware API Key
    fastify.addHook("onRequest", async (request, reply) => {
      // Lewati pengecekan API key pada rute root dan auth
      if (
        request.routerPath === "/" ||
        request.routerPath.startsWith("/auth")
      ) {
        return;
      }

      const requestApiKey = request.headers["x-api-key"];

      if (!apiKey || !requestApiKey || requestApiKey !== apiKey) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: API Key Tidak Valid" });
      }
    });

    // === Rute Root (/) ===
    fastify.get("/", async (request, reply) => {
      return reply.send({
        message: "API Urbansiana berjalan dengan baik",
        status: "online",
        version: "1.0.0",
        documentation:
          "Gunakan endpoint /categories atau /articles untuk mengakses data",
      });
    });

    // === Pengelolaan Token ===

    // Fungsi untuk membuat dan menyimpan token baru
    async function createAndSaveToken(userId, expiryHours = 24) {
      const token = fastify.jwt.sign({
        id: userId,
        timestamp: Date.now(), // Tambahkan timestamp untuk memastikan token selalu unik
      });

      const expiryDate = getExpiryDate(expiryHours);

      // Simpan token ke database
      await db.execute(
        "INSERT INTO user_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
        [userId, token, expiryDate]
      );

      return {
        token,
        expires_at: expiryDate,
      };
    }

    // Fungsi untuk membersihkan token yang sudah tidak valid
    async function cleanupExpiredTokens() {
      try {
        const [result] = await db.execute(
          "DELETE FROM user_tokens WHERE expires_at < NOW()"
        );
        console.log(
          `${result.affectedRows} token kedaluwarsa telah dibersihkan`
        );
      } catch (error) {
        console.error("Gagal membersihkan token kedaluwarsa:", error);
      }
    }

    // Jadwalkan pembersihan token secara berkala (setiap jam)
    setInterval(cleanupExpiredTokens, 60 * 60 * 1000);

    // Panggil pembersihan saat server mulai
    cleanupExpiredTokens();

    // === API untuk Kategori ===

    // **1. API Mendapatkan Semua Kategori**
    fastify.get("/categories", async (request, reply) => {
      try {
        const [rows] = await db.execute(
          "SELECT * FROM categories ORDER BY name ASC"
        );
        return reply.send({ data: rows });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Gagal mengambil kategori" });
      }
    });

    // **2. API Mendapatkan Kategori Berdasarkan ID**
    fastify.get("/categories/:id", async (request, reply) => {
      try {
        const { id } = request.params;
        const [rows] = await db.execute(
          "SELECT * FROM categories WHERE id = ?",
          [id]
        );

        if (rows.length === 0) {
          return reply.status(404).send({ error: "Kategori tidak ditemukan" });
        }

        return reply.send({ data: rows[0] });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Gagal mengambil kategori" });
      }
    });

    // **3. API Mendapatkan Artikel Berdasarkan Kategori**
    fastify.get("/categories/:id/articles", async (request, reply) => {
      try {
        const { id } = request.params;
        const [categoryResult] = await db.execute(
          "SELECT * FROM categories WHERE id = ?",
          [id]
        );

        if (categoryResult.length === 0) {
          return reply.status(404).send({ error: "Kategori tidak ditemukan" });
        }

        const [rows] = await db.execute(
          "SELECT a.* FROM articles a WHERE a.category_id = ? ORDER BY a.date_published DESC",
          [id]
        );

        return reply.send({
          category: categoryResult[0],
          data: rows,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Gagal mengambil artikel" });
      }
    });

    // === API untuk Artikel ===

    // **4. API Mendapatkan Semua Artikel**
    fastify.get("/articles", async (request, reply) => {
      try {
        const [rows] = await db.execute(
          `SELECT a.*, c.name as category_name 
           FROM articles a 
           JOIN categories c ON a.category_id = c.id 
           ORDER BY a.date_published DESC`
        );
        return reply.send({ data: rows });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Gagal mengambil artikel" });
      }
    });

    // **5. API Mendapatkan Artikel Berdasarkan ID**
    fastify.get("/articles/:id", async (request, reply) => {
      try {
        const { id } = request.params;
        const [rows] = await db.execute(
          `SELECT a.*, c.name as category_name 
           FROM articles a 
           JOIN categories c ON a.category_id = c.id 
           WHERE a.id = ?`,
          [id]
        );

        if (rows.length === 0) {
          return reply.status(404).send({ error: "Artikel tidak ditemukan" });
        }

        return reply.send({ data: rows[0] });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Gagal mengambil artikel" });
      }
    });

    // **6. API Mendapatkan Artikel Berdasarkan Slug**
    fastify.get("/articles/slug/:slug", async (request, reply) => {
      try {
        const { slug } = request.params;
        const [rows] = await db.execute(
          `SELECT a.*, c.name as category_name 
           FROM articles a 
           JOIN categories c ON a.category_id = c.id 
           WHERE a.slug = ?`,
          [slug]
        );

        if (rows.length === 0) {
          return reply.status(404).send({ error: "Artikel tidak ditemukan" });
        }

        return reply.send({ data: rows[0] });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Gagal mengambil artikel" });
      }
    });

    // **7. API Mendapatkan Artikel Berdasarkan Posisi**
    fastify.get("/positions/:position", async (request, reply) => {
      try {
        const { position } = request.params;

        // Validasi posisi
        const validPositions = ["news_list", "sub_headline", "headline"];
        if (!validPositions.includes(position)) {
          return reply.status(400).send({
            error:
              "Posisi tidak valid. Gunakan: news_list, sub_headline, atau headline",
          });
        }

        const [rows] = await db.execute(
          `SELECT a.*, c.name as category_name 
           FROM articles a 
           JOIN categories c ON a.category_id = c.id 
           JOIN article_positions ap ON a.id = ap.article_id 
           WHERE ap.position = ? 
           ORDER BY a.date_published DESC`,
          [position]
        );

        return reply.send({ data: rows });
      } catch (error) {
        fastify.log.error(error);
        return reply
          .status(500)
          .send({ error: "Gagal mengambil artikel berdasarkan posisi" });
      }
    });

    // **8. API Mendapatkan Artikel Berdasarkan Kategori dan Posisi**
    fastify.get(
      "/categories/:categoryId/positions/:position",
      async (request, reply) => {
        try {
          const { categoryId, position } = request.params;

          // Validasi posisi
          const validPositions = ["news_list", "sub_headline", "headline"];
          if (!validPositions.includes(position)) {
            return reply.status(400).send({
              error:
                "Posisi tidak valid. Gunakan: news_list, sub_headline, atau headline",
            });
          }

          const [rows] = await db.execute(
            `SELECT a.*, c.name as category_name 
             FROM articles a 
             JOIN categories c ON a.category_id = c.id 
             JOIN article_positions ap ON a.id = ap.article_id 
             WHERE ap.position = ? AND ap.category_id = ? 
             ORDER BY a.date_published DESC`,
            [position, categoryId]
          );

          return reply.send({ data: rows });
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({
            error: "Gagal mengambil artikel berdasarkan kategori dan posisi",
          });
        }
      }
    );

    // **9. API Mendapatkan Artikel Terbaru**
    fastify.get("/articles/latest", async (request, reply) => {
      try {
        const limit = parseInt(request.query.limit || "10");

        const [rows] = await db.execute(
          `SELECT a.*, c.name as category_name 
           FROM articles a 
           JOIN categories c ON a.category_id = c.id 
           ORDER BY a.date_published DESC
           LIMIT ?`,
          [limit]
        );

        return reply.send({ data: rows });
      } catch (error) {
        fastify.log.error(error);
        return reply
          .status(500)
          .send({ error: "Gagal mengambil artikel terbaru" });
      }
    });

    // **10. API Mencari Artikel**
    fastify.get("/articles/search", async (request, reply) => {
      try {
        const { query } = request.query;

        if (!query || query.trim() === "") {
          return reply
            .status(400)
            .send({ error: "Parameter query pencarian diperlukan" });
        }

        const searchTerm = `%${query}%`;

        const [rows] = await db.execute(
          `SELECT a.*, c.name as category_name 
           FROM articles a 
           JOIN categories c ON a.category_id = c.id 
           WHERE a.title LIKE ? OR a.content LIKE ? OR a.description LIKE ?
           ORDER BY a.date_published DESC`,
          [searchTerm, searchTerm, searchTerm]
        );

        return reply.send({ data: rows });
      } catch (error) {
        fastify.log.error(error);
        return reply
          .status(500)
          .send({ error: "Gagal melakukan pencarian artikel" });
      }
    });

    // **11. API Mendapatkan Artikel Terkait**
    fastify.get("/articles/:id/related", async (request, reply) => {
      try {
        const { id } = request.params;
        const limit = parseInt(request.query.limit || "5");

        // Pertama, dapatkan data artikel yang diminta
        const [article] = await db.execute(
          "SELECT * FROM articles WHERE id = ?",
          [id]
        );

        if (article.length === 0) {
          return reply.status(404).send({ error: "Artikel tidak ditemukan" });
        }

        // Mendapatkan artikel dari kategori yang sama, kecuali artikel itu sendiri
        const [rows] = await db.execute(
          `SELECT a.*, c.name as category_name 
           FROM articles a 
           JOIN categories c ON a.category_id = c.id 
           WHERE a.category_id = ? AND a.id != ? 
           ORDER BY a.date_published DESC
           LIMIT ?`,
          [article[0].category_id, id, limit]
        );

        return reply.send({ data: rows });
      } catch (error) {
        fastify.log.error(error);
        return reply
          .status(500)
          .send({ error: "Gagal mengambil artikel terkait" });
      }
    });

    // === API untuk Autentikasi dan Manajemen Token ===

    // API Login (untuk mendapatkan token)
    fastify.post("/auth/login", async (request, reply) => {
      try {
        const { username, password } = request.body;

        if (!username || !password) {
          return reply
            .status(400)
            .send({ error: "Username dan password diperlukan" });
        }

        // Cari pengguna di database
        const [users] = await db.execute(
          "SELECT * FROM users WHERE username = ?",
          [username]
        );

        if (users.length === 0) {
          return reply
            .status(401)
            .send({ error: "Username atau password tidak valid" });
        }

        const user = users[0];

        // Verifikasi password (dalam kasus nyata gunakan bcrypt atau library serupa)
        // Contoh sederhana, asumsi password di database sudah di-hash
        if (user.password !== password) {
          // Di aplikasi sesungguhnya gunakan bcrypt.compare()
          return reply
            .status(401)
            .send({ error: "Username atau password tidak valid" });
        }

        // Hapus token lama untuk user ini jika sudah ada banyak
        await db.execute(
          "DELETE FROM user_tokens WHERE user_id = ? AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)",
          [user.id]
        );

        // Buat token baru dan simpan ke database
        const tokenData = await createAndSaveToken(user.id);

        return reply.send({
          success: true,
          token: tokenData.token,
          expires_at: tokenData.expires_at,
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
          },
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: "Gagal melakukan login" });
      }
    });

    // API Perbarui Token
    fastify.post(
      "/auth/refresh-token",
      { preHandler: fastify.authenticate },
      async (request, reply) => {
        try {
          const userId = request.user.id;
          const currentToken = request.headers.authorization.replace(
            "Bearer ",
            ""
          );

          // Hapus token saat ini dari database
          await db.execute("DELETE FROM user_tokens WHERE token = ?", [
            currentToken,
          ]);

          // Buat token baru
          const tokenData = await createAndSaveToken(userId);

          return reply.send({
            success: true,
            token: tokenData.token,
            expires_at: tokenData.expires_at,
          });
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: "Gagal memperbarui token" });
        }
      }
    );

    // API Logout (invalidate token)
    fastify.post(
      "/auth/logout",
      { preHandler: fastify.authenticate },
      async (request, reply) => {
        try {
          const currentToken = request.headers.authorization.replace(
            "Bearer ",
            ""
          );

          // Hapus token dari database
          await db.execute("DELETE FROM user_tokens WHERE token = ?", [
            currentToken,
          ]);

          return reply.send({
            success: true,
            message: "Berhasil logout",
          });
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: "Gagal melakukan logout" });
        }
      }
    );

    // API Verifikasi Token
    fastify.get("/auth/verify", async (request, reply) => {
      try {
        const token = request.headers.authorization?.replace("Bearer ", "");

        if (!token) {
          return reply.status(400).send({
            valid: false,
            error: "Token tidak disediakan",
          });
        }

        try {
          // Verifikasi token JWT
          const decoded = fastify.jwt.verify(token);

          // Periksa apakah token ada di database dan masih berlaku
          const [tokenRows] = await db.execute(
            "SELECT * FROM user_tokens WHERE token = ? AND expires_at > NOW()",
            [token]
          );

          if (tokenRows.length === 0) {
            return reply.send({
              valid: false,
              error: "Token tidak valid atau sudah kedaluwarsa",
            });
          }

          // Dapatkan info user
          const [userRows] = await db.execute(
            "SELECT id, username, role FROM users WHERE id = ?",
            [decoded.id]
          );

          if (userRows.length === 0) {
            return reply.send({
              valid: false,
              error: "Pengguna tidak ditemukan",
            });
          }

          return reply.send({
            valid: true,
            user: userRows[0],
            expires_at: tokenRows[0].expires_at,
          });
        } catch (error) {
          return reply.send({
            valid: false,
            error: "Token tidak valid",
          });
        }
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          valid: false,
          error: "Gagal memverifikasi token",
        });
      }
    });

    // API Mendapatkan API Key (hanya untuk admin)
    fastify.get(
      "/auth/api-key",
      { preHandler: fastify.authenticate },
      async (request, reply) => {
        try {
          // Verifikasi role admin
          if (request.user.role !== "admin") {
            return reply
              .status(403)
              .send({ error: "Akses ditolak: Hanya admin yang diizinkan" });
          }

          return reply.send({
            api_key: apiKey,
          });
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: "Gagal mendapatkan API Key" });
        }
      }
    );

    // API Regenerasi API Key (hanya untuk admin)
    fastify.post(
      "/auth/regenerate-api-key",
      { preHandler: fastify.authenticate },
      async (request, reply) => {
        try {
          // Verifikasi role admin
          if (request.user.role !== "admin") {
            return reply
              .status(403)
              .send({ error: "Akses ditolak: Hanya admin yang diizinkan" });
          }

          // Generate API Key baru
          const newApiKey = generateApiKey();

          // Simpan ke database
          await db.execute(
            "UPDATE system_settings SET setting_value = ? WHERE setting_key = 'api_key'",
            [newApiKey]
          );

          // Update variabel lokal
          apiKey = newApiKey;

          return reply.send({
            success: true,
            message: "API Key berhasil diperbarui",
            api_key: newApiKey,
          });
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: "Gagal memperbarui API Key" });
        }
      }
    );

    // === Rute Dashboard (Memerlukan Authentication) ===

    // Middleware untuk rute dashboard
    const dashboardAuth = async (request, reply) => {
      try {
        await request.jwtVerify();

        // Validasi apakah pengguna memiliki peran admin
        if (request.user.role !== "admin") {
          return reply
            .status(403)
            .send({ error: "Akses ditolak: Hanya admin yang diizinkan" });
        }

        // Verifikasi token di database
        const token = request.headers.authorization.replace("Bearer ", "");
        const [tokenRows] = await db.execute(
          "SELECT * FROM user_tokens WHERE token = ? AND expires_at > NOW()",
          [token]
        );

        if (tokenRows.length === 0) {
          return reply.status(401).send({
            error: "Token tidak valid atau sudah kedaluwarsa",
            token_expired: true,
          });
        }
      } catch (err) {
        return reply.status(401).send({ error: "Tidak terautentikasi" });
      }
    };

    // Dashboard Statistics
    fastify.get(
      "/dashboard/stats",
      { preHandler: dashboardAuth },
      async (request, reply) => {
        try {
          // Hitung total artikel
          const [totalArticles] = await db.execute(
            "SELECT COUNT(*) as total FROM articles"
          );

          // Hitung total kategori
          const [totalCategories] = await db.execute(
            "SELECT COUNT(*) as total FROM categories"
          );

          // Artikel per kategori
          const [articlesByCategory] = await db.execute(`
          SELECT c.name, COUNT(a.id) as count 
          FROM categories c 
          LEFT JOIN articles a ON c.id = a.category_id 
          GROUP BY c.id 
          ORDER BY count DESC
        `);

          // Artikel terbaru
          const [latestArticles] = await db.execute(`
          SELECT a.id, a.title, a.date_published, c.name as category_name
          FROM articles a
          JOIN categories c ON a.category_id = c.id
          ORDER BY a.date_published DESC
          LIMIT 5
        `);

          return reply.send({
            totalArticles: totalArticles[0].total,
            totalCategories: totalCategories[0].total,
            articlesByCategory,
            latestArticles,
          });
        } catch (error) {
          fastify.log.error(error);
          return reply
            .status(500)
            .send({ error: "Gagal mengambil statistik dashboard" });
        }
      }
    );

    // API untuk mengelola token aktif (hanya admin)
    fastify.get(
      "/dashboard/active-tokens",
      { preHandler: dashboardAuth },
      async (request, reply) => {
        try {
          const [tokens] = await db.execute(`
            SELECT ut.id, ut.user_id, ut.created_at, ut.expires_at, u.username 
            FROM user_tokens ut
            JOIN users u ON ut.user_id = u.id
            WHERE ut.expires_at > NOW()
            ORDER BY ut.created_at DESC
          `);

          return reply.send({ data: tokens });
        } catch (error) {
          fastify.log.error(error);
          return reply
            .status(500)
            .send({ error: "Gagal mengambil data token aktif" });
        }
      }
    );

    // API untuk menghapus token (hanya admin)
    fastify.delete(
      "/dashboard/tokens/:id",
      { preHandler: dashboardAuth },
      async (request, reply) => {
        try {
          const { id } = request.params;

          const [result] = await db.execute(
            "DELETE FROM user_tokens WHERE id = ?",
            [id]
          );

          if (result.affectedRows === 0) {
            return reply.status(404).send({ error: "Token tidak ditemukan" });
          }

          return reply.send({
            success: true,
            message: "Token berhasil dihapus",
          });
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: "Gagal menghapus token" });
        }
      }
    );

    // === Penanganan Kesalahan ===

    // Penanganan Error
    fastify.setErrorHandler((error, request, reply) => {
      // Log error dan kirim respon yang sesuai
      fastify.log.error(error);

      // Jika error validasi
      if (error.validation) {
        return reply
          .status(400)
          .send({ error: "Validasi gagal", details: error.validation });
      }

      // Jika error JWT
      if (
        error.code === "FST_JWT_NO_AUTHORIZATION_IN_HEADER" ||
        error.code === "FST_JWT_AUTHORIZATION_TOKEN_EXPIRED" ||
        error.code === "FST_JWT_AUTHORIZATION_TOKEN_INVALID"
      ) {
        return reply
          .status(401)
          .send({ error: "Tidak terautentikasi", token_expired: true });
      }

      // Untuk error lainnya
      return reply
        .status(500)
        .send({ error: "Terjadi kesalahan internal server" });
    });

    // Tentukan port dan host
    const port = process.env.PORT || 3000;
    const host = process.env.HOST || "0.0.0.0";

    // Mulai server
    await fastify.listen({ port, host });
    console.log(`Server berjalan di ${host}:${port}`);
  } catch (err) {
    console.error("Error saat memulai server:", err);
    process.exit(1);
  }
}

// Memulai server
startServer();

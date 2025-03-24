// File: index.js
import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import knex from "knex";

// Load environment variables
dotenv.config();

// Inisialisasi Fastify
const fastify = Fastify({
  logger: true,
});

// Ambil konfigurasi dari environment variables
const config = {
  DB_HOST: process.env.DB_HOST || "localhost",
  DB_PORT: parseInt(process.env.DB_PORT || "3306"),
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_NAME: process.env.DB_NAME,
  PORT: parseInt(process.env.PORT || "3000"),
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "http://localhost:3000",
};

// Pastikan semua konfigurasi yang diperlukan tersedia
const requiredConfigs = [
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "ALLOWED_ORIGINS",
];
for (const requiredConfig of requiredConfigs) {
  if (!process.env[requiredConfig]) {
    console.error(
      `Error: Konfigurasi ${requiredConfig} tidak ditemukan di file .env`
    );
    process.exit(1);
  }
}

// Konfigurasi CORS
fastify.register(cors, {
  origin: config.ALLOWED_ORIGINS.split(","),
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
});

// Inisialisasi Knex
const db = knex({
  client: "mysql2",
  connection: {
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
  },
  pool: {
    min: 0,
    max: 10,
  },
});

// Dekorasi fastify dengan objek knex
fastify.decorate("db", db);

// ===== ROUTES KATEGORI =====

// Mendapatkan semua kategori
fastify.get("/api/categories", async (request, reply) => {
  try {
    const categories = await fastify.db
      .select("*")
      .from("categories")
      .orderBy("name");

    return { categories };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: "Terjadi kesalahan pada database" });
  }
});

// Mendapatkan kategori berdasarkan ID
fastify.get("/api/categories/:id", async (request, reply) => {
  try {
    const category = await fastify.db
      .select("*")
      .from("categories")
      .where("id", request.params.id)
      .first();

    if (!category) {
      return reply.code(404).send({ error: "Kategori tidak ditemukan" });
    }

    return { category };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: "Terjadi kesalahan pada database" });
  }
});

// Mendapatkan kategori berdasarkan slug
fastify.get("/api/categories/slug/:slug", async (request, reply) => {
  try {
    const category = await fastify.db
      .select("*")
      .from("categories")
      .where("slug", request.params.slug)
      .first();

    if (!category) {
      return reply.code(404).send({ error: "Kategori tidak ditemukan" });
    }

    return { category };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: "Terjadi kesalahan pada database" });
  }
});

// ===== ROUTES ARTIKEL =====

// Mendapatkan semua artikel dengan pagination
fastify.get("/api/articles", async (request, reply) => {
  const page = parseInt(request.query.page) || 1;
  const perPage = parseInt(request.query.perPage) || 10;
  const offset = (page - 1) * perPage;

  try {
    // Mendapatkan artikel dengan informasi kategori
    const articles = await fastify.db
      .select("a.*", "c.name as category_name", "c.slug as category_slug")
      .from("articles as a")
      .join("categories as c", "a.category_id", "c.id")
      .orderBy("a.date_published", "desc")
      .limit(perPage)
      .offset(offset);

    // Mendapatkan total jumlah untuk pagination
    const countResult = await fastify
      .db("articles")
      .count("* as total")
      .first();

    const total = countResult.total;
    const totalPages = Math.ceil(total / perPage);

    return {
      articles,
      pagination: {
        total,
        perPage,
        currentPage: page,
        totalPages,
      },
    };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: "Terjadi kesalahan pada database" });
  }
});

// Mendapatkan artikel berdasarkan ID
fastify.get("/api/articles/:id", async (request, reply) => {
  try {
    const article = await fastify.db
      .select("a.*", "c.name as category_name", "c.slug as category_slug")
      .from("articles as a")
      .join("categories as c", "a.category_id", "c.id")
      .where("a.id", request.params.id)
      .first();

    if (!article) {
      return reply.code(404).send({ error: "Artikel tidak ditemukan" });
    }

    return { article };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: "Terjadi kesalahan pada database" });
  }
});

// Mendapatkan artikel berdasarkan slug
fastify.get("/api/articles/slug/:slug", async (request, reply) => {
  try {
    const article = await fastify.db
      .select("a.*", "c.name as category_name", "c.slug as category_slug")
      .from("articles as a")
      .join("categories as c", "a.category_id", "c.id")
      .where("a.slug", request.params.slug)
      .first();

    if (!article) {
      return reply.code(404).send({ error: "Artikel tidak ditemukan" });
    }

    return { article };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: "Terjadi kesalahan pada database" });
  }
});

// Mendapatkan artikel berdasarkan kategori ID
fastify.get("/api/categories/:categoryId/articles", async (request, reply) => {
  const page = parseInt(request.query.page) || 1;
  const perPage = parseInt(request.query.perPage) || 10;
  const offset = (page - 1) * perPage;

  try {
    // Verifikasi kategori ada
    const categoryExists = await fastify.db
      .select("id")
      .from("categories")
      .where("id", request.params.categoryId)
      .first();

    if (!categoryExists) {
      return reply.code(404).send({ error: "Kategori tidak ditemukan" });
    }

    // Mendapatkan artikel
    const articles = await fastify.db
      .select("a.*", "c.name as category_name", "c.slug as category_slug")
      .from("articles as a")
      .join("categories as c", "a.category_id", "c.id")
      .where("a.category_id", request.params.categoryId)
      .orderBy("a.date_published", "desc")
      .limit(perPage)
      .offset(offset);

    // Mendapatkan total jumlah untuk pagination
    const countResult = await fastify
      .db("articles")
      .count("* as total")
      .where("category_id", request.params.categoryId)
      .first();

    const total = countResult.total;
    const totalPages = Math.ceil(total / perPage);

    return {
      articles,
      pagination: {
        total,
        perPage,
        currentPage: page,
        totalPages,
      },
    };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: "Terjadi kesalahan pada database" });
  }
});

// ===== ROUTES POSISI ARTIKEL =====

// Mendapatkan artikel berdasarkan posisi (headline, sub_headline, news_list)
fastify.get("/api/positions/:position", async (request, reply) => {
  const validPositions = ["headline", "sub_headline", "news_list"];
  const position = request.params.position;

  if (!validPositions.includes(position)) {
    return reply.code(400).send({
      error: "Posisi tidak valid",
      message: `Posisi harus salah satu dari: ${validPositions.join(", ")}`,
    });
  }

  try {
    const articles = await fastify.db
      .select("a.*", "c.name as category_name", "c.slug as category_slug")
      .from("articles as a")
      .join("categories as c", "a.category_id", "c.id")
      .join("article_positions as ap", "a.id", "ap.article_id")
      .where("ap.position", position)
      .orderBy("a.date_published", "desc");

    return { articles };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: "Terjadi kesalahan pada database" });
  }
});

// Mendapatkan artikel berdasarkan posisi untuk kategori tertentu
fastify.get(
  "/api/categories/:categoryId/positions/:position",
  async (request, reply) => {
    const validPositions = ["headline", "sub_headline", "news_list"];
    const position = request.params.position;

    if (!validPositions.includes(position)) {
      return reply.code(400).send({
        error: "Posisi tidak valid",
        message: `Posisi harus salah satu dari: ${validPositions.join(", ")}`,
      });
    }

    try {
      // Verifikasi kategori ada
      const categoryExists = await fastify.db
        .select("id")
        .from("categories")
        .where("id", request.params.categoryId)
        .first();

      if (!categoryExists) {
        return reply.code(404).send({ error: "Kategori tidak ditemukan" });
      }

      const articles = await fastify.db
        .select("a.*", "c.name as category_name", "c.slug as category_slug")
        .from("articles as a")
        .join("categories as c", "a.category_id", "c.id")
        .join("article_positions as ap", "a.id", "ap.article_id")
        .where({
          "ap.category_id": request.params.categoryId,
          "ap.position": position,
        })
        .orderBy("a.date_published", "desc");

      return { articles };
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: "Terjadi kesalahan pada database" });
    }
  }
);

// Route utama
fastify.get("/", async (request, reply) => {
  return { status: "ok", message: "API Berita sedang berjalan" };
});

// Hook untuk menutup koneksi database saat server dimatikan
fastify.addHook("onClose", (instance, done) => {
  if (instance.db) {
    instance.db.destroy(() => {
      console.log("Koneksi database ditutup");
      done();
    });
  } else {
    done();
  }
});

// Memulai server
const start = async () => {
  try {
    await fastify.listen({ port: config.PORT, host: "0.0.0.0" });
    console.log(`Server berjalan pada port ${config.PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import knex from "knex";
import ipaddr from "ipaddr.js";

// Muat variabel lingkungan
dotenv.config();

// Tentukan mode pengembangan
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";

// Rentang IP CloudFlare yang diizinkan
const RENTANG_IP_CLOUDFLARE = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

// Daftar IP lokal yang diizinkan (diperluas)
const IP_LOKAL_DIIZINKAN = [
  "127.0.0.1", // localhost IPv4
  "::1", // localhost IPv6
  "localhost",
  "0.0.0.0",
  "192.168.0.0/16", // Rentang IP lokal privat
  "10.0.0.0/8", // Rentang IP lokal lain
  "172.16.0.0/12", // Rentang IP lokal lain
];

// Inisialisasi Fastify
const fastify = Fastify({
  logger: {
    level: "info",
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
      },
    },
  },
});

// Fungsi untuk memeriksa apakah IP berada di rentang CloudFlare atau IP lokal
function adalahIPCloudFlare(ip) {
  // Bersihkan IP dari awalan ::ffff:
  const ipBersih = ip.replace(/^::ffff:/, "");

  // Jika dalam mode pengembangan, izinkan IP lokal
  if (IS_DEVELOPMENT) {
    const apakahIPLokal = IP_LOKAL_DIIZINKAN.some((rentang) => {
      try {
        // Untuk IP tunggal atau hostname
        if (
          rentang === ipBersih ||
          rentang === "localhost" ||
          ipBersih.includes("localhost")
        ) {
          return true;
        }

        // Untuk rentang CIDR
        if (rentang.includes("/")) {
          const rentangParsed = ipaddr.parseCIDR(rentang);
          const ipParsed = ipaddr.parse(ipBersih);
          return rentangParsed[0].match(ipParsed, rentangParsed[1]);
        }

        return false;
      } catch (error) {
        fastify.log.warn(`Kesalahan saat memeriksa IP lokal: ${error.message}`);
        return false;
      }
    });

    if (apakahIPLokal) {
      fastify.log.info(`Mengizinkan akses dari IP lokal: ${ipBersih}`);
      return true;
    }
  }

  // Periksa IP CloudFlare untuk mode produksi
  return RENTANG_IP_CLOUDFLARE.some((rentang) => {
    try {
      // Untuk IP tunggal
      if (rentang.includes(".") && rentang === ipBersih) {
        return true;
      }

      // Untuk rentang CIDR
      if (rentang.includes("/")) {
        const rentangParsed = ipaddr.parseCIDR(rentang);
        const ipParsed = ipaddr.parse(ipBersih);
        return rentangParsed[0].match(ipParsed, rentangParsed[1]);
      }

      return false;
    } catch (error) {
      fastify.log.error(
        `Kesalahan saat memeriksa IP CloudFlare: ${error.message}`
      );
      return false;
    }
  });
}

// Ambil konfigurasi dari variabel lingkungan
const config = {
  DB_HOST: process.env.DB_HOST || "localhost",
  DB_PORT: parseInt(process.env.DB_PORT || "3306"),
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_NAME: process.env.DB_NAME,
  PORT: parseInt(process.env.PORT || "3000"),
  DOMAIN_DIIZINKAN: process.env.DOMAIN_DIIZINKAN || "",
  CORS_ORIGIN: process.env.CORS_ORIGIN || "",
};

// Konfigurasi CORS yang lebih aman
fastify.register(cors, {
  origin: (origin, cb) => {
    if (!origin) {
      return cb(null, true);
    }

    try {
      const url = new URL(origin);
      const daftarDomain = config.DOMAIN_DIIZINKAN.split(",")
        .map((domain) => domain.trim())
        .filter((domain) => domain);

      // Tambahkan wildcard untuk localhost, IP lokal, dan subdomain
      const apakahDomainDiizinkan =
        daftarDomain.length === 0 ||
        daftarDomain.some(
          (domain) =>
            url.hostname.endsWith(
              domain.replace("https://", "").replace("http://", "")
            ) ||
            url.hostname === "localhost" ||
            url.hostname.startsWith("localhost") ||
            url.hostname.startsWith("192.168.") ||
            url.hostname.startsWith("127.0.0.")
        );

      const apakahOriginSesuai =
        !config.CORS_ORIGIN || origin === config.CORS_ORIGIN;

      cb(null, apakahDomainDiizinkan && apakahOriginSesuai);
    } catch (err) {
      fastify.log.error(`Kesalahan saat memvalidasi origin: ${err.message}`);
      cb(new Error("Origin tidak valid"), false);
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
  origin: true,
  exposedHeaders: ["Content-Range", "X-Content-Range"],
  allowedHeaders: ["Content-Type", "Authorization"],
});
// Tambahkan hook untuk pemeriksaan IP setelah CORS
fastify.addHook("onRequest", (request, reply, done) => {
  // Ekstrak IP dengan metode yang lebih komprehensif
  const ip =
    request.socket.remoteAddress ||
    request.headers["x-forwarded-for"]?.split(",")[0] ||
    request.connection.remoteAddress ||
    "unknown";

  if (!ip || ip === "unknown") {
    fastify.log.warn("Tidak dapat mendeteksi alamat IP");

    // Dalam mode pengembangan, izinkan akses
    if (IS_DEVELOPMENT) {
      fastify.log.info("Mode pengembangan: Mengizinkan akses");
      return done();
    }

    return done(new Error("Alamat IP tidak dapat dideteksi"));
  }

  // Bersihkan IP dari awalan ::ffff:
  const ipBersih = ip.replace(/^::ffff:/, "");

  // Dalam mode pengembangan, izinkan semua IP lokal
  if (IS_DEVELOPMENT || adalahIPCloudFlare(ipBersih)) {
    fastify.log.info(
      `Mode pengembangan/CloudFlare: Mengizinkan akses dari IP ${ipBersih}`
    );
    return done();
  }

  // Jika tidak memenuhi syarat
  fastify.log.warn(`Permintaan ditolak dari IP: ${ipBersih}`);
  return done(new Error("IP tidak diizinkan"));
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

// Middleware untuk log koneksi database
fastify.addHook("onReady", async () => {
  try {
    await db.raw("SELECT 1");
    fastify.log.info(
      `✅ Koneksi Database ke ${config.DB_NAME} berhasil terhubung`
    );
    fastify.log.info(`📍 Host Database: ${config.DB_HOST}:${config.DB_PORT}`);
  } catch (error) {
    fastify.log.error(`❌ Gagal terhubung ke Database: ${error.message}`);
    process.exit(1);
  }
});

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

// Route utama dengan pesan sambutan yang lebih informatif
fastify.get("/", async (request, reply) => {
  return {
    status: "ok",
    message: "API Berita siap digunakan",
    endpoints: ["/api/categories", "/api/articles", "/api/positions/:position"],
  };
});

// Hook Mode untuk memutus koneksi dari ke Database
fastify.addHook("onClose", (instance, done) => {
  if (instance.db) {
    instance.db.destroy(() => {
      fastify.log.warn("🔌 Koneksi database ditutup");
      done();
    });
  } else {
    done();
  }
});

// Memulai server
const mulai = async () => {
  try {
    await fastify.listen({ port: config.PORT, host: "0.0.0.0" });
    fastify.log.info(`🚀 Server Berita berhasil berjalan`);
    fastify.log.info(`🌐 Listening pada port: ${config.PORT}`);

    // Log kondisi mode
    if (IS_DEVELOPMENT) {
      fastify.log.info(`🔓 Mode Pengembangan: Akses IP Lokal Diizinkan`);
    } else {
      fastify.log.info(`🔒 Hanya menerima koneksi dari IP CloudFlare`);
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

mulai();

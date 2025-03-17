import knex from "knex";

// Inisialisasi database dengan nilai default jika tidak ada di env
const dbConfig = {
  client: "mysql2",
  connection: {
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || "3306",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "Gayu251005777",
    database: process.env.DB_NAME || "urbansiana",
  },
  pool: { min: 0, max: 7 },
};

// Inisialisasi koneksi database
const db = knex(dbConfig);

function initializeDatabase(fastify) {
  try {
    // Log informasi koneksi database
    fastify.log.info("Connecting to database...");
    fastify.log.info(
      `Host: ${dbConfig.connection.host}, Port: ${dbConfig.connection.port}, Database: ${dbConfig.connection.database}, User: ${dbConfig.connection.user}`
    );

    // Test koneksi database
    db.raw("SELECT 1")
      .then(() => {
        fastify.log.info("Database connection successful");
      })
      .catch((err) => {
        fastify.log.error("Database connection test failed:", err.message);
        fastify.log.error("Database connection details:", {
          host: dbConfig.connection.host,
          port: dbConfig.connection.port,
          user: dbConfig.connection.user,
          database: dbConfig.connection.database,
        });
      });
  } catch (err) {
    fastify.log.error("Failed to initialize database connection:", err.message);
    fastify.log.error("Database config:", dbConfig.connection);
    process.exit(1);
  }
}

export { db, initializeDatabase };

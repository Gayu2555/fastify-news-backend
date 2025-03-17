"use strict";

import path from "path";
import { fileURLToPath } from "url";
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import knex from "knex";
import bcrypt from "bcrypt";
import nodeCron from "node-cron";
import crypto from "crypto";
import slugify from "slugify";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Fastify instance
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    transport: {
      target: "pino-pretty",
      options: {
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
        colorize: true,
      },
    },
  },
});

// Database Configuration from environment variables
const dbConfig = {
  client: "mysql2",
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
  pool: { min: 0, max: 7 },
};

// Initialize database connection with better error handling
let db;
try {
  fastify.log.info("Connecting to database...");
  fastify.log.info(
    `Host: ${process.env.DB_HOST}, Port: ${process.env.DB_PORT}, Database: ${process.env.DB_NAME}`
  );
  db = knex(dbConfig);

  // Test database connection
  db.raw("SELECT 1")
    .then(() => {
      fastify.log.info("Database connection successful");
    })
    .catch((err) => {
      fastify.log.error("Database connection test failed:", err.message);
      fastify.log.error("Database connection details:", {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        database: process.env.DB_NAME,
      });
    });
} catch (err) {
  fastify.log.error("Failed to initialize database connection:", err.message);
  fastify.log.error("Database config:", {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
  });
  process.exit(1);
}

// Register CORS plugin
fastify.register(fastifyCors, {
  origin: "*",
});

// Register WebSocket plugin
fastify.register(fastifyWebsocket, {
  options: { maxPayload: 1048576 },
});

// Utility Functions for Encryption/Decryption
const encryptionUtils = {
  // Generate a random encryption key if not set in environment
  encryptionKey:
    process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex"),

  // Encrypt data
  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(this.encryptionKey, "hex");
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
  },

  // Decrypt data
  decrypt(text) {
    const parts = text.split(":");
    const iv = Buffer.from(parts[0], "hex");
    const encryptedText = parts[1];
    const key = Buffer.from(this.encryptionKey, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  },
};

// Database models
const models = {
  // Category Model
  Category: {
    tableName: "categories",

    async getAll() {
      try {
        return db(this.tableName).select("*");
      } catch (err) {
        fastify.log.error(`Error fetching all categories: ${err.message}`);
        throw err;
      }
    },

    async findById(id) {
      try {
        return db(this.tableName).where({ id }).first();
      } catch (err) {
        fastify.log.error(`Error finding category by ID ${id}: ${err.message}`);
        throw err;
      }
    },

    async findBySlug(slug) {
      try {
        return db(this.tableName).where({ slug }).first();
      } catch (err) {
        fastify.log.error(
          `Error finding category by slug ${slug}: ${err.message}`
        );
        throw err;
      }
    },
  },

  // Article Model
  Article: {
    tableName: "articles",

    async getAll(filters = {}) {
      try {
        const query = db(this.tableName)
          .select("articles.*", "categories.name as category_name")
          .join("categories", "articles.category_id", "categories.id");

        if (filters.category_id) {
          query.where("articles.category_id", filters.category_id);
        }

        if (filters.search) {
          query.where(function () {
            this.where("articles.title", "like", `%${filters.search}%`).orWhere(
              "articles.content",
              "like",
              `%${filters.search}%`
            );
          });
        }

        return query.orderBy(
          filters.sort_by || "articles.created_at",
          filters.sort_order || "desc"
        );
      } catch (err) {
        fastify.log.error(
          `Error fetching articles with filters ${JSON.stringify(filters)}: ${
            err.message
          }`
        );
        throw err;
      }
    },

    async findById(id) {
      try {
        return db(this.tableName)
          .select("articles.*", "categories.name as category_name")
          .join("categories", "articles.category_id", "categories.id")
          .where("articles.id", id)
          .first();
      } catch (err) {
        fastify.log.error(`Error finding article by ID ${id}: ${err.message}`);
        throw err;
      }
    },

    async findBySlug(slug) {
      try {
        return db(this.tableName)
          .select("articles.*", "categories.name as category_name")
          .join("categories", "articles.category_id", "categories.id")
          .where("articles.slug", slug)
          .first();
      } catch (err) {
        fastify.log.error(
          `Error finding article by slug ${slug}: ${err.message}`
        );
        throw err;
      }
    },
  },

  // ArticlePosition Model
  ArticlePosition: {
    tableName: "article_positions",

    async getPositionsByCategory(categoryId) {
      try {
        return db(this.tableName)
          .select(
            "article_positions.*",
            "articles.title",
            "articles.slug as article_slug",
            "articles.image_url",
            "articles.description"
          )
          .join("articles", "article_positions.article_id", "articles.id")
          .where("article_positions.category_id", categoryId);
      } catch (err) {
        fastify.log.error(
          `Error getting positions for category ID ${categoryId}: ${err.message}`
        );
        throw err;
      }
    },

    async getByPosition(position) {
      try {
        return db(this.tableName)
          .select(
            "article_positions.*",
            "articles.title",
            "articles.slug as article_slug",
            "articles.image_url",
            "articles.description",
            "categories.name as category_name",
            "categories.slug as category_slug"
          )
          .join("articles", "article_positions.article_id", "articles.id")
          .join("categories", "article_positions.category_id", "categories.id")
          .where("article_positions.position", position);
      } catch (err) {
        fastify.log.error(
          `Error getting articles by position ${position}: ${err.message}`
        );
        throw err;
      }
    },
  },

  // Fungsi Pemodelan untuk User
  User: {
    tableName: "users",

    async findById(id) {
      try {
        return db(this.tableName).where({ id }).first();
      } catch (err) {
        fastify.log.error(`Error finding user by ID ${id}: ${err.message}`);
        throw err;
      }
    },

    async findByEmail(email) {
      try {
        return db(this.tableName).where({ email }).first();
      } catch (err) {
        fastify.log.error(
          `Error finding user by email ${email}: ${err.message}`
        );
        throw err;
      }
    },

    async verifyPassword(email, password) {
      try {
        const user = await this.findByEmail(email);

        if (!user) {
          fastify.log.info(`Login failed: User with email ${email} not found`);
          return false;
        }

        const isValid = await bcrypt.compare(password, user.password);

        if (isValid) {
          fastify.log.info(`User ${email} successfully authenticated`);
          delete user.password;
          return user;
        }

        fastify.log.info(`Login failed: Invalid password for user ${email}`);
        return false;
      } catch (err) {
        fastify.log.error(
          `Error verifying password for user ${email}: ${err.message}`
        );
        throw err;
      }
    },
  },

  // Fungsi Pemodelan API KEY
  ApiKey: {
    tableName: "api_keys",

    async generateKey() {
      return crypto.randomBytes(32).toString("hex");
    },

    async findValidKey(key) {
      try {
        const apiKey = await db(this.tableName)
          .where({ key, is_active: true })
          .where("expires_at", ">", db.fn.now())
          .first();

        if (apiKey) {
          fastify.log.debug(`Valid API key found: ID ${apiKey.id}`);
        } else {
          fastify.log.debug(`No valid API key found for provided key`);
        }

        return apiKey;
      } catch (err) {
        fastify.log.error(`Error finding valid API key: ${err.message}`);
        throw err;
      }
    },

    async deleteExpiredKeys() {
      try {
        const deleted = await db(this.tableName)
          .where("expires_at", "<=", db.fn.now())
          .delete();
        fastify.log.info(`Deleted ${deleted} expired API keys`);
        return deleted;
      } catch (err) {
        fastify.log.error(`Error deleting expired API keys: ${err.message}`);
        throw err;
      }
    },

    async rotateKeys() {
      try {
        // Generate a new key
        const key = await this.generateKey();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        const [id] = await db(this.tableName).insert({
          key,
          description: "Auto-rotated API key",
          expires_at: expiresAt,
        });

        const newKey = await db(this.tableName).where({ id }).first();

        fastify.log.info(
          `New API key generated with ID ${newKey.id}, expires at ${expiresAt}`
        );

        // Deactivate older keys
        const updated = await db(this.tableName)
          .where("id", "!=", newKey.id)
          .update({ is_active: false });

        fastify.log.info(`Deactivated ${updated} older API keys`);

        return newKey;
      } catch (err) {
        fastify.log.error(`Error rotating API keys: ${err.message}`);
        throw err;
      }
    },
  },

  // Client Connection Model to store WebSocket client connections
  ClientConnection: {
    // In-memory store for client connections (can be moved to Redis for production)
    connections: new Map(),

    // Add a new client connection
    addConnection(clientId, connection) {
      this.connections.set(clientId, connection);
      fastify.log.info(`Client ${clientId} connected via WebSocket`);
      return clientId;
    },

    // Remove a client connection
    removeConnection(clientId) {
      const removed = this.connections.delete(clientId);
      fastify.log.info(`Client ${clientId} disconnected from WebSocket`);
      return removed;
    },

    // Get a specific client connection
    getConnection(clientId) {
      return this.connections.get(clientId);
    },

    // Get all client connections
    getAllConnections() {
      return Array.from(this.connections.keys());
    },

    // Broadcast a message to all connected clients
    broadcastMessage(message) {
      let count = 0;
      for (const [clientId, connection] of this.connections.entries()) {
        try {
          connection.socket.send(JSON.stringify(message));
          count++;
        } catch (err) {
          fastify.log.error(
            `Error sending message to client ${clientId}: ${err.message}`
          );
          this.removeConnection(clientId); // Remove broken connections
        }
      }
      fastify.log.info(`Broadcasted message to ${count} clients`);
      return count;
    },
  },
};

// API Key middleware - FIXED to properly halt execution
async function verifyApiKey(request, reply) {
  try {
    const apiKey = request.headers["x-api-key"];

    if (!apiKey) {
      fastify.log.warn(`API key verification failed: Missing x-api-key header`);
      throw new Error("API key required");
    }

    fastify.log.debug(`Verifying API key: ${apiKey.substring(0, 8)}...`);

    const validKey = await models.ApiKey.findValidKey(apiKey);

    if (!validKey) {
      fastify.log.warn(`API key verification failed: Invalid or expired key`);
      throw new Error("Invalid API key");
    }

    fastify.log.info(
      `Valid API key used: ID ${validKey.id}, description: "${validKey.description}"`
    );
  } catch (err) {
    fastify.log.error(`API key verification failed: ${err.message}`);
    return reply.code(401).send({ success: false, message: "Invalid API key" });
  }
}

// Request logging middleware
async function requestLogger(request, reply) {
  const { method, url, ip } = request;
  const userAgent = request.headers["user-agent"] || "unknown";

  fastify.log.info({
    msg: `Incoming request: ${method} ${url}`,
    ip: ip,
    userAgent: userAgent,
    params: request.params,
    query: request.query,
  });
}

// API Key
// Fungsi pergantian API KEY, setiap 6 Jam sekali (Cron Job)
async function rotateApiKeys() {
  try {
    fastify.log.info("Starting scheduled API key rotation");

    // Check database connection before proceeding
    try {
      await db.raw("SELECT 1");
      fastify.log.debug("Database connection verified for API key rotation");
    } catch (dbErr) {
      fastify.log.error(
        `Database connection failed during API key rotation: ${dbErr.message}`
      );
      return;
    }

    const newKey = await models.ApiKey.rotateKeys();
    fastify.log.info(`API key rotation complete. New key ID: ${newKey.id}`);

    // Notify clients about key rotation via WebSocket (optional)
    models.ClientConnection.broadcastMessage({
      type: "system",
      action: "api_key_rotated",
      message: "API keys have been rotated. Please obtain a new key.",
      timestamp: new Date().toISOString(),
    });

    // Clean up expired keys
    await models.ApiKey.deleteExpiredKeys();
  } catch (err) {
    fastify.log.error(`Error during API key rotation: ${err.message}`);
  }
}

// Improved security middleware
async function securityMiddleware(request, reply) {
  // Add security headers
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("X-XSS-Protection", "1; mode=block");
  reply.header(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );

  // Rate limiting can be added here

  // Validate request size
  const contentLength = request.headers["content-length"]
    ? parseInt(request.headers["content-length"])
    : 0;
  if (contentLength > 10485760) {
    // 10MB limit
    fastify.log.warn(`Request size exceeded limit: ${contentLength} bytes`);
    return reply
      .code(413)
      .send({ success: false, message: "Request entity too large" });
  }
}

// WebSocket authentication middleware
async function wsAuthMiddleware(connection, request) {
  try {
    const { socket } = connection;
    const apiKey = request.headers["x-api-key"];

    if (!apiKey) {
      fastify.log.warn(`WebSocket authentication failed: Missing API key`);
      socket.send(
        JSON.stringify({
          type: "error",
          message: "Authentication required. Please provide a valid API key.",
        })
      );
      socket.close();
      return false;
    }

    const validKey = await models.ApiKey.findValidKey(apiKey);

    if (!validKey) {
      fastify.log.warn(`WebSocket authentication failed: Invalid API key`);
      socket.send(
        JSON.stringify({
          type: "error",
          message: "Invalid API key. Connection rejected.",
        })
      );
      socket.close();
      return false;
    }

    return true;
  } catch (err) {
    fastify.log.error(`WebSocket authentication error: ${err.message}`);
    connection.socket.close();
    return false;
  }
}

// Set up scheduled tasks
function setupScheduledTasks() {
  // Rotate API keys every day at midnight
  nodeCron.schedule("0 0 * * *", rotateApiKeys);

  // Clean up expired API keys every 6 hours
  nodeCron.schedule("0 */6 * * *", async () => {
    try {
      await models.ApiKey.deleteExpiredKeys();
    } catch (err) {
      fastify.log.error(`Error cleaning up expired API keys: ${err.message}`);
    }
  });
}

// Register global hooks
fastify.addHook("onRequest", requestLogger);
fastify.addHook("onRequest", securityMiddleware);

// Define routes
// Categories API
fastify.get(
  "/api/categories",
  { preHandler: verifyApiKey },
  async (request, reply) => {
    try {
      const categories = await models.Category.getAll();
      return { success: true, data: categories };
    } catch (err) {
      fastify.log.error(`Error fetching categories: ${err.message}`);
      return reply
        .code(500)
        .send({ success: false, message: "Internal server error" });
    }
  }
);

fastify.get(
  "/api/categories/:slug",
  { preHandler: verifyApiKey },
  async (request, reply) => {
    try {
      const { slug } = request.params;
      const category = await models.Category.findBySlug(slug);

      if (!category) {
        return reply
          .code(404)
          .send({ success: false, message: "Category not found" });
      }

      return { success: true, data: category };
    } catch (err) {
      fastify.log.error(`Error fetching category: ${err.message}`);
      return reply
        .code(500)
        .send({ success: false, message: "Internal server error" });
    }
  }
);

// Articles API
fastify.get(
  "/api/articles",
  { preHandler: verifyApiKey },
  async (request, reply) => {
    try {
      const articles = await models.Article.getAll(request.query);
      return { success: true, data: articles };
    } catch (err) {
      fastify.log.error(`Error fetching articles: ${err.message}`);
      return reply
        .code(500)
        .send({ success: false, message: "Internal server error" });
    }
  }
);

fastify.get(
  "/api/articles/:slug",
  { preHandler: verifyApiKey },
  async (request, reply) => {
    try {
      const { slug } = request.params;
      const article = await models.Article.findBySlug(slug);

      if (!article) {
        return reply
          .code(404)
          .send({ success: false, message: "Article not found" });
      }

      return { success: true, data: article };
    } catch (err) {
      fastify.log.error(`Error fetching article: ${err.message}`);
      return reply
        .code(500)
        .send({ success: false, message: "Internal server error" });
    }
  }
);

// Article positions API
fastify.get(
  "/api/positions/:position",
  { preHandler: verifyApiKey },
  async (request, reply) => {
    try {
      const { position } = request.params;
      const articles = await models.ArticlePosition.getByPosition(position);

      return { success: true, data: articles };
    } catch (err) {
      fastify.log.error(`Error fetching position articles: ${err.message}`);
      return reply
        .code(500)
        .send({ success: false, message: "Internal server error" });
    }
  }
);

// Authentication
fastify.post("/api/auth/login", async (request, reply) => {
  try {
    const { email, password } = request.body;

    if (!email || !password) {
      return reply
        .code(400)
        .send({ success: false, message: "Email and password required" });
    }

    const user = await models.User.verifyPassword(email, password);

    if (!user) {
      return reply
        .code(401)
        .send({ success: false, message: "Invalid credentials" });
    }

    // Generate session token
    const token = crypto.randomBytes(64).toString("hex");

    // Store token in database or Redis would be better in production
    // For now, we'll return the token directly

    return {
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name },
        token,
      },
    };
  } catch (err) {
    fastify.log.error(`Error during login: ${err.message}`);
    return reply
      .code(500)
      .send({ success: false, message: "Internal server error" });
  }
});

// WebSocket endpoint with encryption
fastify.register(async function (fastify) {
  fastify.get("/ws", { websocket: true }, async (connection, request) => {
    try {
      // Authenticate WebSocket connection
      const isAuthenticated = await wsAuthMiddleware(connection, request);
      if (!isAuthenticated) return;

      // Generate client ID
      const clientId = crypto.randomBytes(16).toString("hex");

      // Store connection
      models.ClientConnection.addConnection(clientId, connection);

      // Send welcome message with client ID (encrypted)
      const welcomeMessage = {
        type: "system",
        action: "connected",
        clientId: clientId,
        message: "Connection established successfully",
        timestamp: new Date().toISOString(),
      };

      // Encrypt the welcome message
      const encryptedWelcome = encryptionUtils.encrypt(
        JSON.stringify(welcomeMessage)
      );
      connection.socket.send(
        JSON.stringify({
          encrypted: true,
          data: encryptedWelcome,
        })
      );

      // Handle incoming messages
      connection.socket.on("message", async (message) => {
        try {
          const msgData = JSON.parse(message.toString());

          // Handle encrypted messages
          if (msgData.encrypted && msgData.data) {
            try {
              // Decrypt the message
              const decrypted = encryptionUtils.decrypt(msgData.data);
              const decryptedData = JSON.parse(decrypted);

              fastify.log.debug(
                `Received encrypted message from client ${clientId}: ${decrypted}`
              );

              // Process the decrypted message based on its type
              switch (decryptedData.type) {
                case "ping":
                  // Send encrypted pong response
                  const pongResponse = {
                    type: "pong",
                    timestamp: new Date().toISOString(),
                  };
                  const encryptedPong = encryptionUtils.encrypt(
                    JSON.stringify(pongResponse)
                  );
                  connection.socket.send(
                    JSON.stringify({
                      encrypted: true,
                      data: encryptedPong,
                    })
                  );
                  break;

                case "subscribe":
                  // Handle subscription to topics/channels
                  // Implementation would depend on your application needs
                  break;

                default:
                  // Handle other message types
                  break;
              }
            } catch (decryptErr) {
              fastify.log.error(
                `Failed to decrypt message from client ${clientId}: ${decryptErr.message}`
              );
              connection.socket.send(
                JSON.stringify({
                  type: "error",
                  message: "Failed to decrypt message",
                })
              );
            }
          } else {
            // Handle unencrypted messages (could reject them for security)
            fastify.log.warn(
              `Received unencrypted message from client ${clientId}`
            );
            connection.socket.send(
              JSON.stringify({
                type: "error",
                message: "All messages must be encrypted",
              })
            );
          }
        } catch (msgErr) {
          fastify.log.error(
            `Error processing WebSocket message: ${msgErr.message}`
          );
        }
      });

      // Handle connection close
      connection.socket.on("close", () => {
        models.ClientConnection.removeConnection(clientId);
      });
    } catch (err) {
      fastify.log.error(`WebSocket connection error: ${err.message}`);
      if (connection.socket.readyState === 1) {
        // 1 = OPEN
        connection.socket.close();
      }
    }
  });
});

// API Key management endpoint
fastify.register(async function (fastify) {
  // Apply API Key middleware
  fastify.addHook("onRequest", verifyApiKey);

  // Generate new API key (admin only)
  fastify.post("/api/keys/generate", async (request, reply) => {
    try {
      // Additional admin authentication should be implemented here
      // This is just a basic example
      const { description, expiresInDays } = request.body;

      // Generate a new key
      const key = await models.ApiKey.generateKey();

      // Calculate expiration date
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (expiresInDays || 30)); // Default to 30 days

      // Save to database
      const [id] = await db(models.ApiKey.tableName).insert({
        key,
        description: description || "Manually generated API key",
        expires_at: expiresAt,
        is_active: true,
      });

      const newKey = await db(models.ApiKey.tableName).where({ id }).first();

      fastify.log.info(
        `New API key generated with ID ${id}, expires at ${expiresAt}`
      );

      // Only return the full key when it's first created
      return {
        success: true,
        data: {
          id: newKey.id,
          key, // Only show full key on creation
          description: newKey.description,
          expires_at: newKey.expires_at,
          is_active: newKey.is_active,
        },
        message: "Store this key securely as it won't be shown again!",
      };
    } catch (err) {
      fastify.log.error(`Error generating API key: ${err.message}`);
      return reply
        .code(500)
        .send({ success: false, message: "Failed to generate API key" });
    }
  });

  // Get all API keys (admin only)
  fastify.get("/api/keys", async (request, reply) => {
    try {
      // Additional admin authentication should be implemented here

      const keys = await db(models.ApiKey.tableName)
        .select("id", "description", "created_at", "expires_at", "is_active")
        .orderBy("created_at", "desc");

      return { success: true, data: keys };
    } catch (err) {
      fastify.log.error(`Error fetching API keys: ${err.message}`);
      return reply
        .code(500)
        .send({ success: false, message: "Internal server error" });
    }
  });

  // Revoke an API key (admin only)
  fastify.delete("/api/keys/:id", async (request, reply) => {
    try {
      // Additional admin authentication should be implemented here

      const { id } = request.params;

      const updated = await db(models.ApiKey.tableName)
        .where({ id })
        .update({ is_active: false });

      if (updated === 0) {
        return reply
          .code(404)
          .send({ success: false, message: "API key not found" });
      }

      fastify.log.info(`API key with ID ${id} has been revoked`);

      return { success: true, message: "API key revoked successfully" };
    } catch (err) {
      fastify.log.error(`Error revoking API key: ${err.message}`);
      return reply
        .code(500)
        .send({ success: false, message: "Failed to revoke API key" });
    }
  });
});

// Example helper function to send encrypted updates to clients
async function sendEncryptedUpdate(clientId, data) {
  try {
    const connection = models.ClientConnection.getConnection(clientId);

    if (!connection) {
      fastify.log.warn(
        `Cannot send update to client ${clientId}: Client not connected`
      );
      return false;
    }

    const encryptedData = encryptionUtils.encrypt(JSON.stringify(data));
    connection.socket.send(
      JSON.stringify({
        encrypted: true,
        data: encryptedData,
      })
    );

    fastify.log.debug(`Sent encrypted update to client ${clientId}`);
    return true;
  } catch (err) {
    fastify.log.error(
      `Error sending encrypted update to client ${clientId}: ${err.message}`
    );
    return false;
  }
}

// Server startup
async function startServer() {
  try {
    // Set up scheduled tasks
    setupScheduledTasks();

    // Start the server
    const port = process.env.PORT || 3000;
    const host = process.env.HOST || "0.0.0.0";

    await fastify.listen({ port, host });
    fastify.log.info(`Server is running on ${host}:${port}`);

    // Generate initial API key if none exists
    const keysCount = await db("api_keys").count("id as count").first();

    if (keysCount.count === 0) {
      fastify.log.info("No API keys found. Generating initial API key...");
      const newKey = await models.ApiKey.rotateKeys();
      fastify.log.info(`Initial API key generated: ${newKey.key}`);
      fastify.log.info(
        `IMPORTANT: Store this key securely as it won't be shown again!`
      );
    }
  } catch (err) {
    fastify.log.error(`Server startup failed: ${err.message}`);
    process.exit(1);
  }
}

// Start the server
startServer();

// Graceful shutdown
process.on("SIGTERM", async () => {
  fastify.log.info("SIGTERM received, shutting down gracefully");
  await fastify.close();
  await db.destroy();
  process.exit(0);
});

process.on("SIGINT", async () => {
  fastify.log.info("SIGINT received, shutting down gracefully");
  await fastify.close();
  await db.destroy();
  process.exit(0);
});

export { fastify, encryptionUtils, models };

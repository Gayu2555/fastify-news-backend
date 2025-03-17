import { db } from "../config/database.js";
import crypto from "crypto";

const ApiKey = {
  tableName: "api_keys",

  async generateKey() {
    return crypto.randomBytes(32).toString("hex");
  },

  async findValidKey(key, fastify) {
    try {
      const apiKey = await db(this.tableName)
        .where({ key, is_active: true })
        .where("expires_at", ">", db.fn.now())
        .first();

      if (fastify) {
        if (apiKey) {
          fastify.log.debug(`Valid API key found: ID ${apiKey.id}`);
        } else {
          fastify.log.debug(`No valid API key found for provided key`);
        }
      }

      return apiKey;
    } catch (err) {
      if (fastify) {
        fastify.log.error(`Error finding valid API key: ${err.message}`);
      }
      throw err;
    }
  },

  async deleteExpiredKeys(fastify) {
    try {
      const deleted = await db(this.tableName)
        .where("expires_at", "<=", db.fn.now())
        .delete();

      if (fastify) {
        fastify.log.info(`Deleted ${deleted} expired API keys`);
      }
      return deleted;
    } catch (err) {
      if (fastify) {
        fastify.log.error(`Error deleting expired API keys: ${err.message}`);
      }
      throw err;
    }
  },

  async rotateKeys(fastify) {
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

      if (fastify) {
        fastify.log.info(
          `New API key generated with ID ${newKey.id}, expires at ${expiresAt}`
        );
      }

      // Deactivate older keys
      const updated = await db(this.tableName)
        .where("id", "!=", newKey.id)
        .update({ is_active: false });

      if (fastify) {
        fastify.log.info(`Deactivated ${updated} older API keys`);
      }

      return newKey;
    } catch (err) {
      if (fastify) {
        fastify.log.error(`Error rotating API keys: ${err.message}`);
      }
      throw err;
    }
  },
};

export { ApiKey };

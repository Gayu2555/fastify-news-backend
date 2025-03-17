import { db } from "../config/database.js";
import bcrypt from "bcrypt";

const User = {
  tableName: "users",

  async findById(id) {
    try {
      return db(this.tableName).where({ id }).first();
    } catch (err) {
      console.error(`Error finding user by ID ${id}: ${err.message}`);
      throw err;
    }
  },

  async findByEmail(email) {
    try {
      return db(this.tableName).where({ email }).first();
    } catch (err) {
      console.error(`Error finding user by email ${email}: ${err.message}`);
      throw err;
    }
  },

  async verifyPassword(email, password, fastify) {
    try {
      const user = await this.findByEmail(email);

      if (!user) {
        if (fastify) {
          fastify.log.info(`Login failed: User with email ${email} not found`);
        }
        return false;
      }

      const isValid = await bcrypt.compare(password, user.password);

      if (isValid) {
        if (fastify) {
          fastify.log.info(`User ${email} successfully authenticated`);
        }
        delete user.password;
        return user;
      }

      if (fastify) {
        fastify.log.info(`Login failed: Invalid password for user ${email}`);
      }
      return false;
    } catch (err) {
      console.error(
        `Error verifying password for user ${email}: ${err.message}`
      );
      throw err;
    }
  },
};

export { User };

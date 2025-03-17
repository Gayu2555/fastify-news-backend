import { db } from "../config/database.js";

const Category = {
  tableName: "categories",

  async getAll() {
    try {
      return db(this.tableName).select("*");
    } catch (err) {
      console.error(`Error fetching all categories: ${err.message}`);
      throw err;
    }
  },

  async findById(id) {
    try {
      return db(this.tableName).where({ id }).first();
    } catch (err) {
      console.error(`Error finding category by ID ${id}: ${err.message}`);
      throw err;
    }
  },

  async findBySlug(slug) {
    try {
      return db(this.tableName).where({ slug }).first();
    } catch (err) {
      console.error(`Error finding category by slug ${slug}: ${err.message}`);
      throw err;
    }
  },
};

export { Category };

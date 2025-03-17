import { db } from "../config/database.js";

const Article = {
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
      console.error(
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
      console.error(`Error finding article by ID ${id}: ${err.message}`);
      throw err;
    }
  },
  //Gw cinta sama Fastify, tapi kok Amnjing yach
  async findBySlug(slug) {
    try {
      return db(this.tableName)
        .select("articles.*", "categories.name as category_name")
        .join("categories", "articles.category_id", "categories.id")
        .where("articles.slug", slug)
        .first();
    } catch (err) {
      console.error(`Error finding article by slug ${slug}: ${err.message}`);
      throw err;
    }
  },
};

export { Article };

import { db } from "../config/database.js";

const ArticlePosition = {
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
      console.error(
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
      console.error(
        `Error getting articles by position ${position}: ${err.message}`
      );
      throw err;
    }
  },
};

export { ArticlePosition };

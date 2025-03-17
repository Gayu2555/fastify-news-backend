import { models } from "../models/index.js";

// API Key middleware - FIXED to properly halt execution
async function verifyApiKey(request, reply) {
  try {
    const apiKey = request.headers["x-api-key"];

    if (!apiKey) {
      this.log.warn(`API key verification failed: Missing x-api-key header`);
      throw new Error("API key required");
    }

    this.log.debug(`Verifying API key: ${apiKey.substring(0, 8)}...`);

    const validKey = await models.ApiKey.findValidKey(apiKey, this);

    if (!validKey) {
      this.log.warn(`API key verification failed: Invalid or expired key`);
      throw new Error("Invalid API key");
    }

    this.log.info(
      `Valid API key used: ID ${validKey.id}, description: "${validKey.description}"`
    );
  } catch (err) {
    this.log.error(`API key verification failed: ${err.message}`);
    return reply.code(401).send({ success: false, message: "Invalid API key" });
  }
}

export { verifyApiKey };

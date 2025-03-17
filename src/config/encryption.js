import crypto from "crypto";

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

export { encryptionUtils };

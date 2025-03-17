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
    this.log.warn(`Request size exceeded limit: ${contentLength} bytes`);
    return reply
      .code(413)
      .send({ success: false, message: "Request entity too large" });
  }
}

export { securityMiddleware };

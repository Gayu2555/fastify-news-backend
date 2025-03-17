// Request logging middleware
async function requestLogger(request, reply) {
  const { method, url, ip } = request;
  const userAgent = request.headers["user-agent"] || "unknown";

  this.log.info({
    msg: `Incoming request: ${method} ${url}`,
    ip: ip,
    userAgent: userAgent,
    params: request.params,
    query: request.query,
  });
}

export { requestLogger };

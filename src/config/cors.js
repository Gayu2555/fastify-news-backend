import fp from "fastify-plugin";

export const setupSecureCors = fp(
  function (fastify, options, done) {
    try {
      const allowedOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(",")
        : fastify.config?.security?.allowedOrigins || [];

      const allowedIPs = process.env.ALLOWED_IPS
        ? process.env.ALLOWED_IPS.split(",")
        : fastify.config?.security?.allowedIPs || [];

      fastify.register(
        import("@fastify/cors"),
        {
          origin: (origin, cb) => {
            try {
              if (!origin) {
                const allowServerToServer =
                  process.env.ALLOW_SERVER_TO_SERVER === "true" ||
                  fastify.config?.security?.allowServerToServer;

                return cb(null, allowServerToServer);
              }

              // Cek apakah origin ada dalam daftar yang diizinkan
              const isAllowedOrigin = allowedOrigins.some((allowed) => {
                // Periksa domain yang cocok persis
                if (allowed === origin) return true;

                // Periksa subdomain wildcard (misalnya *.example.com)
                if (allowed.startsWith("*.")) {
                  const allowedDomain = allowed.slice(2); // hapus '*.'
                  return (
                    origin.endsWith(allowedDomain) &&
                    origin.lastIndexOf(
                      ".",
                      origin.length - allowedDomain.length - 1
                    ) !== -1
                  );
                }

                return false;
              });

              // Cek apakah IP ada dalam daftar yang diizinkan
              const isAllowedIP = allowedIPs.some((ip) => {
                // Hapus protokol dan port
                const cleanOrigin = origin
                  .replace(/^https?:\/\//, "")
                  .split(":")[0];

                // Periksa IP yang cocok persis
                if (ip === cleanOrigin) return true;

                // Periksa subnet CIDR (misalnya 192.168.1.0/24)
                if (ip.includes("/")) {
                  return isIpInCidrRange(cleanOrigin, ip);
                }

                return false;
              });

              // Jika origin atau IP diizinkan, lanjutkan
              if (isAllowedOrigin || isAllowedIP) {
                cb(null, true);
              } else {
                // Log upaya akses yang tidak diizinkan
                fastify.log.warn(`Akses CORS ditolak untuk origin: ${origin}`);
                cb(new Error(`Origin ${origin} tidak diizinkan`), false);
              }
            } catch (error) {
              fastify.log.error(
                `Error dalam pemrosesan CORS: ${error.message}`
              );
              cb(new Error("Internal server error"), false);
            }
          },
          methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
          allowedHeaders: [
            "Content-Type",
            "Authorization",
            "X-Requested-With",
            "Accept",
            "X-API-Key",
            "X-Request-ID",
          ],
          credentials: true,
          maxAge: 86400, // 1 hari
          preflightContinue: false,
          // Hanya berikan header yang diperlukan
          exposedHeaders: ["Content-Disposition", "X-Request-ID"],
        },
        (err) => {
          if (err) {
            fastify.log.error(`Error registering CORS plugin: ${err.message}`);
            done(err);
            return;
          }

          // Log konfigurasi CORS untuk debugging
          fastify.log.info(
            `CORS dikonfigurasi: ${allowedOrigins.length} domain dan ${allowedIPs.length} IP diizinkan`
          );

          // Panggil done() untuk menandakan plugin telah selesai
          done();
        }
      );
    } catch (error) {
      fastify.log.error(`Gagal mengatur CORS: ${error.message}`);
      done(error);
    }
  },
  { name: "secure-cors" }
);

/**
 * Fungsi pembantu untuk memeriksa apakah sebuah IP ada dalam rentang CIDR
 * @param {string} ip - Alamat IP yang diperiksa
 * @param {string} cidr - Range CIDR (contoh: 192.168.1.0/24)
 * @returns {boolean} - true jika IP dalam rentang CIDR
 */
function isIpInCidrRange(ip, cidr) {
  // Implementasi sederhana untuk memeriksa CIDR
  try {
    const [range, bits] = cidr.split("/");
    const mask = parseInt(bits, 10);

    if (isNaN(mask)) return false;

    const ipParts = ip.split(".").map((part) => parseInt(part, 10));
    const rangeParts = range.split(".").map((part) => parseInt(part, 10));

    // Validasi input IPv4
    if (
      ipParts.length !== 4 ||
      rangeParts.length !== 4 ||
      ipParts.some((p) => isNaN(p) || p < 0 || p > 255) ||
      rangeParts.some((p) => isNaN(p) || p < 0 || p > 255)
    ) {
      return false;
    }

    // Konversi ke biner dan bandingkan dengan mask
    const ipBin =
      ((ipParts[0] << 24) |
        (ipParts[1] << 16) |
        (ipParts[2] << 8) |
        ipParts[3]) >>>
      0;
    const rangeBin =
      ((rangeParts[0] << 24) |
        (rangeParts[1] << 16) |
        (rangeParts[2] << 8) |
        rangeParts[3]) >>>
      0;
    const maskBin = (~0 << (32 - mask)) >>> 0;

    return (ipBin & maskBin) === (rangeBin & maskBin);
  } catch (error) {
    return false;
  }
}

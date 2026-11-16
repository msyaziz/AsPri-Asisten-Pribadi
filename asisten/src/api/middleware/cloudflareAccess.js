import jwt from 'jsonwebtoken';
import env from '../../config/env.js';

// Cache untuk JWKS / public certs
let certsCache = null;
let certsCacheExpiry = 0;

export async function fetchCerts(certsUrl) {
  const now = Date.now();
  if (certsCache && certsCacheExpiry > now) {
    return certsCache;
  }
  const res = await fetch(certsUrl);
  if (!res.ok) {
    throw new Error(`Gagal mengambil Cloudflare Access certs: HTTP ${res.status}`);
  }
  const data = await res.json();
  certsCache = data;
  certsCacheExpiry = now + 10 * 60 * 1000; // cache 10 menit
  return data;
}

export function clearCertsCache() {
  certsCache = null;
  certsCacheExpiry = 0;
}

/**
 * Factory middleware untuk verifikasi Cloudflare Access JWT.
 * Default non-aktif (CF_ACCESS_ENABLED=false).
 *
 * @param {Object} [options]
 * @param {boolean} [options.enabled] - Override status aktif (default env.CF_ACCESS_ENABLED)
 * @param {string} [options.teamDomain] - Override team domain (default env.CF_ACCESS_TEAM_DOMAIN)
 * @param {string} [options.aud] - Override audience (default env.CF_ACCESS_AUD)
 * @param {string} [options.publicKey] - Override public key PEM langsung (berguna untuk testing)
 * @param {string} [options.jwksUri] - Custom JWKS / certs URI
 */
export function createCloudflareAccessMiddleware(options = {}) {
  return async function cloudflareAccessMiddleware(req, res, next) {
    const isEnabled = options.enabled !== undefined ? options.enabled : env.CF_ACCESS_ENABLED;
    if (!isEnabled) {
      return next();
    }

    const token = req.headers['cf-access-jwt-assertion'];
    if (!token) {
      return res.status(403).json({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Header Cf-Access-Jwt-Assertion tidak ditemukan.',
        },
      });
    }

    const teamDomain = options.teamDomain || env.CF_ACCESS_TEAM_DOMAIN;
    const expectedAud = options.aud || env.CF_ACCESS_AUD;

    try {
      let publicKey = options.publicKey;

      if (!publicKey) {
        const certsUrl =
          options.jwksUri ||
          `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
        const certs = await fetchCerts(certsUrl);

        // Ambil kid dari header JWT jika ada
        const decodedToken = jwt.decode(token, { complete: true });
        const kid = decodedToken?.header?.kid;

        if (certs.keys && Array.isArray(certs.keys)) {
          const matchingKey = certs.keys.find((k) => !kid || k.kid === kid);
          if (matchingKey?.x5c?.[0]) {
            publicKey = `-----BEGIN CERTIFICATE-----\n${matchingKey.x5c[0]}\n-----END CERTIFICATE-----`;
          } else if (matchingKey?.cert) {
            publicKey = matchingKey.cert;
          }
        } else if (certs.public_certs && Array.isArray(certs.public_certs)) {
          const matchingCert = certs.public_certs.find((c) => !kid || c.kid === kid);
          if (matchingCert?.cert) {
            publicKey = matchingCert.cert;
          }
        } else if (certs.public_cert?.cert) {
          publicKey = certs.public_cert.cert;
        }

        if (!publicKey) {
          throw new Error('Kunci publik Cloudflare Access tidak ditemukan.');
        }
      }

      const decoded = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
        audience: expectedAud || undefined,
      });

      req.cfAccessUser = decoded;
      next();
    } catch (err) {
      return res.status(403).json({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: `Token Cloudflare Access tidak valid: ${err.message}`,
        },
      });
    }
  };
}

export default createCloudflareAccessMiddleware;


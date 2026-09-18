/**
 * PDSChain API Versioning & Compatibility Manager (Phase 14)
 */

const SUPPORTED_VERSIONS = ['v1'];
const DEFAULT_VERSION = 'v1';
const CURRENT_SEMVER = '1.0.0';
const SUNSET_DATE = 'Fri, 01 Jan 2027 00:00:00 GMT';

function detectVersion(req) {
  const path = req.path || req.originalUrl || '';

  // 1. Path-based versioning: /api/v1/..., /api/v2/...
  const pathMatch = path.match(/^\/api\/(v\d+)(\/|$)/i);
  if (pathMatch) {
    return pathMatch[1].toLowerCase();
  }

  // 2. Custom header: X-API-Version: 1 or 1.0 or v1
  const headerVer = req.headers['x-api-version'];
  if (headerVer) {
    const norm = headerVer.trim().toLowerCase();
    return norm.startsWith('v') ? norm : `v${norm.split('.')[0]}`;
  }

  // 3. Content negotiation Accept header: Accept: application/vnd.pdschain.v1+json
  const acceptHeader = req.headers['accept'] || '';
  const acceptMatch = acceptHeader.match(/application\/vnd\.pdschain\.(v\d+)\+json/i);
  if (acceptMatch) {
    return acceptMatch[1].toLowerCase();
  }

  // Legacy route without explicit version
  if (path.startsWith('/api/') || path === '/api') {
    return 'legacy';
  }

  return DEFAULT_VERSION;
}

function isVersionSupported(version) {
  if (version === 'legacy') return true;
  return SUPPORTED_VERSIONS.includes(version);
}

function versionMiddleware(req, res, next) {
  const version = detectVersion(req);
  req.apiVersion = version;

  // Set standard API version response header
  res.setHeader('X-API-Version', CURRENT_SEMVER);

  // Check for unsupported version in path
  const path = req.path || req.originalUrl || '';
  const pathMatch = path.match(/^\/api\/(v\d+)(\/|$)/i);
  if (pathMatch) {
    const requestedVersion = pathMatch[1].toLowerCase();
    if (!SUPPORTED_VERSIONS.includes(requestedVersion)) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({
        data: null,
        meta: {
          version: CURRENT_SEMVER,
          timestamp: new Date().toISOString()
        },
        error: {
          code: 'UNSUPPORTED_API_VERSION',
          message: `API version '${requestedVersion}' is not supported. Supported versions: ${SUPPORTED_VERSIONS.join(', ')}`,
          supportedVersions: SUPPORTED_VERSIONS
        }
      });
    }
  }

  // Attach deprecation headers for legacy routes
  if (version === 'legacy' && !path.startsWith('/api/v1')) {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', SUNSET_DATE);
    const v1Path = path.replace(/^\/api/, '/api/v1');
    res.setHeader('Link', `<${v1Path}>; rel="successor-version"`);
  }

  next();
}

module.exports = {
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  CURRENT_SEMVER,
  SUNSET_DATE,
  detectVersion,
  isVersionSupported,
  versionMiddleware
};


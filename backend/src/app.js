const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./routes');
const v1Routes = require('./routes/v1');
const { requestTracingMiddleware } = require('./api/RequestTracing');
const { versionMiddleware } = require('./api/ApiVersioning');
const { rpcMiddleware } = require('./rpc');
const errorMiddleware = require('./middleware/errorMiddleware');
const { NotFoundError } = require('./utils/errors');
const config = require('./config/env');
const { inputSanitizerMiddleware } = require('./security/inputValidation');
const {
  defaultTracer,
  defaultApplicationMetrics,
  defaultHealthManager,
  defaultMetricsRegistry
} = require('./observability');

const app = express();

// Global Security Headers (Phases 14, 15, & 17)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; connect-src 'self' http://localhost:3000 http://localhost:3100; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  // Prevent caching of sensitive and API endpoints
  if (req.path.startsWith('/api') || req.path.startsWith('/rpc')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
  }

  next();
});

// Phase 14: Request Tracing & Correlation
app.use(requestTracingMiddleware);

// Phase 19: Distributed Tracing & Application Metrics
app.use(defaultTracer.middleware());
app.use(defaultApplicationMetrics.middleware());

const corsOptions = {
  origin: (origin, callback) => {
    // If no origin header is present (curl, server-to-server, same-origin), allow
    if (!origin) return callback(null, true);

    const allowedOrigins = (config.CORS_ORIGIN || '')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean);

    // In production, reject wildcard and enforce strict allowlist
    if (config.NODE_ENV === 'production') {
      if (allowedOrigins.includes('*')) {
        return callback(new Error('CORS policy: Wildcard origin is forbidden in production.'));
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS policy: Origin ${origin} is not allowed by CORS.`));
    }

    // In development or test:
    if (allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS policy: Origin ${origin} is not allowed by CORS.`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-API-Version', 'Idempotency-Key'],
  credentials: true
};

app.use(cors(corsOptions));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Phase 17: Global Input Validation & Prototype Pollution Guard
app.use(inputSanitizerMiddleware);

// Phase 14: Versioning and Deprecation Headers
app.use(versionMiddleware);

// Phase 14: Mount JSON-RPC 2.0 Endpoints (supports 405 on non-POST)
app.all('/rpc', rpcMiddleware);
app.all('/rpc/v1', rpcMiddleware);

// Phase 19: Kubernetes-Grade Health Probes
app.get('/health/live', (req, res) => {
  const probe = defaultHealthManager.getLiveness();
  return res.status(probe.statusCode).json(probe.payload);
});

app.get('/health/ready', async (req, res) => {
  const probe = await defaultHealthManager.getReadiness();
  return res.status(probe.statusCode).json(probe.payload);
});

app.get('/health/startup', (req, res) => {
  const probe = defaultHealthManager.getStartup();
  return res.status(probe.statusCode).json(probe.payload);
});

app.get('/health/observability', (req, res) => {
  const probe = defaultHealthManager.getObservabilityHealth();
  return res.status(probe.statusCode).json(probe.payload);
});

app.get('/health', async (req, res) => {
  const probe = await defaultHealthManager.getAggregateHealth();
  return res.status(probe.statusCode).json(probe.payload);
});

// Phase 19: Root Prometheus Metrics Endpoint
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return res.send(defaultMetricsRegistry.exportPrometheusText());
});

// Phase 18: Lightweight Database Health Probe
app.get('/health/database', async (req, res) => {
  const { defaultDatabaseManager } = require('./database/DatabaseManager');
  const isHealthy = await defaultDatabaseManager.testConnection();
  const status = defaultDatabaseManager.getStatus();
  return res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DOWN',
    dialect: status.dialect,
    storageTarget: status.storageTarget,
    timestamp: new Date().toISOString()
  });
});

// Mount API routes
app.use('/api/v1', v1Routes);
app.use('/api', routes);

// Phase 15 & Static File Serving for Frontend Application
const frontendDir = path.join(__dirname, '../../frontend');
const htmlDir = path.join(frontendDir, 'html');

app.use('/css', express.static(path.join(frontendDir, 'css')));
app.use('/js', express.static(path.join(frontendDir, 'js')));
app.use('/html', express.static(htmlDir));
app.use(express.static(htmlDir));

// Root landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(htmlDir, 'index.html'));
});

// Portal routes for admin, shop, warehouse, citizen, validator, explorer
const portals = {
  admin: path.join(htmlDir, 'admin/admin.html'),
  shop: path.join(htmlDir, 'shop/shop.html'),
  warehouse: path.join(htmlDir, 'warehouse/warehouse.html'),
  citizen: path.join(htmlDir, 'citizen/citizen.html'),
  validator: path.join(htmlDir, 'validator/validator.html'),
  explorer: path.join(htmlDir, 'explorer.html')
};

for (const [name, defaultHtml] of Object.entries(portals)) {
  app.get(`/${name}`, (req, res) => res.sendFile(defaultHtml));
  app.get(`/${name}/`, (req, res) => res.sendFile(defaultHtml));
  if (name !== 'explorer') {
    app.get(`/${name}/*`, (req, res) => {
      const sub = req.params[0];
      const target = path.join(htmlDir, name, sub);
      const fs = require('fs');
      if (fs.existsSync(target) && !fs.statSync(target).isDirectory()) {
        return res.sendFile(target);
      }
      return res.sendFile(defaultHtml);
    });
  }
}

// 404 handler
app.use((req, res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
});

// Centralized error handler
app.use(errorMiddleware);

module.exports = app;

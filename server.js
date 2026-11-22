require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const webpush = require("web-push");
const { SqliteAdapter, createPostgresDatabase, initializePostgresDatabase } = require("./database");

const ROOT = __dirname;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const BODY_LIMIT = 1024 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SERVICES = [
  "Technology",
  "Creative design",
  "Media production",
  "Music production",
  "Marketing",
  "Bara commerce",
  "Education",
  "Partnerships",
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function makeConfig(overrides = {}) {
  const production = (overrides.nodeEnv || process.env.NODE_ENV) === "production";
  const currencyValue = (overrides.currency ?? process.env.CURRENCY ?? "ZAR").toUpperCase();
  return {
    nodeEnv: production ? "production" : "development",
    port: Number(overrides.port ?? process.env.PORT ?? 8000),
    databasePath: overrides.databasePath ?? process.env.DATABASE_PATH ?? path.join(ROOT, "data", "bara-studios.sqlite"),
    databaseUrl: overrides.databaseUrl || process.env.DATABASE_URL || process.env.POSTGRES_URL || "",
    currency: /^[A-Z]{3}$/.test(currencyValue) ? currencyValue : "ZAR",
    adminEmail: (overrides.adminEmail ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase(),
    adminPassword: overrides.adminPassword ?? process.env.ADMIN_PASSWORD ?? "",
    adminAlertEmail: overrides.adminAlertEmail ?? process.env.ADMIN_ALERT_EMAIL ?? "",
    alertEmailFrom: overrides.alertEmailFrom ?? process.env.ALERT_EMAIL_FROM ?? "",
    resendApiKey: overrides.resendApiKey ?? process.env.RESEND_API_KEY ?? "",
    adminAlertPhone: overrides.adminAlertPhone ?? process.env.ADMIN_ALERT_PHONE ?? "",
    adminAlertWhatsapp: overrides.adminAlertWhatsapp ?? process.env.ADMIN_ALERT_WHATSAPP ?? "",
    twilioAccountSid: overrides.twilioAccountSid ?? process.env.TWILIO_ACCOUNT_SID ?? "",
    twilioAuthToken: overrides.twilioAuthToken ?? process.env.TWILIO_AUTH_TOKEN ?? "",
    twilioPhoneFrom: overrides.twilioPhoneFrom ?? process.env.TWILIO_PHONE_FROM ?? "",
    twilioWhatsappFrom: overrides.twilioWhatsappFrom ?? process.env.TWILIO_WHATSAPP_FROM ?? "",
    twilioWhatsappContentSid: overrides.twilioWhatsappContentSid ?? process.env.TWILIO_WHATSAPP_CONTENT_SID ?? "",
    vapidSubject: overrides.vapidSubject ?? process.env.VAPID_SUBJECT ?? "",
    vapidPublicKey: overrides.vapidPublicKey ?? process.env.VAPID_PUBLIC_KEY ?? "",
    vapidPrivateKey: overrides.vapidPrivateKey ?? process.env.VAPID_PRIVATE_KEY ?? "",
  };
}

function initializeDatabase(db, defaultCurrency = "ZAR") {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      default_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (default_price_cents >= 0),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS client_services (
      id INTEGER PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      service_id INTEGER NOT NULL REFERENCES services(id),
      price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
      started_on TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
      track_inventory INTEGER NOT NULL DEFAULT 0 CHECK (track_inventory IN (0, 1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_email TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'pending', 'refunded', 'cancelled')),
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0)
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      contact_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supply_orders (
      id INTEGER PRIMARY KEY,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'received', 'cancelled')),
      reference TEXT NOT NULL DEFAULT '',
      needed_by TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supply_order_items (
      id INTEGER PRIMARY KEY,
      supply_order_id INTEGER NOT NULL REFERENCES supply_orders(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0)
    );

    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      service TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'converted', 'closed')),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id INTEGER,
      is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id INTEGER PRIMARY KEY,
      notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      subscription_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      csrf_hash TEXT NOT NULL,
      auth_version TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket_key TEXT PRIMARY KEY,
      started_at_ms INTEGER NOT NULL,
      attempts INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
    CREATE INDEX IF NOT EXISTS idx_client_services_client ON client_services(client_id);
    CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_client ON sales(client_id);
    CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries(created_at);
    CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status, priority);
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
  `);
  const sessionColumns = db.prepare("PRAGMA table_info(admin_sessions)").all();
  if (!sessionColumns.some((column) => column.name === "auth_version")) {
    db.exec("ALTER TABLE admin_sessions ADD COLUMN auth_version TEXT NOT NULL DEFAULT ''");
  }
  db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('currency', ?)").run(defaultCurrency);
  const addService = db.prepare("INSERT OR IGNORE INTO services (name, created_at) VALUES (?, ?)");
  for (const service of SERVICES) addService.run(service, now());
}

async function rateLimit(db, bucket, address, maximum, windowMs) {
  const timestamp = Date.now();
  const entry = await db.prepare(`
    INSERT INTO rate_limits (bucket_key, started_at_ms, attempts)
    VALUES (?, ?, 1)
    ON CONFLICT(bucket_key) DO UPDATE SET
      attempts = CASE
        WHEN rate_limits.started_at_ms + ? < ? THEN 1
        ELSE rate_limits.attempts + 1
      END,
      started_at_ms = CASE
        WHEN rate_limits.started_at_ms + ? < ? THEN ?
        ELSE rate_limits.started_at_ms
      END
    RETURNING attempts
  `).get(sha256(`${bucket}:${address}`), timestamp, windowMs, timestamp, windowMs, timestamp, timestamp);
  return entry.attempts <= maximum;
}

function requestAddress(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return (typeof forwarded === "string" && forwarded.split(",")[0].trim())
    || req.socket.remoteAddress
    || "unknown";
}

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(JSON.stringify(value));
}

function fail(status, message) {
  throw new HttpError(status, message);
}

function readCookie(req, name) {
  const cookies = (req.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(cookie.slice(separator + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function now() {
  return new Date().toISOString();
}

function parseText(value, field, { required = false, max = 500 } = {}) {
  if (typeof value !== "string") {
    if (required) fail(400, `${field} is required.`);
    return "";
  }
  const result = value.trim();
  if (required && !result) fail(400, `${field} is required.`);
  if (result.length > max) fail(400, `${field} is too long.`);
  return result;
}

function parseEmail(value, field, { required = false } = {}) {
  const email = parseText(value, field, { required, max: 254 }).toLowerCase();
  if (email && !EMAIL_PATTERN.test(email)) fail(400, `${field} must be a valid email address.`);
  return email;
}

function parsePositiveInteger(value, field, { minimum = 0, maximum = 100000000 } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    fail(400, `${field} must be a valid whole number.`);
  }
  return number;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(new HttpError(413, "Request body is too large."));
        return;
      }
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function verifyOrigin(req, config) {
  const origin = req.headers.origin;
  if (!origin) fail(403, "A same-origin request is required.");
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    fail(403, "Request origin is invalid.");
  }
  if (parsedOrigin.host !== req.headers.host) fail(403, "Cross-origin requests are not allowed.");
  if (config.nodeEnv === "production" && parsedOrigin.protocol !== "https:") {
    fail(403, "HTTPS is required for admin actions.");
  }
}

function setSessionCookies(res, sessionToken, csrfToken, config) {
  const secure = config.nodeEnv === "production" ? "; Secure" : "";
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader("Set-Cookie", [
    `bara_admin=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${secure}`,
    `bara_csrf=${encodeURIComponent(csrfToken)}; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`,
  ]);
}

function clearSessionCookies(res, config) {
  const secure = config.nodeEnv === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", [
    `bara_admin=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure}`,
    `bara_csrf=; SameSite=Strict; Path=/; Max-Age=0${secure}`,
  ]);
}

async function getSession(req, db, authVersion) {
  const token = readCookie(req, "bara_admin");
  if (!token) return null;
  return await db.prepare(`
    SELECT token_hash, csrf_hash, email, expires_at
    FROM admin_sessions
    WHERE token_hash = ? AND auth_version = ? AND expires_at > ?
  `).get(sha256(token), authVersion, now()) || null;
}

function verifyCsrf(req, session) {
  const cookieToken = readCookie(req, "bara_csrf");
  const headerToken = req.headers["x-csrf-token"] || "";
  if (!cookieToken || !safeEqual(cookieToken, headerToken) || !safeEqual(sha256(cookieToken), session.csrf_hash)) {
    fail(403, "This session expired or its security token is invalid. Sign in again.");
  }
}

async function audit(db, actor, action, entityType, entityId, metadata = {}) {
  await db.prepare(`
    INSERT INTO audit_log (actor, action, entity_type, entity_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(actor, action, entityType, entityId ?? null, JSON.stringify(metadata), now());
}

async function makeNotification(db, { title, message, priority, entityType, entityId }) {
  const result = await db.prepare(`
    INSERT INTO notifications (title, message, priority, entity_type, entity_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title, message, priority, entityType, entityId, now());
  return Number(result.lastInsertRowid);
}

async function recordDelivery(db, notificationId, channel, status, detail = "") {
  await db.prepare(`
    INSERT INTO notification_deliveries (notification_id, channel, status, detail, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(notificationId, channel, status, detail.slice(0, 300), now());
}

async function postForm(url, fields, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Provider returned ${response.status}: ${detail.slice(0, 200)}`);
  }
}

async function dispatchAlert(db, config, notificationId) {
  const notification = await db.prepare("SELECT * FROM notifications WHERE id = ?").get(notificationId);
  if (!notification || notification.priority === "normal") return;

  const text = `A ${notification.priority} Bara Studios enquiry needs your attention. Open the admin dashboard to review it.`;
  const jobs = [];
  const twilioReady = config.twilioAccountSid && config.twilioAuthToken;
  const twilioAuth = twilioReady
    ? `Basic ${Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64")}`
    : "";
  const twilioBase = twilioReady
    ? `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.twilioAccountSid)}`
    : "";

  if (config.resendApiKey && config.adminAlertEmail && config.alertEmailFrom) {
    jobs.push((async () => {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: config.alertEmailFrom,
          to: [config.adminAlertEmail],
          subject: notification.title,
          text,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
      await recordDelivery(db, notificationId, "email", "sent");
    })().catch((error) => {
      console.error("Email alert delivery failed.", error);
      return recordDelivery(db, notificationId, "email", "failed", error.message);
    }));
  }

  if (twilioReady && config.adminAlertPhone && config.twilioPhoneFrom) {
    jobs.push(postForm(`${twilioBase}/Messages.json`, {
      To: config.adminAlertPhone,
      From: config.twilioPhoneFrom,
      Body: text,
    }, { Authorization: twilioAuth })
      .then(() => recordDelivery(db, notificationId, "sms", "sent"))
      .catch((error) => {
        console.error("SMS alert delivery failed.", error);
        return recordDelivery(db, notificationId, "sms", "failed", error.message);
      }));
  }

  if (twilioReady && config.adminAlertWhatsapp && config.twilioWhatsappFrom && config.twilioWhatsappContentSid) {
    const whatsappFields = {
      To: config.adminAlertWhatsapp.startsWith("whatsapp:")
        ? config.adminAlertWhatsapp
        : `whatsapp:${config.adminAlertWhatsapp}`,
      From: config.twilioWhatsappFrom.startsWith("whatsapp:")
        ? config.twilioWhatsappFrom
        : `whatsapp:${config.twilioWhatsappFrom}`,
    };
    whatsappFields.ContentSid = config.twilioWhatsappContentSid;
    whatsappFields.ContentVariables = JSON.stringify({ "1": text });
    jobs.push(postForm(`${twilioBase}/Messages.json`, whatsappFields, { Authorization: twilioAuth })
      .then(() => recordDelivery(db, notificationId, "whatsapp", "sent"))
      .catch((error) => {
        console.error("WhatsApp alert delivery failed.", error);
        return recordDelivery(db, notificationId, "whatsapp", "failed", error.message);
      }));
  }

  if (config.vapidPublicKey && config.vapidPrivateKey && config.vapidSubject) {
    webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
    const subscriptions = await db.prepare("SELECT id, subscription_json FROM push_subscriptions").all();
    for (const subscription of subscriptions) {
      jobs.push(webpush.sendNotification(
        JSON.parse(subscription.subscription_json),
        JSON.stringify({ title: notification.title, body: text, url: "/admin" }),
      )      .then(() => recordDelivery(db, notificationId, "browser-push", "sent"))
      .catch(async (error) => {
          if (error.statusCode === 404 || error.statusCode === 410) {
          await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(subscription.id);
          }
          console.error("Browser push delivery failed.", error);
        await recordDelivery(db, notificationId, "browser-push", "failed", error.message);
        }));
    }
  }

  await Promise.all(jobs);
}

function getChannelStatus(config) {
  const twilioReady = Boolean(config.twilioAccountSid && config.twilioAuthToken);
  return {
    "in-app": { configured: true, label: "In-app alerts" },
    "browser-push": {
      configured: Boolean(config.vapidPublicKey && config.vapidPrivateKey && config.vapidSubject),
      label: "Browser push",
      publicKey: config.vapidPublicKey || "",
    },
    email: {
      configured: Boolean(config.resendApiKey && config.adminAlertEmail && config.alertEmailFrom),
      label: "Email",
    },
    sms: {
      configured: Boolean(twilioReady && config.adminAlertPhone && config.twilioPhoneFrom),
      label: "SMS",
    },
    whatsapp: {
      configured: Boolean(twilioReady && config.adminAlertWhatsapp && config.twilioWhatsappFrom && config.twilioWhatsappContentSid),
      label: "WhatsApp",
    },
  };
}

async function makeSummary(db) {
  const counts = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM clients WHERE status != 'archived') AS client_count,
      (SELECT COUNT(*) FROM client_services WHERE status = 'active') AS active_service_count,
      (SELECT COUNT(*) FROM inquiries WHERE status IN ('new', 'in_progress')) AS open_inquiry_count,
      (SELECT COUNT(*) FROM inquiries WHERE status IN ('new', 'in_progress') AND priority IN ('high', 'urgent')) AS priority_inquiry_count,
      (SELECT COUNT(*) FROM sales WHERE status = 'paid') AS paid_sale_count,
      (SELECT COALESCE(SUM(total_cents), 0) FROM sales WHERE status = 'paid') AS lifetime_revenue_cents,
      (SELECT COALESCE(SUM(total_cents), 0) FROM sales WHERE status = 'paid' AND created_at >= ?) AS month_revenue_cents,
      (SELECT COUNT(*) FROM notifications WHERE is_read = 0) AS unread_notification_count
  `).get(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

  const salesByMonth = await db.prepare(`
    SELECT substr(created_at, 1, 7) AS month, SUM(total_cents) AS revenue_cents, COUNT(*) AS sales_count
    FROM sales
    WHERE status = 'paid' AND created_at >= ?
    GROUP BY month
    ORDER BY month
  `).all(new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1).toISOString());

  const recentInquiries = await db.prepare(`
    SELECT id, name, email, service, status, priority, created_at
    FROM inquiries ORDER BY created_at DESC LIMIT 6
  `).all();

  const topProducts = await db.prepare(`
    SELECT si.product_name AS name, SUM(si.quantity) AS units, SUM(si.quantity * si.unit_price_cents) AS revenue_cents
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.status = 'paid'
    GROUP BY si.product_name ORDER BY revenue_cents DESC LIMIT 5
  `).all();

  const monthlyRevenue = new Map(salesByMonth.map((row) => [row.month, row]));
  const revenueTrend = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const monthDate = new Date();
    monthDate.setDate(1);
    monthDate.setMonth(monthDate.getMonth() - offset);
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
    const row = monthlyRevenue.get(key);
    revenueTrend.push({
      month: key,
      label: monthDate.toLocaleString("en", { month: "short" }),
      revenue_cents: Number(row?.revenue_cents || 0),
      sales_count: Number(row?.sales_count || 0),
    });
  }

  return {
    ...counts,
    revenue_trend: revenueTrend,
    top_products: topProducts,
    recent_inquiries: recentInquiries,
    ai_enabled: false,
  };
}

function classifyPriority(message) {
  return /\b(urgent|asap|today|deadline|time[- ]sensitive)\b/i.test(message) ? "high" : "normal";
}

function createApplication(options = {}) {
  const config = makeConfig(options.config || {});
  let db;
  let ready;
  if (options.db) {
    db = options.db instanceof SqliteAdapter ? options.db : new SqliteAdapter(options.db);
    initializeDatabase(db.native, config.currency);
    ready = Promise.resolve();
  } else if (config.databaseUrl) {
    db = createPostgresDatabase(config.databaseUrl);
    ready = options.skipPostgresInitialization
      ? Promise.resolve()
      : initializePostgresDatabase(db, config.currency, SERVICES, now);
    ready.catch(() => {});
  } else {
    if (config.databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(config.databasePath)), { recursive: true });
    }
    db = new SqliteAdapter(new DatabaseSync(config.databasePath));
    initializeDatabase(db.native, config.currency);
    ready = Promise.resolve();
  }

  const passwordSalt = crypto.randomBytes(16);
  const passwordHash = crypto.scryptSync(config.adminPassword || crypto.randomUUID(), passwordSalt, 64);
  const adminConfigured = Boolean(config.adminEmail && config.adminPassword.length >= 16);
  const authVersion = sha256(config.adminPassword);

  async function requireAdmin(req, res) {
    const session = await getSession(req, db, authVersion);
    if (!session) {
      sendJson(res, 401, { error: "Sign in to continue." });
      return null;
    }
    return session;
  }

  async function handleApi(req, res, url) {
    const { pathname } = url;

    if (req.method === "GET" && pathname === "/api/auth/session") {
      const session = await getSession(req, db, authVersion);
      const csrfToken = readCookie(req, "bara_csrf");
      if (!session || !safeEqual(sha256(csrfToken), session.csrf_hash)) {
        sendJson(res, 200, { authenticated: false });
        return;
      }
      sendJson(res, 200, {
        authenticated: true,
        email: session.email,
        csrfToken,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      verifyOrigin(req, config);
      if (!await rateLimit(db, "login", requestAddress(req), 8, 15 * 60 * 1000)) {
        sendJson(res, 429, { error: "Too many sign-in attempts. Try again later." });
        return;
      }
      const body = await readJson(req);
      const email = parseEmail(body.email, "Email", { required: true });
      const password = parseText(body.password, "Password", { required: true, max: 256 });
      if (!adminConfigured) {
        sendJson(res, 503, { error: "Admin sign-in is not configured. Set ADMIN_EMAIL and a unique ADMIN_PASSWORD in the server environment." });
        return;
      }
      const attemptedHash = crypto.scryptSync(password, passwordSalt, 64);
      const valid = safeEqual(email, config.adminEmail) && crypto.timingSafeEqual(attemptedHash, passwordHash);
      if (!valid) {
        sendJson(res, 401, { error: "Email or password is incorrect." });
        return;
      }

      const sessionToken = crypto.randomBytes(32).toString("base64url");
      const csrfToken = crypto.randomBytes(32).toString("base64url");
      const createdAt = now();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      await db.prepare(`
        INSERT INTO admin_sessions (token_hash, csrf_hash, auth_version, email, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(sha256(sessionToken), sha256(csrfToken), authVersion, config.adminEmail, expiresAt, createdAt);
      await db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(createdAt);
      await audit(db, config.adminEmail, "login", "admin_session", null);
      setSessionCookies(res, sessionToken, csrfToken, config);
      sendJson(res, 200, { authenticated: true, email: config.adminEmail, csrfToken });
      return;
    }

    if (req.method === "POST" && pathname === "/api/inquiries") {
      verifyOrigin(req, config);
      if (!await rateLimit(db, "inquiry", requestAddress(req), 5, 60 * 60 * 1000)) {
        sendJson(res, 429, { error: "Too many enquiries were submitted. Please try again later." });
        return;
      }
      const body = await readJson(req);
      if (parseText(body.website, "Website", { max: 300 })) {
        sendJson(res, 202, { received: true });
        return;
      }
      const name = parseText(body.name, "Name", { required: true, max: 120 });
      const email = parseEmail(body.email, "Email", { required: true });
      const phone = parseText(body.phone, "Phone", { max: 40 });
      const service = parseText(body.service, "Service", { max: 100 });
      const message = parseText(body.message, "Message", { required: true, max: 5000 });
      const priority = classifyPriority(message);
      const createdAt = now();
      const result = await db.prepare(`
        INSERT INTO inquiries (name, email, phone, service, message, priority, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, email, phone, service, message, priority, createdAt, createdAt);
      const inquiryId = Number(result.lastInsertRowid);
      const notificationId = await makeNotification(db, {
        title: priority === "normal" ? "New customer enquiry" : "Priority customer enquiry",
        message: `${name} asked about ${service || "Bara Studios services"}.`,
        priority,
        entityType: "inquiry",
        entityId: inquiryId,
      });
      await audit(db, "public", "created", "inquiry", inquiryId, { service, priority });
      if (priority !== "normal") {
        await dispatchAlert(db, config, notificationId).catch((error) => {
          console.error("Priority enquiry alert processing failed.", error);
        });
      }
      sendJson(res, 201, { received: true, id: inquiryId });
      return;
    }

    if (pathname === "/api/auth/logout" && req.method === "POST") {
      const session = await requireAdmin(req, res);
      if (!session) return;
      verifyOrigin(req, config);
      verifyCsrf(req, session);
      await db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(session.token_hash);
      await audit(db, session.email, "logout", "admin_session", null);
      clearSessionCookies(res, config);
      sendJson(res, 200, { authenticated: false });
      return;
    }

    if (!pathname.startsWith("/api/admin/")) {
      sendJson(res, 404, { error: "API route not found." });
      return;
    }

    const session = await requireAdmin(req, res);
    if (!session) return;
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      verifyOrigin(req, config);
      verifyCsrf(req, session);
    }

    if (req.method === "GET" && pathname === "/api/admin/summary") {
      sendJson(res, 200, await makeSummary(db));
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/settings") {
      sendJson(res, 200, {
        channels: getChannelStatus(config),
        currency: (await db.prepare("SELECT value FROM app_settings WHERE key = 'currency'").get())?.value || config.currency,
        ai: { enabled: false, message: "AI is off until you choose a provider and privacy policy." },
      });
      return;
    }

    if (req.method === "PATCH" && pathname === "/api/admin/settings") {
      const body = await readJson(req);
      const currency = parseText(body.currency, "Currency code", { required: true, max: 3 }).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) fail(400, "Currency must be a three-letter ISO code such as ZAR or USD.");
      await db.prepare("INSERT INTO app_settings (key, value) VALUES ('currency', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(currency);
      await audit(db, session.email, "updated", "setting", null, { key: "currency", value: currency });
      sendJson(res, 200, { currency });
      return;
    }
    if (req.method === "GET" && pathname === "/api/admin/clients") {
      const clients = await db.prepare(`
        SELECT c.*,
          (SELECT COUNT(*) FROM client_services cs WHERE cs.client_id = c.id AND cs.status = 'active') AS active_service_count,
          (SELECT COALESCE(SUM(s.total_cents), 0) FROM sales s WHERE s.client_id = c.id AND s.status = 'paid') AS revenue_cents,
          (SELECT MAX(s.created_at) FROM sales s WHERE s.client_id = c.id) AS last_sale_at,
          (SELECT MAX(i.created_at) FROM inquiries i WHERE i.email = c.email AND c.email != '') AS last_inquiry_at
        FROM clients c ORDER BY c.created_at DESC
      `).all();
      sendJson(res, 200, clients);
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/clients") {
      const body = await readJson(req);
      const name = parseText(body.name, "Client name", { required: true, max: 120 });
      const company = parseText(body.company, "Company", { max: 160 });
      const email = parseEmail(body.email, "Email");
      const phone = parseText(body.phone, "Phone", { max: 40 });
      const notes = parseText(body.notes, "Notes", { max: 5000 });
      const timestamp = now();
      const result = await db.prepare(`
        INSERT INTO clients (name, company, email, phone, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(name, company, email, phone, notes, timestamp, timestamp);
      const id = Number(result.lastInsertRowid);
      await audit(db, session.email, "created", "client", id);
      sendJson(res, 201, { id });
      return;
    }

    const clientMatch = pathname.match(/^\/api\/admin\/clients\/(\d+)$/);
    if (clientMatch && req.method === "GET") {
      const id = Number(clientMatch[1]);
      const client = await db.prepare("SELECT * FROM clients WHERE id = ?").get(id);
      if (!client) fail(404, "Client not found.");
      const services = await db.prepare(`
        SELECT cs.id, cs.price_cents, cs.status, cs.started_on, cs.notes,
          s.name, s.description
        FROM client_services cs JOIN services s ON s.id = cs.service_id
        WHERE cs.client_id = ? ORDER BY cs.created_at DESC
      `).all(id);
      const sales = await db.prepare(`
        SELECT id, status, total_cents, created_at
        FROM sales WHERE client_id = ? ORDER BY created_at DESC LIMIT 10
      `).all(id);
      const inquiries = client.email
        ? await db.prepare(`
          SELECT id, service, message, status, priority, created_at
          FROM inquiries WHERE email = ? ORDER BY created_at DESC LIMIT 10
        `).all(client.email)
        : [];
      sendJson(res, 200, { ...client, services, sales, inquiries });
      return;
    }

    if (clientMatch && req.method === "PATCH") {
      const id = Number(clientMatch[1]);
      const body = await readJson(req);
      const current = await db.prepare("SELECT * FROM clients WHERE id = ?").get(id);
      if (!current) fail(404, "Client not found.");
      const name = body.name === undefined ? current.name : parseText(body.name, "Client name", { required: true, max: 120 });
      const company = body.company === undefined ? current.company : parseText(body.company, "Company", { max: 160 });
      const email = body.email === undefined ? current.email : parseEmail(body.email, "Email");
      const phone = body.phone === undefined ? current.phone : parseText(body.phone, "Phone", { max: 40 });
      const notes = body.notes === undefined ? current.notes : parseText(body.notes, "Notes", { max: 5000 });
      const status = body.status === undefined ? current.status : parseText(body.status, "Status", { max: 20 });
      if (!["active", "paused", "archived"].includes(status)) fail(400, "Client status is invalid.");
      await db.prepare(`
        UPDATE clients SET name = ?, company = ?, email = ?, phone = ?, notes = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(name, company, email, phone, notes, status, now(), id);
      await audit(db, session.email, "updated", "client", id);
      sendJson(res, 200, { updated: true });
      return;
    }

    const clientServicesMatch = pathname.match(/^\/api\/admin\/clients\/(\d+)\/services$/);
    if (clientServicesMatch && req.method === "POST") {
      const clientId = Number(clientServicesMatch[1]);
      if (!await db.prepare("SELECT id FROM clients WHERE id = ?").get(clientId)) fail(404, "Client not found.");
      const body = await readJson(req);
      const serviceId = parsePositiveInteger(body.service_id, "Service", { minimum: 1 });
      if (!await db.prepare("SELECT id FROM services WHERE id = ? AND active = 1").get(serviceId)) fail(404, "Active service not found.");
      const priceCents = parsePositiveInteger(body.price_cents, "Price");
      const startedOn = parseText(body.started_on, "Start date", { max: 10 });
      const notes = parseText(body.notes, "Notes", { max: 2000 });
      const result = await db.prepare(`
        INSERT INTO client_services (client_id, service_id, price_cents, started_on, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(clientId, serviceId, priceCents, startedOn, notes, now());
      await audit(db, session.email, "assigned", "client_service", Number(result.lastInsertRowid), { clientId, serviceId });
      sendJson(res, 201, { id: Number(result.lastInsertRowid) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/services") {
      sendJson(res, 200, await db.prepare("SELECT * FROM services ORDER BY active DESC, name").all());
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/services") {
      const body = await readJson(req);
      const name = parseText(body.name, "Service name", { required: true, max: 120 });
      const description = parseText(body.description, "Description", { max: 1000 });
      const defaultPrice = parsePositiveInteger(body.default_price_cents, "Default price");
      const result = await db.prepare(`
        INSERT INTO services (name, description, default_price_cents, created_at)
        VALUES (?, ?, ?, ?)
      `).run(name, description, defaultPrice, now());
      const id = Number(result.lastInsertRowid);
      await audit(db, session.email, "created", "service", id);
      sendJson(res, 201, { id });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/products") {
      sendJson(res, 200, await db.prepare(`
        SELECT p.*,
          (SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = p.id AND s.status = 'paid') AS units_sold,
          (SELECT COALESCE(SUM(si.quantity * si.unit_price_cents), 0) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = p.id AND s.status = 'paid') AS revenue_cents
        FROM products p ORDER BY p.created_at DESC
      `).all());
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/products") {
      const body = await readJson(req);
      const name = parseText(body.name, "Product name", { required: true, max: 160 });
      const sku = parseText(body.sku, "SKU", { max: 80 });
      const priceCents = parsePositiveInteger(body.price_cents, "Price");
      const trackInventory = body.track_inventory === true;
      const stock = parsePositiveInteger(body.stock_quantity ?? 0, "Stock quantity");
      const result = await db.prepare(`
        INSERT INTO products (name, sku, price_cents, stock_quantity, track_inventory, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(name, sku, priceCents, stock, trackInventory ? 1 : 0, now());
      const id = Number(result.lastInsertRowid);
      await audit(db, session.email, "created", "product", id);
      sendJson(res, 201, { id });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/sales") {
      const sales = await db.prepare(`
        SELECT s.*, c.name AS client_name,
          (SELECT GROUP_CONCAT(product_name || ' × ' || quantity, ', ') FROM sale_items WHERE sale_id = s.id) AS items
        FROM sales s LEFT JOIN clients c ON c.id = s.client_id
        ORDER BY s.created_at DESC LIMIT 200
      `).all();
      sendJson(res, 200, sales);
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/sales") {
      const body = await readJson(req);
      const productId = parsePositiveInteger(body.product_id, "Product", { minimum: 1 });
      const quantity = parsePositiveInteger(body.quantity, "Quantity", { minimum: 1, maximum: 10000 });
      const product = await db.prepare("SELECT * FROM products WHERE id = ? AND active = 1").get(productId);
      if (!product) fail(404, "Active product not found.");
      const clientId = body.client_id ? parsePositiveInteger(body.client_id, "Client", { minimum: 1 }) : null;
      const client = clientId ? await db.prepare("SELECT * FROM clients WHERE id = ?").get(clientId) : null;
      if (clientId && !client) fail(404, "Client not found.");
      if (product.track_inventory && product.stock_quantity < quantity) fail(409, "There is not enough stock to record this sale.");
      const totalCents = product.price_cents * quantity;
      const timestamp = now();
      const saleId = await db.transaction(async (transaction) => {
        const sale = await transaction.prepare(`
          INSERT INTO sales (client_id, customer_name, customer_email, total_cents, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(clientId, client?.name || parseText(body.customer_name, "Customer name", { required: true, max: 120 }), client?.email || parseEmail(body.customer_email, "Customer email"), totalCents, timestamp);
        const id = Number(sale.lastInsertRowid);
        await transaction.prepare(`
          INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price_cents)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, product.id, product.name, quantity, product.price_cents);
        if (product.track_inventory) {
          const stockUpdate = await transaction.prepare(`
            UPDATE products SET stock_quantity = stock_quantity - ?
            WHERE id = ? AND stock_quantity >= ?
          `).run(quantity, product.id, quantity);
          if (!stockUpdate.changes) fail(409, "There is not enough stock to record this sale.");
        }
        return id;
      });
      await audit(db, session.email, "recorded", "sale", saleId, { totalCents });
      sendJson(res, 201, { id: saleId, total_cents: totalCents });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/suppliers") {
      sendJson(res, 200, await db.prepare("SELECT * FROM suppliers ORDER BY name").all());
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/suppliers") {
      const body = await readJson(req);
      const name = parseText(body.name, "Supplier name", { required: true, max: 160 });
      const contactName = parseText(body.contact_name, "Contact name", { max: 120 });
      const email = parseEmail(body.email, "Email");
      const phone = parseText(body.phone, "Phone", { max: 40 });
      const notes = parseText(body.notes, "Notes", { max: 2000 });
      const result = await db.prepare(`
        INSERT INTO suppliers (name, contact_name, email, phone, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(name, contactName, email, phone, notes, now());
      const id = Number(result.lastInsertRowid);
      await audit(db, session.email, "created", "supplier", id);
      sendJson(res, 201, { id });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/supply-orders") {
      sendJson(res, 200, await db.prepare(`
        SELECT so.*, s.name AS supplier_name,
          (SELECT COUNT(*) FROM supply_order_items i WHERE i.supply_order_id = so.id) AS item_count
        FROM supply_orders so LEFT JOIN suppliers s ON s.id = so.supplier_id
        ORDER BY so.created_at DESC LIMIT 200
      `).all());
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/supply-orders") {
      const body = await readJson(req);
      const supplierId = parsePositiveInteger(body.supplier_id, "Supplier", { minimum: 1 });
      if (!await db.prepare("SELECT id FROM suppliers WHERE id = ?").get(supplierId)) fail(404, "Supplier not found.");
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
        fail(400, "Add between one and fifty custom order items.");
      }
      const items = body.items.map((item, index) => ({
        description: parseText(item.description, `Item ${index + 1}`, { required: true, max: 200 }),
        quantity: parsePositiveInteger(item.quantity, `Item ${index + 1} quantity`, { minimum: 1, maximum: 10000 }),
        unitCost: parsePositiveInteger(item.unit_cost_cents, `Item ${index + 1} unit cost`),
      }));
      const totalCents = items.reduce((total, item) => total + item.quantity * item.unitCost, 0);
      const reference = parseText(body.reference, "Reference", { max: 100 });
      const neededBy = parseText(body.needed_by, "Needed by", { max: 10 });
      const notes = parseText(body.notes, "Notes", { max: 2000 });
      const timestamp = now();
      const orderId = await db.transaction(async (transaction) => {
        const order = await transaction.prepare(`
          INSERT INTO supply_orders (supplier_id, reference, needed_by, notes, total_cents, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(supplierId, reference, neededBy, notes, totalCents, timestamp);
        const id = Number(order.lastInsertRowid);
        const addItem = transaction.prepare(`
          INSERT INTO supply_order_items (supply_order_id, description, quantity, unit_cost_cents)
          VALUES (?, ?, ?, ?)
        `);
        for (const item of items) await addItem.run(id, item.description, item.quantity, item.unitCost);
        return id;
      });
      await audit(db, session.email, "created", "supply_order", orderId, { totalCents, itemCount: items.length });
      sendJson(res, 201, { id: orderId, total_cents: totalCents });
      return;
    }

    const supplyOrderMatch = pathname.match(/^\/api\/admin\/supply-orders\/(\d+)$/);
    if (supplyOrderMatch && req.method === "PATCH") {
      const id = Number(supplyOrderMatch[1]);
      const body = await readJson(req);
      if (!["draft", "submitted", "received", "cancelled"].includes(body.status)) {
        fail(400, "Supply order status is invalid.");
      }
      const result = await db.prepare("UPDATE supply_orders SET status = ? WHERE id = ?").run(body.status, id);
      if (!result.changes) fail(404, "Supply order not found.");
      await audit(db, session.email, "updated", "supply_order", id, { status: body.status });
      sendJson(res, 200, { updated: true });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/inquiries") {
      const status = url.searchParams.get("status");
      const rows = status && ["new", "in_progress", "converted", "closed"].includes(status)
        ? await db.prepare("SELECT * FROM inquiries WHERE status = ? ORDER BY priority DESC, created_at DESC").all(status)
        : await db.prepare("SELECT * FROM inquiries ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, created_at DESC").all();
      sendJson(res, 200, rows);
      return;
    }

    const inquiryMatch = pathname.match(/^\/api\/admin\/inquiries\/(\d+)$/);
    if (inquiryMatch && req.method === "PATCH") {
      const id = Number(inquiryMatch[1]);
      const body = await readJson(req);
      const current = await db.prepare("SELECT * FROM inquiries WHERE id = ?").get(id);
      if (!current) fail(404, "Enquiry not found.");
      const status = body.status ?? current.status;
      const priority = body.priority ?? current.priority;
      if (!["new", "in_progress", "converted", "closed"].includes(status)) fail(400, "Enquiry status is invalid.");
      if (!["normal", "high", "urgent"].includes(priority)) fail(400, "Enquiry priority is invalid.");
      await db.prepare("UPDATE inquiries SET status = ?, priority = ?, updated_at = ? WHERE id = ?")
        .run(status, priority, now(), id);
      await audit(db, session.email, "updated", "inquiry", id, { status, priority });
      sendJson(res, 200, { updated: true });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/notifications") {
      sendJson(res, 200, await db.prepare(`
        SELECT n.*,
          (SELECT GROUP_CONCAT(channel || ':' || status, ',') FROM notification_deliveries d WHERE d.notification_id = n.id) AS deliveries
        FROM notifications n ORDER BY n.created_at DESC LIMIT 100
      `).all());
      return;
    }

    const notificationMatch = pathname.match(/^\/api\/admin\/notifications\/(\d+)$/);
    if (notificationMatch && req.method === "PATCH") {
      const id = Number(notificationMatch[1]);
      const body = await readJson(req);
      const isRead = body.is_read === true ? 1 : body.is_read === false ? 0 : null;
      if (isRead === null) fail(400, "Read status must be true or false.");
      const result = await db.prepare("UPDATE notifications SET is_read = ? WHERE id = ?").run(isRead, id);
      if (!result.changes) fail(404, "Notification not found.");
      sendJson(res, 200, { updated: true });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/push-subscriptions") {
      const body = await readJson(req);
      const endpoint = parseText(body.endpoint, "Push endpoint", { required: true, max: 2048 });
      let endpointUrl;
      try {
        endpointUrl = new URL(endpoint);
      } catch {
        fail(400, "Push endpoint is invalid.");
      }
      if (endpointUrl.protocol !== "https:" || !body.keys || typeof body.keys.p256dh !== "string" || typeof body.keys.auth !== "string") {
        fail(400, "Push subscription is invalid.");
      }
      await db.prepare(`
        INSERT INTO push_subscriptions (endpoint, subscription_json, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET subscription_json = excluded.subscription_json
      `).run(endpoint, JSON.stringify(body), now());
      sendJson(res, 201, { subscribed: true });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/audit") {
      sendJson(res, 200, await db.prepare(`
        SELECT id, actor, action, entity_type, entity_id, metadata_json, created_at
        FROM audit_log ORDER BY created_at DESC LIMIT 100
      `).all());
      return;
    }

    sendJson(res, 404, { error: "Admin API route not found." });
  }

  async function handleApiRequest(req, res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    try {
      await ready;
      if (!req.url || !new URL(req.url, `https://${req.headers.host || "localhost"}`).pathname.startsWith("/api/")) {
        sendJson(res, 404, { error: "API route not found." });
        return;
      }
      if (!["GET", "POST", "PATCH"].includes(req.method)) {
        sendJson(res, 405, { error: "Method not allowed." }, { Allow: "GET, POST, PATCH" });
        return;
      }
      const requestUrl = new URL(req.url, `https://${req.headers.host || "localhost"}`);
      await handleApi(req, res, requestUrl);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      console.error("API request failed.", error);
      sendJson(res, 500, { error: "The request could not be completed. Check the server logs." });
    }
  }

  const staticFiles = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/shop.html", ["shop.html", "text/html; charset=utf-8"]],
    ["/bara-shop.html", ["bara-shop.html", "text/html; charset=utf-8"]],
    ["/canna-shop.html", ["canna-shop.html", "text/html; charset=utf-8"]],
    ["/bara-services-shop.html", ["bara-services-shop.html", "text/html; charset=utf-8"]],
    ["/admin", ["admin.html", "text/html; charset=utf-8"]],
    ["/admin.html", ["admin.html", "text/html; charset=utf-8"]],
    ["/admin.css", ["admin.css", "text/css; charset=utf-8"]],
    ["/admin.js", ["admin.js", "text/javascript; charset=utf-8"]],
    ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
    ["/shop.css", ["shop.css", "text/css; charset=utf-8"]],
    ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
    ["/shop.js", ["shop.js", "text/javascript; charset=utf-8"]],
    ["/pwa.js", ["pwa.js", "text/javascript; charset=utf-8"]],
    ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
    ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
    ["/jk.jpeg", ["jk.jpeg", "image/jpeg"]],
    ["/wallpapers.png", ["wallpapers.png", "image/png"]],
    ["/1000020433(1)ygufufy.jpg", ["1000020433(1)ygufufy.jpg", "image/jpeg"]],
    ["/app-icon-192.png", ["app-icon-192.png", "image/png"]],
    ["/app-icon-512.png", ["app-icon-512.png", "image/png"]],
  ]);

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, "http://localhost");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    try {
      if (requestUrl.pathname.startsWith("/api/")) {
        await handleApiRequest(req, res);
        return;
      }

      if (!["GET", "HEAD"].includes(req.method)) {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end();
        return;
      }

      const fileEntry = staticFiles.get(requestUrl.pathname);
      if (!fileEntry) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end("Not found");
        return;
      }

      const [filename, contentType] = fileEntry;
      const contents = fs.readFileSync(path.join(ROOT, filename));
      const privatePage = filename === "admin.html" || filename === "admin.js" || filename === "admin.css";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", privatePage ? "no-store" : "public, max-age=3600");
      if (filename === "admin.html") {
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
        );
      }
      res.writeHead(200);
      res.end(req.method === "HEAD" ? undefined : contents);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      console.error("Request failed.", error);
      sendJson(res, 500, { error: "The request could not be completed. Check the server logs." });
    }
  });

  return { server, db, config, adminConfigured, ready, handleApiRequest };
}

function createVercelHandler() {
  let schemaInitialized = false;
  let schemaPromise;
  return async function vercelHandler(req, res) {
    if (!(process.env.DATABASE_URL || process.env.POSTGRES_URL)) {
      sendJson(res, 503, { error: "Set DATABASE_URL or POSTGRES_URL for the Vercel deployment." });
      return;
    }
    // Neon serverless pools must be created and closed within each function request.
    let application;
    try {
      application = createApplication({ skipPostgresInitialization: true });
      if (!schemaInitialized) {
        schemaPromise ||= initializePostgresDatabase(application.db, application.config.currency, SERVICES, now);
        try {
          await schemaPromise;
          schemaInitialized = true;
        } catch (error) {
          schemaPromise = undefined;
          throw error;
        }
      }
      await application.handleApiRequest(req, res);
    } catch (error) {
      console.error("Vercel API startup failed.", error);
      if (!res.headersSent) sendJson(res, 500, { error: "The API could not be initialized." });
    } finally {
      if (application) await application.db.close();
    }
  };
}

if (require.main === module) {
  const app = createApplication();
  app.ready.catch((error) => {
    console.error("Database initialization failed.", error);
    process.exitCode = 1;
  });
  app.server.listen(app.config.port, () => {
    console.log(`Bara Studios app listening at http://localhost:${app.config.port}`);
    if (!app.adminConfigured) {
      console.warn("Admin sign-in is disabled until ADMIN_EMAIL and an ADMIN_PASSWORD of at least 16 characters are configured.");
    }
  });
}

module.exports = { createApplication, createVercelHandler, initializeDatabase };

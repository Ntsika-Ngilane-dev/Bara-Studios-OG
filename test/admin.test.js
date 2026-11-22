const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createApplication } = require("../server");

const app = createApplication({
  config: {
    nodeEnv: "development",
    port: 0,
    databasePath: ":memory:",
    adminEmail: "owner@example.test",
    adminPassword: "test-password-that-is-long-enough",
    currency: "ZAR",
  },
});

let baseUrl;
let cookie;
let csrfToken;

function request(path, { method = "GET", body, headers = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function adminHeaders() {
  return {
    Origin: baseUrl,
    Cookie: cookie,
    "X-CSRF-Token": csrfToken,
  };
}

before(async () => {
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  app.db.close();
});

test("admin APIs require authentication and login establishes a CSRF-protected session", async () => {
  const unauthenticated = await request("/api/admin/clients");
  assert.equal(unauthenticated.status, 401);

  const rejected = await request("/api/auth/login", {
    method: "POST",
    headers: { Origin: baseUrl },
    body: { email: "owner@example.test", password: "wrong-password" },
  });
  assert.equal(rejected.status, 401);

  const login = await request("/api/auth/login", {
    method: "POST",
    headers: { Origin: baseUrl },
    body: { email: "owner@example.test", password: "test-password-that-is-long-enough" },
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  csrfToken = session.csrfToken;
  cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  assert.ok(cookie.includes("bara_admin="));
  assert.ok(csrfToken);

  const summary = await request("/api/admin/summary", { headers: { Cookie: cookie } });
  assert.equal(summary.status, 200);
  assert.equal((await summary.json()).ai_enabled, false);
});

test("client, service, and sale records are persisted and reflected in account analytics", async () => {
  const createdClient = await request("/api/admin/clients", {
    method: "POST",
    headers: adminHeaders(),
    body: {
      name: "Test Client",
      company: "Example Studio",
      email: "client@example.test",
      phone: "+27000000000",
      notes: "Synthetic test data",
    },
  });
  assert.equal(createdClient.status, 201);
  const { id: clientId } = await createdClient.json();

  const servicesResponse = await request("/api/admin/services", { headers: { Cookie: cookie } });
  const services = await servicesResponse.json();
  assert.ok(services.some((service) => service.name === "Technology"));
  const service = services.find((item) => item.name === "Technology");

  const assignment = await request(`/api/admin/clients/${clientId}/services`, {
    method: "POST",
    headers: adminHeaders(),
    body: { service_id: service.id, price_cents: 50000, started_on: "2026-11-21", notes: "Synthetic test data" },
  });
  assert.equal(assignment.status, 201);

  const productResponse = await request("/api/admin/products", {
    method: "POST",
    headers: adminHeaders(),
    body: { name: "Synthetic product", sku: "TEST-1", price_cents: 1500, stock_quantity: 2, track_inventory: true },
  });
  assert.equal(productResponse.status, 201);
  const { id: productId } = await productResponse.json();

  const saleResponse = await request("/api/admin/sales", {
    method: "POST",
    headers: adminHeaders(),
    body: { product_id: productId, quantity: 2, client_id: clientId },
  });
  assert.equal(saleResponse.status, 201);
  assert.equal((await saleResponse.json()).total_cents, 3000);

  const oversell = await request("/api/admin/sales", {
    method: "POST",
    headers: adminHeaders(),
    body: { product_id: productId, quantity: 1, client_id: clientId },
  });
  assert.equal(oversell.status, 409);

  const detail = await request(`/api/admin/clients/${clientId}`, { headers: { Cookie: cookie } });
  const account = await detail.json();
  assert.equal(account.services.length, 1);
  assert.equal(account.services[0].name, "Technology");
  assert.equal(account.sales[0].total_cents, 3000);
  const sales = await request("/api/admin/sales", { headers: { Cookie: cookie } });
  assert.equal((await sales.json())[0].items, "Synthetic product × 2");
  const clientsResponse = await request("/api/admin/clients", { headers: { Cookie: cookie } });
  assert.equal((await clientsResponse.json())[0].revenue_cents, 3000);
});

test("reporting currency can be changed by the signed-in owner", async () => {
  const settings = await request("/api/admin/settings", { headers: { Cookie: cookie } });
  assert.equal((await settings.json()).currency, "ZAR");
  const update = await request("/api/admin/settings", {
    method: "PATCH",
    headers: adminHeaders(),
    body: { currency: "USD" },
  });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).currency, "USD");
});

test("public enquiries are stored and create a priority alert without exposing admin APIs", async () => {
  const inquiry = await request("/api/inquiries", {
    method: "POST",
    headers: { Origin: baseUrl },
    body: {
      name: "Synthetic Lead",
      email: "lead@example.test",
      service: "Creative design",
      message: "We have an urgent deadline today.",
      website: "",
    },
  });
  assert.equal(inquiry.status, 201);
  const result = await inquiry.json();

  const inquiries = await request("/api/admin/inquiries", { headers: { Cookie: cookie } });
  const rows = await inquiries.json();
  assert.equal(rows[0].id, result.id);
  assert.equal(rows[0].priority, "high");

  const notifications = await request("/api/admin/notifications", { headers: { Cookie: cookie } });
  const alertRows = await notifications.json();
  assert.equal(alertRows[0].entity_id, result.id);
  assert.equal(alertRows[0].deliveries, null);

  const invalidCsrf = await request(`/api/admin/inquiries/${result.id}`, {
    method: "PATCH",
    headers: { ...adminHeaders(), "X-CSRF-Token": "invalid" },
    body: { status: "closed" },
  });
  assert.equal(invalidCsrf.status, 403);
});

test("admin pages are not cacheable", async () => {
  const response = await request("/admin");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

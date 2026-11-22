const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createVercelHandler } = require("../server");

test("Vercel API fails closed when no PostgreSQL connection is configured", async () => {
  const savedDatabaseUrl = process.env.DATABASE_URL;
  const savedPostgresUrl = process.env.POSTGRES_URL;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;

  const response = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.body = body;
    },
  };

  try {
    await createVercelHandler()(
      { method: "GET", url: "/api/auth/session", headers: {} },
      response,
    );
    assert.equal(response.status, 503);
    assert.match(response.body, /DATABASE_URL or POSTGRES_URL/);
  } finally {
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
    if (savedPostgresUrl === undefined) delete process.env.POSTGRES_URL;
    else process.env.POSTGRES_URL = savedPostgresUrl;
  }
});

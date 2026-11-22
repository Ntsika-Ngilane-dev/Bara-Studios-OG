const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createApplication } = require("../server");

test("server creates a missing parent directory for its persistent database", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bara-admin-test-"));
  const databasePath = path.join(directory, "data", "admin.sqlite");
  const app = createApplication({
    config: {
      databasePath,
      adminEmail: "owner@example.test",
      adminPassword: "test-password-that-is-long-enough",
    },
  });
  try {
    assert.equal(fs.existsSync(databasePath), true);
  } finally {
    app.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("admin sessions survive server restarts but stop working when the password changes", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bara-session-test-"));
  const databasePath = path.join(directory, "data", "admin.sqlite");
  const email = "owner@example.test";
  const originalPassword = "original-test-password-long-enough";
  const appConfig = (adminPassword) => ({
    databasePath,
    adminEmail: email,
    adminPassword,
  });
  let app;
  try {
    app = createApplication({ config: appConfig(originalPassword) });
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    const login = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: originalPassword }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    await new Promise((resolve) => app.server.close(resolve));
    app.db.close();

    app = createApplication({ config: appConfig(originalPassword) });
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const restartedOrigin = `http://127.0.0.1:${app.server.address().port}`;
    const activeSession = await fetch(`${restartedOrigin}/api/auth/session`, { headers: { Cookie: cookie } });
    assert.equal((await activeSession.json()).authenticated, true);
    await new Promise((resolve) => app.server.close(resolve));
    app.db.close();

    app = createApplication({ config: appConfig("changed-test-password-long-enough") });
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const changedOrigin = `http://127.0.0.1:${app.server.address().port}`;
    const expiredSession = await fetch(`${changedOrigin}/api/auth/session`, { headers: { Cookie: cookie } });
    assert.equal((await expiredSession.json()).authenticated, false);
  } finally {
    if (app?.server.listening) await new Promise((resolve) => app.server.close(resolve));
    app?.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

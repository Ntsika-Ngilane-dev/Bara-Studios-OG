const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

test("service worker never intercepts admin or API requests", () => {
  const listeners = new Map();
  const self = {
    location: new URL("https://bara.example/sw.js"),
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
  };
  const caches = {
    match: async () => null,
    open: async () => ({ put: async () => {} }),
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  vm.runInNewContext(source, {
    self,
    caches,
    URL,
    Request,
    fetch: async () => new Response("ok"),
    console,
  });

  for (const pathname of ["/admin", "/admin.html", "/admin.js", "/admin.css", "/api/auth/session", "/api/admin/clients"]) {
    let intercepted = false;
    listeners.get("fetch")({
      request: new Request(`https://bara.example${pathname}`),
      respondWith() {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false, `${pathname} must bypass the service worker cache`);
  }
});

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { PostgresAdapter } = require("../database");

test("PostgreSQL adapter binds parameters, returns inserted IDs, and normalizes numeric results", async () => {
  const calls = [];
  const adapter = new PostgresAdapter({
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("RETURNING id")) {
        return { rows: [{ id: "42" }], rowCount: 1 };
      }
      return { rows: [{ id: "42", total_cents: "1500" }], rowCount: 1 };
    },
  });

  const inserted = await adapter.prepare("INSERT INTO clients (name) VALUES (?)").run("Example");
  assert.equal(inserted.lastInsertRowid, 42);
  assert.match(calls[0].sql, /VALUES \(\$1\) RETURNING id$/);
  assert.deepEqual(calls[0].params, ["Example"]);

  const rows = await adapter.prepare(`
    SELECT GROUP_CONCAT(product_name, ', ') AS items, total_cents FROM sales WHERE id = ?
  `).all(42);
  assert.match(calls[1].sql, /STRING_AGG\(product_name, ', '\)/);
  assert.equal(rows[0].total_cents, 1500);
});

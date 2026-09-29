const test = require("node:test");
const assert = require("node:assert");

test("sin Postgres no hay DATABASE_URL", () => {
  assert.strictEqual(process.env.DATABASE_URL, undefined);
});

test("usa la versión de node-version", () => {
  assert.match(process.version, /^v24\./);
});

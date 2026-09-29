const test = require("node:test");
const assert = require("node:assert");
const net = require("node:net");

test("recibe las líneas de env y pisa DATABASE_URL", () => {
  assert.strictEqual(process.env.FIXTURE_FLAG, "hola");
  assert.strictEqual(process.env.DATABASE_URL, "postgres://ci:ci@localhost:5432/ci?fixture=1");
});

test("el Postgres efímero acepta conexiones", async () => {
  const url = new URL(process.env.DATABASE_URL);
  await new Promise((resolve, reject) => {
    const socket = net.connect(Number(url.port), url.hostname, () => socket.end(resolve));
    socket.on("error", reject);
  });
});

// App mínima para image-smoke: /health responde siempre; /health/db solo si llega a Postgres
// y si recibió el build-arg y la env del workflow.
const http = require("node:http");
const net = require("node:net");

function reachDb() {
  return new Promise((resolve) => {
    if (!process.env.DATABASE_URL) return resolve(false);
    const url = new URL(process.env.DATABASE_URL);
    const socket = net.connect(Number(url.port || 5432), url.hostname, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

http
  .createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ estado: "ok" }));
    }
    if (req.url === "/health/db") {
      const ok =
        (await reachDb()) &&
        process.env.FIXTURE_BUILD_ARG === "horneado" &&
        process.env.FIXTURE_FLAG === "hola";
      res.writeHead(ok ? 200 : 503);
      return res.end(ok ? "ok" : "falla");
    }
    res.writeHead(404);
    res.end();
  })
  .listen(Number(process.env.PORT ?? 3000));

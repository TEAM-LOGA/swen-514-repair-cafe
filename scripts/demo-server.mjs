// Tiny static file server for the two-user demo (no dependencies).
//
//   node scripts/demo-server.mjs
//
// Serves the built frontend (frontend/dist) on port 3000 and the presentation
// deck (presentation/) on port 3001. Port 3000 is reachable as both
// http://localhost:3000 and http://127.0.0.1:3000. Browsers treat those as two
// origins, so each keeps its own Amplify login (localStorage) and the deck can
// show two signed-in users side by side. Both origins are allowed by CORS in
// terraform/main.tf.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_DIR = path.join(root, "frontend", "dist");
const DECK_DIR = path.join(root, "presentation");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function makeServer(dir) {
  return http.createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const file = path.normalize(path.join(dir, pathname));
      if (file !== dir && !file.startsWith(dir + path.sep)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      if (!(await stat(file)).isFile()) throw new Error("not a file");
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    }
  });
}

// Listen on IPv4 and IPv6 loopback only, so nothing is exposed to the network.
function listen(server, port) {
  for (const host of ["127.0.0.1", "::1"]) {
    const s = host === "127.0.0.1" ? server : makeServer(server.dir);
    s.on("error", (err) => {
      if (host === "127.0.0.1") {
        console.error(`Could not listen on ${host}:${port}: ${err.message}`);
        process.exit(1);
      }
      // IPv6 loopback is optional.
    });
    s.listen(port, host);
  }
}

const site = makeServer(SITE_DIR);
site.dir = SITE_DIR;
const deck = makeServer(DECK_DIR);
deck.dir = DECK_DIR;
listen(site, 3000);
listen(deck, 3001);

console.log("Site (user 1): http://localhost:3000/index.html");
console.log("Site (user 2): http://127.0.0.1:3000/index.html");
console.log("Presentation:  http://localhost:3001/");
console.log("Press Ctrl+C to stop.");

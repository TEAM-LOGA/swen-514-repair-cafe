import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await Promise.all([
  copyFile("index.html", "dist/index.html"),
  copyFile("error.html", "dist/error.html"),
]);
await build({
  entryPoints: ["src/main.jsx"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outfile: "dist/assets/app.js",
});

import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";

const sourceRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: sourceRoot,
  base: "./",
  publicDir: path.join(sourceRoot, "public"),
  build: {
    outDir: path.resolve(sourceRoot, "..", "dist"),
    emptyOutDir: true
  }
});

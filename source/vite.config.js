import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";

const sourceRoot = fileURLToPath(new URL(".", import.meta.url));
const gatewayTarget = process.env.CTC_QUERY_GATEWAY_TARGET?.trim() || "http://127.0.0.1:8765";
const allowedHosts = (process.env.CTC_WEB_ALLOWED_HOSTS || "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);
const hostPolicy = allowedHosts.length > 0 ? { allowedHosts } : {};
const climateProxy = {
  "/api/climate": {
    target: gatewayTarget,
    changeOrigin: false
  }
};

export default defineConfig({
  root: sourceRoot,
  base: "./",
  publicDir: path.join(sourceRoot, "public"),
  build: {
    outDir: path.resolve(sourceRoot, "..", "dist"),
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    ...hostPolicy,
    proxy: climateProxy
  },
  preview: {
    host: "127.0.0.1",
    ...hostPolicy,
    proxy: climateProxy
  }
});

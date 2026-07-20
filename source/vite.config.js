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

export function createAppShellAssetManifestPlugin() {
  return {
    name: "ctc-app-shell-asset-manifest",
    generateBundle(_options, bundle) {
      const assets = Object.values(bundle)
        .map((entry) => entry.fileName)
        .filter((fileName) => fileName.startsWith("assets/") && !fileName.endsWith(".map"))
        .sort();
      if (!assets.some((fileName) => fileName.endsWith(".js"))) {
        this.error("앱 셸 자산 목록에 실행 코드가 없습니다.");
      }
      this.emitFile({
        type: "asset",
        fileName: "app-shell-assets.json",
        source: `${JSON.stringify({ schemaVersion: 1, assets }, null, 2)}\n`
      });
    }
  };
}

export default defineConfig({
  appType: "mpa",
  root: sourceRoot,
  base: "./",
  publicDir: path.join(sourceRoot, "public"),
  plugins: [createAppShellAssetManifestPlugin()],
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

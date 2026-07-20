const CACHE_NAME = "climate-web-shell-v19";
const SHELL_INDEX = new URL("index.html", self.location.href).toString();
const SHELL_ASSET_MANIFEST = new URL("app-shell-assets.json", self.location.href).toString();
const SHELL_ASSET_ROOT = new URL("assets/", self.location.href);
const SHELL_ASSETS = [
  "./",
  "index.html",
  "favicon.svg",
  "app.webmanifest",
  "runtime-config.json",
  "assets/icons/app-icon-192.png",
  "assets/icons/app-icon-512.png",
  "assets/icons/app-icon-maskable-512.png",
  "assets/licenses/kma_mark_1.png",
  "assets/licenses/kma_mark_2.png"
].map((path) => new URL(path, self.location.href).toString());

function resolveBuildAssetUrl(assetPath) {
  if (typeof assetPath !== "string" || assetPath.length === 0) {
    throw new Error("앱 셸 자산 경로가 비어 있습니다.");
  }
  const url = new URL(assetPath, self.location.href);
  if (
    url.origin !== self.location.origin
    || !url.pathname.startsWith(SHELL_ASSET_ROOT.pathname)
    || url.search
    || url.hash
  ) {
    throw new Error("앱 셸 자산 경로가 허용 범위를 벗어났습니다.");
  }
  return url.toString();
}

async function cacheAppShell() {
  const response = await fetch(SHELL_ASSET_MANIFEST, { cache: "no-store" });
  if (!response.ok) throw new Error("앱 셸 자산 목록을 불러오지 못했습니다.");
  const manifest = await response.clone().json();
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.assets)) {
    throw new Error("앱 셸 자산 목록 형식이 올바르지 않습니다.");
  }
  const buildAssets = [...new Set(manifest.assets.map(resolveBuildAssetUrl))];
  if (buildAssets.length === 0) throw new Error("앱 셸 자산 목록이 비어 있습니다.");

  const cache = await caches.open(CACHE_NAME);
  await cache.put(SHELL_ASSET_MANIFEST, response);
  await cache.addAll([...SHELL_ASSETS, ...buildAssets]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/climate/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_INDEX, copy));
          return response;
        })
        .catch(() => caches.match(SHELL_INDEX))
    );
    return;
  }

  const refreshBeforeCache = ["script", "style", "worker"].includes(request.destination)
    || /\.(?:css|js)$/iu.test(url.pathname);
  if (refreshBeforeCache) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async (error) => (await caches.match(request)) || Promise.reject(error))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

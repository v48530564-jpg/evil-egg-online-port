const CACHE_NAME = "evil-egg-web-v4";
const PARTS = ["./game.part1","./game.part2","./game.part3"];

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.pathname.endsWith("/game.data")) {
    event.respondWith(buildGameData());
  }
});

async function buildGameData() {
  const responses = await Promise.all(PARTS.map(async part => {
    const r = await fetch(part, {cache:"no-store"});
    if (!r.ok) throw new Error(`Failed to download ${part}: HTTP ${r.status}`);
    return r.arrayBuffer();
  }));

  const total = responses.reduce((n,b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of responses) {
    out.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }

  return new Response(out, {
    status: 200,
    headers: {
      "Content-Type":"application/octet-stream",
      "Content-Length":String(total),
      "Cache-Control":"no-store"
    }
  });
}

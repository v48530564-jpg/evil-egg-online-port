const CACHE_NAME = "evil-egg-v2";

const PARTS = [
    "./game.part1",
    "./game.part2",
    "./game.part3"
];

self.addEventListener("install", event => {
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});


self.addEventListener("fetch", event => {

    const url = new URL(event.request.url);

    /*
     * game.js requests this:
     *
     *     game.data
     *
     * But GitHub Pages doesn't actually contain game.data.
     *
     * We construct it from the three parts.
     */
    if (url.pathname.endsWith("/game.data")) {

        event.respondWith(
            buildGameData()
        );

        return;
    }

});


async function buildGameData() {

    console.log("[Evil Egg] Building game.data...");

    const responses = await Promise.all(
        PARTS.map(async part => {

            const response = await fetch(part, {
                cache: "no-store"
            });

            if (!response.ok) {
                throw new Error(
                    "Failed to download " +
                    part +
                    " (" +
                    response.status +
                    ")"
                );
            }

            console.log(
                "[Evil Egg] Downloaded " +
                part +
                ": " +
                response.headers.get("content-length") +
                " bytes"
            );

            return response.arrayBuffer();
        })
    );


    const totalSize =
        responses.reduce(
            (total, buffer) =>
                total + buffer.byteLength,
            0
        );


    console.log(
        "[Evil Egg] Total game.data size:",
        totalSize
    );


    const combined =
        new Uint8Array(totalSize);


    let offset = 0;


    for (const buffer of responses) {

        combined.set(
            new Uint8Array(buffer),
            offset
        );

        offset += buffer.byteLength;
    }


    console.log(
        "[Evil Egg] game.data assembled successfully"
    );


    return new Response(
        combined,
        {
            status: 200,

            headers: {
                "Content-Type":
                    "application/octet-stream",

                "Content-Length":
                    String(totalSize),

                "Cache-Control":
                    "no-cache"
            }
        }
    );
}

/// <reference no-default-lib="false"/>
/// <reference lib="ESNext" />
/// <reference lib="webworker" />

const SyncEventsEnum = {
  SyncFrames: "SyncFrames",
};

(() => {
  const self = ((globalThis.self));

  const CACHE_NAME = "pwa-example-cache";
  const CACHED_PATHS = new Set([
    "/",
    "/manifest.json",
    "/index.mjs",
    "/icons/512.png",
    "https://unpkg.com/blurhash@2.0.5/dist/index.mjs",
  ]);

  const NOW = new Date().toISOString();

  const blurhashQueue = [];

  const NULL_RECORDING_ID = "$$$NO_RECORDING_ID$$$";

  const messageHandlers = {
    async "recording:record-frame"({ recordingId, hash, at }) {
      blurhashQueue.push({ recordingId, hash, at });
      await self.registration.sync.register(SyncEventsEnum.SyncFrames);
    },

    async "notification:send"({ title, body }) {
      if (Notification.permission === "granted") {
        await self.registration.showNotification(title, {
          body,
        });
      }
    },
  };

  self.addEventListener("sync", (event) => {
    const tag = event.tag;

    switch (event.tag) {
      case SyncEventsEnum.SyncFrames: {
        const syncItems = async () => {
          let item;
          while ((item = blurhashQueue.pop())) {
            const { recordingId, hash, at } = item;

            let success = false;

            if (recordingId !== NULL_RECORDING_ID) {
              success = await fetch(`/api/recordings/${recordingId}`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  hash,
                  at,
                }),
              })
                .then(() => true)
                .catch((error) => {

                  blurhashQueue.unshift(item);

                  throw error;
                });
            }

            if (!success) {
              await new Promise((resolve) => setTimeout(resolve, 350));
            }
          }
        };

        event.waitUntil(syncItems());
      }
    }
  });

  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(CACHED_PATHS);
      })
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => {
          return Promise.all(
            keys
              .filter((key) => key !== CACHE_NAME)
              .map((key) => caches.delete(key))
          );
        })
        .then(() => self.clients.claim())
    );
  });

  self.addEventListener("fetch", (event) => {
    const tryFetchLive = async () => {
      const cacheKey = `${event.request.method} ${event.request.body} ${event.request.url}`;

      try {
        const networkResponse = await fetch(event.request);

        if (networkResponse.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(cacheKey, networkResponse.clone());
        }

        return networkResponse;
      } catch {}

      return tryLoadCached(cacheKey);
    };

    const tryLoadCached = async (cacheKey) => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(cacheKey);

      if (cachedResponse) {
        return cachedResponse;
      }

      return new Response(
        JSON.stringify({
          error: "offline",
        }),
        {
          status: 200,
          statusText: "OK",
        }
      );
    };

    event.respondWith(tryFetchLive());
  });

  self.addEventListener("message", (event) => {
    const { type, data } = event.data;

    const handler = messageHandlers[type];
    if (handler) {
      event.waitUntil(handler(data));
      return;
    }

  });
})();

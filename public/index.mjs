/// <reference no-default-lib="false"/>
/// <reference lib="ES2020" />
/// <reference lib="DOM" />

import * as blurhash from "https://unpkg.com/blurhash@2.0.5/dist/index.mjs";

(() => {

  const FPS = 1;

  let $BODY = null;

  let IS_ONLINE = navigator.onLine;

  let RECORDING_ID = null;

  const BLURHASH_OPTS = {
    punch: 1.5,
    components: {
      x: 4,
      y: 4,
    },
  };

  const html = (strings, ...values) => {
    let result = "";
    for (let i = 0; i < strings.length; i++) {
      result += strings[i];
      if (i < values.length) {
        result += values[i];
      }
    }
    const div = document.createElement("div");
    div.innerHTML = result;
    return Array.from(div.children);
  };

  const render = (...content) => {
    const elements = content.flat();

    $BODY.replaceChildren(...elements);
  };

  const html$ = (strings, ...values) => render(html(strings, ...values));

  const messageSw = (message) => {
    if (!navigator.serviceWorker.controller) {
      return;
    }

    navigator.serviceWorker.controller.postMessage(message);
  };

  const generateBlurhash = ({ src, ctx, width, height }) => {
    ctx.drawImage(src, 0, 0, width, height);

    const hash = blurhash.encode(
      ctx.getImageData(0, 0, width, height).data,
      width,
      height,
      BLURHASH_OPTS.components.x,
      BLURHASH_OPTS.components.y
    );

    return hash;
  };

  const renderBlurhash = ({ hash, ctx, width, height }) => {
    const pixels = blurhash.decode(hash, width, height, BLURHASH_OPTS.punch);
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
  };

  const saveRecordingFrame = async (hash) => {
    if (!RECORDING_ID) {
      return;
    }

    const hasRegisteredSw = Boolean(navigator.serviceWorker.controller);
    const payload = {
      hash,
      at: new Date(),
    };

    if (hasRegisteredSw) {
      messageSw({
        type: "recording:record-frame",
        data: {
          recordingId: RECORDING_ID,
          ...payload,
        },
      });
      return;
    }

    await fetch(`/api/recordings/${RECORDING_ID}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        hash,
        at: new Date(),
      }),
    }).catch((error) => {
    });
  };

  const runApp = async () => {
    $BODY = document.body;

    let hasMediaDevices =
      "mediaDevices" in navigator && "getUserMedia" in navigator.mediaDevices;

    if (!hasMediaDevices) {
      html$`<div>Preglednik ne podržava dohvačanje medijskih uređaja</div>`;
      return;
    }

    html$`<div>Molimo dopustite dohvačanje kamere kako bi aplikacija funkcionirala</div>`;

    const webcam = await navigator.mediaDevices
      .getUserMedia({
        video: true,
      })
      .catch(() => null);

    if (!webcam) {
      html$`<div>Neuspješno dohvačanje kamere. Molimo pokušajte ponovo ili probajte u drugom pregledniku.</div>`;
      return;
    }

    html$`<div class="container">
      <div class="video">
        <video autoplay playsinline></video>
      </div>
      <div class="canvas">
        <canvas></canvas>
        <div class="blurhash"></div>
      </div>
      <div class="record">
        <button class="record-btn">Započni snimku</button>
        <a href="/recordings">Vidi snimke</a>
      </div>
    </div>
    `;

    const $videoContainer = document.querySelector(".video");
    const $video = $videoContainer.querySelector("video");
    const $canvasContainer = document.querySelector(".canvas");
    const $canvas = $canvasContainer.querySelector("canvas");
    const $blurhash = $canvasContainer.querySelector(".blurhash");

    const $recordBtn = document.querySelector(".record-btn");

    if (
      !$videoContainer ||
      !$canvasContainer ||
      !$video ||
      !$canvas ||
      !$blurhash
    ) {
      html$`<div class="error">Video element not found</div>`;
      return;
    }

    $video.srcObject = webcam;
    $video.addEventListener("loadedmetadata", () => {
      $video.play();
    });

    const ctx = $canvas.getContext("2d", {
      willReadFrequently: true,
    });

    const generateAndRenderBlurhash = () => {
      const { width, height } = $canvas;

      const hash = generateBlurhash({
        src: $video,
        ctx,
        width,
        height,
      });

      saveRecordingFrame(hash);

      $blurhash.innerHTML = `Trenutni hash: <pre><code>${hash}</code></pre>`;

      renderBlurhash({
        hash,
        ctx,
        width,
        height,
      });
    };

    {
      generateAndRenderBlurhash();
      let animationFrameHandle;
      setInterval(() => {
        cancelAnimationFrame(animationFrameHandle);

        animationFrameHandle = requestAnimationFrame(generateAndRenderBlurhash);
      }, 1000 / FPS);
    }

    let isLoading = false;

    const setRecordButtonDisabled = (disabled) => {
      if (disabled) {
        $recordBtn.setAttribute("disabled", "true");
      } else {
        $recordBtn.removeAttribute("disabled");
      }
    };

    {
      if (!IS_ONLINE) {
        setRecordButtonDisabled(true);
      }
      window.addEventListener("online", () => {
        if (!isLoading) {
          setRecordButtonDisabled(false);
        }
      });
      window.addEventListener("offline", () => {
        if (!RECORDING_ID) {
          setRecordButtonDisabled(true);
        }
      });
    }

    $recordBtn.addEventListener("click", async (e) => {
      if (isLoading) {
        return false;
      }

      Notification.requestPermission();

      if (RECORDING_ID) {
        messageSw({
          type: "notification:send",
          data: {
            title: "Snimanje završilo",
            body: `Snimanje završilo za snimku ${RECORDING_ID}.`,
          },
        });
        RECORDING_ID = null;
        $recordBtn.innerHTML = "Započni snimku";
        if (!IS_ONLINE) {
          setRecordButtonDisabled(true);
        }
        return;
      }

      e.preventDefault();

      setRecordButtonDisabled(true);

      isLoading = true;
      const recording = await fetch("/api/recordings", {
        method: "POST",
      })
        .then((res) => res.json())
        .catch((e) => {
          return null;
        });
      isLoading = false;

      setRecordButtonDisabled(false);

      RECORDING_ID = recording.recordingId ?? null;

      if (RECORDING_ID) {
        $recordBtn.innerHTML = "Zavrsi snimku";

        messageSw({
          type: "notification:send",
          data: {
            title: "Snimanje započelo",
            body: `Snimanje započelo za snimku ${RECORDING_ID}.`,
          },
        });
      }
    });
  };


  window.addEventListener("online", () => {
    IS_ONLINE = true;
  });
  window.addEventListener("offline", () => {
    IS_ONLINE = false;
    messageSw({
      type: "notification:send",
      data: {
        title: "Više niste spojeni na internet!",
        body: "Niste spojeni na internet, započinjanje snimke nije moguce.",
      },
    });
  });

  if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistration().then((registration) => {
      navigator.serviceWorker.addEventListener("message", (event) => {
      });

      if (!registration || !navigator.serviceWorker.controller) {
        navigator.serviceWorker.register("/sw.js").then(function () {
          window.location.reload();
        });
      } else {

        runApp();
      }
    });
  } else {
    html$`<h1 style="color: red;">Preglednik ne podržava service workere!</h1>`;
  }
})();

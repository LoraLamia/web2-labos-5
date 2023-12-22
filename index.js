const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const Router = express.Router;
const blurhash = require("blurhash");

const RECORDINGS_DIR = path.join(__dirname, "recordings");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const $PAGE = (name) => path.join(__dirname, "pages", `${name}.html`);

app.get("/", (req, res) => {
  res.sendFile($PAGE("index"));
});

app.get("/recordings", (req, res) => {
  res.sendFile($PAGE("recordings"));
});

app.get("/recordings/:recordingId.html", async (req, res) => {
  const { recordingId } = req.params;
  const recordingPath = path.join(RECORDINGS_DIR, `${recordingId}.txt`);

  if (!(await fileExists(recordingPath))) {
    return res.sendStatus(404);
  }

  const pagePath = $PAGE("recording");
  const pageContents = await fs.readFile(pagePath, "utf8");

  return res.send(pageContents.replace("$$$RECORDING_ID$$$", recordingId));
});

app.use(
  "/api",
  Router().use(
    "/recordings",
    Router()
      .get("/", async (req, res) => {
        const recordingsFiles = await fs.readdir(RECORDINGS_DIR);
        const recordingIds = recordingsFiles
          .filter((x) => x.endsWith(".txt"))
          .map((x) => ({
            recordingId: x.slice(0, -4),
          }));

        return res.json({
          recordings: recordingIds,
        });
      })
      .post("/", async (req, res) => {
        const recordingId = genId();
        const recordingPath = path.join(RECORDINGS_DIR, `${recordingId}.txt`);

        fs.writeFile(recordingPath, "");

        return res.json({
          recordingId,
        });
      })
      .patch("/:recordingId", async (req, res) => {
        const { recordingId } = req.params;
        const recordingPath = path.join(RECORDINGS_DIR, `${recordingId}.txt`);

        if (!(await fileExists(recordingPath))) {
          return res.status(404).json({
            error: "Recording not found",
          });
        }

        let payload = req.body;
        if (!Array.isArray(payload)) {
          payload = [payload];
        }

        {
          const invalidEntries = payload.filter(
            (x) => typeof x !== "object" || !x.hash || !x.at
          );
          if (invalidEntries.length > 0) {
            return res.status(400).json({
              error: "Invalid body. Expected keys 'hash' and 'at'.",
              _body: req.body,
              _entries: invalidEntries,
            });
          }
        }

        {
          const invalidBlurhashes = payload.filter(
            (x) => !blurhash.isBlurhashValid(x.hash)
          );
          if (invalidBlurhashes.length > 0) {
            return res.status(400).json({
              error: "Invalid blurhash",
              _hashes: invalidBlurhashes,
            });
          }
        }

        {
          const fileData =
            payload.map((x) => `${x.at} ${x.hash}`).join("\n") + "\n";

          await fs.appendFile(recordingPath, fileData);
        }

        return res.status(204).end();
      })
      .get("/:recordingId", async (req, res) => {
        const { recordingId } = req.params;
        const recordingPath = path.join(RECORDINGS_DIR, `${recordingId}.txt`);

        if (!(await fileExists(recordingPath))) {
          return res.status(404).json({
            error: "Recording not found",
          });
        }

        const fileData = await fs.readFile(recordingPath, "utf8");
        const items = fileData
          .trim()
          .split("\n")
          .map((x) => x.trim())
          .map((x) => {
            const [at, hash] = x.split(" ");

            if (!blurhash.isBlurhashValid(hash)) {
              return null;
            }

            return {
              at: new Date(at),
              hash,
            };
          })
          .filter((x) => x && x.at && x.hash)
          .sort((lt, gt) => lt.at - gt.at);

        let itemsRelative = [];
        for (const i in items) {
          const item = items[i];
          const nextItem = items[Number(i) + 1];

          if (nextItem) {
            itemsRelative.push({
              hash: item.hash,
              duration: nextItem.at - item.at,
            });
          } else {
            itemsRelative.push({
              hash: item.hash,
              duration: 0,
            });
          }
        }

        return res.json({
          items: itemsRelative,
        });
      })
  )
);

function genId() {
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .substring(2)}`;
}

async function fileExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
});

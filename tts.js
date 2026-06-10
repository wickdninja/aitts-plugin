#!/usr/bin/env node
// aiTTS plugin shim. Zero dependencies, zero synthesis, zero parsing of
// anything: it forwards "speak" requests over the aiTTS Mac app's local
// unix socket and exits. The app does all the work (text-to-speech, PDF
// and image extraction, playback) and enforces its own licensing. If the
// app is not installed there is deliberately nothing this script can do
// except point you at the download.
//
// Wire contract (the app side pins this; add fields, never rename):
//   {"cmd":"speak","shape":"text"|"file"|"clipboard","value":"..."}\n
//
// Usage:
//   tts.js "read this sentence"          one text item
//   tts.js --file /abs/path.pdf          app extracts + reads the file
//   tts.js --clipboard                   app reads the clipboard
//   echo "piped text" | tts.js           text from stdin
"use strict";

const net = require("net");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SOCKET_PATH =
  process.env.TTS_SERVICE_SOCK ||
  path.join(os.homedir(), ".claude", "tts", "service.sock");

const APP_BUNDLE_ID = "dev.wickdninja.aitts";
const DOWNLOAD_URL = "https://aitts.dev";

const INSTALL_MESSAGE = [
  "aiTTS app not reachable.",
  "",
  "This plugin is a remote control for the aiTTS Mac app, which does the",
  "actual speaking. Install or launch it, then try again:",
  "",
  `  ${DOWNLOAD_URL}`,
  "",
].join("\n");

function parseArgs(argv) {
  const items = [];
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") {
      const p = argv[++i];
      if (!p) {
        process.stderr.write("tts: --file needs a path\n");
        process.exit(2);
      }
      items.push({ shape: "file", value: path.resolve(p) });
    } else if (a === "--clipboard") {
      items.push({ shape: "clipboard", value: "" });
    } else {
      rest.push(a);
    }
  }
  if (rest.length > 0) items.push({ shape: "text", value: rest.join(" ") });
  return items;
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function connectOnce(timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SOCKET_PATH);
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("timeout"));
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      resolve(sock);
    });
    sock.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function connectWithLaunch() {
  try {
    return await connectOnce(1500);
  } catch {
    /* fall through to launch */
  }
  // The app may simply not be running. `open` is a no-op-ish failure when
  // it isn't installed; we just keep polling the socket either way.
  const byId = spawnSync("open", ["-g", "-b", APP_BUNDLE_ID], { stdio: "ignore" });
  if (byId.status !== 0) {
    spawnSync("open", ["-g", "-a", "aiTTS"], { stdio: "ignore" });
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      return await connectOnce(1000);
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return null;
}

async function main() {
  let items = parseArgs(process.argv.slice(2));
  if (items.length === 0 && !process.stdin.isTTY) {
    const piped = readStdin().trim();
    if (piped) items = [{ shape: "text", value: piped }];
  }
  if (items.length === 0) {
    process.stderr.write(
      'tts: nothing to read. Pass text, --file <path>, --clipboard, or pipe stdin.\n',
    );
    process.exit(2);
  }
  for (const item of items) {
    if (item.shape === "file" && !fs.existsSync(item.value)) {
      process.stderr.write(`tts: no such file: ${item.value}\n`);
      process.exit(2);
    }
  }

  const sock = await connectWithLaunch();
  if (!sock) {
    process.stderr.write(INSTALL_MESSAGE);
    process.exit(1);
  }

  for (const item of items) {
    sock.write(
      JSON.stringify({ cmd: "speak", shape: item.shape, value: item.value }) +
        "\n",
    );
  }
  sock.end(() => {
    process.stdout.write(
      items.length === 1 ? "sent to aiTTS\n" : `sent ${items.length} items to aiTTS\n`,
    );
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(`tts: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
});

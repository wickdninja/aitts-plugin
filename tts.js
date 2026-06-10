#!/usr/bin/env node
// aiTTS plugin shim. Zero dependencies, zero synthesis, zero parsing of
// anything: it forwards "speak" requests over the aiTTS Mac app's local
// unix socket and exits. The app does all the work (text-to-speech, PDF
// and image extraction, playback) and enforces its own licensing. If the
// app is not installed there is deliberately nothing this script can do
// except point you at the download.
//
// Wire contract (the app side pins this; add fields, never rename):
//   {"proto":1,"cmd":"speak","shape":"text"|"file"|"clipboard","value":"..."}\n
// `proto:1` is required: the app's IPC server rejects frames whose proto
// is absent or unknown (IPCServer.handleLine), same as every other sender.
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

// Stream stdin instead of fs.readFileSync(0): touching process.stdin puts
// fd 0 in non-blocking mode, so a sync read EAGAINs as soon as the pipe
// buffer drains (anything over ~64 KiB from a still-writing producer) and
// the reply would silently read as empty.
function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => {
      buf += d;
    });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", () => resolve(buf));
  });
}

function connectOnce(timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SOCKET_PATH);
    const onError = (err) => {
      clearTimeout(timer);
      reject(err);
    };
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("timeout"));
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      // Hand a listener-free socket back; the caller owns errors from here.
      sock.removeListener("error", onError);
      resolve(sock);
    });
    sock.once("error", onError);
  });
}

async function connectWithLaunch() {
  try {
    return await connectOnce(1500);
  } catch {
    /* fall through to launch */
  }
  // The app may simply not be running; ask LaunchServices to start it in
  // the background. If BOTH launch attempts fail, the app is not installed
  // (or `open` is unavailable): polling cannot succeed, so fail fast to
  // the install pointer instead of burning the 10s deadline.
  const byId = spawnSync("open", ["-g", "-b", APP_BUNDLE_ID], { stdio: "ignore" });
  if (byId.status !== 0) {
    const byName = spawnSync("open", ["-g", "-a", "aiTTS"], { stdio: "ignore" });
    if (byName.status !== 0) return null;
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
    const piped = (await readStdin()).trim();
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

  // Serialize up front so oversize input fails BEFORE we connect or launch
  // the app. The app's IPC server detaches any client that accumulates
  // 1 MiB without a newline (DOS bound), and macOS gives the writer no
  // error when that happens, so an oversize frame would be silently
  // dropped while we print success. ~1 MiB of text is hours of speech;
  // long content belongs in a file.
  const frames = items.map(
    (item) =>
      JSON.stringify({
        proto: 1,
        cmd: "speak",
        shape: item.shape,
        value: item.value,
      }) + "\n",
  );
  const MAX_FRAME_BYTES = 1 << 20;
  for (const f of frames) {
    if (Buffer.byteLength(f, "utf8") >= MAX_FRAME_BYTES) {
      process.stderr.write(
        "tts: text too long to send (over 1 MB); save it to a file and use --file\n",
      );
      process.exit(2);
    }
  }

  const sock = await connectWithLaunch();
  if (!sock) {
    process.stderr.write(INSTALL_MESSAGE);
    process.exit(1);
  }

  // A connection error after connect (app quit mid-write, dropped peer)
  // must fail loudly: without a listener Node throws an unhandled 'error',
  // and a swallowed one would let the process exit 0 having sent nothing.
  sock.on("error", (err) => {
    process.stderr.write(
      `tts: connection to aiTTS lost: ${(err && (err.code || err.message)) || err}\n`,
    );
    process.exit(1);
  });
  // Best-effort drop detection: the app never half-closes mid-request (it
  // reads until OUR EOF), so a FIN before our flush completes means it
  // dropped us. Note macOS usually discards writes to a dropped unix-socket
  // peer silently (no EPIPE, FIN often loses the race to the flush), so
  // delivery is ultimately fire-and-forget; this only catches the orderings
  // the kernel lets us see. On the success path the flush callback below
  // exits first.
  sock.on("end", () => {
    process.stderr.write(
      "tts: aiTTS closed the connection before accepting the request\n",
    );
    process.exit(1);
  });

  for (const f of frames) {
    sock.write(f);
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

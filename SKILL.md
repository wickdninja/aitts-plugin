---
name: tts
description: Read content aloud via the aiTTS Mac app, a file, URL, image, PDF, pasted text, or with no argument the last reply in this Claude session. Use when the user says "read this to me", "tts", "text to speech", "explain this out loud", or wants to listen rather than read. Requires the aiTTS Mac app (aitts.dev); this skill is its remote control.
---

# TTS (one-off)

`/tts` reads one thing aloud through the aiTTS Mac app and exits. The app does
all synthesis and playback (local Kokoro voices by default; engine and voice
are chosen in the app's Settings). This skill only forwards a request to the
app's local socket. Continuous narration of your sessions is owned by the app
itself; no daemon, no hooks.

If the app is not installed, the script prints a pointer to https://aitts.dev
and exits. There is no fallback synthesis path; do not try to install one.

**Arguments:** `$ARGUMENTS` (optional). With no argument, read the last
assistant reply of the current session.

## Phase 0: resolve the shim

```bash
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/tts.js" ]; then
  SKILL_DIR="${CLAUDE_PLUGIN_ROOT}"
elif [ -d "${HOME}/.claude/skills/tts" ] && [ -f "${HOME}/.claude/skills/tts/tts.js" ]; then
  SKILL_DIR="${HOME}/.claude/skills/tts"
else
  echo "ERROR: cannot locate tts.js. Install the plugin: claude plugin marketplace add wickdninja/aitts-plugin && claude plugin install tts@aitts" >&2
  exit 1
fi
```

Retired flags: `--on`, `--off`, `--status`, `--mute`, `--skip`, `--pause`,
`--resume`, `--gemini`, `--voices`, `--voice`, `--speed`. If `$ARGUMENTS`
contains any of these, tell the user: continuous narration and voice choice
live in the aiTTS menu-bar app now (Settings -> Voice / Agents), then read any
remaining content normally without the flag.

## Phase 1: route by input type

Decide what `$ARGUMENTS` is and send it. You (Claude) do the gathering; the
shim only forwards.

- **No argument** -> take your own last assistant reply in this session,
  strip code fences and tool noise so it reads well aloud, and pipe it:

  ```bash
  printf '%s' "<the cleaned reply text>" | node "$SKILL_DIR/tts.js"
  ```

- **Plain text** (quoted words, a sentence, pasted prose) -> pass it through:

  ```bash
  node "$SKILL_DIR/tts.js" "<the text>"
  ```

- **Local file** (PDF, image, audio, or any document; absolute or relative
  path that exists) -> let the APP extract it natively (PDFKit / Vision OCR
  beat anything you could do here):

  ```bash
  node "$SKILL_DIR/tts.js" --file "<absolute path>"
  ```

  For a plain-text/markdown/source file you may instead read it yourself,
  trim boilerplate that reads badly aloud (badges, tables, license headers),
  and pipe the cleaned text. Prefer that when the user asked for a summary
  or "explain", not a verbatim read.

- **URL** -> fetch the page yourself (WebFetch), extract the readable article
  text, and pipe it as text. Do NOT pass URLs to the shim; it has no fetcher
  on purpose.

- **Multiple items** -> combine flags freely. `--file` and `--clipboard`
  items play in the order given; all bare text is joined into ONE item
  that plays last, e.g.
  `node "$SKILL_DIR/tts.js" --file "/a.pdf" "and then this remark"`.
  If something must play before a file, send it as a separate invocation.

## Phase 2: report

The shim prints `sent to aiTTS` on success. Tell the user it is playing in
aiTTS (the floating caption window and menu bar controls handle
pause/skip/replay). If the shim printed the install pointer, relay it: the
aiTTS Mac app from https://aitts.dev is required, with a 14-day free trial.

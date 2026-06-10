# aiTTS plugin

Text-to-speech for Claude Code, powered by the [aiTTS Mac app](https://aitts.dev).

## Install

```
claude plugin marketplace add wickdninja/aitts-plugin
claude plugin install tts@aitts
```

Requires the aiTTS Mac app (macOS 14+, Apple Silicon), free 14-day trial at [aitts.dev](https://aitts.dev).

## What you get

**`/tts`** in Claude Code: read a file, URL, image, PDF, pasted text, or the session's last reply out loud. Local neural voices, lock-screen controls, floating captions, and continuous narration of your agent sessions all live in the app; this plugin is its remote control over a local socket.

## How it works

The plugin contains one small script with zero dependencies. It forwards a `speak` request to the app's local unix socket and exits. All synthesis, document extraction, playback, and licensing happen inside the app. Without the app installed, the script prints a download pointer and does nothing else.

## License

MIT for this repo. The aiTTS Mac and iPhone apps are separate, closed-source products.

## Issues

Plugin bugs are welcome here. App support: support@aitts.dev.

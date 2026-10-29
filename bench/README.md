# Benchmarks

`node scripts/bench.cjs <label>` measures the packaged app (`npm run dist` first) and saves the medians here as `<label>.json`, printed against every other label kept. Each run starts the real app on the same lived-in profile (a 450-turn chat of about 350k tokens, 150 more chats and a 115k-word manuscript), times startup and opening things, then runs the scroll self-test.

Startup marks are milliseconds since the process started. The numbers depend on the machine and on how busy it is: compare runs taken one after another on the same machine. Scrolling in particular drifts with load and heat, so for scrolling, run the builds being compared back to back.

## 1.0 speed pass (Ryzen 9 9950X3D, 238 Hz)

| | 0.9 | 1.0 | |
|---|---|---|---|
| Window appears | 563 ms | 293 ms | −48% |
| First painted frame | 563 ms | 522 ms | −7% |
| Interface ready | 393 ms | 411 ms | +5% |
| Database open | 226 ms | 207 ms | −8% |
| Start-up script the page reads | 1.41 MB | 0.51 MB | −64% |
| Main process script | 639 KB | 446 KB | −30% |
| Page memory after start | 33 MB | 30 MB | −9% |
| Long chat open at start | 222 ms | 203 ms | −9% |

What changed: the window shows at once in the theme's colour instead of waiting for its first paint; the bundles are minified; Settings, Judge, Code, Insights, the welcome and the editor load in the background after start instead of before it; and the startup check for replies a crash left streaming reads a small index instead of every message (a full scan that grew with the history).

Scrolling, measured back to back with 0.9 in the same session, is unchanged (median frame 5.5–7.4 ms for 0.9 and 4.2–6.9 ms for 1.0 that afternoon; the morning's 4.2 ms baseline was a quieter machine). Opening a very long chat still has one long frame while every message is laid out once, by design, so later scrolling has no layout left to do.

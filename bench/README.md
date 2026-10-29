# Benchmarks

`node scripts/bench.cjs <label>` measures the packaged app (`npm run dist` first) and saves the medians here as `<label>.json`, printed against every other label kept. Each run starts the real app on the same lived-in profile (a 450-turn chat of about 350k tokens, 150 more chats and a 115k-word manuscript), times startup and opening things, then runs the scroll self-test.

Startup marks are milliseconds since the process started. The numbers depend on the machine and on how busy it is: compare runs taken one after another on the same machine. Scrolling in particular drifts with load and heat, so for scrolling, run the builds being compared back to back.

## 0.9 → 1.0 (Ryzen 9 9950X3D, 238 Hz)

Medians of five starts each; `baseline-0.9.json` against `release-1.0.json` (the finished 1.0 build, after the speed and UI passes).

| | 0.9 | 1.0 | |
|---|---|---|---|
| Window appears | 563 ms | 274 ms | −51% |
| Interface ready | 393 ms | 394 ms | same |
| Database open | 226 ms | 201 ms | −11% |
| Switch chats | 44 ms | 37 ms | −16% |
| Open the 115k-word manuscript | 41 ms | 35 ms | −15% |
| Long chat open at start | 222 ms | 186 ms | −16% |
| Long chat fully laid out | 498 ms | 408 ms | −18% |
| Start-up script the page reads | 1.41 MB | 0.51 MB | −64% |
| Main process script | 639 KB | 446 KB | −30% |
| Page memory after start | 33 MB | 32 MB | −3% |
| Scrolling, median frame | 4.2 ms | 4.5 ms | within noise |

What changed: the window shows at once in the theme's colour instead of waiting for its first paint; the bundles are minified; Settings, Judge, Code, Insights, the welcome and the editor load in the background after start instead of before it; and the startup check for replies a crash left streaming reads a small index instead of every message (a full scan that grew with the history).

Opening a very long chat still has one long frame while every message is laid out once, by design, so later scrolling has no layout left to do.

## Notes from the speed pass

`speed-pass-1.json` was taken mid-pass. Scrolling drifts with how busy the machine is: that afternoon both 0.9 and 1.0 measured 5.5–7.4 ms median frames when run back to back, against the morning's 4.2 ms, so compare scrolling only between runs taken one after another.

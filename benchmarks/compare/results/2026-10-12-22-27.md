# Comparison results, 2026-10-12

- Machine: Apple M5 Pro, 18 cores, 48 GB, darwin 25.6.0 arm64
- Node v25.9.0; Playwright Chromium (headless shell) 156.0.8078.4; CPU throttle 4x for browser timings
- 7 interleaved rounds; SSR: autocannon, 10 connections, 3s warm-up + 10s per route per round
- Load average (1/5/15 min) at start 6.22 / 13 / 15.6, at end 6.93 / 7.71 / 10.16
- Run: 2026-10-12T22:27:28.748Z to 2026-10-12T22:44:52.918Z

Versions:

- Arc: @sunfall/arc-start 0.1.0-alpha.1, @sunfall/arc-core 0.1.0-alpha.1, solid-js 2.0.0-rc.14, effect 4.0.3, vite 8.3.4
- SolidStart: @solidjs/start 2.0.6, @solidjs/router 1.0.0, solid-js 1.9.17, nitro 3.0.260903-beta, vite 8.3.4
- TanStack Start: @tanstack/react-start 1.168.61, @tanstack/react-router 1.170.42, @tanstack/react-query 5.104.2, react 19.3.0, nitro 3.0.260903-beta, vite 8.3.4

## First visit to `/`: bytes downloaded

| Metric     |      Arc |  SolidStart | TanStack Start |
| ---------- | -------: | ----------: | -------------: |
| JS files   |    **4** |           5 |          **4** |
| JS, raw    | 415.7 KB | **96.8 KB** |       376.3 KB |
| JS, gzip   | 136.4 KB | **33.6 KB** |       120.5 KB |
| JS, brotli | 118.8 KB | **30.2 KB** |       105.8 KB |
| HTML, raw  | 424.1 KB |    470.6 KB |   **366.0 KB** |
| HTML, gzip |  40.5 KB |     43.2 KB |    **38.5 KB** |

## Timings

Median of all rounds; the range below each is min–max.

| Metric                                                         |                                   Arc |                            SolidStart |                            TanStack Start |
| -------------------------------------------------------------- | ------------------------------------: | ------------------------------------: | ----------------------------------------: |
| **SSR, `/` (1,000 rows)**                                      |                                       |                                       |                                           |
| Requests/s                                                     |         **309**<br><sub>232–322</sub> |               97<br><sub>82–104</sub> |                 145<br><sub>138–179</sub> |
| Latency p50                                                    |   **29.0 ms**<br><sub>26.0–39.0</sub> |      91.0 ms<br><sub>85.0–109.0</sub> |           58.0 ms<br><sub>49.0–67.0</sub> |
| Latency p99                                                    |   **68.0 ms**<br><sub>62.0–90.0</sub> |    207.0 ms<br><sub>180.0–308.0</sub> |        134.0 ms<br><sub>108.0–173.0</sub> |
| Server CPU per request                                         |   **5.41 ms**<br><sub>5.11–7.05</sub> |    15.78 ms<br><sub>14.61–18.52</sub> |           6.88 ms<br><sub>5.90–7.88</sub> |
| **SSR, `/items/42`**                                           |                                       |                                       |                                           |
| Requests/s                                                     |       2,282<br><sub>1,760–3,759</sub> |   **5,336**<br><sub>4,830–5,465</sub> |           4,312<br><sub>3,686–6,351</sub> |
| Latency p50                                                    |          3.0 ms<br><sub>2.0–4.0</sub> |      **1.0 ms**<br><sub>1.0–1.0</sub> |          **1.0 ms**<br><sub>1.0–2.0</sub> |
| Latency p99                                                    |        11.0 ms<br><sub>6.0–27.0</sub> |      **5.0 ms**<br><sub>4.0–9.0</sub> |              6.0 ms<br><sub>4.0–7.0</sub> |
| Server CPU per request                                         |       0.57 ms<br><sub>0.37–0.62</sub> |   **0.20 ms**<br><sub>0.18–0.25</sub> |           0.28 ms<br><sub>0.21–0.33</sub> |
| **Cold load of `/`, CPU 4x slower**                            |                                       |                                       |                                           |
| TTFB                                                           |            **6 ms**<br><sub>4–6</sub> |             13 ms<br><sub>12–17</sub> |                    8 ms<br><sub>7–9</sub> |
| FCP                                                            |      **124 ms**<br><sub>124–136</sub> |          148 ms<br><sub>140–152</sub> |              136 ms<br><sub>128–140</sub> |
| LCP                                                            |      **124 ms**<br><sub>124–136</sub> |          148 ms<br><sub>140–152</sub> |              136 ms<br><sub>128–140</sub> |
| First click handled                                            |          308 ms<br><sub>273–314</sub> |      **250 ms**<br><sub>246–264</sub> |              283 ms<br><sub>245–296</sub> |
| Total blocking time                                            |             63 ms<br><sub>46–70</sub> |                1 ms<br><sub>0–5</sub> |                **0 ms**<br><sub>0–0</sub> |
| **Client updates on `/`, CPU 4x slower (input to next frame)** |                                       |                                       |                                           |
| Filter: type `amber` (5 keystrokes)                            |             93 ms<br><sub>73–96</sub> |         **65 ms**<br><sub>62–82</sub> |                 77 ms<br><sub>66–96</sub> |
| Filter: clear (back to 1,000 rows)                             |           104 ms<br><sub>94–108</sub> |            99 ms<br><sub>96–109</sub> |             **92 ms**<br><sub>88–98</sub> |
| Toggle: optimistic row update                                  |    **11.1 ms**<br><sub>9.5–11.4</sub> |       14.9 ms<br><sub>13.5–15.2</sub> |           20.6 ms<br><sub>18.4–22.0</sub> |
| Toggle: settled (server + revalidation)                        |         **24 ms**<br><sub>21–25</sub> |          130 ms<br><sub>125–136</sub> |                 35 ms<br><sub>31–36</sub> |
| Navigate list → detail                                         |         **37 ms**<br><sub>33–43</sub> |             41 ms<br><sub>37–45</sub> |                 39 ms<br><sub>36–44</sub> |
| Navigate detail → list                                         |           119 ms<br><sub>83–127</sub> |          111 ms<br><sub>100–115</sub> |           **103 ms**<br><sub>94–126</sub> |
| **Memory on `/` (unthrottled, after forced GC)**               |                                       |                                       |                                           |
| JS heap after load                                             |       7.94 MB<br><sub>7.94–7.95</sub> |       6.25 MB<br><sub>6.25–6.25</sub> |       **5.27 MB**<br><sub>5.26–5.27</sub> |
| JS heap after 100 toggles                                      |       9.37 MB<br><sub>9.37–9.38</sub> |       7.44 MB<br><sub>7.43–7.44</sub> |       **7.41 MB**<br><sub>7.41–7.42</sub> |
| 100 toggles, each settled                                      | 12,493 ms<br><sub>12,153–12,564</sub> | 13,215 ms<br><sub>12,877–13,462</sub> | **11,257 ms**<br><sub>11,051–11,669</sub> |

## Contract checks

| Metric               |              Arc |       SolidStart |   TanStack Start |
| -------------------- | ---------------: | ---------------: | ---------------: |
| `/items/9999` status |              404 |              404 |              404 |
| `/` HTML bytes       |          434,270 |          481,859 |          374,805 |
| Filter `amber`       | 51 of 1000 items | 51 of 1000 items | 51 of 1000 items |

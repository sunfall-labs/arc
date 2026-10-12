# Comparison results, 2026-10-12

- Machine: Apple M5 Pro, 18 cores, 48 GB, darwin 25.6.0 arm64
- Node v25.9.0; Playwright Chromium (headless shell) 156.0.8078.4; CPU throttle 4x for browser timings
- 7 interleaved rounds; SSR: autocannon, 10 connections, 3s warm-up + 10s per route per round
- Load average (1/5/15 min) at start 20.98 / 18.72 / 22.96, at end 4.26 / 8.87 / 14.01
- Run: 2026-10-12T20:41:28.189Z to 2026-10-12T20:59:05.530Z

Versions:

- Arc: @sunfall/arc-start 0.1.0-alpha.1, @sunfall/arc-core 0.1.0-alpha.1, solid-js 2.0.0-rc.14, effect 4.0.3, vite 8.3.4
- SolidStart: @solidjs/start 2.0.6, @solidjs/router 1.0.0, solid-js 1.9.17, nitro 3.0.260903-beta, vite 8.3.4
- TanStack Start: @tanstack/react-start 1.168.61, @tanstack/react-router 1.170.42, @tanstack/react-query 5.104.2, react 19.3.0, nitro 3.0.260903-beta, vite 8.3.4

## First visit to `/`: bytes downloaded

| Metric     |      Arc |  SolidStart | TanStack Start |
| ---------- | -------: | ----------: | -------------: |
| JS files   |        6 |           5 |          **4** |
| JS, raw    | 416.9 KB | **96.8 KB** |       376.3 KB |
| JS, gzip   | 137.7 KB | **33.6 KB** |       120.5 KB |
| JS, brotli | 120.6 KB | **30.2 KB** |       105.8 KB |
| HTML, raw  | 424.2 KB |    470.6 KB |   **366.0 KB** |
| HTML, gzip |  40.5 KB |     43.2 KB |    **38.5 KB** |

## Timings

Median of all rounds; the range below each is min–max.

| Metric                                                         |                                   Arc |                            SolidStart |                            TanStack Start |
| -------------------------------------------------------------- | ------------------------------------: | ------------------------------------: | ----------------------------------------: |
| **SSR, `/` (1,000 rows)**                                      |                                       |                                       |                                           |
| Requests/s                                                     |         **324**<br><sub>131–397</sub> |               77<br><sub>52–101</sub> |                  134<br><sub>80–145</sub> |
| Latency p50                                                    |   **26.0 ms**<br><sub>22.0–67.0</sub> |     115.0 ms<br><sub>84.0–169.0</sub> |          66.0 ms<br><sub>57.0–111.0</sub> |
| Latency p99                                                    |  **65.0 ms**<br><sub>49.0–244.0</sub> |    263.0 ms<br><sub>187.0–439.0</sub> |        164.0 ms<br><sub>140.0–299.0</sub> |
| Server CPU per request                                         |   **5.24 ms**<br><sub>4.43–9.03</sub> |    19.45 ms<br><sub>15.03–24.52</sub> |          7.75 ms<br><sub>6.98–11.18</sub> |
| **SSR, `/items/42`**                                           |                                       |                                       |                                           |
| Requests/s                                                     |         2,765<br><sub>727–2,932</sub> |   **3,910**<br><sub>1,978–5,734</sub> |           3,436<br><sub>1,031–7,215</sub> |
| Latency p50                                                    |         2.0 ms<br><sub>2.0–12.0</sub> |      **1.0 ms**<br><sub>1.0–3.0</sub> |              2.0 ms<br><sub>1.0–7.0</sub> |
| Latency p99                                                    |        12.0 ms<br><sub>8.0–39.0</sub> |        12.0 ms<br><sub>4.0–76.0</sub> |         **8.0 ms**<br><sub>3.0–43.0</sub> |
| Server CPU per request                                         |       0.51 ms<br><sub>0.45–1.39</sub> |   **0.28 ms**<br><sub>0.17–0.43</sub> |           0.33 ms<br><sub>0.18–0.83</sub> |
| **Cold load of `/`, CPU 4x slower**                            |                                       |                                       |                                           |
| TTFB                                                           |            **5 ms**<br><sub>4–8</sub> |             15 ms<br><sub>10–30</sub> |                   9 ms<br><sub>8–12</sub> |
| FCP                                                            |      **132 ms**<br><sub>120–140</sub> |          144 ms<br><sub>128–160</sub> |              148 ms<br><sub>128–152</sub> |
| LCP                                                            |      **132 ms**<br><sub>120–140</sub> |          144 ms<br><sub>128–160</sub> |              148 ms<br><sub>128–152</sub> |
| First click handled                                            |          309 ms<br><sub>294–331</sub> |      **264 ms**<br><sub>224–289</sub> |              289 ms<br><sub>284–317</sub> |
| Total blocking time                                            |             61 ms<br><sub>52–73</sub> |                2 ms<br><sub>0–6</sub> |                **0 ms**<br><sub>0–0</sub> |
| **Client updates on `/`, CPU 4x slower (input to next frame)** |                                       |                                       |                                           |
| Filter: type `amber` (5 keystrokes)                            |             75 ms<br><sub>70–94</sub> |         **65 ms**<br><sub>59–77</sub> |                 88 ms<br><sub>75–94</sub> |
| Filter: clear (back to 1,000 rows)                             |           104 ms<br><sub>94–108</sub> |           100 ms<br><sub>90–105</sub> |            **95 ms**<br><sub>91–101</sub> |
| Toggle: optimistic row update                                  |   **10.5 ms**<br><sub>10.0–11.2</sub> |       14.7 ms<br><sub>13.9–15.4</sub> |           21.2 ms<br><sub>19.6–23.1</sub> |
| Toggle: settled (server + revalidation)                        |         **25 ms**<br><sub>21–33</sub> |          131 ms<br><sub>122–142</sub> |                 35 ms<br><sub>33–38</sub> |
| Navigate list → detail                                         |             41 ms<br><sub>31–53</sub> |             40 ms<br><sub>34–45</sub> |             **38 ms**<br><sub>32–45</sub> |
| Navigate detail → list                                         |           114 ms<br><sub>95–129</sub> |           112 ms<br><sub>95–116</sub> |           **108 ms**<br><sub>83–144</sub> |
| **Memory on `/` (unthrottled, after forced GC)**               |                                       |                                       |                                           |
| JS heap after load                                             |       7.96 MB<br><sub>7.96–7.96</sub> |       6.25 MB<br><sub>6.25–6.25</sub> |       **5.27 MB**<br><sub>5.27–5.29</sub> |
| JS heap after 100 toggles                                      |       9.42 MB<br><sub>9.41–9.43</sub> |   **7.44 MB**<br><sub>7.41–7.44</sub> |           7.44 MB<br><sub>7.43–7.45</sub> |
| 100 toggles, each settled                                      | 12,476 ms<br><sub>12,387–12,499</sub> | 13,307 ms<br><sub>13,135–13,554</sub> | **11,668 ms**<br><sub>11,408–12,405</sub> |

## Contract checks

| Metric               |              Arc |       SolidStart |   TanStack Start |
| -------------------- | ---------------: | ---------------: | ---------------: |
| `/items/9999` status |              500 |              404 |              404 |
| `/` HTML bytes       |          434,389 |          481,859 |          374,805 |
| Filter `amber`       | 51 of 1000 items | 51 of 1000 items | 51 of 1000 items |

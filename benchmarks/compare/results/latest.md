# Comparison results, 2026-10-12

- Machine: Apple M5 Pro, 18 cores, 48 GB, darwin 25.6.0 arm64
- Node v25.9.0; Playwright Chromium (headless shell) 156.0.8078.4; CPU throttle 4x for browser timings
- 7 interleaved rounds; SSR: autocannon, 10 connections, 3s warm-up + 10s per route per round
- Load average (1/5/15 min) at start 18.22 / 23.06 / 35.79, at end 28.35 / 28.81 / 30.35
- Run: 2026-10-12T19:08:13.194Z to 2026-10-12T19:27:45.848Z

Versions:

- Arc: @sunfall/arc-start 0.1.0-alpha.1, @sunfall/arc-core 0.1.0-alpha.1, solid-js 2.0.0-rc.14, effect 4.0.3, vite 8.3.4
- SolidStart: @solidjs/start 2.0.6, @solidjs/router 1.0.0, solid-js 1.9.17, nitro 3.0.260903-beta, vite 8.3.4
- TanStack Start: @tanstack/react-start 1.168.61, @tanstack/react-router 1.170.42, @tanstack/react-query 5.104.2, react 19.3.0, nitro 3.0.260903-beta, vite 8.3.4

## First visit to `/`: bytes downloaded

| Metric     |      Arc |  SolidStart | TanStack Start |
| ---------- | -------: | ----------: | -------------: |
| JS files   |        6 |           5 |          **4** |
| JS, raw    | 454.4 KB | **96.8 KB** |       376.3 KB |
| JS, gzip   | 149.2 KB | **33.6 KB** |       120.5 KB |
| JS, brotli | 130.2 KB | **30.2 KB** |       105.8 KB |
| HTML, raw  | 425.0 KB |    470.6 KB |   **366.0 KB** |
| HTML, gzip |  40.4 KB |     43.2 KB |    **38.5 KB** |

## Timings

Median of all rounds; the range below each is min–max.

| Metric                                                         |                                   Arc |                            SolidStart |                            TanStack Start |
| -------------------------------------------------------------- | ------------------------------------: | ------------------------------------: | ----------------------------------------: |
| **SSR, `/` (1,000 rows)**                                      |                                       |                                       |                                           |
| Requests/s                                                     |               60<br><sub>34–129</sub> |                48<br><sub>31–63</sub> |                **78**<br><sub>41–94</sub> |
| Latency p50                                                    |     148.0 ms<br><sub>71.0–248.0</sub> |    166.0 ms<br><sub>143.0–258.0</sub> |    **112.0 ms**<br><sub>100.0–232.0</sub> |
| Latency p99                                                    |  395.0 ms<br><sub>142.0–1,159.0</sub> |    656.0 ms<br><sub>425.0–927.0</sub> |    **314.0 ms**<br><sub>218.0–678.0</sub> |
| Server CPU per request                                         |    19.62 ms<br><sub>12.13–21.08</sub> |    24.00 ms<br><sub>21.07–26.45</sub> |    **11.07 ms**<br><sub>10.40–12.31</sub> |
| **SSR, `/items/42`**                                           |                                       |                                       |                                           |
| Requests/s                                                     |           567<br><sub>424–1,946</sub> |   **1,998**<br><sub>1,060–2,828</sub> |             1,236<br><sub>884–2,153</sub> |
| Latency p50                                                    |        14.0 ms<br><sub>3.0–15.0</sub> |      **3.0 ms**<br><sub>2.0–4.0</sub> |              6.0 ms<br><sub>3.0–6.0</sub> |
| Latency p99                                                    |      56.0 ms<br><sub>17.0–114.0</sub> |   **30.0 ms**<br><sub>12.0–75.0</sub> |           46.0 ms<br><sub>15.0–85.0</sub> |
| Server CPU per request                                         |       1.62 ms<br><sub>0.66–1.79</sub> |   **0.43 ms**<br><sub>0.39–0.48</sub> |           0.67 ms<br><sub>0.49–0.73</sub> |
| **Cold load of `/`, CPU 4x slower**                            |                                       |                                       |                                           |
| TTFB                                                           |             20 ms<br><sub>13–79</sub> |            30 ms<br><sub>21–121</sub> |              **16 ms**<br><sub>8–57</sub> |
| FCP                                                            |      **192 ms**<br><sub>176–336</sub> |          212 ms<br><sub>160–324</sub> |              216 ms<br><sub>144–276</sub> |
| LCP                                                            |      **192 ms**<br><sub>176–336</sub> |          212 ms<br><sub>160–324</sub> |              216 ms<br><sub>144–276</sub> |
| First click handled                                            |          627 ms<br><sub>402–671</sub> |      **407 ms**<br><sub>324–542</sub> |              450 ms<br><sub>346–559</sub> |
| Total blocking time                                            |          259 ms<br><sub>137–486</sub> |             33 ms<br><sub>23–74</sub> |               **5 ms**<br><sub>0–13</sub> |
| **Client updates on `/`, CPU 4x slower (input to next frame)** |                                       |                                       |                                           |
| Filter: type `amber` (5 keystrokes)                            |          130 ms<br><sub>102–166</sub> |       **102 ms**<br><sub>73–149</sub> |              146 ms<br><sub>105–169</sub> |
| Filter: clear (back to 1,000 rows)                             |          208 ms<br><sub>165–374</sub> |          150 ms<br><sub>128–212</sub> |          **147 ms**<br><sub>128–200</sub> |
| Toggle: optimistic row update                                  |   **17.3 ms**<br><sub>13.5–38.3</sub> |       21.6 ms<br><sub>19.0–31.0</sub> |           31.8 ms<br><sub>23.7–39.1</sub> |
| Toggle: settled (server + revalidation)                        |        **61 ms**<br><sub>48–126</sub> |          215 ms<br><sub>186–254</sub> |                 70 ms<br><sub>44–93</sub> |
| Navigate list → detail                                         |           144 ms<br><sub>73–288</sub> |           121 ms<br><sub>61–181</sub> |           **102 ms**<br><sub>58–142</sub> |
| Navigate detail → list                                         |          263 ms<br><sub>193–397</sub> |          205 ms<br><sub>163–285</sub> |          **200 ms**<br><sub>159–284</sub> |
| **Memory on `/` (unthrottled, after forced GC)**               |                                       |                                       |                                           |
| JS heap after load                                             |    11.57 MB<br><sub>11.56–11.58</sub> |       6.25 MB<br><sub>6.25–6.25</sub> |       **5.27 MB**<br><sub>5.27–5.30</sub> |
| JS heap after 100 toggles                                      |    12.95 MB<br><sub>12.94–12.99</sub> |   **7.44 MB**<br><sub>7.39–7.44</sub> |           7.45 MB<br><sub>7.44–7.47</sub> |
| 100 toggles, each settled                                      | 13,868 ms<br><sub>13,410–14,475</sub> | 15,012 ms<br><sub>14,863–15,183</sub> | **12,265 ms**<br><sub>12,032–14,200</sub> |

## Contract checks

| Metric               |              Arc |       SolidStart |   TanStack Start |
| -------------------- | ---------------: | ---------------: | ---------------: |
| `/items/9999` status |              500 |              404 |              404 |
| `/` HTML bytes       |          435,197 |          481,859 |          374,805 |
| Filter `amber`       | 51 of 1000 items | 51 of 1000 items | 51 of 1000 items |

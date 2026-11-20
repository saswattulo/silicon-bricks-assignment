# Decisions log: Bangkok plot massing tool

Living record of what the rules are, where each number comes from, and every call made where the law or data was unclear. Newest decisions at the bottom of each section.

## 1. Which law applies

| Layer | Instrument | Status (checked 2026-11-20) | Used for |
|---|---|---|---|
| Zoning | Ministerial Regulation enforcing the Bangkok Comprehensive Plan B.E. 2556 (2013), Royal Gazette vol. 130 part 41 Kor, 16 May 2013 | **Still binding.** The 4th revision ("Draft Bangkok Comprehensive Plan 2026") finished its 90-day public petition window on 9 Nov 2026 and is expected to be enacted late 2027 (LAD, Bangkok Post, Wikipedia). | Land use permission, FAR, OSR, FAR bonus |
| Building control (Bangkok) | Bangkok Metropolitan Administration Building Control Ordinance B.E. 2544 (ข้อบัญญัติกรุงเทพมหานคร เรื่อง ควบคุมอาคาร พ.ศ. 2544) | In force | Road setbacks (cl. 50), height vs road (cl. 49), side openings (cl. 54), open space around building (cl. 55), front fire space (cl. 52-53) |
| Building control (national) | Ministerial Regulation No. 55 B.E. 2543 (2000) | In force; mirrors the Bangkok ordinance on the clauses we use | Open space ≥30% of largest floor for residential (cl. 33), road setback (cl. 41), height vs road (cl. 44-46), openings (cl. 50) |
| High-rise / extra-large | Ministerial Regulation No. 33 B.E. 2535 (1992) | In force | ≥23 m or ≥10,000 m²: 6 m from all boundaries and public road (cl. 4), frontage ≥12 m on a ≥10 m road (≥18 m road if >30,000 m²) (cl. 2), 6 m fire access around (cl. 3), open space ≥30% of plot for residential (cl. 6), FAR ≤10 (cl. 5) |

**Call:** build against the 2013 plan because it is the one a permit would be judged against today. The draft is shown only as a note, because its FAR figures are still contestable.

## 2. The zone: ย.8 (brown, "very high density residential")

**Call:** the one zone done properly is **ย.8**. Pilot site: Thong Lo (Sukhumvit Soi 55, Watthana), block ย.8-23, which a Pruksa land listing places at 13.726314, 100.581890.

Why ย.8:
- It is where Bangkok condos are actually built (inner-city brown zone), so the developer question in the brief is real here.
- Clause 15 of the 2013 regulation does **not** restrict residential condominiums by size or road width in ย.8, so the binding constraints become geometric and building-control ones (setbacks, the road height plane, the 23 m high-rise line), which is exactly what a 3D tool can show. Hotels >50 rooms and offices >1,000 m² *are* road-width restricted in ย.8, which makes the building-type switch meaningful.
- It is eligible for the public-open-space FAR bonus (cl. 53 covers ย.8-ย.10, พ.2-พ.5).

FAR / OSR table (read clause by clause from the regulation text, lawplayer.com mirror of the Krisdika text, cross-checked with the Royal Gazette PDF for ย.1-ย.3):

| Zone | Clause | FAR max | OSR min (% of total floor area) |
|---|---|---|---|
| ย.1 | 8 | 1 | 40 |
| ย.2 | 9 | 1.5 | 20 |
| ย.3 | 10 | 2.5 | 12.5 |
| ย.4 | 11 | 3 | 10 |
| ย.5 | 12 | 4 | 7.5 |
| ย.6 | 13 | 4.5 | 6.5 |
| ย.7 | 14 | 5 | 6 |
| **ย.8** | **15** | **6** | **5** |
| ย.9 | 16 | 7 | 4.5 |
| ย.10 | 17 | 8 | 4 |
| พ.1 | 18 | 5 | 6 |
| พ.2 | 19 | 6 | 5 |
| พ.3 | 20 | 7 | 4.5 |
| พ.4 | 21 | 8 | 4 |
| พ.5 | 22 | 10 | 3 |

Every zone also requires: OSR not below the building-control minimum open space, and **at least 50% of the open space permeable and planted**.

Note an easy trap: **Bangkok OSR is open space as a percentage of total floor area, not of plot area.** At FAR 6 and OSR 5%, open space must be ≥ 0.05 × 6 = 30% of the plot, so coverage is capped at 70% before any building-control rule applies.

## 3. Building-control rules modelled (and how they shape geometry)

| # | Rule | Source | Geometry effect |
|---|---|---|---|
| R1 | Road setback: road <10 m → 6 m from road centreline; 10-20 m → 1/10 of road width from the road boundary; >20 m → 2 m | BKK Ord. 2544 cl. 50; MR55 cl. 41 | Inset of each road-facing edge |
| R2 | Height at any point ≤ 2 × horizontal distance to the far side of the nearest public road | BKK Ord. cl. 49; MR55 cl. 44 | Inclined "sky plane" rising from the road; envelope top is sloped |
| R3 | Plot on two unequal roads (corner, or two roads ≤60 m apart): measure to the wider road; length along narrower road ≤60 m | MR55 cl. 45-46 | Use wider road's plane; flag length |
| R4 | Openings toward a neighbour: ≤9 m high (floors 1-2) → 2 m; >9 m (floor 3+) → 3 m | BKK Ord. cl. 54; MR55 cl. 50 | Stepped side setback by height |
| R5 | High-rise (≥23 m) or extra-large (≥10,000 m²): every part ≥6 m from neighbour boundaries and from the public road | MR33 cl. 4 | 6 m inset all round, including podium |
| R6 | High-rise / extra-large: a side ≥12 m long on a public road with right-of-way ≥10 m (≥18 m if >30,000 m²) | MR33 cl. 2 | Pass/fail on frontage |
| R7 | Residential open space ≥30% of the largest floor plate | MR55 cl. 33 | Caps footprint |
| R8 | High-rise / extra-large residential: open space ≥30% of plot | MR33 cl. 6 | Caps footprint |
| R9 | FAR ≤ zone FAR (+ bonus ≤20%) | 2013 plan cl. 15, 51-57 | Caps total floor area |
| R10 | OSR ≥ zone OSR | 2013 plan cl. 15 | Caps footprint as a function of floor area |
| R12 | Parking. Condo: 1 per unit only for units ≥60 m², but any building >2,000 m² (or ≥15 m high and >1,000 m²) needs ≥1 space per 120 m². Hotel: 10 for the first 30 rooms, +1 per 5 rooms up to 100, +1 per 10 above, and the same 1 per 120 m² floor for large buildings. Office: 1 per 60 m². Stall 2.4 × 5.0 m, 90° aisle 6 m | BKK Ord. 2544 cl. 83-88; MR 7 (B.E. 2517) as amended by MR 41 | Concepts convert lower floors to parking until the count is met; about 30 m² gross per space |
| R13 | EIA: residential buildings with ≥80 units, or hotels with ≥80 rooms or ≥4,000 m², need an EIA report before permit | MoNRE notification of 19 Nov 2018, rows 30-31 | Information line only (time and cost, not geometry) |
| R11 | Buildings >3 floors not on the road need 12 m fire space; exempt if building face toward the road is ≥1/8 of perimeter and within 20 m of the road | BKK Ord. cl. 52(6), 53 | Pass/fail per concept |

## 4. Calls where the law or data is unclear

1. **Two envelopes, not one.** The setbacks depend on the building's class, and the class depends on the design (23 m height line and 10,000 m² floor-area line). So the tool shows the low-rise envelope (<23 m, 2/3 m side setbacks) and the high-rise envelope (6 m all round, sloped road plane), and each concept is checked against its own class. This mirrors the real Bangkok trade-off: the "8-storey low-rise condo" exists precisely to stay under 23 m and avoid MR33.
2. **Distance rules use true distance.** "≥3 m from the boundary" is modelled as distance from every boundary segment (polygon minus buffered edges), so any plot shape works, including concave ones.
3. **Height measured to roof slab**, per MR33 cl. 1 and MR55 cl. 44. Parapets and lift overruns are ignored.
4. **Plot edge to road.** The user marks which plot edges face a public road and gives the right-of-way width. The plot boundary is taken as the road boundary (no future road-widening line). Road widths default to OpenStreetMap-informed estimates and must be confirmed by the user.
5. **Floor area for FAR includes parking** (conservative; MR33 excludes only roof deck, external stairs and plant).
6. **Public-open-space bonus (cl. 53)** applies to "public buildings" under the building control act; a pure condo arguably isn't one. The tool offers the rainwater and green-building bonuses (cl. 55-56) for all types and flags cl. 53 as hotel/office only.
7. **Low-rise uses one side setback for all floors.** R4 allows 2 m up to 9 m and 3 m above. The low-rise envelope shows both steps, but the low-rise concept uses 3 m on every floor so the floor plates stack straight. This loses a little floor area and keeps the design buildable.
8. **Unit and room counts are estimates**: net saleable area = floor area × efficiency (condo 72%, hotel 62%, office 75%), divided by an average unit (condo 35 m², hotel room 32 m²). These drive the parking and EIA lines only.
9. **Large plots.** On a 12 m road, a building over 30,000 m² is not allowed (MR33 cl. 2 needs an 18 m road), so the tool caps floor area at 30,000 m² there. The low-rise concept tries two footprints, a uniform inset and a band along the road, and keeps the one that passes more checks. On big plots the band wins because a centred block would be more than 20 m from the road and fail the fire-truck rule.
10. **Shadows are computed, not rendered.** The sun position comes from the NOAA low-precision formulae (good to about 0.5°) for the plot's latitude and longitude, in Bangkok time (UTC+7). Each floor of the design, and each surrounding building at its OpenStreetMap height, is swept along the sun direction to give its exact ground shadow, which is drawn on the map. Shadows fall on flat ground only (they do not climb neighbouring walls). Presets are the 21st of March, June, September and December, 07:00-18:00.
11. **Structure changes geometry, not the rules.** The use (condo, hotel, office) decides zoning and parking. The structural system decides storey heights, tower plate depth and length, the bay the plate snaps to, and the sellable share. Presets are typical Thai pre-design figures: cast-in-place concrete (free grid), precast concrete (wall panels and hollow-core slabs on a 7.2 m bay, 9.6 m double-tees for offices), post-tensioned flat slab (8.4 m), steel frame (9 m). A custom building lets the user set every one of these numbers within sane limits, and is saved in their browser. Condo units of 60 m² or more switch parking to one space per unit (BKK Ord. cl. 84(3)).
12. **Your design is checked, not corrected.** The third concept is whatever the user shapes: box, round, oval, L, hexagon, octagon, triangle or an outline traced from a picture. They set size, rotation, position relative to the road, tower and podium floors, taper and twist. It runs through the same independent checklist, so an oversized design shows its failures. Trimming to the envelope is a separate opt-in switch. Storey heights come from the chosen structure, using the low-rise heights when the whole building then stays under 23 m.
13. **Picture to draft runs in the browser.** The site is static, so there is no server and no AI key to protect. The picture is shrunk to 320 px and the building is separated from its background by colour distance. Photos are compared with the edge colour of each row, because the sky changes with height. A plan or sketch is traced and simplified, and recognised as a circle, ellipse or rectangle when it fits one. A side photo gives proportions, a floor count from the rhythm of window rows, a taper, and a wider podium at the base. A side view cannot show the plan shape, so the user picks it. Everything is a draft that the user fine-tunes. An AI reading would need a backend or the user's own API key, so it was left out.
14. **Zone lookup.** The BMA's zoning GIS (cityplangis / 3d-cpd ArcGIS) could not be reached from our build environment, so the zone is a user input defaulting to ย.8, with a link to the BMA map to confirm. The tool does not claim to know a plot's zone.

## 5. Sources

- 2013 plan full text: https://lawplayer.com/th/act/pythainlp_65c00507d91ad439 (mirror of Krisdika); Royal Gazette PDF https://download.asa.or.th/03media/04law/cpa/mr56-bma.pdf
- Draft 2026 plan status: https://www.lad.co.th/en/post/what-changes-in-the-draft-bangkok-comprehensive-plan-2026-10-key-issues-to-review-before-the-90-day ; https://en.wikipedia.org/wiki/Bangkok_Comprehensive_Plan
- MR55 full text: http://law.longdo.com/law/179/sub13869
- MR33 full text: https://lawplayer.com/th/act/pythainlp_7e669ae6954267e6
- BKK Building Control Ordinance 2544: https://www.bsa.or.th/ (mirror) and https://download.asa.or.th/03media/04law/cba/bb/bb44-03.pdf
- L/6 and L/8 explainer: https://realplusgroup.com/ (Real Plus, "ระยะร่นอาคารที่สร้างใน กทม L/6 และ L/8")
- Pilot block ย.8-23 Thong Lo: Pruksa land listing PDF (static.pruksa.com)

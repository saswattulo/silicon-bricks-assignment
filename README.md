# Bangkok plot massing tool

A browser tool that shows what can legally be built on a plot in Bangkok's ย.8 zone. You draw any plot on a real 3D map, mark which edges face a road and pick a building type. The tool then works out the rules (FAR, open space ratio, setbacks, height limits), draws the allowed envelope in 3D among the real surrounding buildings, and checks concept designs against every rule, live as you change anything.

- **Live (Vercel, with AI photo reading):** https://silicon-bricks-assignment-app.vercel.app/
- **Mirror (GitHub Pages, no photo reading):** https://saswattulo.github.io/silicon-bricks-assignment/
- **Rules, sources and every judgement call:** [`docs/DECISIONS.md`](docs/DECISIONS.md)

---

## Contents

1. [Use cases](#1-use-cases)
2. [End users](#2-end-users)
3. [What the tool does](#3-what-the-tool-does)
4. [Tech stack](#4-tech-stack)
5. [Architecture](#5-architecture)
6. [Setup, environment variables and deploy](#6-setup-environment-variables-and-deploy)
7. [Key decisions](#7-key-decisions)
8. [What worked, what needed a fix, what still fails](#8-what-worked-what-needed-a-fix-what-still-fails)
9. [Known limitations](#9-known-limitations)

---

## 1. Use cases

- **Land acquisition, first pass.** A plot is on offer. Before paying an architect, a developer wants to know roughly how much floor area it can carry and whether an 8-storey low-rise or a tower makes more sense.
- **Understanding why the numbers are what they are.** The tool shows which rule binds (open space, the road height plane, the 23 m high-rise line, the 6 m setback) instead of just giving a number.
- **Testing a design idea.** A user shapes their own building (round, oval, L, polygon, courtyard, tiers, taper, twist), or builds one from scratch, and sees immediately which rules it breaks.
- **Starting from a reference picture.** Upload a photo, plan or sketch of a building you like; an AI vision model turns it into an editable draft massing that is then checked against the plot's rules.
- **Checking the drawing against the title deed.** Enter the chanote area in rai, ngan and square wah (or m²) and see whether the drawn plot overstates the land.
- **Sharing and presenting.** Send a link that rebuilds the exact setup, or download a PDF report with 3D snapshots, rules, checklists and area schedules.
- **Sun and shadow.** See where the building's shadow falls at any hour on the solstices and equinoxes, together with the shadows of the real buildings around it.

## 2. End users

- **Property developers and land buyers** in Bangkok who need a quick, defensible feasibility answer.
- **Architects and planners** at the pre-design stage, who want a starting envelope and a rule checklist with clause references.
- **Brokers and landowners** who want to show a buyer what a plot can carry.
- **Non-experts** in general: all messages, checks and AI notes are written in plain sentences, and the tool says clearly that it is not a permit check.

## 3. What the tool does

The side panel has four steps, with a summary strip (plot area, max floor area, result of the selected design) that is always visible.

1. **Plot and roads.** Draw any polygon on a 3D map of Bangkok, edit its corners, or load the demo plot on Thong Lo. Mark which edges face a public road and set each road's width (the tool can suggest roads from the OpenStreetMap layer). Optional title deed check.
2. **Building.** Condo, hotel or office; BTS/MRT station within 500 m; FAR bonus (0 to 20%); structural system (cast-in-place, precast, post-tensioned, steel, or a custom one saved in the browser).
3. **Rules.** Max floor area, open space, height plane, low-rise and high-rise setbacks, each with its legal source.
4. **Designs.** Two legal envelopes in 3D (low-rise under 23 m, high-rise under the 2:1 road plane) and concepts:
   - an 8-storey low-rise,
   - a tower on a parking podium,
   - **your design**, shaped with sliders, read from a photo, or built from scratch.

   Each concept has a pass/fail checklist of 10 to 12 rules with clause references, a floor-by-floor area schedule that adds up, and parking and EIA lines.

Extras: bird's-eye view, sun and shadow study, toggle for surrounding buildings, satellite layer, facade detail (slab edges, window bands, mullions, balconies, parapets, roof plant), share link, PDF report and dark mode.

Demo numbers (Thong Lo plot, 2,346 m², 25 m road, condo): max floor area 14,075 m². The low-rise is 8 storeys, 22.8 m and 9,999 m², and passes all 10 checks. The tower is 20 storeys, 61.5 m and 13,550 m², passes all 12 checks, and triggers an EIA.

## 4. Tech stack

| Area | Choice |
|---|---|
| App | React 19, TypeScript, Vite |
| Map | MapLibre GL 6, OpenFreeMap vector tiles (real 3D buildings and roads), optional Esri satellite layer |
| Drawing on the map | terra-draw with its MapLibre adapter |
| 3D | three.js drawn inside MapLibre as a custom layer, so the massing shares depth with real buildings |
| Geometry | clipper-lib (polygon booleans and offsets), earcut (triangulation), turf (areas) |
| Rules | Own TypeScript rules engine (`app/src/rules/engine.ts`) |
| AI photo reading | Vercel serverless function calling **Google Gemini** (`gemini-3.8-flash`, fallback `gemini-3.5-flash-lite`) or **OpenRouter** (`anthropic/claude-sonnet-5.5`), with a zod schema for structured output |
| PDF | jsPDF and jspdf-autotable, generated in the browser |
| Tests | Vitest (50 tests across the rules engine, deed check, structural systems, sun position, share links, photo reading and the in-browser picture reader) |
| Hosting | Vercel (main deploy, with the API function); GitHub Pages via GitHub Actions (static mirror) |

## 5. Architecture

```
app/
  api/read-building.ts      Vercel function: GET says whether a key is set, POST reads a picture
  src/
    rules/engine.ts         Rules, envelopes, concept generation, independent checks
    rules/zones.ts          FAR / OSR per zone (2013 Bangkok Comprehensive Plan)
    rules/systems.ts        Structural system presets and custom buildings
    rules/deed.ts           Title deed area conversion and comparison
    geo/                    Local metre frame, polygon geometry, sun position (NOAA)
    map/MapView.tsx         MapLibre map, drawing, roads, shadows, dark basemap
    map/roads.ts            Road suggestions from the OpenStreetMap layer
    three/massing.ts        three.js custom layer: envelopes and floor-by-floor buildings
    ai/readBuilding.ts      Server-only: prompt, schema, Gemini and OpenRouter calls
    ui/Panel.tsx            Four-step side panel and summary strip
    ui/DesignEditor.tsx     "Your design" editor and photo upload
    ui/Builder.tsx          Build from scratch (outer shape, inner shape, floors and tiers)
    ui/imageToDesign.ts     In-browser picture reader used for the bundled samples
    report.ts               PDF report
    share.ts                Share links packed into the URL hash
docs/DECISIONS.md           Law, sources and judgement calls
```

How a change flows: any input (plot corner, road width, building type, design slider) updates React state, the rules engine recomputes the envelopes, concepts and checks in the browser, and the three.js layer redraws. There is no server round trip except for photo reading.

How photo reading flows:

1. The browser shrinks the picture to 896 px JPEG and posts it to `/api/read-building`.
2. The function checks the request comes from the same site, then sends the picture and a prompt to Gemini (or OpenRouter) asking for JSON that matches a zod schema.
3. The reply is validated, clamped to the editor's ranges and mapped to the same `Design` fields the sliders use (shape, size, floors, podium, taper, twist, tiers, roof, window pattern, colours).
4. The draft goes through the same rule checks as any other design, and the user can fine-tune it.

The API key never reaches the browser. Pictures are not stored.

## 6. Setup, environment variables and deploy

### Run locally

```bash
cd app
npm ci
npm run dev        # http://localhost:5173
npx vitest run     # tests
npm run build      # type check and production build
```

Photo upload needs the API function. `npm run dev` serves the app only, so locally the designer shows the five bundled sample pictures. To try the function locally, use `vercel dev` from `app/` with the variables below.

### Environment variables (Vercel only)

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | One of the two keys | Google AI Studio key. Used first when set. |
| `GEMINI_MODEL` | No | Overrides `gemini-3.8-flash`. `gemini-3.5-flash-lite` is always tried as a fallback. |
| `OPENROUTER_API_KEY` | One of the two keys | Used when there is no Gemini key, or as a fallback when Gemini fails. |
| `OPENROUTER_MODEL` | No | Overrides `anthropic/claude-sonnet-5.5`. |

With neither key set, `GET /api/read-building` returns `{"configured": false}` and the page offers the samples instead of upload.

Note: on Google's free tier, Google may use submitted pictures to improve its products. Use a paid key if that matters.

### Deploy

- **Vercel (main).** Import the repo, set Root Directory to `app`, framework Vite, and add the environment variables. `app/vercel.json` gives the function up to 120 seconds.
- **GitHub Pages (mirror).** `.github/workflows/pages.yml` runs the tests, builds and publishes `app/dist` on every push to the deploy branch. Pages is static, so it has no photo reading.

## 7. Key decisions

The full list with legal sources is in [`docs/DECISIONS.md`](docs/DECISIONS.md). The main ones:

- **Zone ย.8** (brown, very high density residential), under the 2013 Bangkok Comprehensive Plan, which is still the binding law. The 2026 draft plan is shown only as a note. ย.8 does not restrict condos by size, so the limits that bind are geometric, which a 3D tool shows well.
- **OSR is a share of floor area, not plot area.** At FAR 6 and OSR 5%, 30% of the plot must stay open.
- **Two envelopes, not one.** At 23 m (or 10,000 m²) the high-rise rules of MR33 apply: 6 m setback all round, 12 m frontage on a 10 m road, 30% of the plot open. This is why Bangkok has so many 8-storey condos, so the tool shows both classes.
- **Checks are independent of the generator.** Every checklist line re-measures the final geometry (setbacks per edge per floor, the height plane at every plate corner) instead of trusting the code that made the design.
- **Your design is checked, not corrected.** An oversized design shows its failures. Trimming to the envelope is a separate switch.
- **Zone lookup is a user input.** The BMA zoning GIS could not be reached from the build environment, so the tool defaults to ย.8 and links to the BMA map instead of claiming to know a plot's zone.
- **Integrating an image model to turn pictures into buildings.** The first picture reader ran fully in the browser (colour segmentation, outline tracing, window-row counting). It was not reliable on real photos, so it now only powers five bundled sample pictures. For real photos the Vercel deploy adds one serverless function that calls a vision model. The model fills in a **parametric draft** (the same fields the editor uses), not a 3D mesh, so every rule check still runs on it and the user can edit it.
- **OpenRouter first, then Google Gemini directly.** Photo reading started on OpenRouter with Claude Sonnet 5.5. When the OpenRouter credit ran out, direct Gemini support was added through Google's Generative Language API (free tier with an AI Studio key). Gemini is tried first; OpenRouter is the fallback when its key is also set.
- **Photos become tiers.** A building is read as stacked tiers, each with its own floors, shape, size and offset, plus roof form (flat, gable, hip) and window pattern (ribbon, punched, curtain). Tiers change the floor plates, so they are checked like any other floor.
- **Share links without a server.** The whole setup is packed into the URL after `#s=`.
- **PDF in the browser.** jsPDF's built-in fonts cover Latin-1 only, so Thai script is left out and the zone appears as `Y.8`.
- **Dark mode recolours the basemap layer by layer** rather than swapping the map style, which would drop the 3D layers. The PDF stays light because it is meant for print.

## 8. What worked, what needed a fix, what still fails

### Worked well

- The rules engine and both legal envelopes, with all checks passing on the demo plot and failing honestly on oversized designs.
- Drawing three.js inside MapLibre, so the massing sits among real buildings with correct depth.
- Shadows computed from the sun position and swept along each floor, including surrounding buildings.
- Parametric drafts from the AI: because the model only fills in editor fields, a bad reading is easy to correct and never bypasses the rules.
- Share links, the title deed check and the PDF report.

### Needed a small fix

| Problem | Cause | Fix |
|---|---|---|
| Upload said photo reading was off although the key was set | The tab was opened before the key was added and kept the old answer | The page asks the server again each time the pictures open |
| Firefox opened a dropped photo as a `file://` page | A drop outside the drop zone let the browser navigate to the file | Drops are caught on the whole window and on the designer |
| `NetworkError` and timeouts on photo reading | A slow model with deep thinking outlasted the function, and pictures were large | Faster default model, pictures shrunk to 896 px, function limit raised to 120 s and browser timeout to 130 s, and clearer error messages |
| 502 after adding facade fields | The provider rejected the strict JSON schema | Retry with the schema in the prompt and validate the reply leniently |
| OpenRouter out of credit (402) | A request's `max_tokens` was more than the remaining credit could cover | Retry with fewer tokens and a clear "out of credit" message; then direct Gemini support was added |
| First AI buildings were too plain, just stacked floors | The reading returned only one box shape | Added facade detail (colours, window share, glass podium, balconies), tiers, roof types and window patterns |
| Real buildings are not all boxes | The shape list was too small | Added round, oval, regular polygons with 3 to 12 sides, courtyards and freeform traced outlines, per tier |
| Plot drawn larger than the land | Hand drawing is imprecise | Title deed check with the gap in % and a warning above 1% |
| Side panel was getting long | Features were added one after another | Redesigned into four steps with a summary strip and folding detail |

### Still fails or is weak

- **Round towers in photos are often read as boxes.** The prompt describes the visual signs of a cylinder (curved floor lines, smooth shading, no corner edge), but a side photo of a round tower is still frequently returned as a rectangle. The user has to switch the shape in the editor.
- **Scale from a single photo is a guess.** Width and depth come from cues like doors, cars and window rows. A width hint from the user helps.
- **The free Gemini quota can run out**, in which case the user is asked to try again later.

## 9. Known limitations

- One zone (ย.8) is modelled fully. Other zones appear only as a FAR/OSR comparison.
- The zone is not looked up; the user confirms it on the BMA map.
- Road widths are user-confirmed estimates, and there is no road-widening line.
- Height is measured to the roof slab; parapets and lift overruns are ignored, as the law allows.
- Unit counts use an average unit size (condo 35 m², hotel room 32 m²) and drive only the parking and EIA lines.
- The low-rise concept uses a 3 m side setback on every floor, which is conservative.
- Shadows fall on flat ground only; they do not climb neighbouring walls.
- The PDF has no Thai text.
- Photo reading exists only on the Vercel deploy.
- This is a feasibility tool, not a permit check.

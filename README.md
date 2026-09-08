# openmrs-esm-chartsearchai

An [OpenMRS 3.x](https://openmrs.org/) microfrontend that lets clinicians ask natural-language questions about a patient's chart and receive AI-generated answers with source citations.

![OpenMRS](https://img.shields.io/badge/OpenMRS-3.x-green)
[![OpenMRS CI](https://github.com/openmrs/openmrs-esm-chartsearchai/actions/workflows/ci.yml/badge.svg)](https://github.com/openmrs/openmrs-esm-chartsearchai/actions/workflows/ci.yml)
[![License: MPL 2.0](https://img.shields.io/badge/License-MPL_2.0-blue.svg)](https://opensource.org/licenses/MPL-2.0)

## What it does

A floating AI button appears on the patient chart page. Clicking it opens a search panel where clinicians can type questions like:

- "What medications is this patient on?"
- "Has she ever had a bad reaction to penicillin?"
- "Is her diabetes getting better or worse?"

The module streams an answer token-by-token (via SSE) with numbered citations (e.g. `[1]`, `[2]`) that link back to the relevant section of the patient chart (Results, Orders, Allergies, etc.).

When the backend's optional [drug-reference feature](https://github.com/openmrs/openmrs-module-chartsearchai#drug-reference-injection--safety-validation) is enabled, the panel also shows non-blocking **safety-check** chips below the answer (overdose / interaction / contraindication), renders module-supplied reference citations (drug references, safety findings, drug-class notes) as distinct non-navigating reference chips, and states what the safety check did and did not cover — see [Fields that state the answer's limits](#fields-that-state-the-answers-limits).

## Backend

This frontend requires the [Chart Search AI backend module](https://github.com/openmrs/openmrs-module-chartsearchai), which uses a RAG (Retrieval Augmented Generation) architecture:

1. **Retrieval** -- patient records are embedded with all-MiniLM-L6-v2 (ONNX, CPU) and narrowed to the top-K most relevant via cosine similarity.
2. **Generation** -- the filtered records are sent to a local GGUF LLM (default: Llama 3.3 8B via llama.cpp) with a system prompt that produces cited, structured answers.

See the [backend README](https://github.com/openmrs/openmrs-module-chartsearchai#readme) for full setup instructions, model downloads, and global property configuration.

## Prerequisites

- OpenMRS 3.x with the [Chart Search AI module](https://github.com/openmrs/openmrs-module-chartsearchai) installed and configured
- Node.js 18+
- Yarn 4.x

## Getting started

```sh
# Install dependencies
yarn install

# Start the dev server (proxies to a running OpenMRS instance)
yarn start
```

## Configuration

The following options can be set via the OpenMRS 3.x config system:

| Property              | Type      | Default                          | Description                                                 |
| --------------------- | --------- | -------------------------------- | ----------------------------------------------------------- |
| `aiSearchPlaceholder` | `string`  | `"Ask AI about this patient..."` | Placeholder text for the search input                       |
| `maxQuestionLength`   | `number`  | `1000`                           | Maximum characters allowed in a question                    |
| `useStreaming`        | `boolean` | `true`                           | Use the SSE streaming endpoint for token-by-token responses |

## API endpoints used

All endpoints are served by the backend module under `/ws/rest/v1/chartsearchai/`:

| Method | Path             | Description                                         |
| ------ | ---------------- | --------------------------------------------------- |
| POST   | `/search`        | Synchronous search (returns complete answer)        |
| POST   | `/search/stream` | SSE streaming search (tokens streamed in real-time) |

Request body: `{ "patient": "<uuid>", "question": "<text>" }`

Response:

```json
{
  "answer": "The patient is currently on metformin [1] and lisinopril [2]...",
  "disclaimer": "AI-generated summary. Verify with the full chart.",
  "references": [
    {
      "index": 1,
      "resourceType": "order",
      "resourceUuid": "5946f880-b197-400b-9caa-a3c661d71165",
      "date": "2025-12-01"
    },
    {
      "index": 2,
      "resourceType": "order",
      "resourceUuid": "a8f5f167-4ee2-4d2a-94f9-3f3f86d2e9b6",
      "date": "2025-11-15"
    }
  ],
  "safetyWarnings": [],
  "misattributedOrderCitations": [],
  "unstatedFindingSeverities": [],
  "conditionRuleCoverage": "unloaded",
  "interactionPairs": null
}
```

`references[].resourceUuid` is the cited record's UUID (used to locate and highlight the chart row). `safetyWarnings` (each `{ type, drug, detail, severity, chartOrderBridges }`) is always present and empty unless the backend's optional drug-reference feature is enabled; the panel renders any entries as chips below the answer.

### Fields that state the answer's limits

Four response fields, plus one per-reference field, say what a bounded safety answer did **not** cover. The panel renders these five; the backend publishes more that this app does not draw — see _Not rendered_ below. The backend README is authoritative for what each does and does not assert.

| Field                              | Rendered as                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unstatedFindingSeverities`        | The rating for that finding, beside the sentence whose finding the answer left unrated — as a **caveat**, since the backend documents cells where this key over-reports. The rating is not on the key and cannot be joined to a chip by `(type, drug)`, so the panel narrows to the candidates sharing it and requires the answer's own sentence to single one out. It reads three independent kinds of evidence — `chartOrderBridges` (typed, and carrying both the substance and the chart's order display), the partner substance alone, and the module's whole sentence — and any disagreement between them refuses rather than being resolved by precedence. Findings sharing one `(type, drug)` are a candidate **set**: they are badged together or not at all, because a bare item beside a badged one reads as "no rating exists" rather than "we declined" |
| `misattributedOrderCitations`      | Those citations struck through and non-navigating, marked _Not the order named_ — bad **evidence** for a sound finding, never an unsupported claim                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `conditionRuleCoverage`            | A neutral note on `absent`/`unloaded`, each with its own wording; nothing on `published`, which says the dataset _can_ run the condition arm and never that a condition was screened. Shown only where a safety check produced something — the backend states this on every answer, so an ungated note would sit under questions that never asked for a contraindication screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `interactionPairs`                 | "Interaction pairs shown: N of M", calling out the withholding where `reported < found`. `found: 0` gets its own sentence, because the count speaks for the check that reported it and not for the findings beside it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `references[].attachedByTheModule` | A chip tagged _Added by the module_ — the prose carries no `[N]` marker for such a citation, so this is the only place it appears                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Two readings the panel deliberately does not offer. An empty `misattributedOrderCitations` renders **nothing** — the check reads only answers reproducing the module's own phrasing, so `[]` is not a certificate that the other citations are sound. And a `null` measurement renders nothing rather than a completeness claim.

**A known cost of the severity join, and it is a blank rather than a wrong rating.** The rating a citation gets is reconstructed from the model's prose, and the module refuses wherever the reading is ambiguous. One rule decides that by asking whether a drug of the same finding-group is named _past the answer's last citation marker_ — a subject left over, which is the signature of a list written so that each marker precedes the name it belongs to. It is deliberately blunt: it does not care what the closing text says about that drug, because two narrower forms were each defeated by a dangling subject phrased slightly differently, and the distinction they were reaching for is grammatical. So an answer closing with _"Prednisone would be the safer choice."_ renders no ratings even though its citations were unambiguous. The trade is deliberate: this module treats a missing badge as safe and a rating beside the wrong citation as the worst thing it can do. It costs 13 of the 98 ratings this module would otherwise render across the 46 captured live answers — three answers lose theirs because the closing text names one of their own finding-group's drugs for an unrelated reason. That price is paid deliberately: the shape the rule catches resolved 35,010 generated answers of which 35,010 carried a wrong rating, and a clinician reading a Major finding badged Moderate has been actively misled where a missing badge sends them to the chart. `src/utils/safety-disclosure.ts` carries the measurements beside the rule.

**Not rendered.** The backend publishes more than the five above. Naming them here is a deliberate gap, not a claim that the contract stops at what this panel draws.

- `unresolvedDrugClass` — the drug **class** a question named that the module resolved to no substance (`"NSAID"`, `"oral contraceptive"`), or `null`. The backend asks a client to say that reference _entries_ are indexed by individual substance name so the class matched none of them, and to ask for a specific drug by name.
- `unfaithfullyRenderedCitations` — citations whose rendering _in the answer_ the module found unfaithful to the record they point at.
- `references[].withheldInteractions` — how many of a cited record's interaction partners the record does not show, so a client can say the citation shows a subset.
- `references[].source` — the dataset a cited record's content came from (`"DDInter 2.0 (via openmrs-ddi-knowledge-base)"`), and `null` both for a chart record and for a module-derived finding, which is computed rather than quoted. Not drawn, so a clinician cannot see which dataset a drug-reference citation is quoting; the backend is explicit that a client must branch on the value rather than on `group`, since a `reference`-group entry may legitimately carry no attribution.
- `safetyWarnings[].chartOrderBridges` — `{ substance, orderDisplay }`, saying _this chip's `Ibuprofen` is your `Advil 400mg` order_. This one is a partial: the panel **reads** it, as one of the three ORDER-FREE kinds of evidence the severity join weighs — they corroborate or contradict and none outranks another, which is why a disagreement refuses rather than being settled by precedence — but does not **display** it. The backend asks for it beside the chip, and until that is done a clinician reading a chip list next to the answer still has to work out whether `Advil` and `Ibuprofen` are one prescription or two.

Under `chartsearchai.grounding.async=true` the SSE `done` event is emitted before validation runs, so `safetyWarnings` and every measurement taken _after_ the answer — `interactionPairs`, `misattributedOrderCitations`, `unstatedFindingSeverities` — arrive on the trailing `grounded` event instead. That is why the stream's `onGrounded` callback hands over the whole payload rather than the references alone. Two exceptions not to gate on that event: `conditionRuleCoverage` is read off the dataset load before the model is called and so is already final on `done`, and on an answer-cache hit no early `done` is emitted at all.

The required privilege is **AI Query Patient Data**.

## Deploying to an O3 Instance (without publishing to npm)

These steps work for the **OpenMRS SDK**, **O3 Standalone**, and **Docker** deployments.

### 1. Clone and build

```sh
git clone https://github.com/openmrs/openmrs-esm-chartsearchai.git
cd openmrs-esm-chartsearchai
yarn install
yarn build
```

### 2. Locate your frontend directory

Find the `frontend/` folder that contains `importmap.json`:

- **OpenMRS SDK**: `~/openmrs/<server-name>/frontend/`
- **O3 Standalone**: `<standalone-directory>/appdata/frontend/`
- **Docker**: the frontend files are inside the `frontend` container (see below)

Confirm by checking that `importmap.json` exists inside the directory.

For **Docker**, find the frontend directory inside the container:

```sh
# Find the frontend container name
docker ps --format '{{.Names}}' | grep frontend

# The frontend files are typically at /usr/share/nginx/html/
# Verify by checking for importmap.json
docker exec <frontend-container> ls /usr/share/nginx/html/importmap.json
```

### 3. Copy the built files

**SDK / Standalone:**

```sh
mkdir -p <frontend-directory>/openmrs-esm-chartsearchai-app
cp dist/* <frontend-directory>/openmrs-esm-chartsearchai-app/
```

**Docker:**

```sh
# Create the directory inside the container
docker exec <frontend-container> mkdir -p /usr/share/nginx/html/openmrs-esm-chartsearchai-app

# Copy the built files into the container
docker cp dist/. <frontend-container>:/usr/share/nginx/html/openmrs-esm-chartsearchai-app/
```

### 4. Add the module to the import map

Edit `importmap.json` and add this entry inside the `"imports"` object:

```json
"@openmrs/esm-chartsearchai-app": "./openmrs-esm-chartsearchai-app/openmrs-esm-chartsearchai-app.js"
```

For **Docker**, you can edit the file in-place:

```sh
docker exec <frontend-container> sh -c "cat /usr/share/nginx/html/importmap.json | \
  sed 's/}}/,\"@openmrs\/esm-chartsearchai-app\":\"\.\/openmrs-esm-chartsearchai-app\/openmrs-esm-chartsearchai-app.js\"}}/' \
  > /tmp/importmap.json && mv /tmp/importmap.json /usr/share/nginx/html/importmap.json"
```

Or copy the file out, edit locally, and copy it back:

```sh
docker cp <frontend-container>:/usr/share/nginx/html/importmap.json .
# Edit importmap.json with your editor
docker cp importmap.json <frontend-container>:/usr/share/nginx/html/importmap.json
```

### 5. Register the module's routes

Edit `routes.registry.json` and add this entry to the top-level JSON object.

For **Docker**, copy the file out, edit, and copy back:

```sh
docker cp <frontend-container>:/usr/share/nginx/html/routes.registry.json .
# Edit routes.registry.json with your editor
docker cp routes.registry.json <frontend-container>:/usr/share/nginx/html/routes.registry.json
```

Add this entry:

```json
"@openmrs/esm-chartsearchai-app": {
  "$schema": "https://json.openmrs.org/routes.schema.json",
  "backendDependencies": {
    "webservices.rest": ">=2.44.0",
    "chartsearchai": ">=1.0.0-SNAPSHOT"
  },
  "extensions": [
    {
      "name": "ai-search-button",
      "component": "aiSearchButton",
      "slot": "patient-banner-tags-slot",
      "privilege": "AI Query Patient Data",
      "order": 100
    }
  ],
  "version": "1.0.0"
}
```

### 6. Ensure your user has the required privilege

The logged-in user's role must include the **"AI Query Patient Data"** privilege. You can assign this via the OpenMRS admin UI under **Administration > Manage Roles**.

### 7. Hard-refresh the browser

Press **Cmd+Shift+R** (Mac) or **Ctrl+Shift+R** (Windows/Linux) to bypass the cache. Navigate to a patient chart and the AI search button should appear in the patient banner.

### Updating after code changes

After making changes, rebuild and copy:

**SDK / Standalone:**

```sh
yarn build
cp dist/* <frontend-directory>/openmrs-esm-chartsearchai-app/
```

**Docker:**

```sh
yarn build
docker cp dist/. <frontend-container>:/usr/share/nginx/html/openmrs-esm-chartsearchai-app/
```

Then hard-refresh the browser. No server restart is needed.

## Running tests

```sh
yarn test
```

## Building for production

```sh
yarn build
```

## License

[MPL-2.0](https://opensource.org/licenses/MPL-2.0)

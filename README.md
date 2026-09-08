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

The module receives staged SSE updates from the backend: the short answer arrives as one chunk, optional answer validation updates the same message, and in-depth analysis arrives as a later whole chunk. Numbered citations (e.g. `[1]`, `[2]`) link back to the relevant section of the patient chart (Results, Orders, Allergies, etc.).

When the selected med-agent-hub profile emits deterministic safety advisories, the panel shows non-blocking **safety-check** chips below the answer and renders knowledge-base citations as distinct, non-navigating reference chips.

Low-confidence output remains visible with its warning so a clinician or evaluator can inspect it. If checks edit an Answer or remove In-Depth claims, the original model output appears in an open, clearly labeled review section. Rejected draft citations use their own source mappings and are never presented as final checked evidence.

When the backend's optional [drug-reference feature](https://github.com/openmrs/openmrs-module-chartsearchai#drug-reference-injection--safety-validation) is enabled, the panel also shows non-blocking **safety-check** chips below the answer (overdose / interaction / contraindication), renders module-supplied reference citations (drug references, safety findings, drug-class notes) as distinct non-navigating reference chips, and states what the safety check did and did not cover — see [Fields that state the answer's limits](#fields-that-state-the-answers-limits).

## Backend

This frontend requires the [Chart Search AI backend module](https://github.com/openmrs/openmrs-module-chartsearchai). It is provider-neutral: the backend advertises the enabled provider and capabilities, then the frontend renders the returned lifecycle without choosing provider endpoints.

The **bundled provider** keeps ChartSearchAI's local or configured remote engine, token-streaming answer path, and bundled context, safety, and grounding behavior. The **med-agent-hub provider** relays one staged hub profile request; the hub owns profile composition, optional context sources, temporal and safety checks, answer review, citation grounding, and In-Depth generation. Switching providers starts a new conversation, and there is no automatic fallback between them.

The frontend renders those lifecycle and evidence states. It does not choose provider endpoints, compose model stages, or maintain a model catalog.

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

| Property | Type | Default | Description |
|---|---|---|---|
| `aiSearchPlaceholder` | `string` | `"Ask AI about this patient..."` | Placeholder text for the search input |
| `maxQuestionLength` | `number` | `1000` | Maximum characters allowed in a question |
| `showModelPicker` | `boolean` | `true` | Show configured providers and, when supported, the selected provider's profiles |

## API endpoints used

All endpoints are served by the backend module under `/ws/rest/v1/chartsearchai/`:

| Method | Path | Description |
|---|---|---|
| POST | `/chat` | Synchronous chat turn (returns the complete answer) |
| POST | `/chat/stream` | SSE staged chat turn (answer/validation/in-depth phase events; multi-turn via `session`) |
| GET | `/chat` | Hydrate a patient's active session + prior messages |
| POST | `/chat/new` | Close the active session and open a fresh one |
| GET | `/providers` | Discover enabled provider metadata and capabilities |
| GET | `/models` | Discover med-agent-hub profiles when the hub provider is enabled |

Request body: `{ "patient": "<uuid>", "question": "<text>", "session": "<uuid, optional>", "provider": "<configured provider, optional>", "profile": "<hub profile when selected, optional>" }`

Response (`POST /chat`, and the final `done` event of `POST /chat/stream`):
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
  "session": "session-uuid",
  "messageId": "assistant-message-uuid",
  "misattributedOrderCitations": [],
  "unstatedFindingSeverities": [],
  "conditionRuleCoverage": "unloaded",
  "interactionPairs": null
}
```

`references[].resourceUuid` is the cited record's UUID (used to locate and highlight the chart row). `safetyWarnings` (each `{ type, drug, detail, severity, chartOrderBridges }`) is always present and empty unless the backend's optional drug-reference feature is enabled; the panel renders any entries as chips below the answer.

### Fields that state the answer's limits

Five response fields, plus one per-reference field, say what a bounded safety answer did **not** cover. The panel renders these six; the backend publishes more that this app does not draw — see _Not rendered_ below. The backend README is authoritative for what each does and does not assert.

| Field                              | Rendered as                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unstatedFindingSeverities`        | The rating for that finding, beside the sentence whose finding the answer left unrated — as a **caveat**, since the backend documents cells where this key over-reports. The rating is not on the key and cannot be joined to a chip by `(type, drug)`, so the panel narrows to the candidates sharing it and requires the answer's own sentence to single one out. It reads three independent kinds of evidence — `chartOrderBridges` (typed, and carrying both the substance and the chart's order display), the partner substance alone, and the module's whole sentence — and any disagreement between them refuses rather than being resolved by precedence. Findings sharing one `(type, drug)` are a candidate **set**: they are badged together or not at all, because a bare item beside a badged one reads as "no rating exists" rather than "we declined" |
| `misattributedOrderCitations`      | Those citations struck through and non-navigating, marked _Not the order named_ — bad **evidence** for a sound finding, never an unsupported claim                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `conditionRuleCoverage`            | A neutral note on `absent`/`unloaded`, each with its own wording; nothing on `published`, which says the dataset _can_ run the condition arm and never that a condition was screened. Shown only where a safety check produced something — the backend states this on every answer, so an ungated note would sit under questions that never asked for a contraindication screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `interactionPairs`                 | "Interaction pairs shown: N of M", calling out the withholding where `reported < found`. `found: 0` gets its own sentence, because the count speaks for the check that reported it and not for the findings beside it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `activeOrderClaims`                | "Statements about her active orders citing no chart record: N of M", called out as a bound, with the reason a claim without a record cannot be checked at all. Where none is uncited it says every such statement cites a record and stops there — a record was _offered_, which is not a claim the record was the right one. Nothing where the answer made no such claim, and nothing on `null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `references[].attachedByTheModule` | A chip tagged _Added by the module_ — the prose carries no `[N]` marker for such a citation, so this is the only place it appears                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Two readings the panel deliberately does not offer. An empty `misattributedOrderCitations` renders **nothing** — the check reads only answers reproducing the module's own phrasing, so `[]` is not a certificate that the other citations are sound. And a `null` measurement renders nothing rather than a completeness claim.

`activeOrderClaims` is drawn for that first reason rather than as a sixth field for its own sake. The backend states that `misattributedOrderCitations: []` is two responses a client cannot tell apart — an answer whose active-order claims all cited chart records that were accepted, and an answer that cited no chart record for any of them — and that both have been recorded on one patient and one question. Rendering the other five without it left that ambiguity on the screen.

**A known cost of the severity join, and it is a blank rather than a wrong rating.** The rating a citation gets is reconstructed from the model's prose, and the module refuses wherever the reading is ambiguous. Three rules decide that, between them covering the whole answer: they ask whether a drug of the same finding-group is named _past the set's own last citation_, _before its first_, or _between two of them_ with no citation willing to claim it — a subject left over, which is the signature of a list written so that each marker precedes the name it belongs to. All three are deliberately blunt about wording: two word lists were tried across them and each was defeated by the same subject phrased slightly differently, because the distinction they were reaching for is grammatical and nothing here parses. So an answer closing with _"Prednisone would be the safer choice."_ renders no ratings even though its citations were unambiguous. Together they cost 18 of the 98 ratings this module would otherwise render across the 46 captured live answers: three answers lose theirs because the closing text names one of their own finding-group's drugs for an unrelated reason, and two more because an earlier sentence names a family member the citations do not account for. That leaves 80, and every one of the 80 has been read against the sentence it was drawn from and checked against the payload's own warnings. A fourth rule joins them, from the payload rather than the prose: where the answer states a rating in words, the backend's own rule says no citation on its unstated list can be that finding, so a resolution giving it that rating is deleted. The count read 82 for part of a day, because that rule was first written to remove such findings from the candidate list instead — which recovered two correct ratings on one live answer and was then found to manufacture a swapped pair on another, since a shorter candidate list changes which drug names count as telling two findings apart. It deletes a resolution now and narrows nothing, so those two are blanks again and are not among the 80. That price is paid deliberately. The shape these rules catch resolved 35,010 generated answers of which 35,010 carried a wrong rating — the class has no correct resolutions at all — and a clinician reading a Major finding badged Moderate has been actively misled, where a missing badge sends them to the chart. `src/utils/safety-disclosure.ts` carries the measurements beside the rule.

**Three known gaps remain, all recorded in the code beside the rule they evade.** The first is an over-warning: where the answer misspells the order display it means — live captures on one day wrote `Solu-Medrol 12mg/5ml`, `125mag/5ml` and `125mcg/5ml` — the marker's own subject is invisible and a sibling named in the same sentence is elected in its place, so a Moderate finding can render Major. It is left open deliberately: closing it needs a near-match on drug names, and `Prednisone` and `Prednisolone` are different drugs one letter apart, so that trade buys one over-warning at the price of a class of wrong ratings between real neighbours. `src/utils/safety-disclosure.test.ts` asserts the shape as it behaves, so the assertion changes on the day someone closes it.

The second is a blind spot rather than a wrong reading: the rule that catches a list written so each marker precedes its drug works by reading what follows the last citation, so **an answer that ends on its last citation gives it nothing to read**, and the other checks are all silent there by construction. The same answer with one more name after that marker is refused, so the verdict turns on whether the module can see the tail rather than on how clear the prose is. It is left open because the two readings of such an answer genuinely disagree — the full stop argues one way, the next line the other — so there is no correct pairing to build a rule against, and a rule built on the wrong one would render wrong ratings instead of blanks.

The third is a cost rather than a wrong reading, and it is the one most likely to be noticed in use: **an answer that states one finding's rating in words withholds the ratings of the others.** Stating a rating removes that citation from the backend's list, which leaves the drug named in the prose with no citation of the remaining measurement to claim it — so it reads as a subject left over and the whole set is withheld. That is the shape a clinician is most likely to produce a question for, since a model naming one severity and not the rest is exactly what this field exists to report. No captured live answer resolves through it. The fix adds resolutions rather than removing them, which is the direction that has twice turned out to manufacture a wrong rating on this file, so it is deferred to a change that can be measured on its own.

**Not rendered.** The backend publishes more than the five above. Naming them here is a deliberate gap, not a claim that the contract stops at what this panel draws.

- `unresolvedDrugClass` — the drug **class** a question named that the module resolved to no substance (`"NSAID"`, `"oral contraceptive"`), or `null`. The backend asks a client to say that reference _entries_ are indexed by individual substance name so the class matched none of them, and to ask for a specific drug by name.
- `unfaithfullyRenderedCitations` — citations whose rendering _in the answer_ the module found unfaithful to the record they point at.
- `references[].withheldInteractions` — how many of a cited record's interaction partners the record does not show, so a client can say the citation shows a subset.
- `references[].source` — the dataset a cited record's content came from (`"DDInter 2.0 (via openmrs-ddi-knowledge-base)"`), and `null` both for a chart record and for a module-derived finding, which is computed rather than quoted. Not drawn, so a clinician cannot see which dataset a drug-reference citation is quoting; the backend is explicit that a client must branch on the value rather than on `group`, since a `reference`-group entry may legitimately carry no attribution.
- `safetyWarnings[].chartOrderBridges` — `{ substance, orderDisplay }`, saying _this chip's `Ibuprofen` is your `Advil 400mg` order_. This one is a partial: the panel **reads** it, as one of the three ORDER-FREE kinds of evidence the severity join weighs — they corroborate or contradict and none outranks another, which is why a disagreement refuses rather than being settled by precedence — but does not **display** it. The backend asks for it beside the chip, and until that is done a clinician reading a chip list next to the answer still has to work out whether `Advil` and `Ibuprofen` are one prescription or two.

Under `chartsearchai.grounding.async=true` the SSE `done` event is emitted before validation runs, so `safetyWarnings` and every measurement taken _after_ the answer — `interactionPairs`, `misattributedOrderCitations`, `unstatedFindingSeverities` — arrive on the trailing `grounded` event instead. That is why the stream's `onGrounded` callback hands over the whole payload rather than the references alone. Two exceptions not to gate on that event: `conditionRuleCoverage` is read off the dataset load before the model is called and so is already final on `done`, and on an answer-cache hit no early `done` is emitted at all.

Hub product profiles emit this staged sequence:
`answer_done` (direct answer complete) → optional `answer_validation` (self-check result) →
`indepth_pending` → `indepth_done` or `indepth_error` → `done`. The hub does not token-stream the
answer or in-depth text; each content phase is delivered whole. The bundled provider may instead
emit answer token events before its terminal answer. See the
[backend README's streaming chat docs](https://github.com/openmrs/openmrs-module-chartsearchai#streaming-chat-sse) for the full event reference.

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

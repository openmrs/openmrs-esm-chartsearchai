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

| Property | Type | Default | Description |
|---|---|---|---|
| `aiSearchPlaceholder` | `string` | `"Ask AI about this patient..."` | Placeholder text for the search input |
| `maxQuestionLength` | `number` | `1000` | Maximum characters allowed in a question |
| `useStreaming` | `boolean` | `true` | Use the SSE streaming endpoint for token-by-token responses |

## API endpoints used

All endpoints are served by the backend module under `/ws/rest/v1/chartsearchai/`:

| Method | Path | Description |
|---|---|---|
| POST | `/search` | Synchronous search (returns complete answer) |
| POST | `/search/stream` | SSE streaming search (tokens streamed in real-time) |

Request body: `{ "patient": "<uuid>", "question": "<text>" }`

Response:
```json
{
  "answer": "The patient is currently on metformin [1] and lisinopril [2]...",
  "disclaimer": "AI-generated summary. Verify with the full chart.",
  "references": [
    { "index": 1, "resourceType": "order", "resourceId": 456, "date": "2025-12-01" },
    { "index": 2, "resourceType": "order", "resourceId": 789, "date": "2025-11-15" }
  ]
}
```

The required privilege is **AI Query Patient Data**.

## Deploying to an O3 Standalone Instance

If you are running an OpenMRS O3 standalone instance and want to add this module without publishing to npm:

### 1. Clone and build

```sh
git clone https://github.com/openmrs/openmrs-esm-chartsearchai.git
cd openmrs-esm-chartsearchai
yarn install
yarn build
```

### 2. Locate your standalone frontend directory

Find the `frontend/` folder inside your standalone's `appdata/` directory. For example:

```
<standalone-directory>/appdata/frontend/
```

Confirm by checking that `importmap.json` exists inside it.

### 3. Copy the built files

```sh
mkdir -p <frontend-directory>/openmrs-esm-chartsearchai-app
cp dist/* <frontend-directory>/openmrs-esm-chartsearchai-app/
```

### 4. Add the module to the import map

Edit `<frontend-directory>/importmap.json` and add this entry inside the `"imports"` object:

```json
"@openmrs/esm-chartsearchai-app": "./openmrs-esm-chartsearchai-app/openmrs-esm-chartsearchai-app.js"
```

### 5. Register the module's routes

Edit `<frontend-directory>/routes.registry.json` and add this entry to the top-level JSON object:

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

```sh
yarn build
cp dist/* <frontend-directory>/openmrs-esm-chartsearchai-app/
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

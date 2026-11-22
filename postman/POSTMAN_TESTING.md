# Postman Test Guide

Use this checklist to verify the Hotel Offer Orchestrator against the requirements. The collection is `hotel-offer-orchestrator.postman_collection.json`; its `baseUrl` variable defaults to `http://localhost:3000`.

## Start and run

Start the API, worker, Temporal, and Redis from the project directory:

```bash
docker compose up -d --build
```

In Postman, import the collection and run **all requests sequentially, top to bottom** with the Collection Runner. Do not run the collection in parallel: the supplier-failure scenarios change shared in-memory mock state. Each request has Postman assertions; confirm every request and assertion is green.

You can also run the collection from a terminal with Newman:

```bash
npx newman run postman/hotel-offer-orchestrator.postman_collection.json
```

## Request checklist

| # | Method and path | Expected result / requirement checked |
| ---: | --- | --- |
| 1 | `GET /health` | `200`, status `ok`; both suppliers, Redis, and Temporal are reported up. |
| 2 | `GET /health/live` | `200`, `{ "status": "ok" }`; liveness does not depend on other services. |
| 3 | `GET /` | `200` HTML landing page with clickable API examples. |
| 4 | `GET /api/hotels?city=delhi&refresh=true` | `200` bare array, `X-Cache: REFRESH`, workflow ID, eight unique offers, cheapest overlaps retained. |
| 5 | `GET /api/hotels?city=delhi` | `200`, `X-Cache: HIT`; confirms the previous workflow result was saved in Redis. |
| 6 | `GET /api/hotels?city=delhi&minPrice=5000&maxPrice=10000` | `200`; only inclusive in-range offers, queried from Redis. |
| 7 | `GET /api/hotels?city=delhi&minPrice=6000` | `200`; minimum-only filtering. |
| 8 | `GET /api/hotels?city=delhi&maxPrice=4000` | `200`; maximum-only filtering. |
| 9 | `GET /api/hotels?city=delhi&minPrice=100000&maxPrice=200000` | `200` with an empty array; valid range with no matches. |
| 10 | `GET /api/hotels?city=delhi&minPrice=100&maxPrice=1000` | `200` with an empty array; verifies the requested low price range. |
| 11 | `GET /api/hotels?city=mumbai` | `200`; overlapping Mumbai offers are deduplicated. |
| 12 | `GET /api/hotels?city=atlantis` | `200` with an empty array; unknown city is handled. |
| 13 | `GET /api/hotels` | `400 VALIDATION_ERROR`; missing city. |
| 14 | `GET /api/hotels?city=delhi&minPrice=9000&maxPrice=1000` | `400 VALIDATION_ERROR`; minimum exceeds maximum. |
| 15 | `GET /api/hotels?city=delhi&minPrice=abc` | `400 VALIDATION_ERROR`; non-numeric price. |
| 16 | `POST /supplierA/_chaos` with `{"down":true}` | `200`; take Supplier A down. |
| 17 | `GET /api/hotels?city=delhi&refresh=true` | `200` degraded result from Supplier B; degraded and failed-supplier headers set. |
| 18 | `GET /health` | `200`, status `degraded`; Supplier A down and Supplier B up. |
| 19 | `POST /supplierB/_chaos` with `{"down":true}` | `200`; take Supplier B down too. |
| 20 | `GET /api/hotels?city=delhi&refresh=true` | `502 UPSTREAM_UNAVAILABLE`; both suppliers failed. |
| 21 | `GET /health` | `503`, status `down`; both suppliers are down. |
| 22 | `POST /supplierA/_chaos` with `{"down":false}` | `200`; restore Supplier A. |
| 23 | `POST /supplierB/_chaos` with `{"down":false}` | `200`; restore Supplier B. |
| 24 | `GET /api/hotels?city=delhi&refresh=true` | `200`; full eight-offer result recovered. |
| 25 | `GET /supplierA/hotels?city=delhi` | `200`; mock Supplier A returns its raw hotel records. |
| 26 | `GET /supplierB/hotels?city=delhi` | `200`; mock Supplier B returns its raw hotel records. |

For POST requests, set `Content-Type: application/json` and use the JSON body shown in the table. If the run stops during the failure sequence, restore both suppliers by sending steps 20 and 21 before rerunning the collection.

## Result recorded for this checkout

The updated collection was run against the Docker Compose stack with Newman: **26 requests executed, 66 assertions passed, 0 failures**. This includes the home page links and the `minPrice=100&maxPrice=1000` case.

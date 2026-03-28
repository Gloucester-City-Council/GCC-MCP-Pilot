# Blob notes performance considerations

## Context

For the `mcp-notes` Azure Function, request latency is mostly affected by:

1. Blob client lifecycle (initialisation / connection reuse)
2. Network path distance between Function App and Storage Account

## Resolution approach

### 1) Blob SDK initialisation

- Keep `BlobServiceClient` as a **singleton at module scope** and reuse it for all invocations in the same worker process.
- Avoid creating a new `BlobServiceClient` inside the request handler for each call.
- In this codebase we use lazy singleton initialisation (`getContainerClient`) so cold starts remain safe when env vars are missing, while still reusing the same client once created.

### 2) Connection reuse / keep-alive

- Reusing the same `BlobServiceClient` allows the Azure SDK transport layer to reuse HTTP connections (keep-alive pooling) automatically.
- If client objects are recreated per request, connection setup/TLS overhead is paid repeatedly.

### 3) Round-trip geography

Latency is strongly influenced by region placement:

- Co-locate Function App and Storage Account in the same Azure region whenever possible.
- If data residency requires separation, keep regions as close as possible and budget for extra RTT.
- Validate with production telemetry (Application Insights dependency timings + P95/P99 latency) rather than assumptions.

## Practical checklist

- [ ] Function App and Storage Account are in the same region (or nearest permissible)
- [ ] `STORAGE_CONNECTION` points to the intended regional account
- [ ] Blob client is reused across invocations (singleton pattern)
- [ ] P95 and P99 blob dependency latency are tracked and alerted


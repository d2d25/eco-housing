# Server Connected Mode

Eco Housing V0.2 introduces a server-connected data source.

The app still works without a server by using the bundled vanilla `eco-data.json`. A live Eco server can provide server-specific data by installing the `EcoHousingExporter` mod.

## Required Server API

The app expects the server to expose:

```http
GET /api/v1/eco-housing/status
GET /api/v1/eco-housing/data
GET /api/v1/eco-housing/economy
OPTIONS /api/v1/eco-housing/*
```

These endpoints are owned by the `EcoHousingExporter` mod. The app does not rely on vanilla Eco web endpoints for economy data.
The exporter must include CORS headers and answer `OPTIONS` preflight requests, otherwise browsers will block the web app when it is hosted from another origin.

When the app files are packaged with the exporter, Eco also serves the app at:

```http
GET /eco-housing
GET /eco-housing/*
```

## App Behavior

Open **Settings**, select **Connected server**, enter the server URL, then click **Connect / Sync**.

For the planned local Eco exporter endpoint, the default URL is:

```text
http://localhost:3001
```

If the app is opened from `http://server:3001/eco-housing`, it auto-connects to that same server origin. Manual connection remains available in Settings.

When connected, the app loads:

- server housing data from `/data`;
- market prices and stock from `/economy`;
- server/exporter metadata from `/status`.

If the connection fails, the app keeps the current data and shows the error. Vanilla bundled data remains available as a fallback.

The `/data` payload can include `constructionMaterials`, mapping each house material tier to the item classes that should be priced for construction. This is how modded servers can replace the vanilla material assumptions used for House budget calculations.

When the exporter uses its reflection fallback, `/data.meta.extractionCompleteness` tells the app and testers which sections are complete enough to trust. The current reflection path can safely detect items, basic housing values, skills, recipe metadata, vanilla fallback room tiers/categories, and partial WorldObject room requirements.

`/data` is treated as stable for a running EcoServer process. The exporter starts a non-blocking warm-up after the DLL is loaded, stores the generated snapshot in memory, and serves later requests from that cache. A request that arrives before warm-up is complete still builds a fast reflection snapshot first, then background enrichment can replace the cache when it finishes. Set `ECO_HOUSING_DISABLE_STARTUP_WARMUP=1` to disable this behavior while debugging.

If `ECO_HOUSING_SOURCE_ROOTS` points at readable Eco mod sources, the exporter can enrich:

- recipe ingredients, products, crafting tables, and variants;
- occupancy geometry from `WorldObjectOccupancyAutoGen.cs`;
- operational requirements such as power, fuel, water, sewage, and chimney hints;
- names, descriptions, icon hints, and XLF localized names.

Modded room rules and runtime-generated server state still need an Eco-specific live data reader.

## Economy Data

The economy snapshot uses normalized item class names so prices can be matched to housing items:

```json
{
  "fetchedAt": "2026-06-09T00:00:00.000Z",
  "currencies": ["Credits"],
  "listings": [
    {
      "itemClass": "HewnTableItem",
      "quantity": 5,
      "price": 12.5,
      "currency": "Credits",
      "storeName": "Carpentry Store",
      "seller": "Player",
      "storeId": "store-entity-id",
      "sellerId": "seller-user-id",
      "taxRate": 0.05,
      "fee": 0
    }
  ]
}
```

The web app can then display cost, stock, and cost-aware recommendations.

## Exporter Status

The current `work/eco-housing-exporter` folder is a buildable exporter foundation with an installable local-server package. The package contains only the precompiled exporter DLL and packaged web assets needed by Eco's existing web server.

It contains:

- API DTOs for `/status`, `/data`, and `/economy`;
- `IEcoHousingExportProvider`, the server-data collection interface;
- `StubEcoHousingExportProvider`, returning valid empty payloads with warnings;
- `EcoHousingHttpRouter`, a pure router for the three endpoint paths;
- `IEcoLiveDataReader` and `EcoDataSnapshotBuilder`, the bridge that will turn live Eco registries into `/data`;
- `IEcoLiveEconomyReader`, `EcoWorldStoreObjectSource`, and `EcoEconomySnapshotBuilder`, the bridge that turns live Eco `StoreComponent` sell offers into `/economy`;
- `EcoHousingController`, discovered by Eco's MVC mod hook and serving `/api/v1/eco-housing/*`;
- `EcoHousingAppController`, serving packaged static app files from `/eco-housing`;
- `EcoHousingEndpointBridge`, the testable endpoint registration bridge for `/status`, `/data`, and `/economy`;
- `MapEcoHousingExporter(...)`, an ASP.NET Core adapter for standalone host smoke tests;
- an `ECO_MODKIT` guarded adapter placeholder;
- packaging, install, endpoint smoke, and local live smoke scripts.

The Eco HTTP hook is now identified: `Eco.WebServer.Web.Startup` calls `AddEcoMvcMods()`, which adds every `ModKitPlugin.LoadedManagedAssemblies` assembly as an ASP.NET MVC application part before `MapControllers()`. A controller in `EcoHousingExporter.dll` is therefore enough for the API to be exposed by Eco's existing web server.

Create a package with:

```powershell
.\work\eco-housing-exporter\scripts\package-exporter.ps1
```

This produces `work/eco-housing-exporter/dist/EcoHousingExporter.zip`. The package contains the exporter DLL, the `EcoHousingExporter.Web` static app folder, README, and manifest. It intentionally does not include the old experimental `UserCode` bootstrap.

Install to a local Steam Eco server with:

```powershell
.\work\eco-housing-exporter\scripts\install-local-eco-server.ps1
```

Then start EcoServer and test:

```powershell
.\work\eco-housing-exporter\scripts\test-exporter-endpoints.ps1
```

For a full local smoke test:

```powershell
.\work\eco-housing-exporter\scripts\test-local-eco-server-live.ps1 -TimeoutSeconds 180
```

If EcoServer must be started manually from Steam or an interactive console, start it first and run:

```powershell
.\work\eco-housing-exporter\scripts\test-local-eco-server-live.ps1 -UseExistingServer
```

Live endpoint proof on a local EcoServer:

- EcoServer starts without the UserCode bootstrap.
- Logs show `Loading EcoHousingExporter...`.
- `GET http://127.0.0.1:3001/api/v1/eco-housing/status` returns 200.
- `GET http://127.0.0.1:3001/api/v1/eco-housing/data` returns live reflection data. On the local Steam EcoServer it returned 812 housing entries, 1644 items, 1453 recipes, 815 world objects, and 724 occupancy rows after auto-detecting `Mods/__core__`. The first request took about 1.7 seconds and the cached second request took about 0.3 seconds.
- `GET http://127.0.0.1:3001/api/v1/eco-housing/economy` reads live `WorldObjectManager` store components and returns a valid economy payload; on an empty test world it returns 0 listings with `No placed Eco StoreComponent instances were found in the live world.`
- With a test store selling 3 `SoftwoodHewnLogItem` at 10 `d2d25 Credit`, `/economy` returned one listing with item, quantity, price, currency, store name, seller, store id, seller id, and no warnings.
- `GET http://127.0.0.1:3001/eco-housing` serves the packaged app.

Live testing on Eco 0.13 showed the experimental UserCode bootstrap is not viable by default: ModKit UserCode does not automatically reference the precompiled exporter DLL or `System.Net.HttpListener`, and installing it causes server startup compilation errors. The installable package no longer includes that bootstrap, and the default installer disables any previously installed bootstrap source file.

Remaining server work:

- improve the provider that reads live item, recipe, housing, world object, stock, and currency data from the running server;
- finish the pre-indexed source-code recipe/variant collector. `/data` is now cached and warmed up after Eco loads the exporter, but variant extraction still needs to be made both fast and complete enough for live startup warm-up;
- extend `/economy` metadata for taxes and fees when Eco exposes them.

The economy integration target is now wired through Eco's live `WorldObjectManager.All` collection. The exporter finds placed objects with `Eco.Gameplay.Components.Store.StoreComponent`, reads `StoreData.SellOffers`, ignores buy offers, and normalizes `Stack.Item`, `Stack.Quantity`, `Price`, and store-level currency data into `/economy`.

# Server Connected Mode

Eco Housing V0.2 introduces a server-connected data source.

The app still works without a server by using the bundled vanilla `eco-data.json`. A live Eco server can provide server-specific data by installing the `EcoHousingExporter` mod.

## Required Server API

The app expects the server to expose:

```http
GET /api/v1/eco-housing/status
GET /api/v1/eco-housing/data
GET /api/v1/eco-housing/economy
```

These endpoints are owned by the `EcoHousingExporter` mod. The app does not rely on vanilla Eco web endpoints for economy data.

## App Behavior

Open **Settings**, select **Connected server**, enter the server URL, then click **Connect / Sync**.

When connected, the app loads:

- server housing data from `/data`;
- market prices and stock from `/economy`;
- server/exporter metadata from `/status`.

If the connection fails, the app keeps the current data and shows the error. Vanilla bundled data remains available as a fallback.

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
      "seller": "Player"
    }
  ]
}
```

The web app can then display cost, stock, and cost-aware recommendations.

## Exporter Status

The current `work/eco-housing-exporter` folder is a stub and API contract. It is ready to be wired to Eco ModKit assemblies when the server-side implementation starts.

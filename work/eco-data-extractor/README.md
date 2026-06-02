# Eco Data Extractor

Local extractor that turns Eco server/mod files into JSON consumed by the housing optimizer.

## Usage

Extract game data:

```powershell
node .\work\eco-data-extractor\src\extract-eco-data.mjs --eco-path "C:\Program Files (x86)\Steam\steamapps\common\Eco" --out .\outputs\eco-data.json
```

Extract game data and item icons in one pass:

```powershell
node .\work\eco-data-extractor\src\extract-eco-data.mjs --eco-path "C:\Program Files (x86)\Steam\steamapps\common\Eco" --out .\outputs\eco-data.json --extract-icons
```

You can also point directly to the `Mods` directory:

```powershell
node .\work\eco-data-extractor\src\extract-eco-data.mjs --mods-path "C:\Program Files (x86)\Steam\steamapps\common\Eco\Eco_Data\Server\Mods" --out .\outputs\eco-data.json
```

Extract item icons from Eco's Unity icon bundle:

```powershell
npm run extract:icons -- --eco-path "C:\Program Files (x86)\Steam\steamapps\common\Eco"
```

After icons are extracted, `extract-eco-data.mjs` automatically adds `iconUrl` fields when matching PNG files exist in `outputs/assets/eco-icons`. Use `--icons-dir` to point at another icon directory.

## Extracted Data

- `items`: item classes, readable names, descriptions, browser metadata, and icon URLs when available.
- `housing`: housing values declared through `HousingValue` or `HomeFurnishingValue`.
- `recipes`: products, ingredients, required skills, and crafting stations.
- `skills`: detected skill classes and profession groups.
- `worldObjects`, `occupancy`, `roomCategories`, `roomTiers`: placement and housing calculation rules used by the app.

The extractor stays independent from the UI. When Eco changes version, rerun the extractors and the app reads the updated JSON/assets.

## Run The App

From the repository root:

```powershell
node .\work\serve-outputs.mjs
```

Then open:

```text
http://127.0.0.1:4173
```

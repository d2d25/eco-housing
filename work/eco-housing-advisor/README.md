# Eco Housing Advisor

## Purpose

Eco Housing Advisor is a new Eco server mod project.

The goal is to build an in-game housing assistant, inspired by food advisor mods such as OpenNutriView, but for house XP and furniture. The mod should help a player answer:

- What should I add to this room right now?
- Which object gives the best real housing XP after caps and duplicate penalties?
- Which object is the best value for money on this server?
- Which item is craftable, buyable, already owned, blocked, or not worth placing?
- Which room in my house should I improve first?

The project should prefer Eco runtime data and Eco game code over hand-maintained JSON or duplicated rules. Static extraction can still be useful for tests and fallback data, but the primary target is a server-side mod that runs inside Eco and sees the real server state.

## Main Design Change

This project replaces the previous direction of a mostly external web app reading `eco-data.json`.

The new direction is:

1. Build an Eco server mod.
2. Use Eco runtime APIs as the source of truth.
3. Provide player-facing recommendations in-game first.
4. Optionally expose a web/API layer later.

The old Eco Housing app remains useful as research and as a possible future web UI, but this project should not inherit its complexity by default.

## Sources Of Inspiration

### OpenNutriView

Repository: https://github.com/BeanHeaDza/OpenNutriView

Useful ideas:

- In-game tooltip style UX.
- Server-side calculation using Eco runtime objects.
- Reading stores, stock, currencies, and accessible containers.
- Showing best food based on real server/player state.
- User config persisted server-side.

What to reuse conceptually:

- Use runtime data instead of trying to fully reproduce game state outside the game.
- Make the recommendation directly useful to the player.
- Include price/availability when the server economy is available.

What not to copy blindly:

- Housing calculations can be heavier than food tooltips, so caching/snapshots may be needed.
- Housing recommendations need room context, placement constraints, support categories, and material tier caps.

### FurnitureFinder

Repository: https://github.com/BeanHeaDza/FurnitureFinder

Useful ideas:

- Iterate Eco world object types.
- Detect furniture using `HousingComponent`.
- Resolve the creating item with `WorldObjectItem.GetCreatingItemTemplateFromType(...)`.
- Read `WorldObjectItem.HomeValue`.
- Use `HomeValue.Category`, `HomeValue.TypeForRoomLimit`, `HomeValue.BaseValue`, and `HomeValue.DiminishingReturnMultiplier`.
- Group equivalent furniture and variants for display.

This is probably the closest reference for the housing data layer.

## Product Goal

The final experience should feel simple:

```text
Bedroom, Tier 2
Current useful score: 14.8

Best additions:
1. Hewn Dresser x1
   +2.4 real XP, craftable with Carpentry

2. Torch Stand x1
   +1.8 real XP, buyable for 12 credits

3. Elk Statuette x2
   +1.1 real XP, already available in storage

Ignored:
- Mortared Granite Fireplace: wrong room/support category
- Electric Wall Lamp: requires electricity
- Orrery: below minimum efficiency after duplicates
```

The player should not need to understand every housing formula. The mod should explain only when useful:

- why an item is recommended;
- why an item is blocked;
- why the real gain is lower than base XP;
- what to buy/craft first.

## Expected Features

### V0: Furniture Data Probe

Build the smallest useful mod:

- Add a command such as `/housingadvisor`.
- Discover all housing furniture from Eco runtime.
- Read each item `HomeValue`.
- Print or expose a categorized list:
  - item name;
  - room/support category;
  - base housing value;
  - type limit;
  - duplicate multiplier;
  - creating recipe or skill if available.

Success condition:

- The mod can list real furniture values from the running Eco server without relying on the old extractor.

### V1: Room Advisor

Recommend what to add to one room.

Inputs:

- current room, if detectable;
- or selected room type;
- room material tier;
- existing objects in the room;
- accepted requirements:
  - electricity;
  - mechanical power;
  - fuel;
  - water;
  - chimney/pollution;
- minimum XP efficiency;
- optional budget/currency.

Outputs:

- current score if obtainable from Eco;
- recommended objects;
- real XP gain per object;
- duplicate/cap/tier explanation;
- craft/buy/owned status;
- blocked items with reasons;
- alternatives and equivalents.

### V2: Whole House Advisor

Analyze all rooms in a house/property.

Outputs:

- which room to improve first;
- best global shopping/crafting list;
- rooms that are already near cap;
- rooms with bad value due to material tier;
- objects that should be moved between rooms;
- house-level score improvement estimate.

### V3: Economy-Aware Optimization

Use live server economy:

- store listings;
- price;
- stock;
- currencies;
- seller/store name;
- taxes if accessible;
- player-accessible storage if possible.

Optimization modes:

- max XP;
- max XP under budget;
- best XP per credit;
- cheapest equivalent;
- best next object to buy.

## Runtime Data To Use

Prefer runtime Eco APIs and objects whenever possible.

Important data sources to investigate:

- `ServiceHolder.Obj.AllTypes`
- `HousingComponent`
- `WorldObjectItem.GetCreatingItemTemplateFromType(...)`
- `WorldObjectItem.HomeValue`
- `CraftingComponent.RecipesForItem(...)`
- `StoreComponent`
- `StorageComponent`
- player inventory/storage access APIs
- property/residency APIs
- room detection APIs
- world object occupancy and room requirement components

Expected `HomeValue` fields:

- `Category`
- `TypeForRoomLimit`
- `BaseValue`
- `DiminishingReturnMultiplier`

## Housing Rules To Respect

The advisor must eventually account for:

- room category;
- support category;
- primary room value;
- support caps;
- duplicate item diminishing returns;
- material tier soft cap;
- material tier hard cap;
- material tier diminishing return;
- bathroom or other room ratio limits;
- multiple rooms of the same type;
- outdoor category behavior;
- room volume;
- required room material tier;
- room containment requirement;
- object occupancy;
- object height;
- surface placement;
- objects placed on tables/shelves/stands;
- rugs or objects that do not block normal floor placement;
- operational requirements:
  - electricity;
  - mechanical power;
  - fuel;
  - water;
  - chimney/pollution;
- variants;
- equivalence groups;
- craftability;
- buyability;
- player-owned items.

The advisor should always present "real gain", not only base housing value.

## Equivalence And Variants

Two concepts must stay separate.

### Variant

A variant is the same object family with different material/color/style, usually from the same base recipe.

Example:

- Ashlar Basalt Fireplace
- Ashlar Granite Fireplace
- Ashlar Limestone Fireplace

### Equivalent

An equivalent is not necessarily the same object family, but it can serve the same optimization role.

Objects may be equivalent if they have the same:

- room/support category;
- base value;
- duplicate multiplier;
- type limit;
- placement requirements;
- room requirements;
- operational requirements;
- footprint/surface/volume constraints.

The advisor should recommend an equivalence group, then show currently available variants/options.

Example:

```text
Best seating option:
- Hewn Bench if Carpentry is available
- Mortared Stone Bench if Masonry is available
- pick cheapest available option if economy is enabled
```

## Economy Rules

Economy recommendations must distinguish:

- already owned;
- in accessible storage;
- buyable directly;
- craftable from owned/buyable ingredients;
- unavailable;
- blocked by stock;
- blocked by missing skill;
- blocked by missing station;
- blocked by unsupported requirement.

For budget mode, the advisor should consider:

- cheapest equivalent;
- stock-limited purchases;
- recursive craft cost;
- ingredient tags;
- multiple currencies;
- missing prices;
- server-specific modded items.

## User Interface Ideas

Start simple. Avoid building a complex web UI too early.

Possible surfaces:

- slash command;
- tooltip;
- in-game tab/window if practical;
- optional web page served by the mod later.

Suggested commands:

```text
/housingadvisor
/housingadvisor room
/housingadvisor house
/housingadvisor economy
/housingadvisor debug
```

Suggested output levels:

- normal: only best recommendations;
- expanded: reasons and alternatives;
- debug: exact calculation steps and raw runtime values.

## Debug And Issue Support

The mod should eventually support an export/debug payload for bug reports.

Useful payload:

- Eco version;
- mod version;
- server name if allowed;
- room category;
- material tier;
- current objects;
- recommended objects;
- item `HomeValue` data;
- stores/prices used;
- player config;
- calculated result;
- raw Eco score if available.

Goal:

- make it easy for testers to report a difference between the advisor and the game tooltip.

## Architecture Proposal

Keep the project split into clear layers.

### Eco Runtime Adapter

Responsible for reading Eco runtime objects:

- furniture;
- home values;
- recipes;
- rooms;
- stores;
- inventory/storage;
- player state.

This layer can depend on Eco assemblies.

### Advisor Domain

Pure C# logic as much as possible:

- scoring;
- recommendations;
- ranking;
- equivalence groups;
- availability;
- budget optimization.

This layer should be unit-testable with fake snapshots.

### Presentation Layer

Responsible for:

- commands;
- tooltip output;
- web/API output if added later.

It should not contain housing formulas.

## Suggested Project Layout

```text
EcoHousingAdvisor/
  README.md
  EcoHousingAdvisor.csproj
  Commands/
    HousingAdvisorCommands.cs
  EcoRuntime/
    EcoFurnitureReader.cs
    EcoEconomyReader.cs
    EcoRoomReader.cs
  Domain/
    HousingAdvisorEngine.cs
    HousingScoring.cs
    AvailabilityResolver.cs
    EquivalenceResolver.cs
  Presentation/
    AdvisorTextRenderer.cs
  Tests/
    HousingScoringTests.cs
    EquivalenceResolverTests.cs
```

## Testing Strategy

Start with fake snapshots before full Eco integration tests.

Minimum tests:

- reads fake `HomeValue`;
- duplicate diminishing returns;
- support cap;
- material tier cap;
- equivalent items grouped correctly;
- unavailable items rejected;
- cheaper equivalent chosen;
- stock-limited purchase respected;
- blocked operational requirement explained;
- zero-gain item ignored.

Later tests:

- compare against real Eco tooltip examples;
- compare against FurnitureFinder output for raw furniture values;
- compare store extraction against OpenNutriView-like store reading.

## Development Rules For Codex

When working on this project in a fresh context:

1. Read this README first.
2. Do not import old app complexity unless explicitly needed.
3. Prefer small vertical slices over large rewrites.
4. Use Eco runtime APIs as source of truth.
5. Keep domain logic testable outside Eco.
6. Avoid hardcoded item exceptions unless the runtime data proves there is no general rule.
7. Keep user-facing output simple.
8. Add tests before changing scoring behavior.
9. Document any confirmed gap between Eco runtime data and what the game UI displays.
10. Do not optimize the whole house until the single-room advisor is reliable.

## First Implementation Task

Recommended first prompt for a new context:

```text
Read work/eco-housing-advisor/README.md.
Create the initial EcoHousingAdvisor mod skeleton.
Implement V0 only:
- command /housingadvisor;
- discover housing furniture from Eco runtime;
- read WorldObjectItem.HomeValue;
- print grouped furniture by category with base value and duplicate multiplier.
Keep the domain model separate from Eco runtime code.
Add fake unit tests for the domain grouping logic.
Do not build the full optimizer yet.
```

## V0 Implementation Notes

The initial skeleton is intentionally small:

- `Domain/` contains pure grouping records and logic.
- `EcoRuntime/` contains the Eco-facing furniture reader.
- `Presentation/` renders simple command text.
- `Commands/` contains the `/housingadvisor` chat command behind `ECO_MODKIT`.
- `Tests/` contains fake domain tests that can run without Eco assemblies.

Runtime API uncertainty to confirm inside a real Eco server:

- The command handler signature and localized chat send helper may need small adjustments for the exact Eco server version.
- `ServiceHolder.Obj.AllTypes` is read reflectively when available, then falls back to loaded assembly types.
- `WorldObjectItem.HomeValue` / `homeValue` is read reflectively. The reader currently accepts `BaseValue`, `Value`, or `ObjectValue`, and `DiminishingReturnMultiplier`, `DiminishingMultiplierAcrossFullProperty`, or `DiminishingReturnPercent`.
- `HousingComponent` detection is best-effort because component metadata may be exposed by attributes, members, or runtime component collections depending on Eco version. Non-null `HomeValue` remains the decisive V0 furniture signal.

## V0.2 Plan

Goal: make the in-game command comfortable to test on a real server without starting the full optimizer.

Scope:

- Add command filters:
  - `/housingadvisor` shows a short summary and the first page.
  - `/housingadvisor category <name>` lists one category.
  - `/housingadvisor search <text>` finds matching furniture names.
  - `/housingadvisor debug` prints discovery counts and runtime warnings.
- Add pagination or a hard output limit so the chat is not flooded.
- Improve display names without constructing Eco item attributes after startup.
- Cache the discovered furniture snapshot after the first command call.
- Add a safe refresh path, probably `/housingadvisor refresh`, for server admins.
- Add recipe/skill hints only if they can be read from Eco runtime without side effects.
- Keep grouping logic in `Domain/` and add fake tests for filtering, pagination, and stable ordering.

Acceptance tests:

- Server starts with `EcoHousingAdvisor` installed and no compile/runtime errors.
- `/housingadvisor` returns a short summary instead of a giant wall of text.
- `/housingadvisor category Seating` returns only seating entries.
- `/housingadvisor search chair` returns chair-like items with base value, type limit, and duplicate multiplier.
- Running the command repeatedly does not create Eco item attributes or throw cache errors.
- Local fake tests pass.

Out of scope for V0.2:

- Room-specific recommendations.
- Real XP gain after material tier, room caps, or placed duplicates.
- Economy/store optimization.

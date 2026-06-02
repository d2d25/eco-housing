import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createCraftResolver } from "../domain/craftResolver";
import { byName } from "../domain/model";
import { estimateObjectFloor, formatFootprint, itemFootprint, surfacePlacementKind, surfaceSummary, surfaceUnitsProvided, surfaceUnitsRequired } from "../domain/placementRules";
import { summarizeEntries } from "../domain/roomScoring";
import type { EcoModel, HousingItem, ItemClass, RoomOptimization, Skill, SkillClass } from "../domain/types";
import { loadEcoModel } from "../data/ecoDataLoader";
import { DEFAULT_CONFIG, loadConfig, loadOwnedItems, saveConfig, saveOwnedItems, type ActiveView, type AppConfig } from "./storage";
import { useRoomOptimizationWorker } from "./useRoomOptimizationWorker";

const PROFESSION_ORDER = ["Carpenter", "Mason", "Farmer", "Hunter", "Chef", "Tailor", "Smith", "Engineer", "Scientist"];
const APP_VERSION = "0.1.0-beta";
const EXPORT_SCHEMA_VERSION = 1;
const SUPPORTED_EXPORT_SCHEMA_VERSIONS = new Set([1]);

export function App() {
  const [model, setModel] = useState<EcoModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AppConfig>(() => loadConfig());
  const [ownedItems, setOwnedItems] = useState<Map<ItemClass, number>>(() => loadOwnedItems());
  const [ownedOpen, setOwnedOpen] = useState(false);
  const [allowedOpen, setAllowedOpen] = useState(false);

  useEffect(() => {
    loadEcoModel().then(setModel).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => saveConfig(config), [config]);
  useEffect(() => saveOwnedItems(ownedItems), [ownedItems]);

  const selectedSkills = useMemo(() => new Set(config.selectedSkills), [config.selectedSkills]);
  const disabledItems = useMemo(() => new Set(config.disabledItems), [config.disabledItems]);
  const availableSkills = useMemo(() => (model ? model.skills.filter((skill) => skill.isSpecialty) : []), [model]);
  const availableHousingCount = useMemo(() => {
    if (!model) return 0;
    const resolver = createCraftResolver(model, selectedSkills);
    return model.housingItems.filter((item) => resolver.resolve(item.itemClass).craftable).length;
  }, [model, selectedSkills]);

  function update(partial: Partial<AppConfig>) {
    setConfig((current) => ({ ...current, ...partial }));
  }

  async function importExportJson(file: File) {
    try {
      if (!model) throw new Error("Cannot import before Eco data is loaded.");
      const raw = await file.text();
      const imported = parseImportedIssueJson(JSON.parse(raw), model);
      setConfig((current) => ({ ...current, ...imported.config, activeView: "room" }));
      setOwnedItems(imported.ownedItems);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  if (error) return <main className="boot-error">{error}</main>;
  if (!model) return <main className="boot-error">Chargement des donnees Eco...</main>;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandLogo />
          <div>
            <h1>Eco Housing</h1>
            <p>Piece + objets - {APP_VERSION}</p>
          </div>
        </div>
        <nav className="tabs" aria-label="Navigation">
          <button className={config.activeView === "room" ? "active" : ""} onClick={() => update({ activeView: "room" })}>Piece</button>
          <button className={config.activeView === "objects" ? "active" : ""} onClick={() => update({ activeView: "objects" })}>Objets</button>
        </nav>
        <SkillPanel model={model} availableSkills={availableSkills} selectedSkills={selectedSkills} onChange={(next) => update({ selectedSkills: [...next] })} />
      </aside>

      <main className="app">
        <header className="toolbar">
          <div>
            <p className="eyebrow">Donnees extraites du jeu</p>
            <h2>{config.activeView === "room" ? "Optimiser une piece" : "Catalogue des objets"}</h2>
          </div>
          <div className="stats">
            <div><strong>{model.housingItems.length}</strong><span>housing</span></div>
            <div><strong>{availableHousingCount}</strong><span>objets dispo</span></div>
          </div>
        </header>

        {config.activeView === "room" ? (
          <RoomPage
            model={model}
            config={config}
            update={update}
            selectedSkills={selectedSkills}
            disabledItems={disabledItems}
            ownedItems={ownedItems}
            onOpenOwned={() => setOwnedOpen(true)}
            onOpenAllowed={() => setAllowedOpen(true)}
            onImportJson={importExportJson}
          />
        ) : (
          <ObjectsPage model={model} config={config} update={update} selectedSkills={selectedSkills} />
        )}
      </main>

      {ownedOpen && <OwnedItemsModal model={model} ownedItems={ownedItems} selectedSkills={selectedSkills} onChange={setOwnedItems} onClose={() => setOwnedOpen(false)} />}
      {allowedOpen && <AllowedItemsModal model={model} disabledItems={disabledItems} onChange={(next) => update({ disabledItems: [...next] })} onClose={() => setAllowedOpen(false)} />}
    </div>
  );
}

function BrandLogo() {
  return (
    <span className="brand-logo" aria-hidden="true">
      <svg viewBox="0 0 96 96" role="img">
        <rect width="96" height="96" rx="18" fill="#2F7D55" />
        <path d="M18 46L48 22L78 46V78H18V46Z" fill="#F7F8F2" />
        <path d="M28 50L48 34L68 50V72H28V50Z" fill="#DDECD5" />
        <path d="M39 72V55H57V72" fill="#2F7D55" />
        <path d="M18 46L48 22L78 46" stroke="#173B2A" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M35 57H43M53 57H61" stroke="#173B2A" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function SkillPanel({
  model,
  availableSkills,
  selectedSkills,
  onChange,
}: {
  model: EcoModel;
  availableSkills: typeof model.skills;
  selectedSkills: Set<SkillClass>;
  onChange: (next: Set<SkillClass>) => void;
}) {
  const groups = useMemo(() => {
    const byGroup = new Map<string, typeof model.skills>();
    for (const skill of availableSkills) {
      const group = skill.professionGroup ?? "Autres";
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push(skill);
    }
    return [...byGroup.entries()].sort(([a], [b]) => professionOrder(a) - professionOrder(b));
  }, [availableSkills, model.skills]);

  function toggle(skillClass: SkillClass) {
    const next = new Set(selectedSkills);
    if (next.has(skillClass)) next.delete(skillClass);
    else next.add(skillClass);
    onChange(next);
  }

  return (
    <section className="skills">
      <div className="panel-head">
        <h3>Metiers</h3>
        <div className="button-row">
          <button onClick={() => onChange(new Set(availableSkills.map((skill) => skill.className)))}>Tout</button>
          <button onClick={() => onChange(new Set())}>Reset</button>
        </div>
      </div>
      <div className="skill-list">
        {groups.length ? groups.map(([group, skills]) => (
          <details key={group} open>
            <summary>{group}<span>{skills.filter((skill) => selectedSkills.has(skill.className)).length}/{skills.length}</span></summary>
            {skills.map((skill) => (
              <label className="check-row" key={skill.className}>
                <input type="checkbox" checked={selectedSkills.has(skill.className)} onChange={() => toggle(skill.className)} />
                <SkillName skill={skill} />
              </label>
            ))}
          </details>
        )) : <div className="empty">Aucun metier disponible.</div>}
      </div>
    </section>
  );
}

function RoomPage(props: {
  model: EcoModel;
  config: AppConfig;
  update: (partial: Partial<AppConfig>) => void;
  selectedSkills: Set<SkillClass>;
  disabledItems: Set<ItemClass>;
  ownedItems: Map<ItemClass, number>;
  onOpenOwned: () => void;
  onOpenAllowed: () => void;
  onImportJson: (file: File) => void;
}) {
  const { model, config, update, selectedSkills, disabledItems, ownedItems } = props;
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const playableRooms = model.roomCategories.filter((room) => room.canBeRoomCategory && !room.negatesValue && room.name !== "Outdoor" && room.name !== "Cultural");
  const tiers = model.roomTiers;
  const optimizationState = useRoomOptimizationWorker({ model, config, selectedSkills, disabledItems, ownedItems });
  const optimization = optimizationState.optimization;
  const roomVolume = config.width * config.depth * config.height;

  return (
    <section className="room-page">
      <div className="page-actions">
        <span>{optimization ? `categories compatibles: ${optimization.groups.map((group) => group.category).join(", ")}` : "calcul en cours"}</span>
        <button disabled={!optimization} onClick={() => optimization && exportIssueJson(model, config, selectedSkills, ownedItems, disabledItems, optimization)}>Export</button>
        <button onClick={() => importInputRef.current?.click()}>Import</button>
        <input
          ref={importInputRef}
          className="file-input"
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) props.onImportJson(file);
            event.currentTarget.value = "";
          }}
        />
        <button onClick={props.onOpenOwned}>Objets acquis ({[...ownedItems.values()].reduce((a, b) => a + b, 0)})</button>
        <button onClick={props.onOpenAllowed}>Autorisations</button>
      </div>

      <section className="setup-panel">
        <div className="field-grid">
          <NumberField label="Largeur" value={config.width} min={1} max={20} onChange={(width) => update({ width })} />
          <NumberField label="Longueur" value={config.depth} min={1} max={20} onChange={(depth) => update({ depth })} />
          <NumberField label="Hauteur" value={config.height} min={2} max={8} onChange={(height) => update({ height })} />
        </div>
        <div className="segmented">
          <span>Tier de la piece</span>
          <div>{tiers.map((tier) => <button key={tier.tier} className={config.roomTier === tier.tier ? "active" : ""} onClick={() => update({ roomTier: tier.tier })}>T{tier.tier}<small>{tier.softCap}/{tier.hardCap}</small></button>)}</div>
        </div>
        <div className="segmented">
          <span>Type de piece</span>
          <div>{playableRooms.map((room) => <button key={room.name} className={config.roomType === room.name ? "active" : ""} onClick={() => update({ roomType: room.name })}>{room.name}</button>)}</div>
        </div>
      </section>

      {optimizationState.status === "loading" && <OptimizationSpinner />}
      {optimizationState.status === "error" && <OptimizationError message={optimizationState.error} />}
      {optimizationState.status === "ready" && (
        <RoomOptimizationResults optimization={optimizationState.optimization} width={config.width} depth={config.depth} height={config.height} roomVolume={roomVolume} />
      )}
    </section>
  );
}

function exportIssueJson(model: EcoModel, config: AppConfig, selectedSkills: Set<SkillClass>, ownedItems: Map<ItemClass, number>, disabledItems: Set<ItemClass>, optimization: RoomOptimization) {
  const skillByClass = new Map(model.skills.map((skill) => [skill.className, skill]));
  const itemByClass = new Map(model.housingItems.map((item) => [item.itemClass, item]));
  const report = {
    format: {
      name: "eco-housing-issue",
      schemaVersion: EXPORT_SCHEMA_VERSION,
      breakingChangePolicy: "Increment schemaVersion when import-compatible fields change incompatibly.",
    },
    app: {
      name: "Eco Housing",
      version: APP_VERSION,
      url: window.location.href,
      exportedAt: new Date().toISOString(),
    },
    roomInput: {
      roomType: config.roomType,
      tier: config.roomTier,
      width: config.width,
      depth: config.depth,
      height: config.height,
      volume: config.width * config.depth * config.height,
    },
    selectedSkills: [...selectedSkills].sort().map((skillClass) => ({
      className: skillClass,
      name: skillByClass.get(skillClass)?.friendlyName ?? skillClass,
      professionGroup: skillByClass.get(skillClass)?.professionGroup ?? null,
    })),
    ownedItems: [...ownedItems.entries()].filter(([, quantity]) => quantity > 0).sort(([a], [b]) => a.localeCompare(b)).map(([itemClass, quantity]) => ({
      itemClass,
      name: itemByClass.get(itemClass)?.friendlyName ?? itemClass,
      quantity,
    })),
    disabledItems: [...disabledItems].sort().map((itemClass) => ({
      itemClass,
      name: itemByClass.get(itemClass)?.friendlyName ?? itemClass,
    })),
    score: optimization.score,
    selectedItems: optimization.groups.map((group) => ({
      category: group.category,
      role: group.role,
      score: group.score,
      supportCap: group.supportCap,
      supportCapPercent: group.supportCapPercent,
      entries: summarizeEntries(group.entries).map((entry) => ({
        itemClass: entry.item.itemClass,
        name: entry.item.friendlyName,
        category: entry.item.category,
        typeForRoomLimit: entry.item.typeForRoomLimit,
        quantity: entry.quantityPerRoom,
        score: entry.score,
        rawScore: entry.rawScore,
        fromOwned: entry.fromOwned,
        footprint: formatFootprint(entry.item),
        requiredRoomVolume: entry.item.requirements?.requiredRoomVolume ?? null,
        requiredRoomMaterialTier: entry.item.requirements?.requiredRoomMaterialTier ?? null,
        placement: surfacePlacementKind(entry.item) || null,
        placedOnFloor: entry.placedOnFloor,
      })),
    })),
    constraints: {
      roomFloor: config.width * config.depth,
      roomVolume: config.width * config.depth * config.height,
      usedFloor: optimization.constraints.usedFloor,
      usedRequiredVolume: optimization.constraints.usedRequiredVolume,
      surfaceCapacity: optimization.constraints.surfaceCapacity,
      usedSurface: optimization.constraints.usedSurface,
    },
    expectedGameEvidence: {
      required: "Attach a screenshot of Eco's in-game Room Details tooltip for this exact room.",
    },
  };

  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  link.href = url;
  link.download = `eco-housing-issue-${timestamp}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseImportedIssueJson(data: unknown, model: EcoModel): { config: Partial<AppConfig>; ownedItems: Map<ItemClass, number> } {
  if (!isRecord(data)) throw new Error("Invalid import file: expected a JSON object.");

  const format = isRecord(data.format) ? data.format : null;
  const schemaVersion = Number(format?.schemaVersion ?? 0);
  if (!SUPPORTED_EXPORT_SCHEMA_VERSIONS.has(schemaVersion)) {
    throw new Error(`Unsupported import schema version: ${schemaVersion || "missing"}. Supported version: ${EXPORT_SCHEMA_VERSION}.`);
  }

  const roomInput = isRecord(data.roomInput) ? data.roomInput : null;
  if (!roomInput) throw new Error("Invalid import file: missing roomInput.");

  const roomNames = new Set(model.roomCategories.map((room) => room.name));
  const skillClasses = new Set(model.skills.map((skill) => skill.className));
  const itemClasses = new Set(model.housingItems.map((item) => item.itemClass));
  const roomType = readString(roomInput.roomType, "roomInput.roomType");
  if (!roomNames.has(roomType)) throw new Error(`Invalid import file: unknown room type "${roomType}".`);

  const selectedSkills = readClassArray(data.selectedSkills, "selectedSkills").filter((skillClass) => skillClasses.has(skillClass));
  const disabledItems = readClassArray(data.disabledItems, "disabledItems").filter((itemClass) => itemClasses.has(itemClass));
  const ownedItems = new Map<ItemClass, number>();
  for (const entry of readObjectArray(data.ownedItems, "ownedItems")) {
    const itemClass = readString(entry.itemClass, "ownedItems.itemClass");
    const quantity = Math.max(0, Math.floor(readNumber(entry.quantity, "ownedItems.quantity")));
    if (quantity > 0 && itemClasses.has(itemClass)) ownedItems.set(itemClass, quantity);
  }

  return {
    config: {
      roomType,
      roomTier: readNumber(roomInput.tier, "roomInput.tier"),
      width: readNumber(roomInput.width, "roomInput.width"),
      depth: readNumber(roomInput.depth, "roomInput.depth"),
      height: readNumber(roomInput.height, "roomInput.height"),
      selectedSkills,
      disabledItems,
    },
    ownedItems,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, field: string) {
  if (typeof value !== "string" || !value) throw new Error(`Invalid import file: missing ${field}.`);
  return value;
}

function readNumber(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid import file: invalid ${field}.`);
  return number;
}

function readObjectArray(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new Error(`Invalid import file: missing ${field}.`);
  return value.filter(isRecord);
}

function readClassArray(value: unknown, field: string) {
  return readObjectArray(value, field).map((entry) => readString(entry.className ?? entry.itemClass, `${field}.className`));
}

function RoomOptimizationResults({ optimization, width, depth, height, roomVolume }: { optimization: RoomOptimization; width: number; depth: number; height: number; roomVolume: number }) {
  const score = optimization.score;
  const surface = surfaceSummary(optimization.entries);
  const objectFloor = estimateObjectFloor(optimization.entries);
  const requiredVolume = optimization.entries.reduce((total, entry) => total + (entry.item.requirements?.requiredRoomVolume ?? 0), 0);

  return (
    <>
      <section className="score-grid">
        <div className="score-card primary"><span>Total utile de la piece</span><strong>{score.capped.toFixed(1)}</strong><small>{score.raw.toFixed(1)} brut | {score.afterSupportCaps.toFixed(1)} avant tier</small></div>
        <div className="score-card"><span>Tier actif</span><strong>T{score.tier?.tier ?? "?"}</strong><small>soft {score.tier?.softCap ?? "?"} | hard {score.tier?.hardCap ?? "?"} | retour {score.tier ? Math.round(score.tier.diminishingReturnPercent * 100) : "?"}%</small></div>
      </section>

      <section className="trace-grid">
        <Metric label="brut objets" value={score.raw} />
        <Metric label="apres doublons" value={score.afterDiminishing} delta={-score.duplicateLoss} />
        <Metric label="apres caps supports" value={score.afterSupportCaps} delta={-score.supportCapLoss} />
        <Metric label="apres tier" value={score.capped} delta={-score.capLoss} />
      </section>

      <section className="fit-grid">
        <div><strong>{width}x{depth}x{height}</strong><span>taille piece</span></div>
        <div className={objectFloor > width * depth ? "bad" : ""}><strong>{objectFloor}/{width * depth}</strong><span>sol objets</span></div>
        <div className={requiredVolume > roomVolume ? "bad" : ""}><strong>{requiredVolume}/{roomVolume}</strong><span>m3 requis objets / m3 piece</span></div>
        <div className={surface.used > surface.capacity ? "bad" : ""}><strong>{surface.used}/{surface.capacity}</strong><span>surface posee / disponible</span></div>
      </section>

      <section className="optimizer-grid">
        {optimization.groups.map((group) => (
          <article className="opt-group" key={group.category}>
            <div className="opt-title">
              <div><span>{group.category}</span><h3>{group.role}</h3>{group.supportCap != null && <small>plafond {Math.round((group.supportCapPercent ?? 0) * 100)}%: {group.supportCap.toFixed(1)}</small>}</div>
              <strong>{group.score.toFixed(1)}</strong>
            </div>
            <div className="opt-items">
              {summarizeEntries(group.entries).length ? summarizeEntries(group.entries).map((summary) => <RoomItem key={summary.item.itemClass} summary={summary} />) : <div className="empty">Aucun item avec ces filtres.</div>}
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

function OptimizationSpinner() {
  return <section className="optimization-state" aria-label="Calcul optimisation"><span className="spinner" /></section>;
}

function OptimizationError({ message }: { message: string }) {
  return <section className="optimization-state error"><strong>Erreur de calcul</strong><span>{message}</span></section>;
}

function RoomItem({ summary }: { summary: ReturnType<typeof summarizeEntries>[number] }) {
  const item = summary.item;
  return (
    <div className="opt-item">
      <div className="item-head">
        <ItemName item={item} />
        <b>x{summary.quantityPerRoom}</b>
      </div>
      <div className="pill-row">
        <span className="pill">+{summary.score.toFixed(2)} XP total</span>
        {summary.fromOwned > 0 && <span className="pill">acquis x{summary.fromOwned}</span>}
        {summary.rawScore - summary.score > 0.01 && <span className="pill warn">cap -{(summary.rawScore - summary.score).toFixed(2)}</span>}
        {summary.lastMultiplier < 1 && <span className="pill">dernier: {Math.round(summary.lastMultiplier * 100)}%</span>}
        <span className="pill">{item.typeForRoomLimit ?? "General"}</span>
        <span className="pill">{formatFootprint(item)}</span>
        {surfacePlacementKind(item) && <span className="pill">{surfacePlacementKind(item)}</span>}
        {summary.placedOnFloor && <span className="pill warn">pose au sol</span>}
        {surfaceUnitsProvided(item) > 0 && <span className="pill">surface +{surfaceUnitsProvided(item)}</span>}
        {surfaceUnitsRequired(item) > 0 && <span className="pill">surface -{surfaceUnitsRequired(item)}</span>}
        {itemFootprint(item).estimated && <span className="pill warn">empreinte estimee</span>}
        {item.requirements?.requiredRoomVolume != null && <span className="pill">m3 requis {item.requirements.requiredRoomVolume}</span>}
        {item.requirements?.requiredRoomMaterialTier != null && <span className="pill">T{item.requirements.requiredRoomMaterialTier}</span>}
      </div>
    </div>
  );
}

function ObjectsPage({ model, config, update, selectedSkills }: { model: EcoModel; config: AppConfig; update: (partial: Partial<AppConfig>) => void; selectedSkills: Set<SkillClass> }) {
  const [openFilter, setOpenFilter] = useState<{ key: "category" | "craft"; left: number; top: number } | null>(null);
  const resolver = useMemo(() => createCraftResolver(model, selectedSkills), [model, selectedSkills]);
  const categories = [...new Set(model.housingItems.map((item) => item.category))].sort();
  const craftSkills = craftSkillOptions(model);
  const query = config.objectSearch.trim().toLowerCase();
  const items = model.housingItems
    .filter((item) => !config.objectCategories.length || config.objectCategories.includes(item.category))
    .filter((item) => {
      if (!config.objectCraftSkills.length) return true;
      const skillClasses = craftSkillClassesForItem(model, item);
      return config.objectCraftSkills.some((skillClass) => skillClass === "none" ? skillClasses.length === 0 : skillClasses.includes(skillClass));
    })
    .filter((item) => {
      const resolution = resolver.resolve(item.itemClass);
      return resolution.craftable;
    })
    .filter((item) => !query || [item.friendlyName, item.category, item.typeForRoomLimit, item.source].join(" ").toLowerCase().includes(query))
    .sort((a, b) => sortObjects(a, b, config.objectSort));

  function toggleColumnFilter(key: "category" | "craft", event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 280;
    const margin = 12;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    const top = Math.min(rect.bottom + 8, window.innerHeight - 120);
    setOpenFilter((current) => current?.key === key ? null : { key, left, top });
  }

  return (
    <section className="objects-page">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <span className="object-name-header">
                  <SortableColumn
                    label="Objet"
                    active={config.objectSort === "name-asc" || config.objectSort === "name-desc"}
                    direction={config.objectSort === "name-desc" ? "desc" : "asc"}
                    onClick={() => update({ objectSort: config.objectSort === "name-asc" ? "name-desc" : "name-asc" })}
                  />
                  <input value={config.objectSearch} onChange={(event) => update({ objectSearch: event.target.value })} placeholder="Rechercher..." />
                </span>
              </th>
              <th>
                <FilterColumn
                  label="Categorie"
                  help="Categorie housing extraite du jeu. Elle sert a grouper les objets et a appliquer les caps de support dans le calcul de piece."
                  activeCount={config.objectCategories.length}
                  open={openFilter?.key === "category"}
                  popoverStyle={openFilter?.key === "category" ? { left: openFilter.left, top: openFilter.top } : undefined}
                  onToggle={(event) => toggleColumnFilter("category", event)}
                  onClear={() => update({ objectCategories: [] })}
                >
                  {categories.map((category) => (
                    <label className="filter-option" key={category}>
                      <input
                        type="checkbox"
                        checked={config.objectCategories.includes(category)}
                        onChange={() => update({ objectCategories: toggleFilterValue(config.objectCategories, category) })}
                      />
                      <span>{category}</span>
                    </label>
                  ))}
                </FilterColumn>
              </th>
              <th>
                <SortableColumn
                  label="XP"
                  help="Valeur housing brute de l'objet avant les doublons, caps de support et cap du tier de materiaux."
                  active={config.objectSort === "xp-desc" || config.objectSort === "xp-asc"}
                  direction={config.objectSort === "xp-asc" ? "asc" : "desc"}
                  onClick={() => update({ objectSort: config.objectSort === "xp-desc" ? "xp-asc" : "xp-desc" })}
                />
              </th>
              <th><ColumnHelp label="Doublons" help="Pourcentage conserve quand plusieurs objets du meme type sont places. 50% veut dire que le doublon vaut moitie moins." /></th>
              <th>
                <SortableColumn
                  label="Empreinte au sol"
                  help="Taille au sol extraite ou estimee. Le format largeur x profondeur = surface indique combien de blocs de sol l'objet occupe."
                  active={config.objectSort === "floor-desc" || config.objectSort === "floor-asc"}
                  direction={config.objectSort === "floor-asc" ? "asc" : "desc"}
                  onClick={() => update({ objectSort: config.objectSort === "floor-desc" ? "floor-asc" : "floor-desc" })}
                />
              </th>
              <th>
                <SortableColumn
                  label="Volume requis"
                  help="Volume minimal demande par l'objet dans les donnees du jeu. Ce n'est pas le volume physique de l'objet."
                  active={config.objectSort === "volume-desc" || config.objectSort === "volume-asc"}
                  direction={config.objectSort === "volume-asc" ? "asc" : "desc"}
                  onClick={() => update({ objectSort: config.objectSort === "volume-desc" ? "volume-asc" : "volume-desc" })}
                />
              </th>
              <th>
                <FilterColumn
                  label="Metier craft"
                  help="Metier direct requis par la recette de cet objet. All signifie qu'aucun metier specifique n'est requis dans la recette directe."
                  activeCount={config.objectCraftSkills.length}
                  open={openFilter?.key === "craft"}
                  popoverStyle={openFilter?.key === "craft" ? { left: openFilter.left, top: openFilter.top } : undefined}
                  onToggle={(event) => toggleColumnFilter("craft", event)}
                  onClear={() => update({ objectCraftSkills: [] })}
                >
                  <label className="filter-option">
                    <input
                      type="checkbox"
                      checked={config.objectCraftSkills.includes("none")}
                      onChange={() => update({ objectCraftSkills: toggleFilterValue(config.objectCraftSkills, "none") })}
                    />
                    <span>All (sans metier)</span>
                  </label>
                  {craftSkills.map((skill) => (
                    <label className="filter-option" key={skill.className}>
                      <input
                        type="checkbox"
                        checked={config.objectCraftSkills.includes(skill.className)}
                        onChange={() => update({ objectCraftSkills: toggleFilterValue(config.objectCraftSkills, skill.className) })}
                      />
                      <SkillName skill={skill} />
                    </label>
                  ))}
                </FilterColumn>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              return (
                <tr key={item.itemClass}>
                  <td><ItemName item={item} subtitle={item.typeForRoomLimit ?? "-"} /></td>
                  <td>{item.category}</td>
                  <td>{item.value}</td>
                  <td>{Math.round((item.diminishingReturnPercent ?? 1) * 100)}%</td>
                  <td>{formatFootprint(item)}</td>
                  <td>{item.requirements?.requiredRoomVolume ?? "-"}</td>
                  <td><CraftSkillNames model={model} item={item} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function sortObjects(a: HousingItem, b: HousingItem, sort: AppConfig["objectSort"]) {
  if (sort === "name-desc") return byName(b, a);
  if (sort === "xp-desc") return b.value - a.value || byName(a, b);
  if (sort === "xp-asc") return a.value - b.value || byName(a, b);
  if (sort === "floor-desc") return floorAreaForSort(b) - floorAreaForSort(a) || byName(a, b);
  if (sort === "floor-asc") return floorAreaForSort(a) - floorAreaForSort(b) || byName(a, b);
  if (sort === "volume-desc") return requiredVolumeForSort(b) - requiredVolumeForSort(a) || byName(a, b);
  if (sort === "volume-asc") return requiredVolumeForSort(a) - requiredVolumeForSort(b) || byName(a, b);
  return byName(a, b);
}

function toggleFilterValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function requiredVolumeForSort(item: HousingItem) {
  return item.requirements?.requiredRoomVolume ?? -1;
}

function floorAreaForSort(item: HousingItem) {
  return itemFootprint(item).floorArea;
}

function craftSkillOptions(model: EcoModel) {
  const used = new Set<SkillClass>();
  for (const item of model.housingItems) {
    for (const skillClass of craftSkillClassesForItem(model, item)) used.add(skillClass);
  }
  return [...used]
    .map((skillClass) => model.skillsByClass.get(skillClass) ?? { className: skillClass, friendlyName: skillClass })
    .sort((a, b) => byName(a, b));
}

function craftSkillClassesForItem(model: EcoModel, item: HousingItem) {
  return [...new Set(item.recipes.map((recipe) => recipe.requiredSkillClass).filter((skillClass): skillClass is SkillClass => isCraftSkill(model, skillClass)))];
}

function isCraftSkill(model: EcoModel, skillClass: SkillClass | null | undefined): skillClass is SkillClass {
  if (!skillClass || skillClass === "Skill") return false;
  const skill = model.skillsByClass.get(skillClass);
  return !skill?.isProfession;
}

function CraftSkillNames({ model, item }: { model: EcoModel; item: HousingItem }) {
  const requirements = craftSkillRequirements(model, item);
  if (!requirements.length) return <span>All</span>;
  return (
    <span className="skill-list-inline">
      {requirements.map(({ skill, level }) => (
        <SkillName key={skill.className} skill={skill} suffix={level ? String(level) : undefined} />
      ))}
    </span>
  );
}

function craftSkillRequirements(model: EcoModel, item: HousingItem) {
  const requirements = new Map<SkillClass, number | null>();
  for (const recipe of item.recipes) {
    const skillClass = recipe.requiredSkillClass;
    if (!isCraftSkill(model, skillClass)) continue;
    const level = recipe.requiredSkillLevel ?? null;
    const current = requirements.get(skillClass);
    if (current == null || (level ?? 0) < current) requirements.set(skillClass, level);
  }

  return [...requirements.entries()]
    .map(([skillClass, level]) => ({
      skill: model.skillsByClass.get(skillClass) ?? { className: skillClass, friendlyName: skillClass },
      level,
    }))
    .sort((a, b) => byName(a.skill, b.skill));
}

function ColumnHelp({ label, help }: { label: string; help: string }) {
  return (
    <span className="column-help">
      <span>{label}</span>
      <span className="help-wrap">
        <button type="button" className="help-button" aria-label={help}>?</button>
        <span className="help-popover" role="tooltip">{help}</span>
      </span>
    </span>
  );
}

function SortableColumn({
  label,
  help,
  active,
  direction = "asc",
  onClick,
}: {
  label: string;
  help?: string;
  active: boolean;
  direction?: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <span className="column-control">
      <button type="button" className={active ? "sort-button active" : "sort-button"} onClick={onClick}>
        {label}<span aria-hidden="true">{active ? (direction === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
      {help && <HelpButton help={help} />}
    </span>
  );
}

function FilterColumn({
  label,
  help,
  activeCount,
  open,
  popoverStyle,
  onToggle,
  onClear,
  children,
}: {
  label: string;
  help: string;
  activeCount: number;
  open: boolean;
  popoverStyle?: CSSProperties;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <span className="column-filter">
      <span className="column-control">
        <span>{label}</span>
        <HelpButton help={help} />
        <button type="button" className={activeCount ? "filter-button active" : "filter-button"} onClick={onToggle} aria-label={`Filtrer ${label}`}>
          <FilterIcon />
          {activeCount > 0 && <span>{activeCount}</span>}
        </button>
      </span>
      {open && (
        <span className="filter-popover" style={popoverStyle}>
          <span className="filter-popover-head">
            <strong>{label}</strong>
            <button type="button" onClick={onClear}>Reset</button>
          </span>
          <span className="filter-options">{children}</span>
        </span>
      )}
    </span>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6H20L14 13V19L10 21V13L4 6Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function HelpButton({ help }: { help: string }) {
  return (
    <span className="help-wrap">
      <button type="button" className="help-button" aria-label={help}>?</button>
      <span className="help-popover" role="tooltip">{help}</span>
    </span>
  );
}

function OwnedItemsModal({ model, ownedItems, selectedSkills, onChange, onClose }: { model: EcoModel; ownedItems: Map<ItemClass, number>; selectedSkills: Set<SkillClass>; onChange: (next: Map<ItemClass, number>) => void; onClose: () => void }) {
  const resolver = useMemo(() => createCraftResolver(model, selectedSkills), [model, selectedSkills]);
  const items = model.housingItems.filter((item) => resolver.resolve(item.itemClass).craftable).sort((a, b) => byName(a, b));
  return <ItemQuantityModal title="Objets deja acquis" items={items} ownedItems={ownedItems} onChange={onChange} onClose={onClose} />;
}

function ItemQuantityModal({ title, items, ownedItems, onChange, onClose }: { title: string; items: HousingItem[]; ownedItems: Map<ItemClass, number>; onChange: (next: Map<ItemClass, number>) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const filtered = items.filter((item) => !query || item.friendlyName.toLowerCase().includes(query)).slice(0, 220);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="modal-tools"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrer les objets..." /><button onClick={() => onChange(new Map())}>Vider</button></div>
      <div className="modal-list">
        {filtered.map((item) => <label className="quantity-row" key={item.itemClass}><ItemName item={item} subtitle={item.category} /><input type="number" min={0} max={999} value={ownedItems.get(item.itemClass) ?? 0} onChange={(event) => {
          const next = new Map(ownedItems);
          const quantity = Math.max(0, Number.parseInt(event.target.value, 10) || 0);
          if (quantity) next.set(item.itemClass, quantity);
          else next.delete(item.itemClass);
          onChange(next);
        }} /></label>)}
      </div>
    </Modal>
  );
}

function AllowedItemsModal({ model, disabledItems, onChange, onClose }: { model: EcoModel; disabledItems: Set<ItemClass>; onChange: (next: Set<ItemClass>) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const items = model.housingItems.filter((item) => !query || item.friendlyName.toLowerCase().includes(query)).sort((a, b) => byName(a, b)).slice(0, 260);
  function setAllowed(item: HousingItem, allowed: boolean) {
    const next = new Set(disabledItems);
    if (allowed) next.delete(item.itemClass);
    else next.add(item.itemClass);
    onChange(next);
  }
  return (
    <Modal title="Autorisations d'optimisation" onClose={onClose}>
      <div className="modal-tools"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrer les objets..." /><button onClick={() => onChange(new Set())}>Tout autoriser</button></div>
      <div className="modal-list">
        {items.map((item) => <label className="check-row modal-check" key={item.itemClass}><input type="checkbox" checked={!disabledItems.has(item.itemClass)} onChange={(event) => setAllowed(item, event.target.checked)} /><ItemName item={item} subtitle={item.category} /></label>)}
      </div>
    </Modal>
  );
}

function ItemName({ item, subtitle }: { item: HousingItem; subtitle?: string | null }) {
  return (
    <span className="item-name">
      <ItemIcon item={item} />
      <span>
        <strong>{item.friendlyName}</strong>
        {subtitle != null && <small>{subtitle}</small>}
      </span>
    </span>
  );
}

function SkillName({ skill, suffix }: { skill: Pick<Skill, "className" | "friendlyName" | "iconUrl">; suffix?: string }) {
  return (
    <span className="skill-name">
      <SkillIcon skill={skill} />
      <span>{skill.friendlyName}{suffix ? ` ${suffix}` : ""}</span>
    </span>
  );
}

function SkillIcon({ skill }: { skill: Pick<Skill, "className" | "friendlyName" | "iconUrl"> }) {
  const style = { "--icon-hue": iconHue(skill.className) } as CSSProperties;
  if (skill.iconUrl) {
    return <img className="skill-icon" src={skill.iconUrl} alt="" loading="lazy" />;
  }
  return <span className="skill-icon skill-icon-fallback" style={style} aria-hidden="true">{iconInitials(skill.friendlyName)}</span>;
}

function ItemIcon({ item }: { item: HousingItem }) {
  const label = iconLabel(item);
  const style = { "--icon-hue": iconHue(item.itemClass) } as CSSProperties;
  if (item.iconUrl && !item.noIcon) {
    return <img className="item-icon" src={item.iconUrl} alt="" loading="lazy" />;
  }
  return <span className="item-icon item-icon-fallback" style={style} aria-hidden="true">{label}</span>;
}

function iconInitials(value: string) {
  const words = value.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function iconLabel(item: HousingItem) {
  return iconInitials(item.friendlyName);
}

function iconHue(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) % 360;
  return String(hash);
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal"><header><h2>{title}</h2><button onClick={onClose}>x</button></header>{children}</section></div>;
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label>{label}<input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Math.max(min, Math.min(max, Number.parseInt(event.target.value, 10) || min)))} /></label>;
}

function Metric({ label, value, delta = 0 }: { label: string; value: number; delta?: number }) {
  return <div><span>{label}</span><strong>{value.toFixed(2)}</strong>{Math.abs(delta) > 0.01 && <small>{delta.toFixed(2)}</small>}</div>;
}

function professionOrder(name: string) {
  const index = PROFESSION_ORDER.indexOf(name);
  return index === -1 ? 999 : index;
}

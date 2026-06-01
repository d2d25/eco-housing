import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createCraftResolver } from "../domain/craftResolver";
import { byName } from "../domain/model";
import { estimateObjectFloor, formatFootprint, itemFootprint, surfacePlacementKind, surfaceSummary, surfaceUnitsProvided, surfaceUnitsRequired } from "../domain/placementRules";
import { summarizeEntries } from "../domain/roomScoring";
import type { EcoModel, HousingItem, ItemClass, RoomOptimization, SkillClass } from "../domain/types";
import { loadEcoModel } from "../data/ecoDataLoader";
import { formatAvailability } from "./format";
import { DEFAULT_CONFIG, loadConfig, loadOwnedItems, saveConfig, saveOwnedItems, type ActiveView, type AppConfig } from "./storage";
import { useRoomOptimizationWorker } from "./useRoomOptimizationWorker";

const PROFESSION_ORDER = ["Carpenter", "Mason", "Farmer", "Hunter", "Chef", "Tailor", "Smith", "Engineer", "Scientist"];

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

  function update(partial: Partial<AppConfig>) {
    setConfig((current) => ({ ...current, ...partial }));
  }

  if (error) return <main className="boot-error">{error}</main>;
  if (!model) return <main className="boot-error">Chargement des donnees Eco...</main>;

  const selectedCount = config.selectedSkills.length;
  const ownedCount = [...ownedItems.values()].reduce((total, value) => total + value, 0);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">E</span>
          <div>
            <h1>Eco Housing</h1>
            <p>Piece + objets</p>
          </div>
        </div>
        <nav className="tabs" aria-label="Navigation">
          <button className={config.activeView === "room" ? "active" : ""} onClick={() => update({ activeView: "room" })}>Piece</button>
          <button className={config.activeView === "objects" ? "active" : ""} onClick={() => update({ activeView: "objects" })}>Objets</button>
        </nav>
        <SkillPanel model={model} selectedSkills={selectedSkills} onChange={(next) => update({ selectedSkills: [...next] })} />
      </aside>

      <main className="app">
        <header className="toolbar">
          <div>
            <p className="eyebrow">Donnees extraites du jeu</p>
            <h2>{config.activeView === "room" ? "Optimiser une piece" : "Catalogue des objets"}</h2>
          </div>
          <div className="stats">
            <div><strong>{model.housingItems.length}</strong><span>housing</span></div>
            <div><strong>{selectedCount}</strong><span>metiers</span></div>
            <div><strong>{ownedCount}</strong><span>acquis</span></div>
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

function SkillPanel({ model, selectedSkills, onChange }: { model: EcoModel; selectedSkills: Set<SkillClass>; onChange: (next: Set<SkillClass>) => void }) {
  const groups = useMemo(() => {
    const byGroup = new Map<string, typeof model.skills>();
    for (const skill of model.skills.filter((skill) => skill.isSpecialty)) {
      const group = skill.professionGroup ?? "Autres";
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push(skill);
    }
    return [...byGroup.entries()].sort(([a], [b]) => professionOrder(a) - professionOrder(b));
  }, [model]);

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
          <button onClick={() => onChange(new Set(model.skills.filter((skill) => skill.isSpecialty).map((skill) => skill.className)))}>Tout</button>
          <button onClick={() => onChange(new Set())}>Reset</button>
        </div>
      </div>
      <div className="skill-list">
        {groups.map(([group, skills]) => (
          <details key={group} open>
            <summary>{group}<span>{skills.filter((skill) => selectedSkills.has(skill.className)).length}/{skills.length}</span></summary>
            {skills.map((skill) => (
              <label className="check-row" key={skill.className}>
                <input type="checkbox" checked={selectedSkills.has(skill.className)} onChange={() => toggle(skill.className)} />
                <span>{skill.friendlyName}</span>
              </label>
            ))}
          </details>
        ))}
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
}) {
  const { model, config, update, selectedSkills, disabledItems, ownedItems } = props;
  const playableRooms = model.roomCategories.filter((room) => room.canBeRoomCategory && !room.negatesValue && room.name !== "Outdoor" && room.name !== "Cultural");
  const tiers = model.roomTiers;
  const optimizationState = useRoomOptimizationWorker({ model, config, selectedSkills, disabledItems, ownedItems });
  const optimization = optimizationState.optimization;
  const roomVolume = config.width * config.depth * config.height;

  return (
    <section className="room-page">
      <div className="page-actions">
        <span>{optimization ? `categories compatibles: ${optimization.groups.map((group) => group.category).join(", ")}` : "calcul en cours"}</span>
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
      <div className="item-head"><strong>{item.friendlyName}</strong><b>x{summary.quantityPerRoom}</b></div>
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
  const resolver = useMemo(() => createCraftResolver(model, selectedSkills), [model, selectedSkills]);
  const categories = [...new Set(model.housingItems.map((item) => item.category))].sort();
  const query = config.objectSearch.trim().toLowerCase();
  const items = model.housingItems
    .filter((item) => config.objectCategory === "all" || item.category === config.objectCategory)
    .filter((item) => {
      const resolution = resolver.resolve(item.itemClass);
      if (config.objectAvailability === "available" && !resolution.craftable) return false;
      if (config.objectAvailability === "locked" && resolution.craftable) return false;
      return true;
    })
    .filter((item) => !query || [item.friendlyName, item.category, item.typeForRoomLimit, item.source].join(" ").toLowerCase().includes(query))
    .sort((a, b) => b.value - a.value || byName(a, b));

  return (
    <section className="objects-page">
      <div className="object-tools">
        <label>Recherche<input value={config.objectSearch} onChange={(event) => update({ objectSearch: event.target.value })} placeholder="Lit, table, lamp..." /></label>
        <label>Categorie<select value={config.objectCategory} onChange={(event) => update({ objectCategory: event.target.value })}><option value="all">Toutes</option>{categories.map((cat) => <option key={cat}>{cat}</option>)}</select></label>
        <label>Affichage<select value={config.objectAvailability} onChange={(event) => update({ objectAvailability: event.target.value as AppConfig["objectAvailability"] })}><option value="available">Craftable avec metiers</option><option value="all">Tous</option><option value="locked">Verrouilles</option></select></label>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Item</th><th>Categorie</th><th>Valeur</th><th>Retour</th><th>Sol</th><th>m3</th><th>Surface</th><th>Metier</th></tr></thead>
          <tbody>
            {items.map((item) => {
              const resolution = resolver.resolve(item.itemClass);
              return (
                <tr key={item.itemClass}>
                  <td><strong>{item.friendlyName}</strong><small>{item.typeForRoomLimit ?? "-"}</small></td>
                  <td>{item.category}</td>
                  <td>{item.value}</td>
                  <td>{Math.round((item.diminishingReturnPercent ?? 1) * 100)}%</td>
                  <td>{formatFootprint(item)}</td>
                  <td>{item.requirements?.requiredRoomVolume ?? "-"}</td>
                  <td>{surfacePlacementKind(item) || "-"}</td>
                  <td className={resolution.craftable ? "" : "locked"}>{formatAvailability(model, item, resolution)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
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
        {filtered.map((item) => <label className="quantity-row" key={item.itemClass}><span>{item.friendlyName}<small>{item.category}</small></span><input type="number" min={0} max={999} value={ownedItems.get(item.itemClass) ?? 0} onChange={(event) => {
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
        {items.map((item) => <label className="check-row modal-check" key={item.itemClass}><input type="checkbox" checked={!disabledItems.has(item.itemClass)} onChange={(event) => setAllowed(item, event.target.checked)} /><span>{item.friendlyName}<small>{item.category}</small></span></label>)}
      </div>
    </Modal>
  );
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

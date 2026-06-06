import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createCraftResolver } from "../domain/craftResolver";
import { byName } from "../domain/model";
import { effectiveFloorArea, estimateObjectFloor, formatFootprint, surfacePlacementKind, surfaceSummary } from "../domain/placementRules";
import { roomUsesMaterialTier, summarizeEntries } from "../domain/roomScoring";
import type { EcoModel, HouseMaxCopiesPerRoomType, HouseOptimizationResult, HousingItem, ItemClass, RoomOptimization, Skill, SkillClass } from "../domain/types";
import { loadEcoModel } from "../data/ecoDataLoader";
import { createTranslator, LANGUAGES, type Language, type Translator } from "./i18n";
import { DEFAULT_CONFIG, loadConfig, loadOwnedItems, saveConfig, saveOwnedItems, type ActiveView, type AppConfig } from "./storage";
import { useHouseOptimizationWorker } from "./useHouseOptimizationWorker";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const t = useMemo(() => createTranslator(config.language), [config.language]);

  useEffect(() => {
    loadEcoModel().then(setModel).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => saveConfig(config), [config]);
  useEffect(() => saveOwnedItems(ownedItems), [ownedItems]);
  useEffect(() => {
    document.documentElement.lang = config.language;
  }, [config.language]);

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
      if (!model) throw new Error(t("importBeforeData"));
      const raw = await file.text();
      const imported = parseImportedIssueJson(JSON.parse(raw), model, t);
      setConfig((current) => ({ ...current, ...imported.config }));
      setOwnedItems(imported.ownedItems);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  if (error) return <main className="boot-error">{error}</main>;
  if (!model) return <main className="boot-error">{t("loadingEcoData")}</main>;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandLogo />
          <div>
            <h1>Eco Housing</h1>
            <p>{t("appSubtitle")} - {APP_VERSION}</p>
          </div>
        </div>
        <nav className="tabs" aria-label="Navigation">
          <button className={config.activeView === "house" ? "active" : ""} onClick={() => update({ activeView: "house" })}>{t("viewHouse")}</button>
          <button className={config.activeView === "room" ? "active" : ""} onClick={() => update({ activeView: "room" })}>{t("viewRoom")}</button>
          <button className={config.activeView === "objects" ? "active" : ""} onClick={() => update({ activeView: "objects" })}>{t("viewObjects")}</button>
        </nav>
        <SkillPanel t={t} language={config.language} model={model} availableSkills={availableSkills} selectedSkills={selectedSkills} onChange={(next) => update({ selectedSkills: [...next] })} />
      </aside>

      <main className="app">
        <header className="toolbar">
          <div>
            <p className="eyebrow">{t("dataSource")}</p>
            <h2>{activeViewTitle(config.activeView, t)}</h2>
          </div>
          <div className="stats">
            <LanguageSwitcher language={config.language} onChange={(language) => update({ language })} />
            <button className="settings-button" onClick={() => setSettingsOpen(true)}>{t("settings")}</button>
            <div><strong>{model.housingItems.length}</strong><span>{t("housingCount")}</span></div>
            <div><strong>{availableHousingCount}</strong><span>{t("availableObjectsCount")}</span></div>
          </div>
        </header>

        {config.activeView === "house" ? (
          <HousePage
            model={model}
            t={t}
            language={config.language}
            config={config}
            update={update}
            selectedSkills={selectedSkills}
            disabledItems={disabledItems}
            ownedItems={ownedItems}
            onOpenOwned={() => setOwnedOpen(true)}
            onOpenAllowed={() => setAllowedOpen(true)}
            onImportJson={importExportJson}
          />
        ) : config.activeView === "room" ? (
          <RoomPage
            model={model}
            t={t}
            language={config.language}
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
          <ObjectsPage model={model} t={t} language={config.language} config={config} update={update} selectedSkills={selectedSkills} />
        )}
      </main>

      {ownedOpen && <OwnedItemsModal t={t} language={config.language} model={model} ownedItems={ownedItems} selectedSkills={selectedSkills} onChange={setOwnedItems} onClose={() => setOwnedOpen(false)} />}
      {allowedOpen && <AllowedItemsModal t={t} language={config.language} model={model} disabledItems={disabledItems} onChange={(next) => update({ disabledItems: [...next] })} onClose={() => setAllowedOpen(false)} />}
      {settingsOpen && <SettingsModal t={t} config={config} update={update} onClose={() => setSettingsOpen(false)} />}
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

function LanguageSwitcher({ language, onChange }: { language: AppConfig["language"]; onChange: (language: AppConfig["language"]) => void }) {
  return (
    <div className="language-switcher" role="group" aria-label="Language">
      {LANGUAGES.map((entry) => (
        <button key={entry.code} className={language === entry.code ? "active" : ""} onClick={() => onChange(entry.code)}>
          {entry.label}
        </button>
      ))}
    </div>
  );
}

function activeViewTitle(activeView: ActiveView, t: Translator) {
  if (activeView === "house") return t("houseTitle");
  if (activeView === "room") return t("roomTitle");
  return t("objectsTitle");
}

function SkillPanel({
  t,
  language,
  model,
  availableSkills,
  selectedSkills,
  onChange,
}: {
  t: Translator;
  language: Language;
  model: EcoModel;
  availableSkills: typeof model.skills;
  selectedSkills: Set<SkillClass>;
  onChange: (next: Set<SkillClass>) => void;
}) {
  const groups = useMemo(() => {
    const byGroup = new Map<string, typeof model.skills>();
    for (const skill of availableSkills) {
      const group = skill.professionGroup ?? t("otherGroup");
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push(skill);
    }
    return [...byGroup.entries()].sort(([a], [b]) => professionOrder(a) - professionOrder(b));
  }, [availableSkills, model.skills, t]);

  function toggle(skillClass: SkillClass) {
    const next = new Set(selectedSkills);
    if (next.has(skillClass)) next.delete(skillClass);
    else next.add(skillClass);
    onChange(next);
  }

  return (
    <section className="skills">
      <div className="panel-head">
        <h3>{t("skills")}</h3>
        <div className="button-row">
          <button onClick={() => onChange(new Set(availableSkills.map((skill) => skill.className)))}>{t("all")}</button>
          <button onClick={() => onChange(new Set())}>{t("reset")}</button>
        </div>
      </div>
      <div className="skill-list">
        {groups.length ? groups.map(([group, skills]) => (
          <details key={group} open>
            <summary>{group}<span>{skills.filter((skill) => selectedSkills.has(skill.className)).length}/{skills.length}</span></summary>
            {skills.map((skill) => (
              <label className="check-row" key={skill.className}>
                <input type="checkbox" checked={selectedSkills.has(skill.className)} onChange={() => toggle(skill.className)} />
                <SkillName language={language} skill={skill} />
              </label>
            ))}
          </details>
        )) : <div className="empty">{t("noSkillAvailable")}</div>}
      </div>
    </section>
  );
}

function HousePage(props: {
  model: EcoModel;
  t: Translator;
  language: Language;
  config: AppConfig;
  update: (partial: Partial<AppConfig>) => void;
  selectedSkills: Set<SkillClass>;
  disabledItems: Set<ItemClass>;
  ownedItems: Map<ItemClass, number>;
  onOpenOwned: () => void;
  onOpenAllowed: () => void;
  onImportJson: (file: File) => void;
}) {
  const { model, t, language, config, update, selectedSkills, disabledItems, ownedItems } = props;
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const tiers = model.roomTiers;
  const fuelTags = availableFuelTags(model);
  const optimizationState = useHouseOptimizationWorker({ model, config, selectedSkills, disabledItems, ownedItems });
  const result = optimizationState.status === "ready" ? optimizationState.optimization : null;

  return (
    <section className="house-page">
      <div className="page-actions">
        <span />
        <button disabled={!result} onClick={() => result && exportHouseJson(model, config, selectedSkills, ownedItems, disabledItems, result)}>{t("export")}</button>
        <button onClick={() => importInputRef.current?.click()}>{t("import")}</button>
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
        <button onClick={props.onOpenOwned}>{t("ownedObjects")} ({[...ownedItems.values()].reduce((a, b) => a + b, 0)})</button>
        <button onClick={props.onOpenAllowed}>{t("permissions")}</button>
      </div>

      <section className="house-dashboard">
        <section className="setup-panel house-setup">
          <div className="segmented compact tier-buttons">
            <span>{t("constructionTier")}</span>
            <div>{tiers.map((tier) => <button key={tier.tier} className={config.houseConstructionTier === tier.tier ? "active" : ""} onClick={() => update({ houseConstructionTier: tier.tier })}>T{tier.tier}</button>)}</div>
          </div>
          <div className="field-grid">
            <NumberField label={t("houseMaterialBudget")} value={config.houseMaterialBudget} min={0} max={10000} onChange={(houseMaterialBudget) => update({ houseMaterialBudget })} />
            <NumberField label={t("height")} value={config.houseHeight} min={2} max={8} onChange={(houseHeight) => update({ houseHeight })} />
            <label>{t("maxCopiesPerRoomType")}
              <select value={String(config.houseMaxCopiesPerRoomType)} onChange={(event) => update({ houseMaxCopiesPerRoomType: parseHouseMaxCopies(event.target.value) })}>
                <option value="auto">{t("autoCopies")}</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4+</option>
              </select>
            </label>
          </div>
          <label className="inline-check">
            <input type="checkbox" checked={config.houseSameHeight} onChange={(event) => update({ houseSameHeight: event.target.checked })} />
            {t("sameHeightForAllRooms")}
          </label>
          <section className="room-option-range">
            <span>
              <strong>{t("minXpEfficiency")} ({config.minXpEfficiencyPercent}%)</strong>
              <small>{t("minXpEfficiencyHelp")}</small>
            </span>
            <span className="range-control">
              <input type="range" min={0} max={100} step={5} value={config.minXpEfficiencyPercent} onChange={(event) => update({ minXpEfficiencyPercent: clampPercent(Number(event.target.value)) })} />
              <input type="number" min={0} max={100} value={config.minXpEfficiencyPercent} onChange={(event) => update({ minXpEfficiencyPercent: clampPercent(Number.parseInt(event.target.value, 10) || 0) })} />
            </span>
          </section>
          <section className="operational-options">
            <strong>{t("operationalOptions")}</strong>
            <div className="toggle-grid">
              <label><input type="checkbox" checked={config.allowElectricPower} onChange={(event) => update({ allowElectricPower: event.target.checked })} />{t("allowElectricPower")}</label>
              <label><input type="checkbox" checked={config.allowMechanicalPower} onChange={(event) => update({ allowMechanicalPower: event.target.checked })} />{t("allowMechanicalPower")}</label>
              <label><input type="checkbox" checked={config.allowFuel} onChange={(event) => update({ allowFuel: event.target.checked })} />{t("allowFuel")}</label>
              <label><input type="checkbox" checked={config.allowWater} onChange={(event) => update({ allowWater: event.target.checked })} />{t("allowWater")}</label>
              <label><input type="checkbox" checked={config.allowChimney} onChange={(event) => update({ allowChimney: event.target.checked })} />{t("allowChimney")}</label>
            </div>
            {fuelTags.length > 0 && config.allowFuel && (
              <div className="fuel-tag-options">
                <span>{t("fuelTags")}</span>
                <div>{fuelTags.map((tag) => (
                  <label key={tag}>
                    <input type="checkbox" checked={!config.disabledFuelTags.includes(tag)} onChange={(event) => update({ disabledFuelTags: toggleListValue(config.disabledFuelTags, tag, !event.target.checked) })} />
                    {tag}
                  </label>
                ))}</div>
              </div>
            )}
          </section>
        </section>
        <HouseSummary t={t} status={optimizationState.status} result={result} />
      </section>

      {optimizationState.status === "loading" && <OptimizationSpinner t={t} />}
      {optimizationState.status === "error" && <OptimizationError t={t} message={optimizationState.error} />}
      {result && result.rooms.length ? (
        <section className="house-results">
          <section className="house-section">
            <h3>{t("recommendedRooms")}</h3>
            <div className="house-room-grid">
              {result.rooms.map((room) => <HouseRoomCard key={room.roomType} t={t} language={language} model={model} room={room} selectedSkills={selectedSkills} />)}
            </div>
          </section>
          <section className="house-side-grid">
            <section className="house-section">
              <h3>{t("visualPlan")}</h3>
              <HousePlan language={language} model={model} result={result} />
            </section>
            <section className="house-section">
              <h3>{t("craftList")}</h3>
              <div className="craft-list">
                {result.craftList.filter((entry) => entry.craftQuantity > 0).slice(0, 80).map((entry) => (
                  <div key={entry.item.itemClass} className="craft-row">
                    <ItemName language={language} item={entry.item} />
                    <strong>x{entry.craftQuantity}</strong>
                    {entry.ownedUsed > 0 && <small>{t("owned")} x{entry.ownedUsed}</small>}
                  </div>
                ))}
              </div>
            </section>
          </section>
        </section>
      ) : optimizationState.status === "ready" ? <div className="empty">{t("noHousePlan")}</div> : null}
    </section>
  );
}

function HouseSummary({ t, status, result }: { t: Translator; status: "loading" | "ready" | "error"; result: HouseOptimizationResult | null }) {
  return (
    <section className="house-summary">
      <div className="summary-tile main"><span>{t("totalHouseScore")}</span><strong>{result ? result.score.toFixed(1) : status === "loading" ? "..." : "-"}</strong></div>
      <div className="summary-tile"><span>{t("materialsUsed")}</span><strong>{result ? `${result.materials.used}/${result.materials.budget}` : "-"}</strong></div>
      <div className="summary-tile"><span>{t("materialsRemaining")}</span><strong>{result ? result.materials.remaining : "-"}</strong></div>
      <div className="summary-tile"><span>{t("sharedWallSavings")}</span><strong>{result ? result.materials.sharedSavings : "-"}</strong></div>
    </section>
  );
}

function HouseRoomCard({ t, language, model, room, selectedSkills }: { t: Translator; language: Language; model: EcoModel; room: HouseOptimizationResult["rooms"][number]; selectedSkills: Set<SkillClass> }) {
  const size = room.optimization.resolvedSize;
  const summaries = summarizeEntries(room.optimization.entries).slice(0, 6);
  return (
    <article className="house-room-card">
      <header>
        <CategoryBadge t={t} language={language} model={model} category={room.roomType} />
        <strong>x{room.quantity}</strong>
      </header>
      <div className="house-room-metrics">
        <span>{t("firstRoomScore")} <strong>{room.optimization.score.capped.toFixed(1)}</strong></span>
        <span>{t("totalRoomGroupScore")} <strong>{room.totalScore.toFixed(1)}</strong></span>
        {size && <span>{t("roomSize")} <strong>{size.width}x{size.depth}x{size.height}</strong></span>}
        {room.cappedByRatio && <span>{t("ratioCapped")} <strong>{room.ratioCap?.toFixed(1)}</strong></span>}
      </div>
      <div className="house-room-items">
        {summaries.map((summary) => <HouseRoomItem key={summary.item.itemClass} t={t} language={language} model={model} summary={summary} selectedSkills={selectedSkills} />)}
      </div>
    </article>
  );
}

function HouseRoomItem({ t, language, model, summary, selectedSkills }: { t: Translator; language: Language; model: EcoModel; summary: ReturnType<typeof summarizeEntries>[number]; selectedSkills: Set<SkillClass> }) {
  const [alternativesOpen, setAlternativesOpen] = useState(false);
  const item = summary.item;
  const variants = variantAlternatives(model, item);
  const equivalentChoices = equivalentChoiceGroups(model, item, selectedSkills);
  const hasAlternatives = variants.length > 0 || equivalentChoices.length > 0;
  return (
    <>
      <span className="house-room-item">
        <span className="house-room-item-main">
          <ItemIcon item={item} />
          <span>{displayItemName(item, language)}</span>
          <strong>x{summary.quantityPerRoom}</strong>
        </span>
        {hasAlternatives && (
          <button className="house-alt-button" type="button" onClick={() => setAlternativesOpen(true)}>
            {t("alternatives")}
          </button>
        )}
      </span>
      {alternativesOpen && (
        <HouseAlternativesModal
          t={t}
          language={language}
          item={item}
          variants={variants}
          equivalentChoices={equivalentChoices}
          onClose={() => setAlternativesOpen(false)}
        />
      )}
    </>
  );
}

function HouseAlternativesModal({
  t,
  language,
  item,
  variants,
  equivalentChoices,
  onClose,
}: {
  t: Translator;
  language: Language;
  item: HousingItem;
  variants: HousingItem[];
  equivalentChoices: ReturnType<typeof equivalentChoiceGroups>;
  onClose: () => void;
}) {
  return (
    <Modal title={`${displayItemName(item, language)} - ${t("alternatives")}`} onClose={onClose}>
      <div className="house-alternatives-modal">
        {equivalentChoices.length > 0 && (
          <section>
            <h3>{t("equivalentOptions")}</h3>
            <div className="house-alternative-list">
              {equivalentChoices.map((choice) => (
                <div className="house-alternative-row" key={choice.item.itemClass}>
                  <ItemName language={language} item={choice.item} />
                  {choice.skillNames.length > 0 && <small>{choice.skillNames.join(", ")}</small>}
                  {choice.variants.length > 1 && <VariantDetails t={t} language={language} variants={choice.variants.filter((variant) => variant.itemClass !== choice.item.itemClass)} />}
                </div>
              ))}
            </div>
          </section>
        )}
        {equivalentChoices.length === 0 && variants.length > 0 && (
          <section>
            <h3>{t("variants")}</h3>
            <div className="house-alternative-list">
              {variants.map((variant) => (
                <div className="house-alternative-row" key={variant.itemClass}>
                  <ItemName language={language} item={variant} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}

function HousePlan({ language, model, result }: { language: Language; model: EcoModel; result: HouseOptimizationResult }) {
  const indoor = result.layout.filter((room) => room.roomType !== "Outdoor");
  const maxX = Math.max(1, ...indoor.map((room) => room.x + room.width));
  const maxY = Math.max(1, ...indoor.map((room) => room.y + room.depth));
  return (
    <div className="house-plan" style={{ "--plan-width": maxX, "--plan-depth": maxY } as CSSProperties}>
      {indoor.map((room) => (
        <div
          key={room.id}
          className="house-plan-room"
          style={{ "--x": room.x, "--y": room.y, "--w": room.width, "--d": room.depth, "--room-color": categoryColor(model, room.roomType) } as CSSProperties}
        >
          <strong>{displayCategoryName(model, room.roomType, language)}</strong>
          <small>{room.width}x{room.depth}</small>
        </div>
      ))}
    </div>
  );
}

function parseHouseMaxCopies(value: string): HouseMaxCopiesPerRoomType {
  if (value === "auto") return "auto";
  const numeric = Number(value);
  return numeric === 1 || numeric === 2 || numeric === 3 || numeric === 4 ? numeric : "auto";
}

function exportHouseJson(model: EcoModel, config: AppConfig, selectedSkills: Set<SkillClass>, ownedItems: Map<ItemClass, number>, disabledItems: Set<ItemClass>, result: HouseOptimizationResult) {
  const report = {
    format: { name: "eco-housing-house", schemaVersion: EXPORT_SCHEMA_VERSION },
    app: { name: "Eco Housing", version: APP_VERSION, url: window.location.href, exportedAt: new Date().toISOString() },
    houseInput: {
      constructionTier: config.houseConstructionTier,
      materialBudget: config.houseMaterialBudget,
      height: config.houseHeight,
      sameHeightForAllRooms: config.houseSameHeight,
      maxCopiesPerRoomType: config.houseMaxCopiesPerRoomType,
      minXpEfficiencyPercent: config.minXpEfficiencyPercent,
    },
    selectedSkills: [...selectedSkills].sort().map((skillClass) => ({ className: skillClass })),
    ownedItems: [...ownedItems.entries()].filter(([, quantity]) => quantity > 0).map(([itemClass, quantity]) => ({ itemClass, quantity })),
    disabledItems: [...disabledItems].sort(),
    result: {
      score: result.score,
      materials: result.materials,
      rooms: result.rooms.map((room) => ({
        roomType: room.roomType,
        quantity: room.quantity,
        score: room.totalScore,
        size: room.optimization.resolvedSize,
        items: room.optimization.entries.map((entry) => entry.item.itemClass),
      })),
    },
    data: { housingItems: model.housingItems.length },
  };
  downloadJson(`eco-housing-house-${new Date().toISOString().slice(0, 10)}.json`, report);
}

function RoomPage(props: {
  model: EcoModel;
  t: Translator;
  language: Language;
  config: AppConfig;
  update: (partial: Partial<AppConfig>) => void;
  selectedSkills: Set<SkillClass>;
  disabledItems: Set<ItemClass>;
  ownedItems: Map<ItemClass, number>;
  onOpenOwned: () => void;
  onOpenAllowed: () => void;
  onImportJson: (file: File) => void;
}) {
  const { model, t, language, config, update, selectedSkills, disabledItems, ownedItems } = props;
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const playableRooms = model.roomCategories.filter((room) => room.canBeRoomCategory && !room.negatesValue && room.name !== "Cultural");
  const tiers = model.roomTiers;
  const optimizationState = useRoomOptimizationWorker({ model, config, selectedSkills, disabledItems, ownedItems });
  const optimization = optimizationState.optimization;
  const usesMaterialTier = roomUsesMaterialTier(model, config.roomType);
  const usesRoomSize = config.roomType !== "Outdoor";
  const resolvedSize = optimization?.resolvedSize ?? null;
  const resultWidth = resolvedSize?.width ?? config.width;
  const resultDepth = resolvedSize?.depth ?? config.depth;
  const resultHeight = resolvedSize?.height ?? config.height;
  const roomVolume = resolvedSize?.volume ?? config.width * config.depth * config.height;
  const fuelTags = availableFuelTags(model);

  return (
    <section className="room-page">
      <div className="page-actions">
        <span className="compatible-categories">
          {optimization ? (
            <>
              <span>{t("compatibleCategories")}</span>
              {optimization.groups.map((group) => <CategoryBadge key={group.category} t={t} language={language} model={model} category={group.category} />)}
            </>
          ) : t("calculating")}
        </span>
        <button disabled={!optimization} onClick={() => optimization && exportIssueJson(model, config, selectedSkills, ownedItems, disabledItems, optimization)}>{t("export")}</button>
        <button onClick={() => importInputRef.current?.click()}>{t("import")}</button>
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
        <button onClick={props.onOpenOwned}>{t("ownedObjects")} ({[...ownedItems.values()].reduce((a, b) => a + b, 0)})</button>
        <button onClick={props.onOpenAllowed}>{t("permissions")}</button>
      </div>

      <section className="room-top-panel">
        <section className="setup-panel">
          <div className="segmented compact">
            <span>{t("roomType")}</span>
            <div>{playableRooms.map((room) => <button key={room.name} className={config.roomType === room.name ? "active" : ""} onClick={() => update({ roomType: room.name })}>{displayCategoryName(model, room.name, language)}</button>)}</div>
          </div>
          {usesMaterialTier && (
            <div className="segmented compact tier-buttons">
              <span>{t("roomTier")}</span>
              <div>{tiers.map((tier) => <button key={tier.tier} className={config.roomTier === tier.tier ? "active" : ""} onClick={() => update({ roomTier: tier.tier })}>T{tier.tier}</button>)}</div>
            </div>
          )}
          {usesRoomSize && (
            <details className="advanced-room-options">
              <summary>{t("roomSizeOptions")}</summary>
              <div className="size-mode-grid">
                <label className="radio-card">
                  <input type="radio" checked={config.roomSizeMode === "auto"} onChange={() => update({ roomSizeMode: "auto" })} />
                  <span><strong>{t("autoRoomSize")}</strong><small>{t("autoRoomSizeHelp")}</small></span>
                </label>
                <label className="radio-card">
                  <input type="radio" checked={config.roomSizeMode === "materials"} onChange={() => update({ roomSizeMode: "materials" })} />
                  <span><strong>{t("materialBudgetMode")}</strong><small>{t("materialBudgetModeHelp")}</small></span>
                </label>
                <label className="radio-card">
                  <input type="radio" checked={config.roomSizeMode === "manual"} onChange={() => update({ roomSizeMode: "manual" })} />
                  <span><strong>{t("manualRoomSize")}</strong><small>{t("manualRoomSizeHelp")}</small></span>
                </label>
              </div>
              {config.roomSizeMode === "materials" && (
                <div className="field-grid one">
                  <NumberField label={t("materialBudget")} value={config.materialBudget} min={1} max={2000} onChange={(materialBudget) => update({ materialBudget })} />
                </div>
              )}
              {config.roomSizeMode === "manual" && (
                <div className="field-grid">
                  <NumberField label={t("width")} value={config.width} min={1} max={20} onChange={(width) => update({ width })} />
                  <NumberField label={t("depth")} value={config.depth} min={1} max={20} onChange={(depth) => update({ depth })} />
                  <NumberField label={t("height")} value={config.height} min={2} max={8} onChange={(height) => update({ height })} />
                </div>
              )}
            </details>
          )}
          <section className="room-option-range">
            <span>
              <strong>{t("minXpEfficiency")} ({config.minXpEfficiencyPercent}%)</strong>
              <small>{t("minXpEfficiencyHelp")}</small>
            </span>
            <span className="range-control">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={config.minXpEfficiencyPercent}
                onChange={(event) => update({ minXpEfficiencyPercent: clampPercent(Number(event.target.value)) })}
              />
              <input
                type="number"
                min={0}
                max={100}
                value={config.minXpEfficiencyPercent}
                onChange={(event) => update({ minXpEfficiencyPercent: clampPercent(Number.parseInt(event.target.value, 10) || 0) })}
              />
            </span>
          </section>
          <section className="operational-options">
            <strong>{t("operationalOptions")}</strong>
            <div className="toggle-grid">
              <label><input type="checkbox" checked={config.allowElectricPower} onChange={(event) => update({ allowElectricPower: event.target.checked })} />{t("allowElectricPower")}</label>
              <label><input type="checkbox" checked={config.allowMechanicalPower} onChange={(event) => update({ allowMechanicalPower: event.target.checked })} />{t("allowMechanicalPower")}</label>
              <label><input type="checkbox" checked={config.allowFuel} onChange={(event) => update({ allowFuel: event.target.checked })} />{t("allowFuel")}</label>
              <label><input type="checkbox" checked={config.allowWater} onChange={(event) => update({ allowWater: event.target.checked })} />{t("allowWater")}</label>
              <label><input type="checkbox" checked={config.allowChimney} onChange={(event) => update({ allowChimney: event.target.checked })} />{t("allowChimney")}</label>
            </div>
            {fuelTags.length > 0 && config.allowFuel && (
              <div className="fuel-tag-options">
                <span>{t("fuelTags")}</span>
                <div>
                  {fuelTags.map((tag) => (
                    <label key={tag}>
                      <input
                        type="checkbox"
                        checked={!config.disabledFuelTags.includes(tag)}
                        onChange={(event) => update({ disabledFuelTags: toggleListValue(config.disabledFuelTags, tag, !event.target.checked) })}
                      />
                      {tag}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </section>
        </section>
        <RoomSummaryPanel
          t={t}
          status={optimizationState.status}
          optimization={optimizationState.status === "ready" ? optimizationState.optimization : null}
          width={resultWidth}
          depth={resultDepth}
          height={resultHeight}
          usesRoomSize={usesRoomSize}
        />
      </section>

      {optimizationState.status === "loading" && <OptimizationSpinner t={t} />}
      {optimizationState.status === "error" && <OptimizationError t={t} message={optimizationState.error} />}
      {optimizationState.status === "ready" && (
        <RoomOptimizationResults t={t} language={language} model={model} optimization={optimizationState.optimization} width={resultWidth} depth={resultDepth} height={resultHeight} roomVolume={roomVolume} usesRoomSize={usesRoomSize} devMode={config.devMode} selectedSkills={selectedSkills} />
      )}
    </section>
  );
}

function RoomSummaryPanel({
  t,
  status,
  optimization,
  width,
  depth,
  height,
  usesRoomSize,
}: {
  t: Translator;
  status: "idle" | "loading" | "ready" | "error";
  optimization: RoomOptimization | null;
  width: number;
  depth: number;
  height: number;
  usesRoomSize: boolean;
}) {
  return (
    <section className="room-summary-panel">
      <div className="summary-tile main">
        <span>{t("usefulRoomTotal")}</span>
        <strong>{optimization ? optimization.score.capped.toFixed(1) : status === "loading" ? "..." : "-"}</strong>
      </div>
      <div className="summary-tile">
        <span>{usesRoomSize ? t("roomSize") : t("outdoorNoSize")}</span>
        <strong>{usesRoomSize ? `${width}x${depth}x${height}` : "-"}</strong>
      </div>
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
      sizeMode: config.roomSizeMode,
      materialBudget: config.materialBudget,
      width: config.width,
      depth: config.depth,
      height: config.height,
      volume: config.width * config.depth * config.height,
      minXpEfficiencyPercent: config.minXpEfficiencyPercent,
      allowedOperationalRequirements: {
        electricPower: config.allowElectricPower,
        mechanicalPower: config.allowMechanicalPower,
        fuel: config.allowFuel,
        water: config.allowWater,
        chimney: config.allowChimney,
        disabledFuelTags: config.disabledFuelTags,
      },
      resolvedSize: optimization.resolvedSize,
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
        operationalRequirements: entry.item.requirements?.operationalRequirements ?? null,
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

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadJson(`eco-housing-issue-${timestamp}.json`, report);
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseImportedIssueJson(data: unknown, model: EcoModel, t: Translator): { config: Partial<AppConfig>; ownedItems: Map<ItemClass, number> } {
  if (!isRecord(data)) throw new Error(t("invalidImportObject"));

  const format = isRecord(data.format) ? data.format : null;
  const schemaVersion = Number(format?.schemaVersion ?? 0);
  if (!SUPPORTED_EXPORT_SCHEMA_VERSIONS.has(schemaVersion)) {
    throw new Error(`${t("unsupportedSchema")} ${schemaVersion || "missing"}. ${t("supportedVersion")} ${EXPORT_SCHEMA_VERSION}.`);
  }

  const roomNames = new Set(model.roomCategories.map((room) => room.name));
  const skillClasses = new Set(model.skills.map((skill) => skill.className));
  const itemClasses = new Set(model.housingItems.map((item) => item.itemClass));
  const selectedSkills = readClassArray(data.selectedSkills, "selectedSkills", t).filter((skillClass) => skillClasses.has(skillClass));
  const disabledItems = readClassArray(data.disabledItems, "disabledItems", t).filter((itemClass) => itemClasses.has(itemClass));
  const ownedItems = new Map<ItemClass, number>();
  for (const entry of readObjectArray(data.ownedItems, "ownedItems", t)) {
    const itemClass = readString(entry.itemClass, "ownedItems.itemClass", t);
    const quantity = Math.max(0, Math.floor(readNumber(entry.quantity, "ownedItems.quantity", t)));
    if (quantity > 0 && itemClasses.has(itemClass)) ownedItems.set(itemClass, quantity);
  }

  const houseInput = isRecord(data.houseInput) ? data.houseInput : null;
  if (houseInput) {
    return {
      config: {
        activeView: "house",
        houseConstructionTier: readNumber(houseInput.constructionTier, "houseInput.constructionTier", t),
        houseMaterialBudget: readNumber(houseInput.materialBudget, "houseInput.materialBudget", t),
        houseHeight: readNumber(houseInput.height, "houseInput.height", t),
        houseSameHeight: Boolean(houseInput.sameHeightForAllRooms ?? DEFAULT_CONFIG.houseSameHeight),
        houseMaxCopiesPerRoomType: parseHouseMaxCopies(String(houseInput.maxCopiesPerRoomType ?? DEFAULT_CONFIG.houseMaxCopiesPerRoomType)),
        minXpEfficiencyPercent: clampPercent(Number(houseInput.minXpEfficiencyPercent ?? DEFAULT_CONFIG.minXpEfficiencyPercent)),
        selectedSkills,
        disabledItems,
      },
      ownedItems,
    };
  }

  const roomInput = isRecord(data.roomInput) ? data.roomInput : null;
  if (!roomInput) throw new Error(t("missingRoomInput"));
  const roomType = readString(roomInput.roomType, "roomInput.roomType", t);
  if (!roomNames.has(roomType)) throw new Error(`${t("unknownRoomType")} "${roomType}".`);

  return {
    config: {
      activeView: "room",
      roomType,
      roomTier: readNumber(roomInput.tier, "roomInput.tier", t),
      width: readNumber(roomInput.width, "roomInput.width", t),
      depth: readNumber(roomInput.depth, "roomInput.depth", t),
      height: readNumber(roomInput.height, "roomInput.height", t),
      roomSizeMode: readRoomSizeMode(roomInput.sizeMode),
      materialBudget: Number(roomInput.materialBudget ?? DEFAULT_CONFIG.materialBudget),
      minXpEfficiencyPercent: clampPercent(Number(roomInput.minXpEfficiencyPercent ?? DEFAULT_CONFIG.minXpEfficiencyPercent)),
      ...readOperationalConfig(roomInput),
      selectedSkills,
      disabledItems,
    },
    ownedItems,
  };
}

function readOperationalConfig(roomInput: Record<string, unknown>): Partial<AppConfig> {
  const operational = isRecord(roomInput.allowedOperationalRequirements) ? roomInput.allowedOperationalRequirements : {};
  return {
    allowElectricPower: operational.electricPower == null ? DEFAULT_CONFIG.allowElectricPower : Boolean(operational.electricPower),
    allowMechanicalPower: operational.mechanicalPower == null ? DEFAULT_CONFIG.allowMechanicalPower : Boolean(operational.mechanicalPower),
    allowFuel: operational.fuel == null ? DEFAULT_CONFIG.allowFuel : Boolean(operational.fuel),
    allowWater: operational.water == null ? DEFAULT_CONFIG.allowWater : Boolean(operational.water),
    allowChimney: operational.chimney == null ? DEFAULT_CONFIG.allowChimney : Boolean(operational.chimney),
    disabledFuelTags: Array.isArray(operational.disabledFuelTags) ? operational.disabledFuelTags.filter((value): value is string => typeof value === "string") : DEFAULT_CONFIG.disabledFuelTags,
  };
}

function readRoomSizeMode(value: unknown): AppConfig["roomSizeMode"] {
  return value === "auto" || value === "manual" || value === "materials" ? value : DEFAULT_CONFIG.roomSizeMode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, field: string, t: Translator) {
  if (typeof value !== "string" || !value) throw new Error(`${t("missingField")} ${field}.`);
  return value;
}

function readNumber(value: unknown, field: string, t: Translator) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${t("invalidField")} ${field}.`);
  return number;
}

function readObjectArray(value: unknown, field: string, t: Translator) {
  if (!Array.isArray(value)) throw new Error(`${t("missingField")} ${field}.`);
  return value.filter(isRecord);
}

function readClassArray(value: unknown, field: string, t: Translator) {
  if (!Array.isArray(value)) throw new Error(`${t("missingField")} ${field}.`);
  return value.map((entry) => typeof entry === "string" ? entry : isRecord(entry) ? readString(entry.className ?? entry.itemClass, `${field}.className`, t) : "").filter(Boolean);
}

function availableFuelTags(model: EcoModel) {
  return [...new Set(model.housingItems.flatMap((item) => item.requirements?.operationalRequirements?.fuel?.tags ?? []))].sort();
}

function summarizeOperationalNeeds(entries: RoomOptimization["entries"], model: EcoModel) {
  let electricWatts = 0;
  let mechanicalWatts = 0;
  let heatWatts = 0;
  let water = false;
  let chimney = false;
  const fuelTags = new Set<string>();

  for (const entry of entries) {
    const requirements = entry.item.requirements?.operationalRequirements;
    const consumption = requirements?.powerConsumption;
    if (consumption?.type === "ElectricPower") electricWatts += consumption.watts ?? 0;
    if (consumption?.type === "MechanicalPower") mechanicalWatts += consumption.watts ?? 0;
    if (consumption?.type === "HeatPower") heatWatts += consumption.watts ?? 0;
    if (requirements?.water) water = true;
    if (requirements?.chimney) chimney = true;
    for (const tag of requirements?.fuel?.tags ?? []) fuelTags.add(tag);
  }

  const mechanicalGenerators = model.housingItems
    .filter((item) => item.requirements?.operationalRequirements?.generator?.type === "MechanicalPower")
    .map((item) => ({ name: item.friendlyName, watts: item.requirements?.operationalRequirements?.generator?.watts ?? 0 }))
    .filter((generator) => generator.watts > 0)
    .sort((a, b) => b.watts - a.watts || a.name.localeCompare(b.name));

  return {
    electricWatts,
    mechanicalWatts,
    heatWatts,
    water,
    chimney,
    fuelTags: [...fuelTags].sort(),
    mechanicalGenerators,
    hasNeeds: electricWatts > 0 || mechanicalWatts > 0 || heatWatts > 0 || water || chimney,
  };
}

function formatWatts(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${Number.isInteger(value) ? value : value.toFixed(1).replace(/\.0$/, "")}w`;
}

function generatorHelpText(t: Translator, watts: number, generators: { name: string; watts: number }[]) {
  if (!generators.length) return t("generatorHelp");
  return `${t("generatorHelp")} ${generators.slice(0, 4).map((generator) => `${generator.name} x${Math.ceil(watts / generator.watts)} (${formatWatts(generator.watts)})`).join(", ")}`;
}

function toggleListValue(values: string[], value: string, disabled: boolean) {
  if (disabled) return values.includes(value) ? values : [...values, value].sort();
  return values.filter((entry) => entry !== value);
}

function RoomOptimizationResults({
  t,
  language,
  model,
  optimization,
  width,
  depth,
  height,
  roomVolume,
  usesRoomSize,
  devMode,
  selectedSkills,
}: {
  t: Translator;
  language: Language;
  model: EcoModel;
  optimization: RoomOptimization;
  width: number;
  depth: number;
  height: number;
  roomVolume: number;
  usesRoomSize: boolean;
  devMode: boolean;
  selectedSkills: Set<SkillClass>;
}) {
  const score = optimization.score;
  const surface = surfaceSummary(optimization.entries);
  const objectFloor = estimateObjectFloor(optimization.entries);
  const requiredVolume = optimization.entries.reduce((total, entry) => total + (entry.item.requirements?.requiredRoomVolume ?? 0), 0);
  const operational = summarizeOperationalNeeds(optimization.entries, model);

  return (
    <>
      {operational.hasNeeds && (
        <section className="operational-summary">
          <strong>{t("operationalNeeds")}</strong>
          <div>
            {operational.electricWatts > 0 && <span>{formatWatts(operational.electricWatts)} {t("electricNeed")}</span>}
            {operational.mechanicalWatts > 0 && <span>{formatWatts(operational.mechanicalWatts)} {t("mechanicalNeed")} <HelpButton help={generatorHelpText(t, operational.mechanicalWatts, operational.mechanicalGenerators)} /></span>}
            {operational.heatWatts > 0 && <span>{formatWatts(operational.heatWatts)} {t("fuelNeed")}{operational.fuelTags.length ? `: ${operational.fuelTags.join(", ")}` : ""}</span>}
            {operational.water && <span>{t("waterNeed")}</span>}
            {operational.chimney && <span>{t("chimneyNeed")}</span>}
          </div>
        </section>
      )}
      {devMode && (
        <section className="debug-room-panel">
          <div className="score-card debug-tier"><span>{score.tier ? t("activeTier") : t("materialTierNotUsed")}</span>{score.tier ? <><strong>T{score.tier.tier}</strong><small>{t("soft")} {score.tier.softCap} | {t("hard")} {score.tier.hardCap} | {t("return")} {Math.round(score.tier.diminishingReturnPercent * 100)}%</small></> : <><strong>-</strong><small>{t("outdoorNoMaterialCap")}</small></>}</div>
          <section className="fit-grid">
            {usesRoomSize ? <div className={objectFloor > width * depth ? "bad" : ""}><strong>{objectFloor}/{width * depth}</strong><span>{t("objectFloor")}</span></div> : <div><strong>{objectFloor}</strong><span>{t("objectFloor")}</span></div>}
            {usesRoomSize ? <div className={requiredVolume > roomVolume ? "bad" : ""}><strong>{requiredVolume}/{roomVolume}</strong><span>{t("requiredVolumeVsRoom")}</span></div> : <div><strong>{requiredVolume}</strong><span>{t("requiredVolume")}</span></div>}
            <div className={surface.used > surface.capacity ? "bad" : ""}><strong>{surface.used}/{surface.capacity}</strong><span>{t("placedSurfaceVsAvailable")}</span></div>
          </section>
          <div className="trace-grid">
            <Metric label={t("rawObjects")} value={score.raw} />
            <Metric label={t("afterDuplicates")} value={score.afterDiminishing} delta={-score.duplicateLoss} />
            <Metric label={t("afterSupportCaps")} value={score.afterSupportCaps} delta={-score.supportCapLoss} />
            <Metric label={t("afterTier")} value={score.capped} delta={-score.capLoss} />
          </div>
        </section>
      )}

      <section className="optimizer-grid">
        {optimization.groups.map((group) => (
          <article className="opt-group" key={group.category} style={{ "--category-color": categoryColor(model, group.category) } as CSSProperties}>
            <div className="opt-title">
              <div><CategoryBadge t={t} language={language} model={model} category={group.category} /><h3>{displayGroupRole(group.role, t)}</h3>{group.supportCap != null && <small>{t("cap")} {Math.round((group.supportCapPercent ?? 0) * 100)}%: {group.supportCap.toFixed(1)}</small>}</div>
              <strong>{group.score.toFixed(1)}</strong>
            </div>
            <div className="opt-items">
              {summarizeEntries(group.entries).length ? summarizeEntries(group.entries).map((summary) => <RoomItem key={summary.item.itemClass} t={t} language={language} model={model} summary={summary} devMode={devMode} selectedSkills={selectedSkills} />) : <div className="empty">{t("noItemWithFilters")}</div>}
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

function OptimizationSpinner({ t }: { t: Translator }) {
  return <section className="optimization-state" aria-label={t("calculationOptimization")}><span className="spinner" /></section>;
}

function OptimizationError({ t, message }: { t: Translator; message: string }) {
  return <section className="optimization-state error"><strong>{t("calculationError")}</strong><span>{message}</span></section>;
}

function RoomItem({ t, language, model, summary, devMode, selectedSkills }: { t: Translator; language: Language; model: EcoModel; summary: ReturnType<typeof summarizeEntries>[number]; devMode: boolean; selectedSkills: Set<SkillClass> }) {
  const item = summary.item;
  const [variantModal, setVariantModal] = useState<{ title: string; variants: HousingItem[] } | null>(null);
  const variants = variantAlternatives(model, item);
  const equivalentChoices = equivalentChoiceGroups(model, item, selectedSkills);
  const isEquivalentGroup = equivalentChoices.length > 0;
  return (
    <>
      <details className={isEquivalentGroup ? "opt-item equivalent-card" : "opt-item"}>
        <summary className="room-item-summary">
          <span className="room-item-title">
            {isEquivalentGroup ? (
              <span className="equivalent-title">
                <strong>{item.typeForRoomLimit ?? displayCategoryName(model, item.category, language)}</strong>
                <small>{t("equivalentChoiceCard")}</small>
              </span>
            ) : (
              <ItemName language={language} item={item} />
            )}
            {!isEquivalentGroup && variants.length > 1 && (
              <button className="inline-variant-button" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setVariantModal({ title: displayItemName(item, language), variants }); }}>
                {variants.length} {t("variants")}
              </button>
            )}
            <b>x{summary.quantityPerRoom}</b>
          </span>
        <span className={`room-item-metrics${devMode ? " has-give" : ""}`}>
          <MetricBadge label="XP" value={summary.score.toFixed(2)} />
          <MetricBadge label={t("floorShort")} value={String(summary.totalFloor)} />
          <MetricBadge label={t("m3Short")} value={String(summary.totalRequiredVolume)} />
          {devMode && <button className="copy-give-button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void copyText(giveCommand(item, summary.quantityPerRoom)); }}>{t("copyGive")}</button>}
        </span>
          {isEquivalentGroup && <EquivalentChoices t={t} language={language} choices={equivalentChoices} onOpenVariants={(title, choiceVariants) => setVariantModal({ title, variants: choiceVariants })} />}
        </summary>
        <div className="room-item-detail">
          <div className="detail-grid">
            <DetailMetric label={t("xpPerObject")} value={`+${formatCompactNumber(summary.score / summary.quantityPerRoom)}`} />
            <DetailMetric label={t("m3PerObject")} value={formatCompactNumber(summary.totalRequiredVolume / summary.quantityPerRoom)} />
            <DetailMetric label={t("floorFootprintPerObject")} value={formatFootprint(item)} />
          </div>
          <table className="item-breakdown-table">
            <thead><tr><th>{t("copyIndex")}</th><th>%</th><th>XP</th></tr></thead>
            <tbody>{summary.rows.map((row) => <tr key={row.index}><td>#{row.index}</td><td>{Math.round(row.multiplier * 100)}%</td><td>{formatCompactNumber(row.score)}</td></tr>)}</tbody>
          </table>
          {devMode && (
            <div className="dev-panel">
              <div className="pill-row compact">
                {summary.fromOwned > 0 && <span className="pill">{t("owned")} x{summary.fromOwned}</span>}
                {summary.rawScore - summary.score > 0.01 && <span className="pill warn">cap -{(summary.rawScore - summary.score).toFixed(2)}</span>}
                {summary.totalSurfaceProvided > 0 && <span className="pill">{t("surface")} +{summary.totalSurfaceProvided}</span>}
                {summary.totalSurfaceRequired > 0 && <span className="pill">{t("surface")} -{summary.totalSurfaceRequired}</span>}
                {summary.placedOnFloor && <span className="pill warn">{t("floorPlacement")}</span>}
                {item.requirements?.requiredRoomMaterialTier != null && <span className="pill">T{item.requirements.requiredRoomMaterialTier}</span>}
              </div>
            </div>
          )}
        </div>
      </details>
      {variantModal && <VariantModal t={t} language={language} title={variantModal.title} variants={variantModal.variants} onClose={() => setVariantModal(null)} />}
    </>
  );
}

function MetricBadge({ label, value }: { label: string; value: string }) {
  return <span className="metric-badge"><strong>{value}</strong><small>{label}</small></span>;
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return <span className="detail-metric"><small>{label}</small><strong>{value}</strong></span>;
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function giveCommand(item: HousingItem, quantity: number) {
  return `/give ${item.itemClass},${quantity}`;
}

async function copyText(value: string) {
  await navigator.clipboard?.writeText(value);
}

function ObjectsPage({ model, t, language, config, update, selectedSkills }: { model: EcoModel; t: Translator; language: Language; config: AppConfig; update: (partial: Partial<AppConfig>) => void; selectedSkills: Set<SkillClass> }) {
  const [openFilter, setOpenFilter] = useState<{ key: "category" | "craft"; left: number; top: number } | null>(null);
  const pageRef = useRef<HTMLElement | null>(null);
  const resolver = useMemo(() => createCraftResolver(model, selectedSkills), [model, selectedSkills]);
  const categories = [...new Set(model.housingItems.map((item) => item.category))].sort();
  const craftSkills = craftSkillOptions(model);
  const query = config.objectSearch.trim().toLowerCase();
  const items = model.housingItems
    .filter((item) => !item.variantOfItemClass)
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
    .filter((item) => !query || objectSearchText(model, item, language).includes(query))
    .sort((a, b) => sortObjects(a, b, config.objectSort));

  useEffect(() => {
    if (!openFilter) return;
    function closeOnOutsideClick(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && pageRef.current?.contains(target)) return;
      setOpenFilter(null);
    }
    window.addEventListener("pointerdown", closeOnOutsideClick);
    return () => window.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [openFilter]);

  function toggleColumnFilter(key: "category" | "craft", event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 280;
    const margin = 12;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    const top = Math.min(rect.bottom + 8, window.innerHeight - 120);
    setOpenFilter((current) => current?.key === key ? null : { key, left, top });
  }

  return (
    <section className="objects-page" ref={pageRef}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <span className="object-name-header">
                  <SortableColumn
                    label={t("object")}
                    active={config.objectSort === "name-asc" || config.objectSort === "name-desc"}
                    direction={config.objectSort === "name-desc" ? "desc" : "asc"}
                    onClick={() => update({ objectSort: config.objectSort === "name-asc" ? "name-desc" : "name-asc" })}
                  />
                  <input value={config.objectSearch} onChange={(event) => update({ objectSearch: event.target.value })} placeholder={t("search")} />
                </span>
              </th>
              <th>
                <FilterColumn
                  t={t}
                  label={t("category")}
                  help={t("categoryHelp")}
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
                      <CategoryBadge t={t} language={language} model={model} category={category} />
                    </label>
                  ))}
                </FilterColumn>
              </th>
              <th>
                <SortableColumn
                  label="XP"
                  help={t("xpHelp")}
                  active={config.objectSort === "xp-desc" || config.objectSort === "xp-asc"}
                  direction={config.objectSort === "xp-asc" ? "asc" : "desc"}
                  onClick={() => update({ objectSort: config.objectSort === "xp-desc" ? "xp-asc" : "xp-desc" })}
                />
              </th>
              <th><ColumnHelp label={t("duplicates")} help={t("duplicatesHelp")} /></th>
              <th>
                <SortableColumn
                  label={t("floorFootprint")}
                  help={t("floorFootprintHelp")}
                  active={config.objectSort === "floor-desc" || config.objectSort === "floor-asc"}
                  direction={config.objectSort === "floor-asc" ? "asc" : "desc"}
                  onClick={() => update({ objectSort: config.objectSort === "floor-desc" ? "floor-asc" : "floor-desc" })}
                />
              </th>
              <th>
                <SortableColumn
                  label={t("requiredVolume")}
                  help={t("requiredVolumeHelp")}
                  active={config.objectSort === "volume-desc" || config.objectSort === "volume-asc"}
                  direction={config.objectSort === "volume-asc" ? "asc" : "desc"}
                  onClick={() => update({ objectSort: config.objectSort === "volume-desc" ? "volume-asc" : "volume-desc" })}
                />
              </th>
              <th>
                <FilterColumn
                  t={t}
                  label={t("craftSkill")}
                  help={t("craftSkillHelp")}
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
                    <span>{t("noSpecificSkill")}</span>
                  </label>
                  {craftSkills.map((skill) => (
                    <label className="filter-option" key={skill.className}>
                      <input
                        type="checkbox"
                        checked={config.objectCraftSkills.includes(skill.className)}
                        onChange={() => update({ objectCraftSkills: toggleFilterValue(config.objectCraftSkills, skill.className) })}
                      />
                      <SkillName language={language} skill={skill} />
                    </label>
                  ))}
                </FilterColumn>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const variants = variantAlternatives(model, item);
              return (
                <tr key={item.itemClass}>
                  <td>
                    <ItemName language={language} item={item} subtitle={item.typeForRoomLimit ?? "-"} />
                    {variants.length > 0 && <VariantDetails t={t} language={language} variants={variants} />}
                  </td>
                  <td><CategoryBadge t={t} language={language} model={model} category={item.category} /></td>
                  <td>{item.value}</td>
                  <td>{Math.round((item.diminishingReturnPercent ?? 1) * 100)}%</td>
                  <td>{formatFootprint(item)}</td>
                  <td>{item.requirements?.requiredRoomVolume ?? "-"}</td>
                  <td><CraftSkillNames t={t} language={language} model={model} item={item} /></td>
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
  return effectiveFloorArea(item);
}

function objectSearchText(model: EcoModel, item: HousingItem, language: Language) {
  const variants = variantAlternatives(model, item);
  const equivalents = equivalentAlternatives(model, item);
  return [
    displayItemName(item, language),
    item.friendlyName,
    displayCategoryName(model, item.category, language),
    item.category,
    item.typeForRoomLimit,
    item.source,
    ...variants.flatMap((variant) => [displayItemName(variant, language), variant.friendlyName]),
    ...equivalents.flatMap((equivalent) => [displayItemName(equivalent, language), equivalent.friendlyName]),
  ].join(" ").toLowerCase();
}

function variantAlternatives(model: EcoModel, item: HousingItem) {
  return (model.variantItemsByBase.get(item.itemClass) ?? []).filter((variant) => variant.itemClass !== item.itemClass);
}

function equivalentAlternatives(model: EcoModel, item: HousingItem) {
  const group = model.equivalenceGroupByItemClass.get(item.itemClass);
  if (!group) return [];
  return group.itemClasses
    .map((itemClass) => model.housingItems.find((housingItem) => housingItem.itemClass === itemClass))
    .filter((equivalent): equivalent is HousingItem => Boolean(equivalent))
    .filter((equivalent) => equivalent.itemClass !== item.itemClass);
}

function equivalentChoiceGroups(model: EcoModel, item: HousingItem, selectedSkills: Set<SkillClass>) {
  const group = model.equivalenceGroupByItemClass.get(item.itemClass);
  if (!group) return [];
  return group.options
    .map((option) => {
      const optionItem = model.housingItems.find((housingItem) => housingItem.itemClass === option.itemClass);
      if (!optionItem) return null;
      const variants = (option.variantItemClasses ?? [option.itemClass])
        .map((itemClass) => model.housingItems.find((housingItem) => housingItem.itemClass === itemClass))
        .filter((variant): variant is HousingItem => Boolean(variant));
      const available = option.requiredSkillClasses?.length
        ? option.requiredSkillClasses.some((skillClass) => selectedSkills.has(skillClass))
        : optionItem.craftableWithoutSkill || optionItem.recipes.length === 0;
      return {
        item: optionItem,
        variants,
        available,
        skillNames: (option.requiredSkillClasses ?? [])
          .map((skillClass) => model.skillsByClass.get(skillClass)?.friendlyName ?? skillClass.replace(/Skill$/, ""))
          .sort(),
      };
    })
    .filter((choice): choice is NonNullable<typeof choice> => Boolean(choice))
    .filter((choice, _index, choices) => choices.some((candidate) => candidate.available) ? choice.available : true);
}

function VariantDetails({ t, language, variants }: { t: Translator; language: Language; variants: HousingItem[] }) {
  return (
    <details className="variant-details">
      <summary>{variants.length} {t("variants")}</summary>
      <div className="variant-list">
        {variants.map((variant) => (
          <ItemName key={variant.itemClass} language={language} item={variant} />
        ))}
      </div>
    </details>
  );
}

function VariantModal({ t, language, title, variants, onClose }: { t: Translator; language: Language; title: string; variants: HousingItem[]; onClose: () => void }) {
  return (
    <Modal title={`${title} - ${t("variants")}`} onClose={onClose}>
      <div className="variant-modal-list">
        {variants.map((variant) => (
          <ItemName key={variant.itemClass} language={language} item={variant} />
        ))}
      </div>
    </Modal>
  );
}

function EquivalentChoices({ t, language, choices, onOpenVariants }: { t: Translator; language: Language; choices: ReturnType<typeof equivalentChoiceGroups>; onOpenVariants: (title: string, variants: HousingItem[]) => void }) {
  return (
    <div className="equivalent-choices" aria-label={t("equivalents")}>
      <span>{t("equivalentOptions")}</span>
      <div>
        {choices.map((choice) => (
          <span className="equivalent-choice" key={choice.item.itemClass}>
            <span className="equivalent-choice-main">
              <ItemName language={language} item={choice.item} />
              {choice.skillNames.length > 0 && <small>{choice.skillNames.join(", ")}</small>}
            </span>
            {choice.variants.length > 1 && (
              <button
                className="inline-variant-button"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenVariants(displayItemName(choice.item, language), choice.variants);
                }}
              >
                {choice.variants.length} {t("variants")}
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function localizedName(entry: { localizedName?: Record<string, string>; friendlyName?: string; name?: string }, language: Language) {
  return entry.localizedName?.[language] ?? entry.friendlyName ?? entry.name ?? "";
}

function displayItemName(item: HousingItem, language: Language) {
  return localizedName(item, language) || item.friendlyName;
}

function displaySkillName(skill: Pick<Skill, "friendlyName" | "localizedName">, language: Language) {
  return localizedName(skill, language) || skill.friendlyName;
}

function displayCategoryName(model: EcoModel, category: string, language: Language) {
  const roomCategory = model.roomCategoryByName.get(category);
  return roomCategory?.localizedName?.[language] ?? category;
}

function displayGroupRole(role: string, t: Translator) {
  if (role === "definit la piece") return t("primaryRole");
  if (role === "support general") return t("generalSupportRole");
  if (role === "support") return t("supportRole");
  return role;
}

function CategoryBadge({ t, language, model, category }: { t: Translator; language: Language; model: EcoModel; category: string }) {
  const roomCategory = model.roomCategoryByName.get(category);
  const color = categoryColor(model, category);
  const source = roomCategory?.colorHex ? t("ecoColor") : roomCategory?.colorSource ? `${roomCategory.colorSource}, ${t("approximateColor")}` : t("appColor");
  const label = displayCategoryName(model, category, language);
  return (
    <span className="category-badge" style={{ "--category-color": color } as CSSProperties} title={`${label} - ${source}`}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}

function categoryColor(model: EcoModel, category: string) {
  return model.roomCategoryByName.get(category)?.colorHex ?? fallbackCategoryColor(category);
}

function fallbackCategoryColor(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hash}, 54%, 46%)`;
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

function CraftSkillNames({ t, language, model, item }: { t: Translator; language: Language; model: EcoModel; item: HousingItem }) {
  const requirements = craftSkillRequirements(model, item);
  if (!requirements.length) return <span>{t("all")}</span>;
  return (
    <span className="skill-list-inline">
      {requirements.map(({ skill, level }) => (
        <SkillName key={skill.className} language={language} skill={skill} suffix={level ? String(level) : undefined} />
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
  t,
  label,
  help,
  activeCount,
  open,
  popoverStyle,
  onToggle,
  onClear,
  children,
}: {
  t: Translator;
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
        <button type="button" className={activeCount ? "filter-button active" : "filter-button"} onClick={onToggle} aria-label={`${t("filterLabel")} ${label}`}>
          <FilterIcon />
          {activeCount > 0 && <span>{activeCount}</span>}
        </button>
      </span>
      {open && (
        <span className="filter-popover" style={popoverStyle}>
          <span className="filter-popover-head">
            <strong>{label}</strong>
            <button type="button" onClick={onClear}>{t("reset")}</button>
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

function OwnedItemsModal({ t, language, model, ownedItems, selectedSkills, onChange, onClose }: { t: Translator; language: Language; model: EcoModel; ownedItems: Map<ItemClass, number>; selectedSkills: Set<SkillClass>; onChange: (next: Map<ItemClass, number>) => void; onClose: () => void }) {
  const resolver = useMemo(() => createCraftResolver(model, selectedSkills), [model, selectedSkills]);
  const items = model.housingItems.filter((item) => resolver.resolve(item.itemClass).craftable).sort((a, b) => byName(a, b));
  return <ItemQuantityModal t={t} language={language} model={model} title={t("ownedItemsTitle")} items={items} ownedItems={ownedItems} onChange={onChange} onClose={onClose} />;
}

function ItemQuantityModal({ t, language, model, title, items, ownedItems, onChange, onClose }: { t: Translator; language: Language; model: EcoModel; title: string; items: HousingItem[]; ownedItems: Map<ItemClass, number>; onChange: (next: Map<ItemClass, number>) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const filtered = items.filter((item) => !query || [displayItemName(item, language), item.friendlyName].join(" ").toLowerCase().includes(query)).slice(0, 220);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="modal-tools"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("filterObjects")} /><button onClick={() => onChange(new Map())}>{t("clear")}</button></div>
      <div className="modal-list">
        {filtered.map((item) => <label className="quantity-row" key={item.itemClass}><ItemName language={language} item={item} subtitle={displayCategoryName(model, item.category, language)} /><input type="number" min={0} max={999} value={ownedItems.get(item.itemClass) ?? 0} onChange={(event) => {
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

function AllowedItemsModal({ t, language, model, disabledItems, onChange, onClose }: { t: Translator; language: Language; model: EcoModel; disabledItems: Set<ItemClass>; onChange: (next: Set<ItemClass>) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const items = model.housingItems.filter((item) => !query || [displayItemName(item, language), item.friendlyName].join(" ").toLowerCase().includes(query)).sort((a, b) => byName(a, b)).slice(0, 260);
  function setAllowed(item: HousingItem, allowed: boolean) {
    const next = new Set(disabledItems);
    if (allowed) next.delete(item.itemClass);
    else next.add(item.itemClass);
    onChange(next);
  }
  return (
    <Modal title={t("optimizationPermissionsTitle")} onClose={onClose}>
      <div className="modal-tools"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("filterObjects")} /><button onClick={() => onChange(new Set())}>{t("allowAll")}</button></div>
      <div className="modal-list">
        {items.map((item) => <label className="check-row modal-check" key={item.itemClass}><input type="checkbox" checked={!disabledItems.has(item.itemClass)} onChange={(event) => setAllowed(item, event.target.checked)} /><ItemName language={language} item={item} subtitle={displayCategoryName(model, item.category, language)} /></label>)}
      </div>
    </Modal>
  );
}

function SettingsModal({ t, config, update, onClose }: { t: Translator; config: AppConfig; update: (partial: Partial<AppConfig>) => void; onClose: () => void }) {
  return (
    <Modal title={t("settings")} onClose={onClose}>
      <div className="settings-list">
        <label className="settings-row">
          <input type="checkbox" checked={config.devMode} onChange={(event) => update({ devMode: event.target.checked })} />
          <span>
            <strong>{t("devMode")}</strong>
            <small>{t("devModeHelp")}</small>
          </span>
        </label>
      </div>
    </Modal>
  );
}

function ItemName({ language, item, subtitle }: { language: Language; item: HousingItem; subtitle?: string | null }) {
  return (
    <span className="item-name">
      <ItemIcon item={item} />
      <span>
        <strong>{displayItemName(item, language)}</strong>
        {subtitle != null && <small>{subtitle}</small>}
      </span>
    </span>
  );
}

function SkillName({ language, skill, suffix }: { language: Language; skill: Pick<Skill, "className" | "friendlyName" | "localizedName" | "iconUrl">; suffix?: string }) {
  return (
    <span className="skill-name">
      <SkillIcon skill={skill} />
      <span>{displaySkillName(skill, language)}{suffix ? ` ${suffix}` : ""}</span>
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

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function Metric({ label, value, delta = 0 }: { label: string; value: number; delta?: number }) {
  return <div><span>{label}</span><strong>{value.toFixed(2)}</strong>{Math.abs(delta) > 0.01 && <small>{delta.toFixed(2)}</small>}</div>;
}

function professionOrder(name: string) {
  const index = PROFESSION_ORDER.indexOf(name);
  return index === -1 ? 999 : index;
}

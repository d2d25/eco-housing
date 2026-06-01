const state = {
  data: null,
  activeView: "house",
  selectedSkills: new Set(),
  search: "",
  room: "all",
  roomWidth: 4,
  roomDepth: 4,
  roomHeight: 3,
  houseHeight: 3,
  residentCount: 1,
  constructionMaterials: 100,
  materialStocks: { 0: 0, 1: 0, 2: 100, 3: 0, 4: 0, 5: 0 },
  roomTier: 2,
  category: "all",
  availability: "available",
  authorizationSearch: "",
  authorizationCategory: "all",
  disabledOptimizationItems: new Set(),
  ownedSearch: "",
  ownedCategory: "all",
  ownedItems: new Map(),
  craftCache: new Map(),
  houseRoomCounts: {},
};

const EXCLUDED_ITEM_CLASSES = new Set([
  "EckoStatueItem",
]);

const EXCLUDED_ROOM_CATEGORIES = new Set([
  "Cultural",
]);

const PROFESSION_ORDER = [
  "Carpenter",
  "Mason",
  "Farmer",
  "Hunter",
  "Chef",
  "Tailor",
  "Smith",
  "Engineer",
  "Scientist",
];

const ALWAYS_AVAILABLE_SKILLS = new Set([
  "SurvivalistSkill",
  "SelfImprovementSkill",
]);

const BASELINE_STATION_OBJECTS = new Set([
  "CampsiteObject",
  "WorkbenchObject",
]);

const BASELINE_RESOURCE_TAGS = new Set([
  "Crop",
  "NaturalFiber",
]);

const MIN_NON_OWNED_CREDITED_SCORE = 0.1;
const CONFIG_STORAGE_KEY = "ecoHousingConfig";
const OWNED_STORAGE_KEY = "ecoHousingOwnedItems";

const els = {
  searchInput: document.querySelector("#searchInput"),
  viewTitle: document.querySelector("#viewTitle"),
  viewTabs: document.querySelectorAll(".view-tab"),
  views: document.querySelectorAll(".view"),
  sidePanels: document.querySelectorAll(".side-panel"),
  roomSelect: document.querySelector("#roomSelect"),
  roomWidthInput: document.querySelector("#roomWidthInput"),
  roomDepthInput: document.querySelector("#roomDepthInput"),
  roomHeightInput: document.querySelector("#roomHeightInput"),
  houseHeightInput: document.querySelector("#houseHeightInput"),
  residentCountInput: document.querySelector("#residentCountInput"),
  materialInputs: document.querySelector("#materialInputs"),
  tierSelect: document.querySelector("#tierSelect"),
  roomTierButtons: document.querySelector("#roomTierButtons"),
  roomTypeBar: document.querySelector("#roomTypeBar"),
  tierHelpButton: document.querySelector("#tierHelpButton"),
  tierHelp: document.querySelector("#tierHelp"),
  categorySelect: document.querySelector("#categorySelect"),
  availabilitySelect: document.querySelector("#availabilitySelect"),
  skillList: document.querySelector("#skillList"),
  selectAllSkills: document.querySelector("#selectAllSkills"),
  clearSkills: document.querySelector("#clearSkills"),
  housingCount: document.querySelector("#housingCount"),
  visibleCount: document.querySelector("#visibleCount"),
  skillCount: document.querySelector("#skillCount"),
  optimizerGroups: document.querySelector("#optimizerGroups"),
  optimizerHint: document.querySelector("#optimizerHint"),
  roomTotalScore: document.querySelector("#roomTotalScore"),
  roomFitSummary: document.querySelector("#roomFitSummary"),
  houseHint: document.querySelector("#houseHint"),
  houseRoomCounts: document.querySelector("#houseRoomCounts"),
  housePlan: document.querySelector("#housePlan"),
  houseShoppingList: document.querySelector("#houseShoppingList"),
  houseRoomDetails: document.querySelector("#houseRoomDetails"),
  dataHint: document.querySelector("#dataHint"),
  dataCards: document.querySelector("#dataCards"),
  dataLists: document.querySelector("#dataLists"),
  itemRows: document.querySelector("#itemRows"),
  authorizationModal: document.querySelector("#authorizationModal"),
  authorizationOpen: document.querySelectorAll(".authorization-open"),
  authorizationClose: document.querySelector("#authorizationClose"),
  authorizationSearch: document.querySelector("#authorizationSearch"),
  authorizationAllowAll: document.querySelector("#authorizationAllowAll"),
  authorizationCategories: document.querySelector("#authorizationCategories"),
  authorizationItems: document.querySelector("#authorizationItems"),
  ownedModal: document.querySelector("#ownedModal"),
  ownedOpen: document.querySelectorAll(".owned-open"),
  ownedClose: document.querySelector("#ownedClose"),
  ownedSearch: document.querySelector("#ownedSearch"),
  ownedClear: document.querySelector("#ownedClear"),
  ownedCategories: document.querySelector("#ownedCategories"),
  ownedItems: document.querySelector("#ownedItems"),
};

function byName(a, b) {
  return String(a.friendlyName ?? a.className).localeCompare(String(b.friendlyName ?? b.className));
}

function loadOwnedItems() {
  try {
    const raw = localStorage.getItem(OWNED_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.ownedItems = new Map(Object.entries(parsed).map(([itemClass, quantity]) => [itemClass, Number(quantity) || 0]).filter(([, quantity]) => quantity > 0));
  } catch {
    state.ownedItems = new Map();
  }
}

function saveOwnedItems() {
  const payload = Object.fromEntries([...state.ownedItems.entries()].filter(([, quantity]) => quantity > 0));
  localStorage.setItem(OWNED_STORAGE_KEY, JSON.stringify(payload));
}

function loadAppConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return;
    const config = JSON.parse(raw);
    if (config.activeView) state.activeView = config.activeView;
    if (config.search != null) state.search = String(config.search);
    if (config.room) state.room = config.room;
    if (config.category) state.category = config.category;
    if (config.availability) state.availability = config.availability;
    if (config.authorizationCategory) state.authorizationCategory = config.authorizationCategory;
    if (config.ownedCategory) state.ownedCategory = config.ownedCategory;
    state.roomWidth = config.roomWidth ?? state.roomWidth;
    state.roomDepth = config.roomDepth ?? state.roomDepth;
    state.roomHeight = config.roomHeight ?? state.roomHeight;
    state.houseHeight = config.houseHeight ?? state.houseHeight;
    state.residentCount = config.residentCount ?? state.residentCount;
    state.roomTier = config.roomTier ?? state.roomTier;
    state.materialStocks = { ...state.materialStocks, ...(config.materialStocks ?? {}) };
    state.selectedSkills = new Set(config.selectedSkills ?? []);
    state.disabledOptimizationItems = new Set(config.disabledOptimizationItems ?? []);
    if (EXCLUDED_ROOM_CATEGORIES.has(state.room)) state.room = "all";
  } catch {
    localStorage.removeItem(CONFIG_STORAGE_KEY);
  }
}

function saveAppConfig() {
  if (!state.data) return;
  const payload = {
    activeView: state.activeView,
    selectedSkills: [...state.selectedSkills],
    search: state.search,
    room: state.room,
    roomWidth: normalizedRoomWidth(),
    roomDepth: normalizedRoomDepth(),
    roomHeight: normalizedRoomHeight(),
    houseHeight: normalizedHouseHeight(),
    residentCount: normalizedResidentCount(),
    materialStocks: state.materialStocks,
    roomTier: state.roomTier,
    category: state.category,
    availability: state.availability,
    authorizationCategory: state.authorizationCategory,
    disabledOptimizationItems: [...state.disabledOptimizationItems],
    ownedCategory: state.ownedCategory,
  };
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(payload));
}

function buildModel(data) {
  const skillsByClass = new Map(data.skills.map((skill) => [skill.className, skill]));
  const itemByClass = new Map((data.items ?? []).map((item) => [item.className, item]));
  const recipesByProduct = new Map();
  const itemByWorldObject = new Map();
  const occupancyByWorldObject = new Map((data.occupancy ?? []).map((entry) => [entry.worldObjectClass, entry]));
  const requirementsByWorldObject = new Map((data.worldObjects ?? []).map((entry) => [entry.className, entry]));
  const roomCategories = data.roomCategories?.length
    ? data.roomCategories
    : [...new Set(data.housing.map((item) => item.category).filter(Boolean))].map((name) => ({ name, canBeRoomCategory: true }));
  const supportForAnyRoom = roomCategories.filter((room) => room.supportForAnyRoomType).map((room) => room.name);

  for (const item of data.items ?? []) {
    if (item.worldObjectClass) itemByWorldObject.set(item.worldObjectClass, item.className);
  }

  for (const recipe of data.recipes) {
    for (const product of recipe.products ?? []) {
      if (!product.itemClass) continue;
      if (!recipesByProduct.has(product.itemClass)) recipesByProduct.set(product.itemClass, []);
      recipesByProduct.get(product.itemClass).push(recipe);
    }
  }

  const housingItems = data.housing
    .filter((housing) => !EXCLUDED_ITEM_CLASSES.has(housing.itemClass))
    .filter((housing) => !housing.hiddenCategory && !housing.notInBrowser)
    .filter((housing) => housing.category !== "Industrial")
    .filter((housing) => Number.isFinite(housing.value) && housing.value > 0)
    .map((housing) => {
    const recipes = recipesByProduct.get(housing.itemClass) ?? [];
    const directSkillClasses = [...new Set(recipes.map((recipe) => recipe.requiredSkillClass).filter(Boolean))];
    const skillClasses = directSkillClasses;
    const skills = skillClasses.map((className) => skillsByClass.get(className) ?? { className, friendlyName: className });
    const minSkillLevel = recipes.reduce((best, recipe) => {
      if (!recipe.requiredSkillLevel) return best;
      return best == null ? recipe.requiredSkillLevel : Math.min(best, recipe.requiredSkillLevel);
    }, null);

    return {
      ...housing,
      tags: [...new Set([...(housing.tags ?? []), ...(requirementsByWorldObject.get(housing.worldObjectClass)?.tags ?? [])])],
      recipes,
      skills,
      skillClasses,
      minSkillLevel,
      occupancy: occupancyByWorldObject.get(housing.worldObjectClass) ?? null,
      requirements: requirementsByWorldObject.get(housing.worldObjectClass) ?? null,
      craftableWithoutSkill: recipes.length > 0 && skillClasses.length === 0,
    };
  });

  return {
    ...data,
    housingItems,
    skills: [...data.skills].sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || byName(a, b)),
    roomCategories,
    roomCategoryByName: new Map(roomCategories.map((room) => [room.name, room])),
    housingConfig: data.housingConfig ?? {},
    supportForAnyRoom,
    roomTiers: data.roomTiers ?? [],
    skillsByClass,
    itemByClass,
    recipesByProduct,
    itemByWorldObject,
    occupancyByWorldObject,
    requirementsByWorldObject,
  };
}

function selectedRoom(roomName = state.room) {
  return state.data.roomCategories.find((room) => room.name === roomName) ?? null;
}

function compatibleCategoriesForRoom(roomName) {
  if (roomName === "all") return null;
  const room = selectedRoom(roomName);
  if (!room) return new Set([roomName]);

  return new Set([
    room.name,
    ...(room.supportingRoomCategoryNames ?? []),
    ...state.data.supportForAnyRoom,
  ]);
}

function isCompatibleWithSelectedRoom(item) {
  const compatible = compatibleCategoriesForRoom(state.room);
  if (!compatible) return true;
  return compatible.has(item.category);
}

function isAvailable(item) {
  return resolveCraft(item.itemClass).craftable;
}

function resolveCraft(itemClass, stack = [], mode = "full") {
  if (stack.includes(itemClass)) return { craftable: true, missing: [], required: [] };
  const cacheKey = `${mode}:${itemClass}`;
  if (state.craftCache.has(cacheKey)) return state.craftCache.get(cacheKey);

  if (mode === "ingredient" && isBaselineResource(itemClass)) {
    const raw = { craftable: true, missing: [], required: [] };
    state.craftCache.set(cacheKey, raw);
    return raw;
  }

  const recipes = state.data.recipesByProduct.get(itemClass) ?? [];
  if (!recipes.length) {
    const raw = { craftable: true, missing: [], required: [] };
    state.craftCache.set(cacheKey, raw);
    return raw;
  }

  const attempts = recipes.map((recipe) => (
    mode === "ingredient"
      ? resolveIngredientRecipe(recipe)
      : mode === "station"
        ? resolveStationRecipe(recipe, [...stack, itemClass])
      : resolveRecipe(recipe, [...stack, itemClass])
  ));
  const craftable = attempts.find((attempt) => attempt.craftable);
  if (craftable) {
    state.craftCache.set(cacheKey, craftable);
    return craftable;
  }

  const blocked = attempts.sort((a, b) => a.missing.length - b.missing.length)[0] ?? { craftable: false, missing: [], required: [] };
  state.craftCache.set(cacheKey, blocked);
  return blocked;
}

function isBaselineResource(itemClass) {
  const item = state.data.itemByClass.get(itemClass);
  return Boolean(item?.tags?.some((tag) => BASELINE_RESOURCE_TAGS.has(tag)));
}

function resolveIngredientRecipe(recipe) {
  const missing = [];
  const required = [];
  addSkillRequirement(recipe.requiredSkillClass, recipe.requiredSkillLevel, missing, required);

  return {
    craftable: missing.length === 0,
    missing: uniqueRequirements(missing),
    required: uniqueRequirements(required),
  };
}

function resolveStationRecipe(recipe, stack) {
  const missing = [];
  const required = [];
  addSkillRequirement(recipe.requiredSkillClass, recipe.requiredSkillLevel, missing, required);

  return {
    craftable: missing.length === 0,
    missing: uniqueRequirements(missing),
    required: uniqueRequirements(required),
  };
}

function resolveRecipe(recipe, stack) {
  const missing = [];
  const required = [];

  addSkillRequirement(recipe.requiredSkillClass, recipe.requiredSkillLevel, missing, required);

  const tableItemClass = state.data.itemByWorldObject.get(recipe.craftingTableClass);
  if (tableItemClass && !BASELINE_STATION_OBJECTS.has(recipe.craftingTableClass)) {
    mergeResolution(resolveCraft(tableItemClass, stack, "station"), missing, required);
  }

  for (const ingredient of recipe.ingredients ?? []) {
    if (!ingredient.itemClass) continue;
    mergeResolution(resolveCraft(ingredient.itemClass, stack, "ingredient"), missing, required);
  }

  return {
    craftable: missing.length === 0,
    missing: uniqueRequirements(missing),
    required: uniqueRequirements(required),
  };
}

function addSkillRequirement(skillClass, level, missing, required) {
  if (!skillClass || skillClass === "Skill") return;
  if (ALWAYS_AVAILABLE_SKILLS.has(skillClass) || isProfessionCategory(skillClass)) return;
  const requirement = { skillClass, level: level ?? null };
  required.push(requirement);
  if (!state.selectedSkills.has(skillClass)) missing.push(requirement);
}

function mergeResolution(resolution, missing, required) {
  missing.push(...resolution.missing);
  required.push(...resolution.required);
}

function uniqueRequirements(requirements) {
  const bySkill = new Map();
  for (const requirement of requirements) {
    const current = bySkill.get(requirement.skillClass);
    if (!current || (requirement.level ?? 0) > (current.level ?? 0)) {
      bySkill.set(requirement.skillClass, requirement);
    }
  }
  return [...bySkill.values()].sort((a, b) => formatRequirement(a).localeCompare(formatRequirement(b)));
}

function availabilityFilter(item) {
  const available = isAvailable(item);
  if (state.availability === "available") return available;
  if (state.availability === "locked") return !available;
  return true;
}

function isOptimizationAllowed(item) {
  return !state.disabledOptimizationItems.has(item.itemClass);
}

function authorizationDisabledCount() {
  return state.disabledOptimizationItems.size;
}

function ownedItemQuantity(itemClass) {
  return state.ownedItems.get(itemClass) ?? 0;
}

function ownedItemCount() {
  return [...state.ownedItems.values()].reduce((total, quantity) => total + quantity, 0);
}

function ownedRemaining(itemClass, context = null) {
  const used = context?.ownedUsage?.get(itemClass) ?? 0;
  return Math.max(0, ownedItemQuantity(itemClass) - used);
}

function markOwnedUsed(itemClass, context = null) {
  if (!context?.ownedUsage || ownedRemaining(itemClass, context) <= 0) return false;
  context.ownedUsage.set(itemClass, (context.ownedUsage.get(itemClass) ?? 0) + 1);
  return true;
}

function availabilityLabel(item) {
  const resolution = resolveCraft(item.itemClass);
  if (resolution.craftable) return "disponible";
  return `manque ${resolution.missing.map(formatRequirement).join(", ")}`;
}

function filteredItems() {
  const query = state.search.trim().toLowerCase();

  return state.data.housingItems
    .filter((item) => isCompatibleWithSelectedRoom(item))
    .filter((item) => state.category === "all" || item.category === state.category)
    .filter((item) => {
      if (!query) return true;
      const text = [
        item.friendlyName,
        item.category,
        item.typeForRoomLimit,
        item.source,
        ...item.skills.map((skill) => skill.friendlyName),
      ].join(" ").toLowerCase();
      return text.includes(query);
    })
    .filter((item) => availabilityFilter(item))
    .sort((a, b) => b.value - a.value || byName(a, b));
}

function formatSkill(item) {
  const resolution = resolveCraft(item.itemClass);
  if (!resolution.required.length) return "Aucun";
  if (resolution.missing.length) return `Manque: ${resolution.missing.map(formatRequirement).join(", ")}`;
  return resolution.required.map(formatRequirement).join(", ");
}

function formatRequirement(requirement) {
  const skill = state.data.skillsByClass.get(requirement.skillClass);
  return `${skill?.friendlyName ?? requirement.skillClass}${requirement.level ? ` ${requirement.level}` : ""}`;
}

function hasSurfaceTag(item, tagName) {
  return item.tags?.includes(`SurfaceTags.${tagName}`);
}

function hasTag(item, tagName) {
  return item.tags?.includes(tagName);
}

function isSmallEstimatedPlaceable(item) {
  return hasSurfaceTag(item, "CanBeOnSurface") || (!item.worldObjectClass && hasTag(item, "Petals"));
}

function surfacePlacementKind(item) {
  if (hasSurfaceTag(item, "Rug")) return "superposable: tapis";
  if (!item.worldObjectClass && hasTag(item, "Petals")) return "petit objet posable estime";
  if (hasSurfaceTag(item, "CanBeOnSurface")) return "posable sur surface";
  if (hasSurfaceTag(item, "HasTableSurface")) return "fournit surface";
  return "";
}

function surfaceUnitsProvided(item) {
  if (!hasSurfaceTag(item, "HasTableSurface")) return 0;
  return Math.max(1, item.occupancy?.floorArea ?? 1);
}

function surfaceUnitsRequired(item) {
  if (!isSmallEstimatedPlaceable(item)) return 0;
  return Math.max(1, itemFootprint(item).floorArea);
}

function itemFootprint(item) {
  if (item.occupancy) {
    return {
      width: item.occupancy.width ?? 0,
      depth: item.occupancy.depth ?? 0,
      height: item.occupancy.height ?? 0,
      floorArea: item.occupancy.floorArea ?? 0,
      estimated: false,
    };
  }

  if (isSmallEstimatedPlaceable(item)) {
    return { width: 1, depth: 1, height: 1, floorArea: 1, estimated: true };
  }

  return { width: 0, depth: 0, height: 0, floorArea: 0, estimated: false };
}

function effectiveFloorArea(item) {
  if (hasSurfaceTag(item, "Rug")) return 0;
  return itemFootprint(item).floorArea;
}

function floorAreaWhenOnSurface(item) {
  if (hasSurfaceTag(item, "Rug")) return 0;
  if (isSmallEstimatedPlaceable(item)) return 0;
  return effectiveFloorArea(item);
}

function itemOccupancyDimensions(item) {
  const footprint = itemFootprint(item);
  return {
    width: footprint.width,
    depth: footprint.depth,
    height: footprint.height,
  };
}

function itemFitsRoomDimensions(item, constraints = null) {
  if (!constraints) return true;
  const { width, depth, height } = itemOccupancyDimensions(item);

  if (constraints.maxHeight != null && height > 0 && height > constraints.maxHeight) return false;

  if (constraints.maxWidth != null && constraints.maxDepth != null && width > 0 && depth > 0) {
    const fitsDefault = width <= constraints.maxWidth && depth <= constraints.maxDepth;
    const fitsRotated = depth <= constraints.maxWidth && width <= constraints.maxDepth;
    if (!fitsDefault && !fitsRotated) return false;
  }

  return true;
}

function formatFootprint(item) {
  const occupancy = itemFootprint(item);
  if (!occupancy.floorArea) return "<span class='muted'>-</span>";
  const blocking = effectiveFloorArea(item);
  const suffix = blocking !== occupancy.floorArea ? `, bloque ${blocking}` : "";
  const height = occupancy.height > 1 ? `x${occupancy.height}` : "";
  const estimated = occupancy.estimated ? ", estime" : "";
  return `${occupancy.width}x${occupancy.depth}${height} (${occupancy.floorArea}${suffix}${estimated})`;
}

function formatRequiredVolume(item) {
  const volume = item.requirements?.requiredRoomVolume;
  if (volume == null) return "<span class='muted'>-</span>";
  return `${volume} m3`;
}

function formatObjectConstraints(item) {
  const requirements = item.requirements;
  const occupancy = item.occupancy;
  const parts = [];
  const surface = surfacePlacementKind(item);
  if (surface) parts.push(surface);
  const surfaceProvided = surfaceUnitsProvided(item);
  const surfaceRequired = surfaceUnitsRequired(item);
  if (surfaceProvided) parts.push(`surface +${surfaceProvided}`);
  if (surfaceRequired) parts.push(`surface -${surfaceRequired}`);
  if (itemFootprint(item).estimated) parts.push("empreinte estimee");
  if (requirements?.requireRoomContainment) parts.push("piece fermee");
  if (requirements?.requiredRoomMaterialTier != null) parts.push(`tier ${requirements.requiredRoomMaterialTier}`);
  if (requirements?.attachmentDirections?.length) parts.push(`attache: ${requirements.attachmentDirections.join(", ")}`);
  if (item.hasDynamicFurnishingValue) parts.push("valeur dynamique");
  if (item.diminishingMultiplierAcrossFullProperty != null) parts.push(`retour propriete ${Math.round(item.diminishingMultiplierAcrossFullProperty * 100)}%`);
  if (occupancy?.ports?.length) parts.push(`ports: ${occupancy.ports.join(", ")}`);
  if (!parts.length) return "<span class='muted'>-</span>";
  return parts.join(" | ");
}

function renderSkills() {
  els.skillList.innerHTML = "";
  for (const group of skillGroups()) {
    const details = document.createElement("details");
    details.className = "skill-tier";
    details.open = true;
    details.innerHTML = `
      <summary>
        <span>${group.name}</span>
        <strong>${group.selected}/${group.skills.length}</strong>
      </summary>
      <div class="tier-skills"></div>
    `;

    const list = details.querySelector(".tier-skills");
    for (const skill of group.skills) {
      const label = document.createElement("label");
      label.className = "skill-option";
      label.innerHTML = `
        <input type="checkbox" value="${skill.className}">
        <span>${skill.friendlyName ?? skill.className}</span>
      `;
      const input = label.querySelector("input");
      input.checked = state.selectedSkills.has(skill.className);
      input.addEventListener("change", () => {
        if (input.checked) state.selectedSkills.add(skill.className);
        else state.selectedSkills.delete(skill.className);
        renderSkills();
        render();
      });
      list.append(label);
    }

    els.skillList.append(details);
  }
}

function renderMaterialInputs() {
  els.materialInputs.innerHTML = "";
  for (const tier of [0, 1, 2, 3, 4, 5]) {
    const label = document.createElement("label");
    label.className = "material-field";
    label.innerHTML = `
      <span>T${tier}</span>
      <input type="number" min="0" max="5000" step="1" value="${normalizedMaterialStock(tier)}" data-material-tier="${tier}">
    `;
    label.querySelector("input").addEventListener("input", (event) => {
      const currentTier = Number(event.target.dataset.materialTier);
      state.materialStocks[currentTier] = Math.max(0, Math.min(5000, Number.parseInt(event.target.value, 10) || 0));
      event.target.value = String(state.materialStocks[currentTier]);
      render();
    });
    els.materialInputs.append(label);
  }
}

function skillGroups() {
  const byProfession = new Map();
  for (const skill of selectableSkills()) {
    const profession = skill.professionGroup ?? (skill.isProfession ? skill.friendlyName : "Autres");
    if (!byProfession.has(profession)) byProfession.set(profession, []);
    byProfession.get(profession).push(skill);
  }

  return [...byProfession.entries()]
    .sort(([a], [b]) => professionOrder(a) - professionOrder(b) || a.localeCompare(b))
    .map(([name, skills]) => ({
      name,
      skills: skills.sort(sortSkillsInProfession),
      selected: skills.filter((skill) => state.selectedSkills.has(skill.className)).length,
    }));
}

function selectableSkills() {
  return state.data.skills.filter((skill) => (
    !skill.isProfession &&
    !ALWAYS_AVAILABLE_SKILLS.has(skill.className) &&
    skill.professionGroup !== "Survivalist"
  ));
}

function isProfessionCategory(skillClass) {
  return state.data.skillsByClass.get(skillClass)?.isProfession ?? false;
}

function professionOrder(name) {
  const index = PROFESSION_ORDER.indexOf(name);
  return index === -1 ? 999 : index;
}

function sortSkillsInProfession(a, b) {
  return (a.tier ?? 99) - (b.tier ?? 99) || byName(a, b);
}

function renderRooms() {
  els.roomSelect.innerHTML = `<option value="all">Choisir une piece</option>`;
  els.roomTypeBar.innerHTML = "";
  const rooms = state.data.roomCategories
    .filter((room) => room.canBeRoomCategory && !room.negatesValue)
    .filter((room) => !EXCLUDED_ROOM_CATEGORIES.has(room.name))
    .sort((a, b) => {
      if (a.negatesValue !== b.negatesValue) return a.negatesValue ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  for (const room of rooms) {
    const option = document.createElement("option");
    option.value = room.name;
    option.textContent = room.name;
    els.roomSelect.append(option);

    if (room.name === "Outdoor") continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `room-type-button${state.room === room.name ? " active" : ""}`;
    button.dataset.room = room.name;
    button.textContent = room.name;
    els.roomTypeBar.append(button);
  }
}

function playableRooms() {
  return state.data.roomCategories
    .filter((room) => room.canBeRoomCategory && !room.negatesValue && room.name !== "Outdoor")
    .filter((room) => !EXCLUDED_ROOM_CATEGORIES.has(room.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderTiers() {
  els.tierSelect.innerHTML = "";
  els.roomTierButtons.innerHTML = "";
  for (const tier of state.data.roomTiers) {
    const option = document.createElement("option");
    option.value = String(tier.tier);
    option.textContent = `Tier ${tier.tier} (${tier.softCap}/${tier.hardCap})`;
    if (tier.tier === state.roomTier) option.selected = true;
    els.tierSelect.append(option);

    const button = document.createElement("button");
    button.type = "button";
    button.className = `tier-button${tier.tier === state.roomTier ? " active" : ""}`;
    button.dataset.tier = String(tier.tier);
    button.innerHTML = `<strong>T${tier.tier}</strong><span>${tier.softCap}/${tier.hardCap}</span>`;
    els.roomTierButtons.append(button);
  }
  renderTierHelp();
}

function renderTierHelp() {
  const tier = selectedTier();
  if (!tier) {
    els.tierHelp.textContent = "";
    return;
  }
  els.tierHelp.textContent = `Soft cap: score plein jusqu'a ${tier.softCap}. Hard cap: limite a ${tier.hardCap}. Entre les deux, seuls ${Math.round(tier.diminishingReturnPercent * 100)}% des points comptent.`;
}

function renderRoomControls() {
  els.roomSelect.value = state.room;
  els.tierSelect.value = String(state.roomTier);
  els.roomWidthInput.value = String(normalizedRoomWidth());
  els.roomDepthInput.value = String(normalizedRoomDepth());
  els.roomHeightInput.value = String(normalizedRoomHeight());
  els.houseHeightInput.value = String(normalizedHouseHeight());
  els.residentCountInput.value = String(normalizedResidentCount());
  els.searchInput.value = state.search;
  els.categorySelect.value = state.category;
  els.availabilitySelect.value = state.availability;
  for (const button of els.roomTypeBar.querySelectorAll(".room-type-button")) {
    button.classList.toggle("active", button.dataset.room === state.room);
  }
  for (const button of els.roomTierButtons.querySelectorAll(".tier-button")) {
    button.classList.toggle("active", Number(button.dataset.tier) === state.roomTier);
  }
}

function renderCategories() {
  const categories = [...new Set(state.data.housingItems.map((item) => item.category).filter(Boolean))].sort();
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    els.categorySelect.append(option);
  }
}

function renderAuthorizationButtons() {
  const count = authorizationDisabledCount();
  const text = count ? `Autorisations (${count} bloque${count > 1 ? "s" : ""})` : "Autorisations";
  for (const button of els.authorizationOpen) button.textContent = text;
}

function renderOwnedButtons() {
  const count = ownedItemCount();
  const text = count ? `Objets acquis (${count})` : "Objets acquis";
  for (const button of els.ownedOpen) button.textContent = text;
}

function renderAuthorizationModal() {
  if (els.authorizationModal.hidden) return;

  const categories = [...new Set(state.data.housingItems.map((item) => item.category).filter(Boolean))].sort();
  els.authorizationCategories.innerHTML = [
    `<button class="category-filter-button${state.authorizationCategory === "all" ? " active" : ""}" type="button" data-auth-category-filter="all">Toutes</button>`,
    ...categories.map((category) => `
      <button class="category-filter-button${state.authorizationCategory === category ? " active" : ""}" type="button" data-auth-category-filter="${category}">
        ${category}
      </button>
    `),
  ].join("");

  const query = state.authorizationSearch.trim().toLowerCase();
  const items = state.data.housingItems
    .filter((item) => state.authorizationCategory === "all" || item.category === state.authorizationCategory)
    .filter((item) => {
      if (!query) return true;
      return [item.friendlyName, item.category, item.typeForRoomLimit].join(" ").toLowerCase().includes(query);
    })
    .sort((a, b) => a.category.localeCompare(b.category) || byName(a, b));

  els.authorizationItems.innerHTML = items.map((item) => `
    <label class="check-row">
      <input type="checkbox" data-auth-item="${item.itemClass}" ${state.disabledOptimizationItems.has(item.itemClass) ? "" : "checked"}>
      <span>${item.friendlyName}<small>${item.category} | ${item.value}</small></span>
    </label>
  `).join("");
}

function openAuthorizationModal() {
  els.authorizationModal.hidden = false;
  renderAuthorizationModal();
  els.authorizationSearch.focus();
}

function closeAuthorizationModal() {
  els.authorizationModal.hidden = true;
}

function renderOwnedModal() {
  if (els.ownedModal.hidden) return;

  const availableItems = state.data.housingItems.filter((item) => isAvailable(item));
  const categories = [...new Set(availableItems.map((item) => item.category).filter(Boolean))].sort();
  els.ownedCategories.innerHTML = [
    `<button class="category-filter-button${state.ownedCategory === "all" ? " active" : ""}" type="button" data-owned-category-filter="all">Toutes</button>`,
    ...categories.map((category) => `
      <button class="category-filter-button${state.ownedCategory === category ? " active" : ""}" type="button" data-owned-category-filter="${category}">
        ${category}
      </button>
    `),
  ].join("");

  const query = state.ownedSearch.trim().toLowerCase();
  const items = availableItems
    .filter((item) => state.ownedCategory === "all" || item.category === state.ownedCategory)
    .filter((item) => {
      if (!query) return true;
      return [item.friendlyName, item.category, item.typeForRoomLimit].join(" ").toLowerCase().includes(query);
    })
    .sort((a, b) => a.category.localeCompare(b.category) || byName(a, b));

  els.ownedItems.innerHTML = items.map((item) => `
    <label class="owned-row">
      <span>${item.friendlyName}<small>${item.category} | ${item.value}</small></span>
      <input type="number" min="0" max="999" step="1" value="${ownedItemQuantity(item.itemClass)}" data-owned-item="${item.itemClass}">
    </label>
  `).join("");
}

function openOwnedModal() {
  els.ownedModal.hidden = false;
  renderOwnedModal();
  els.ownedSearch.focus();
}

function closeOwnedModal() {
  els.ownedModal.hidden = true;
}

function renderTable(items) {
  els.itemRows.innerHTML = "";

  if (!items.length) {
    els.itemRows.innerHTML = `<tr><td colspan="10" class="empty">Aucun item ne correspond aux filtres.</td></tr>`;
    return;
  }

  for (const item of items) {
    const row = document.createElement("tr");
    const available = isAvailable(item);
    row.innerHTML = `
      <td class="item-name">${item.friendlyName}</td>
      <td>${item.category ?? ""}</td>
      <td>${formatCompatibility(item)}</td>
      <td>${item.value ?? ""}</td>
      <td>${item.typeForRoomLimit ?? "<span class='muted'>-</span>"}</td>
      <td>${item.diminishingReturnPercent ?? "<span class='muted'>-</span>"}</td>
      <td>${formatFootprint(item)}</td>
      <td>${formatRequiredVolume(item)}</td>
      <td>${formatObjectConstraints(item)}</td>
      <td><span class="pill ${available ? "" : "locked"}">${formatSkill(item)}</span></td>
    `;
    els.itemRows.append(row);
  }
}

function formatCompatibility(item) {
  if (state.room === "all") return "<span class='muted'>-</span>";
  if (item.category === state.room) return "definit la piece";
  const room = selectedRoom();
  if (room?.supportingRoomCategoryNames?.includes(item.category)) return "support";
  if (state.data.supportForAnyRoom.includes(item.category)) return "support general";
  return "<span class='muted'>compatible</span>";
}

function formatRoomHint() {
  const compatible = compatibleCategoriesForRoom(state.room);
  if (!compatible) return "meilleures valeurs visibles";
  return `categories compatibles: ${[...compatible].join(", ")}`;
}

function optimizerGroups(roomName = state.room, constraints = null, tierValue = state.roomTier) {
  const compatible = compatibleCategoriesForRoom(roomName);
  if (!compatible) return [];
  if (constraints) {
    constraints.usedFloor = 0;
    constraints.usedRequiredVolume = 0;
    constraints.surfaceCapacity = 0;
    constraints.usedSurface = 0;
  }
  const room = selectedRoom(roomName);
  const primary = room ? [room.name] : [];
  const supports = room?.supportingRoomCategoryNames ?? [];
  const general = state.data.supportForAnyRoom;
  const ordered = [...new Set([...primary, ...supports, ...general])].filter((category) => compatible.has(category));
  let primaryScore = 0;

  const groups = ordered.map((category) => {
    const isPrimary = category === roomName;
    const role = isPrimary ? "definit la piece" : general.includes(category) ? "support general" : "support";
    const supportCapPercent = isPrimary ? null : supportCapPercentForCategory(category, roomName);
    const supportCap = supportCapPercent == null ? null : primaryScore * supportCapPercent;
    const items = state.data.housingItems
      .filter((item) => item.category === category)
      .filter((item) => availabilityFilter(item))
      .filter((item) => isOptimizationAllowed(item))
      .sort((a, b) => b.value - a.value || byName(a, b));
    const picked = bestItemsWithDiminishingReturns(items, 8, supportCap, constraints);
    const score = estimateEntriesScore(picked);
    if (isPrimary) primaryScore = score;
    return {
      category,
      role,
      entries: picked,
      score,
      supportCap,
      supportCapPercent,
    };
  });
  reconcileSurfacePlacement(groups, constraints);
  return groups.map((group) => ({
    ...group,
    score: estimateEntriesScore(group.entries),
  }));
}

function supportCapPercentForCategory(category, primaryRoomName = state.room) {
  const roomCategory = state.data.roomCategoryByName.get(category);
  return roomCategory?.maxSupportPercentOfPrimaryPerCategory?.[primaryRoomName] ?? roomCategory?.maxSupportPercentOfPrimary ?? null;
}

function selectedTier(tierValue = state.roomTier) {
  return state.data.roomTiers.find((tier) => tier.tier === tierValue) ?? state.data.roomTiers.at(-1) ?? null;
}

function diminishingMultiplier(item, countBefore) {
  if (countBefore <= 0) return 1;
  const multiplier = item.diminishingReturnPercent ?? 1;
  return multiplier ** countBefore;
}

function estimateItemsScore(items) {
  const byType = new Map();
  let total = 0;

  for (const item of items) {
    const type = item.typeForRoomLimit ?? item.itemClass;
    const count = byType.get(type) ?? 0;
    total += item.value * diminishingMultiplier(item, count);
    byType.set(type, count + 1);
  }

  return total;
}

function estimateEntriesScore(entries) {
  return entries.reduce((total, entry) => total + entry.score, 0);
}

function surfaceSummary(entries) {
  return entries.reduce((summary, entry) => ({
    capacity: summary.capacity + surfaceUnitsProvided(entry.item),
    used: summary.used + surfaceUnitsRequired(entry.item),
  }), { capacity: 0, used: 0 });
}

function reconcileSurfacePlacement(groups, constraints = null) {
  const entries = groups.flatMap((group) => group.entries.map((entry) => ({ group, entry })));
  let { capacity, used } = surfaceSummary(entries.map(({ entry }) => entry));
  if (used <= capacity) return;

  const consumers = entries
    .filter(({ entry }) => surfaceUnitsRequired(entry.item) > 0)
    .sort((a, b) => {
      if (Boolean(a.entry.fromOwned) !== Boolean(b.entry.fromOwned)) return a.entry.fromOwned ? 1 : -1;
      return a.entry.score - b.entry.score || byName(a.entry.item, b.entry.item);
    });

  for (const candidate of consumers) {
    if (used <= capacity) break;
    const required = surfaceUnitsRequired(candidate.entry.item);
    const extraFloor = effectiveFloorArea(candidate.entry.item) - floorAreaWhenOnSurface(candidate.entry.item);
    if (
      constraints?.maxFloor != null &&
      ((constraints.usedFloor ?? 0) + extraFloor) > constraints.maxFloor
    ) {
      const index = candidate.group.entries.indexOf(candidate.entry);
      if (index === -1) continue;
      candidate.group.entries.splice(index, 1);
      refundEntryUsage(candidate.entry, constraints);
    } else {
      candidate.entry.placedOnFloor = true;
      candidate.entry.extraFloorFromSurfaceOverflow = extraFloor;
      if (constraints) constraints.usedFloor = (constraints.usedFloor ?? 0) + extraFloor;
    }
    used -= required;
  }
}

function refundEntryUsage(entry, constraints = null) {
  if (!constraints) return;
  constraints.usedFloor = Math.max(0, (constraints.usedFloor ?? 0) - floorAreaWhenOnSurface(entry.item) - (entry.extraFloorFromSurfaceOverflow ?? 0));
  constraints.usedRequiredVolume = Math.max(0, (constraints.usedRequiredVolume ?? 0) - (entry.item.requirements?.requiredRoomVolume ?? 0));
  constraints.surfaceCapacity = Math.max(0, (constraints.surfaceCapacity ?? 0) - surfaceUnitsProvided(entry.item));
  constraints.usedSurface = Math.max(0, (constraints.usedSurface ?? 0) - surfaceUnitsRequired(entry.item));

  if (entry.fromOwned && constraints.ownedUsage?.has(entry.item.itemClass)) {
    const next = Math.max(0, (constraints.ownedUsage.get(entry.item.itemClass) ?? 0) - entry.fromOwned);
    if (next > 0) constraints.ownedUsage.set(entry.item.itemClass, next);
    else constraints.ownedUsage.delete(entry.item.itemClass);
  }

  if (entry.item.diminishingMultiplierAcrossFullProperty != null && constraints.propertyTypeCounts?.has(entry.type)) {
    const next = Math.max(0, (constraints.propertyTypeCounts.get(entry.type) ?? 0) - 1);
    if (next > 0) constraints.propertyTypeCounts.set(entry.type, next);
    else constraints.propertyTypeCounts.delete(entry.type);
  }
}

function applyTierCap(value, tierValue = state.roomTier) {
  const tier = selectedTier(tierValue);
  if (!tier) return value;
  if (value <= tier.softCap) return value;
  const overflow = value - tier.softCap;
  const range = tier.hardCap - tier.softCap;
  if (range <= 0) return tier.hardCap;
  return tier.hardCap - range * (tier.diminishingReturnPercent ** (overflow / range));
}

function tierCapLoss(raw, capped) {
  return Math.max(0, raw - capped);
}

function scoreSummary(groups, tierValue = state.roomTier) {
  const allEntries = groups.flatMap((group) => group.entries);
  const raw = allEntries.reduce((total, entry) => total + (entry.baseScore ?? entry.item.value ?? 0), 0);
  const afterDiminishing = allEntries.reduce((total, entry) => total + (entry.rawScore ?? entry.score), 0);
  const afterSupportCaps = estimateEntriesScore(allEntries);
  const capped = applyTierCap(afterSupportCaps, tierValue);
  const tier = selectedTier(tierValue);
  return {
    raw,
    afterDiminishing,
    afterSupportCaps,
    capped,
    totalRaw: raw,
    totalCapped: capped,
    perResident: capped * occupancyMultiplier(),
    roomMultiplier: 1,
    tier,
    duplicateLoss: Math.max(0, raw - afterDiminishing),
    supportCapLoss: Math.max(0, afterDiminishing - afterSupportCaps),
    capLoss: tierCapLoss(afterSupportCaps, capped),
    capText: tier ? `Tier ${tier.tier}: soft ${tier.softCap}, hard ${tier.hardCap}` : "sans cap",
  };
}

function roomOptimization(roomName = state.room, tierValue = state.roomTier, constraints = null) {
  const optimizationContext = constraints ?? {};
  if (!optimizationContext.ownedUsage) optimizationContext.ownedUsage = new Map();
  const groups = optimizerGroups(roomName, optimizationContext, tierValue);
  const score = scoreSummary(groups, tierValue);
  return {
    roomName,
    tierValue,
    groups,
    score,
    entries: selectedEntries(groups),
  };
}

function selectedEntries(groups) {
  return groups.flatMap((group) => group.entries);
}

function maxRequiredRoomVolume(entries) {
  return entries.reduce((best, entry) => Math.max(best, entry.item.requirements?.requiredRoomVolume ?? 0), 0);
}

function totalRequiredRoomVolume(entries) {
  return entries.reduce((total, entry) => total + (entry.item.requirements?.requiredRoomVolume ?? 0), 0);
}

function maxObjectDimensions(entries) {
  return entries.reduce((max, entry) => {
    const dims = itemOccupancyDimensions(entry.item);
    return {
      width: Math.max(max.width, Math.min(dims.width || 0, dims.depth || 0)),
      depth: Math.max(max.depth, Math.max(dims.width || 0, dims.depth || 0)),
      height: Math.max(max.height, dims.height || 0),
    };
  }, { width: 0, depth: 0, height: 0 });
}

function maxRequiredRoomMaterialTier(entries) {
  return entries.reduce((best, entry) => Math.max(best, entry.item.requirements?.requiredRoomMaterialTier ?? 0), 0);
}

function roomScore(roomName) {
  return roomOptimization(roomName).score.capped;
}

function roomScoreAtTier(roomName, tierValue) {
  return roomOptimization(roomName, tierValue).score.capped;
}

function estimateRoomDimensions(volume, height = normalizedHouseHeight()) {
  const floorArea = Math.max(1, Math.ceil(volume / height));
  const width = Math.max(1, Math.ceil(Math.sqrt(floorArea)));
  const depth = Math.max(1, Math.ceil(floorArea / width));
  return { width, depth, height, floorArea: width * depth };
}

function estimateConstructionMaterialsForRooms(entries, height = normalizedRoomHeight(), count = 1) {
  const volume = totalRequiredRoomVolume(entries);
  if (!volume) return null;
  const dims = estimateRoomDimensions(volume, height);
  const floorAndCeiling = dims.floorArea * 2 * count;
  const wallsPerRoom = (dims.width + dims.depth) * 2 * dims.height;
  const sharedWallsSaved = Math.max(0, count - 1) * dims.depth * dims.height;
  const total = Math.ceil(floorAndCeiling + wallsPerRoom * count - sharedWallsSaved);

  return {
    total,
    available: normalizedConstructionMaterials(),
    volume,
    dims,
    maxTier: maxRequiredRoomMaterialTier(entries),
  };
}

function constructionSummary(groups) {
  const estimate = estimateConstructionMaterialsForRooms(selectedEntries(groups), normalizedRoomHeight());
  if (!estimate) return "";
  const status = estimate.total <= estimate.available ? "OK" : "manque";
  const tierText = estimate.maxTier > 2 ? `, tier requis ${estimate.maxTier}` : "";
  return ` | construction T2: ~${estimate.total}/${estimate.available} blocs (${status}, ${estimate.dims.width}x${estimate.dims.depth}x${estimate.dims.height}${tierText})`;
}

function roomDuplicateRate() {
  return state.data.housingConfig.roomCategoryDiminishingReturnRate ?? 0.1;
}

function roomDuplicateMultiplier(roomIndex) {
  if (roomIndex <= 0) return 1;
  const effectiveRepeats = roomIndex / normalizedResidentCount();
  return Math.max(0, 1 - roomDuplicateRate() * effectiveRepeats);
}

function occupancyMultiplier() {
  const residents = normalizedResidentCount();
  if (residents <= 1) return 1;
  const values = state.data.housingConfig.housePointsMultiplierPerResidentsCount ?? [];
  const factor = values[Math.min(residents, values.length - 1)] ?? 1;
  return (1 / residents) * factor;
}

function bestItemsWithDiminishingReturns(items, limit, maxScore = null, constraints = null) {
  const entries = [];
  const byType = new Map();
  const byItem = new Map();
  if (constraints && !constraints.propertyTypeCounts) constraints.propertyTypeCounts = new Map();
  let total = 0;

  while (entries.length < limit) {
    const remaining = maxScore == null ? Infinity : maxScore - total;
    if (remaining <= 0.01) break;

    let best = null;
    for (const item of items) {
      const floorArea = floorAreaWhenOnSurface(item);
      const requiredVolume = item.requirements?.requiredRoomVolume ?? 0;
      if (!itemFitsRoomDimensions(item, constraints)) continue;
      if (constraints?.maxVolume != null && ((constraints.usedRequiredVolume ?? 0) + requiredVolume) > constraints.maxVolume) continue;
      if (constraints?.maxFloor != null && ((constraints.usedFloor ?? 0) + floorArea) > constraints.maxFloor) continue;

      const type = item.typeForRoomLimit ?? item.itemClass;
      const propertyWide = item.diminishingMultiplierAcrossFullProperty != null;
      const roomTypeCount = byType.get(type) ?? 0;
      const propertyTypeCount = constraints?.propertyTypeCounts?.get(type) ?? 0;
      const typeCount = propertyWide ? propertyTypeCount : roomTypeCount;
      const multiplier = propertyWide
        ? item.diminishingMultiplierAcrossFullProperty ** typeCount
        : diminishingMultiplier(item, typeCount);
      const score = item.value * multiplier;
      if (score <= 0) continue;
      const ownedAvailable = ownedRemaining(item.itemClass, constraints) > 0;
      if (
        !best ||
        (ownedAvailable && !best.ownedAvailable) ||
        (ownedAvailable === best.ownedAvailable && (score > best.score || (score === best.score && byName(item, best.item) < 0)))
      ) {
        best = { item, type, typeCount, multiplier, score, ownedAvailable };
      }
    }
    if (!best || best.score < 0.05) break;

    const creditedScore = Math.min(best.score, remaining);
    if (!best.ownedAvailable && creditedScore < MIN_NON_OWNED_CREDITED_SCORE) break;
    const floorArea = floorAreaWhenOnSurface(best.item);
    const fromOwned = markOwnedUsed(best.item.itemClass, constraints);
    entries.push({
      item: best.item,
      type: best.type,
      itemCount: (byItem.get(best.item.itemClass) ?? 0) + 1,
      typeCount: best.typeCount + 1,
      multiplier: best.multiplier,
      baseScore: best.item.value,
      rawScore: best.score,
      score: creditedScore,
      capped: creditedScore < best.score,
      supportCapLoss: Math.max(0, best.score - creditedScore),
      fromOwned,
    });
    total += creditedScore;
    if (constraints) constraints.usedFloor = (constraints.usedFloor ?? 0) + floorArea;
    if (constraints) constraints.usedRequiredVolume = (constraints.usedRequiredVolume ?? 0) + (best.item.requirements?.requiredRoomVolume ?? 0);
    if (constraints) constraints.surfaceCapacity = (constraints.surfaceCapacity ?? 0) + surfaceUnitsProvided(best.item);
    if (constraints) constraints.usedSurface = (constraints.usedSurface ?? 0) + surfaceUnitsRequired(best.item);
    byType.set(best.type, best.typeCount + 1);
    if (best.item.diminishingMultiplierAcrossFullProperty != null && constraints?.propertyTypeCounts) {
      constraints.propertyTypeCounts.set(best.type, best.typeCount + 1);
    }
    byItem.set(best.item.itemClass, (byItem.get(best.item.itemClass) ?? 0) + 1);
  }

  return entries;
}

function normalizedRoomWidth() {
  return Math.max(1, Math.min(20, Number.parseInt(state.roomWidth, 10) || 1));
}

function normalizedRoomDepth() {
  return Math.max(1, Math.min(20, Number.parseInt(state.roomDepth, 10) || 1));
}

function normalizedRoomHeight() {
  return Math.max(2, Math.min(8, Number.parseInt(state.roomHeight, 10) || 3));
}

function normalizedHouseHeight() {
  return Math.max(2, Math.min(8, Number.parseInt(state.houseHeight, 10) || 3));
}

function roomFloorArea() {
  return normalizedRoomWidth() * normalizedRoomDepth();
}

function roomVolume() {
  return roomFloorArea() * normalizedRoomHeight();
}

function selectedRoomConstraints() {
  return {
    maxWidth: normalizedRoomWidth(),
    maxDepth: normalizedRoomDepth(),
    maxHeight: normalizedRoomHeight(),
    maxFloor: roomFloorArea(),
    maxVolume: roomVolume(),
    usedFloor: 0,
    usedRequiredVolume: 0,
    ownedUsage: new Map(),
  };
}

function normalizedResidentCount() {
  return Math.max(1, Math.min(12, Number.parseInt(state.residentCount, 10) || 1));
}

function normalizedConstructionMaterials() {
  return Math.max(0, Math.min(5000, Number.parseInt(state.constructionMaterials, 10) || 0));
}

function normalizedMaterialStock(tier) {
  return Math.max(0, Math.min(5000, Number.parseInt(state.materialStocks[tier], 10) || 0));
}

function materialTierForRequirement(requiredTier) {
  const needed = Math.max(0, Math.ceil(requiredTier ?? state.roomTier ?? 0));
  for (let tier = needed; tier <= 5; tier += 1) {
    if (normalizedMaterialStock(tier) > 0) return tier;
  }
  return needed;
}

function totalMaterialStock() {
  return Object.keys(state.materialStocks).reduce((total, tier) => total + normalizedMaterialStock(tier), 0);
}

function summarizeEntries(entries) {
  const byItem = new Map();
  for (const entry of entries) {
    const current = byItem.get(entry.item.itemClass) ?? {
      item: entry.item,
      quantityPerRoom: 0,
      score: 0,
      rawScore: 0,
      multipliers: [],
      capped: false,
      fromOwned: 0,
      placedOnFloor: false,
    };
    current.quantityPerRoom += 1;
    current.score += entry.score;
    current.rawScore += entry.rawScore ?? entry.score;
    current.multipliers.push(entry.multiplier);
    current.capped = current.capped || entry.capped;
    current.placedOnFloor = current.placedOnFloor || entry.placedOnFloor;
    if (entry.fromOwned) current.fromOwned += 1;
    byItem.set(entry.item.itemClass, current);
  }

  return [...byItem.values()].sort((a, b) => b.score - a.score || byName(a.item, b.item));
}

function formatReturnRange(summary) {
  const reduced = summary.multipliers.filter((value) => value < 1);
  if (!reduced.length) return "";
  const last = reduced.at(-1);
  return `<span class="pill">dernier: ${Math.round(last * 100)}%</span>`;
}

function formatSupportCap(group) {
  if (group.supportCap == null) return "";
  return `<span class="support-cap">plafond ${Math.round(group.supportCapPercent * 100)}%: ${group.supportCap.toFixed(1)}</span>`;
}

function estimateObjectFloor(entries) {
  return entries.reduce((total, entry) => total + floorAreaWhenOnSurface(entry.item) + (entry.extraFloorFromSurfaceOverflow ?? 0), 0);
}

function renderRoomFitSummary(groups) {
  if (!els.roomFitSummary) return;
  if (state.room === "all") {
    els.roomFitSummary.innerHTML = "";
    return;
  }

  const entries = selectedEntries(groups);
  const usedFloor = estimateObjectFloor(entries);
  const floor = roomFloorArea();
  const volume = roomVolume();
  const requiredVolume = totalRequiredRoomVolume(entries);
  const surface = surfaceSummary(entries);
  const floorClass = usedFloor > floor ? "bad" : "good";
  const volumeClass = requiredVolume > volume ? "bad" : "good";
  const surfaceClass = surface.used > surface.capacity ? "bad" : "good";
  els.roomFitSummary.innerHTML = `
    <div><strong>${normalizedRoomWidth()}x${normalizedRoomDepth()}x${normalizedRoomHeight()}</strong><span>taille piece</span></div>
    <div class="${floorClass}"><strong>${usedFloor}/${floor}</strong><span>sol objets</span></div>
    <div class="${volumeClass}"><strong>${requiredVolume}/${volume}</strong><span>m3 requis objets / m3 piece</span></div>
    <div class="${surfaceClass}"><strong>${surface.used}/${surface.capacity}</strong><span>surface posee / disponible</span></div>
  `;
}

function formatScoreDetails(score) {
  return `
    <div class="calc-trace">
      <span>brut objets <strong>${score.raw.toFixed(2)}</strong></span>
      <span>apres doublons <strong>${score.afterDiminishing.toFixed(2)}</strong>${score.duplicateLoss > 0.01 ? ` (-${score.duplicateLoss.toFixed(2)})` : ""}</span>
      <span>apres caps supports <strong>${score.afterSupportCaps.toFixed(2)}</strong>${score.supportCapLoss > 0.01 ? ` (-${score.supportCapLoss.toFixed(2)})` : ""}</span>
      <span>apres tier <strong>${score.capped.toFixed(2)}</strong>${score.capLoss > 0.01 ? ` (-${score.capLoss.toFixed(2)})` : ""}</span>
    </div>
  `;
}

function renderOptimizer() {
  els.optimizerGroups.innerHTML = "";

  if (state.room === "all") {
    els.optimizerHint.textContent = "choisis une piece";
    els.roomTotalScore.innerHTML = "";
    els.roomFitSummary.innerHTML = "";
    els.optimizerGroups.innerHTML = `<div class="empty">Choisis une piece a optimiser pour voir une proposition groupee.</div>`;
    return;
  }

  const optimization = roomOptimization(state.room, state.roomTier, selectedRoomConstraints());
  const groups = optimization.groups;
  renderRoomFitSummary(groups);
  const score = optimization.score;
  els.optimizerHint.textContent = `${formatRoomHint()}${constructionSummary(groups)}`;
  els.roomTotalScore.innerHTML = `
    <div>
      <span>Total utile de la piece</span>
      <strong>${score.capped.toFixed(1)}</strong>
      <small>${score.raw.toFixed(1)} brut | ${score.afterSupportCaps.toFixed(1)} avant tier</small>
      ${formatScoreDetails(score)}
    </div>
    <div>
      <span>Tier actif</span>
      <strong>T${score.tier?.tier ?? "?"}</strong>
      <small>soft ${score.tier?.softCap ?? "?"} | hard ${score.tier?.hardCap ?? "?"} | retour ${score.tier ? Math.round(score.tier.diminishingReturnPercent * 100) : "?"}%</small>
    </div>
  `;

  for (const group of groups) {
    const section = document.createElement("article");
    section.className = "opt-group";
    section.innerHTML = `
      <div class="opt-title">
        <div>
          <span class="category">${group.category}</span>
          <h4>${group.role}</h4>
          ${formatSupportCap(group)}
        </div>
        <strong>${group.score.toFixed(1)}</strong>
      </div>
      <div class="opt-items"></div>
    `;

    const itemWrap = section.querySelector(".opt-items");
    if (!group.entries.length) {
      itemWrap.innerHTML = `<div class="muted">Aucun item avec ces filtres.</div>`;
    } else {
      for (const summary of summarizeEntries(group.entries)) {
        const item = summary.item;
        const row = document.createElement("div");
        row.className = "opt-item";
        row.innerHTML = `
          <span>${item.friendlyName} <small>x${summary.quantityPerRoom}</small></span>
          <div class="pill-row">
            <span class="pill">+${summary.score.toFixed(2)} XP / piece</span>
            ${summary.rawScore - summary.score > 0.01 ? `<span class="pill locked">cap -${(summary.rawScore - summary.score).toFixed(2)}</span>` : ""}
            ${summary.fromOwned ? `<span class="pill">acquis x${summary.fromOwned}</span>` : ""}
            ${summary.capped ? `<span class="pill locked">plafonné</span>` : ""}
            ${formatReturnRange(summary)}
            ${item.hasDynamicFurnishingValue ? `<span class="pill locked">valeur dynamique</span>` : ""}
            <span class="pill">${item.typeForRoomLimit ?? "General"}</span>
            <span class="pill">${formatFootprint(item)}</span>
            ${surfacePlacementKind(item) ? `<span class="pill">${surfacePlacementKind(item)}</span>` : ""}
            ${summary.placedOnFloor ? `<span class="pill locked">pose au sol</span>` : ""}
            ${surfaceUnitsProvided(item) ? `<span class="pill">surface +${surfaceUnitsProvided(item)}</span>` : ""}
            ${surfaceUnitsRequired(item) ? `<span class="pill">surface -${surfaceUnitsRequired(item)}</span>` : ""}
            ${itemFootprint(item).estimated ? `<span class="pill locked">empreinte estimee</span>` : ""}
            ${item.requirements?.requiredRoomVolume != null ? `<span class="pill">m3 requis ${item.requirements.requiredRoomVolume}</span>` : ""}
            ${item.requirements?.requiredRoomMaterialTier != null ? `<span class="pill">T${item.requirements.requiredRoomMaterialTier}</span>` : ""}
            <span class="pill ${isAvailable(item) ? "" : "locked"}">${availabilityLabel(item)}</span>
          </div>
        `;
        itemWrap.append(row);
      }
    }

    els.optimizerGroups.append(section);
  }
}

function roomCountForHouse(roomName) {
  return Math.max(0, Math.min(20, Number.parseInt(state.houseRoomCounts[roomName], 10) || 0));
}

function entriesForRoom(roomName) {
  return optimizerGroups(roomName).flatMap((group) => group.entries);
}

function cloneOptimizationContext(context) {
  if (!context) return { ownedUsage: new Map(), propertyTypeCounts: new Map() };
  return {
    ...context,
    ownedUsage: new Map(context.ownedUsage ?? []),
    propertyTypeCounts: new Map(context.propertyTypeCounts ?? []),
  };
}

function roomSpec(roomName, optimizationContext = null, tierValue = state.roomTier) {
  const context = optimizationContext ?? cloneOptimizationContext(null);
  if (context.maxHeight == null) context.maxHeight = normalizedHouseHeight();
  const optimization = roomOptimization(roomName, tierValue, context);
  const entries = optimization.entries;
  const objectFloor = estimateObjectFloor(entries);
  const objectDims = maxObjectDimensions(entries);
  const requiredTier = maxRequiredRoomMaterialTier(entries);
  const volume = Math.max(totalRequiredRoomVolume(entries), normalizedHouseHeight() * 4);
  const minFloor = Math.max(Math.ceil(volume / normalizedHouseHeight()), Math.ceil(objectFloor * 1.35), 4);
  const width = Math.max(2, objectDims.width, Math.ceil(Math.sqrt(minFloor)));
  const depth = Math.max(2, objectDims.depth, Math.ceil(minFloor / width));

  return {
    name: roomName,
    width,
    depth,
    height: normalizedHouseHeight(),
    floorArea: width * depth,
    objectFloor,
    objectDims,
    volume,
    score: optimization.score.capped,
    requiredTier,
    entries,
    groups: optimization.groups,
    scoreBreakdown: optimization.score,
  };
}

function estimateRoomConstruction(spec, index) {
  const width = spec.width;
  const depth = spec.depth;
  const height = spec.height;
  const floorArea = width * depth;
  const floorAndCeiling = floorArea * 2;
  const wallsPerRoom = (width + depth) * 2 * height;
  const sharedWallSaved = index > 0 ? Math.min(width, depth) * height : 0;
  return Math.ceil(floorAndCeiling + wallsPerRoom - sharedWallSaved);
}

function roomEfficiencyScore(room, candidateIndex) {
  const duplicate = roomDuplicateMultiplier(candidateIndex);
  const tierScore = room.scoreAtTier ?? room.score;
  return (tierScore * duplicate) / Math.max(1, estimateRoomConstruction(room, candidateIndex));
}

function minimumUsefulRooms() {
  const bedroomCount = Math.max(1, Math.ceil(normalizedResidentCount() / 2));
  return [
    ...Array.from({ length: bedroomCount }, () => "Bedroom"),
    "Kitchen",
    "Bathroom",
    "Living Room",
  ];
}

function roomCandidateOrder() {
  const base = minimumUsefulRooms();
  const extras = playableRooms().map((room) => room.name);
  return [...base, ...extras, ...extras, ...extras, ...extras];
}

function calculatedHousePlan() {
  const rooms = [];
  const stocks = new Map(Object.keys(state.materialStocks).map((tier) => [Number(tier), normalizedMaterialStock(tier)]));
  const optimizationContext = { ownedUsage: new Map(), propertyTypeCounts: new Map(), maxHeight: normalizedHouseHeight() };

  for (const roomName of minimumUsefulRooms()) {
    if (!selectedRoom(roomName)) continue;
    const previewSpec = roomSpec(roomName, cloneOptimizationContext(optimizationContext));
    const previewCost = estimateRoomConstruction(previewSpec, rooms.length);
    const tier = materialTierForRequirement(previewSpec.requiredTier);
    const previewTierSpec = roomSpec(roomName, cloneOptimizationContext(optimizationContext), tier);
    const previewScoreAtTier = previewTierSpec.score;
    const available = stocks.get(tier) ?? 0;
    if (available < previewCost || previewScoreAtTier <= 0) continue;
    const spec = roomSpec(roomName, optimizationContext, tier);
    const cost = estimateRoomConstruction(spec, rooms.length);
    const scoreAtTier = spec.score;
    const sameTypeCount = rooms.filter((room) => room.name === roomName).length + 1;
    rooms.push({ ...spec, scoreAtTier, cost, index: sameTypeCount, materialTier: tier, creditedScore: scoreAtTier * roomDuplicateMultiplier(sameTypeCount - 1) });
    stocks.set(tier, available - cost);
  }

  while (rooms.length < 24) {
    const candidates = playableRooms()
      .map((room) => {
        const spec = roomSpec(room.name, cloneOptimizationContext(optimizationContext));
        const sameTypeCount = rooms.filter((current) => current.name === room.name).length + 1;
        const cost = estimateRoomConstruction(spec, rooms.length);
        const tier = materialTierForRequirement(spec.requiredTier);
        const tierSpec = roomSpec(room.name, cloneOptimizationContext(optimizationContext), tier);
        const scoreAtTier = tierSpec.score;
        const available = stocks.get(tier) ?? 0;
        return { ...tierSpec, scoreAtTier, cost, index: sameTypeCount, materialTier: tier, affordable: available >= cost && scoreAtTier > 0 };
      })
      .filter((room) => room.affordable)
      .sort((a, b) => roomEfficiencyScore(b, b.index - 1) - roomEfficiencyScore(a, a.index - 1));

    const best = candidates[0];
    if (!best) break;
    const available = stocks.get(best.materialTier) ?? 0;
    const committedSpec = roomSpec(best.name, optimizationContext, best.materialTier);
    stocks.set(best.materialTier, available - best.cost);
    rooms.push({ ...best, ...committedSpec, creditedScore: committedSpec.score * roomDuplicateMultiplier(best.index - 1) });
  }

  const counts = new Map();
  for (const room of rooms) counts.set(room.name, (counts.get(room.name) ?? 0) + 1);
  const usedByTier = new Map(Object.keys(state.materialStocks).map((tier) => {
    const numericTier = Number(tier);
    return [numericTier, normalizedMaterialStock(numericTier) - (stocks.get(numericTier) ?? 0)];
  }));
  return applyRestOfPropertyCaps({ rooms, counts, usedByTier, remainingByTier: stocks });
}

function applyRestOfPropertyCaps(plan) {
  const rooms = plan.rooms.map((room) => ({ ...room }));

  for (const room of rooms) {
    const category = state.data.roomCategoryByName.get(room.name);
    const capPercent = category?.capToPercentOfRestOfProperty;
    if (capPercent == null) continue;
    const restValue = rooms
      .filter((other) => other !== room && other.name !== room.name)
      .reduce((total, other) => total + other.creditedScore, 0);
    const cap = restValue * capPercent;
    if (room.creditedScore > cap) {
      room.uncappedScore = room.creditedScore;
      room.creditedScore = cap;
      room.restPropertyCapPercent = capPercent;
    }
  }

  const filteredRooms = rooms.filter((room) => room.creditedScore > 0.01);
  const counts = new Map();
  for (const room of filteredRooms) counts.set(room.name, (counts.get(room.name) ?? 0) + 1);
  const usedByTier = new Map(Object.keys(state.materialStocks).map((tier) => [Number(tier), 0]));
  for (const room of filteredRooms) {
    usedByTier.set(room.materialTier, (usedByTier.get(room.materialTier) ?? 0) + room.cost);
  }
  const remainingByTier = new Map(Object.keys(state.materialStocks).map((tier) => {
    const numericTier = Number(tier);
    return [numericTier, normalizedMaterialStock(numericTier) - (usedByTier.get(numericTier) ?? 0)];
  }));
  return { ...plan, rooms: filteredRooms, counts, usedByTier, remainingByTier };
}

function renderHouseRoomCounts(plan = calculatedHousePlan()) {
  if (!plan.rooms.length) {
    els.houseRoomCounts.innerHTML = `<div class="empty">Pas assez de materiaux pour une piece utile.</div>`;
    return;
  }

  els.houseRoomCounts.innerHTML = [...plan.counts.entries()].map(([name, count]) => {
    const spec = plan.rooms.find((room) => room.name === name);
    return `
      <div class="calc-room-row">
        <div>
          <strong>${name}</strong>
          <span>${spec.width}x${spec.depth}x${spec.height} | T${spec.materialTier} | ${spec.creditedScore.toFixed(1)} pts/piece</span>
        </div>
        <b>x${count}</b>
      </div>
    `;
  }).join("");
}

function houseRooms(plan = calculatedHousePlan()) {
  return plan.rooms;
}

function houseShoppingList() {
  const byItem = new Map();
  const plan = calculatedHousePlan();
  for (const room of plan.rooms) {
    for (const group of room.groups ?? []) {
      for (const summary of summarizeEntries(group.entries)) {
        const current = byItem.get(summary.item.itemClass) ?? {
          item: summary.item,
          quantity: 0,
          owned: ownedItemQuantity(summary.item.itemClass),
          score: 0,
        };
        current.quantity += summary.quantityPerRoom;
        current.score += summary.score;
        current.toCraft = Math.max(0, current.quantity - current.owned);
        byItem.set(summary.item.itemClass, current);
      }
    }
  }
  return [...byItem.values()].sort((a, b) => b.toCraft - a.toCraft || b.score - a.score || byName(a.item, b.item));
}

function roomObjectDetails(room) {
  return (room.groups ?? roomOptimization(room.name, room.materialTier).groups)
    .flatMap((group) => summarizeEntries(group.entries).map((summary) => ({ group, summary })))
    .map(({ group, summary }) => `
      <div class="room-object-row">
        <span>${summary.item.friendlyName}</span>
        <small>${group.category} | x${summary.quantityPerRoom}${ownedItemQuantity(summary.item.itemClass) ? ` | acquis x${ownedItemQuantity(summary.item.itemClass)}` : ""}</small>
      </div>
    `).join("");
}

function renderHousePlanner() {
  const plan = calculatedHousePlan();
  const rooms = houseRooms(plan);
  renderHouseRoomCounts(plan);
  const totalScore = rooms.reduce((total, room) => total + room.creditedScore, 0);
  const materialText = [...plan.usedByTier.entries()]
    .filter(([, used]) => used > 0)
    .map(([tier, used]) => `T${tier} ${used}/${normalizedMaterialStock(tier)}`)
    .join(", ") || "aucun bloc";
  els.houseHint.textContent = `${rooms.length} pieces | ${totalScore.toFixed(1)} pts avant resident | ${materialText}`;

  if (!rooms.length) {
    els.housePlan.innerHTML = `<div class="empty">Ajoute au moins une piece.</div>`;
  } else {
    els.housePlan.innerHTML = rooms.map((room) => `
      <div class="plan-room">
        <strong>${room.name}</strong>
        <span>#${room.index} | ${room.width}x${room.depth} | T${room.materialTier} ${room.cost} blocs | ${room.creditedScore.toFixed(1)} pts${room.restPropertyCapPercent != null ? " | cap propriete" : ""}</span>
      </div>
    `).join("");
  }

  const shopping = houseShoppingList();
  if (!shopping.length) {
    els.houseShoppingList.innerHTML = `<div class="empty">Aucun objet propose avec les filtres actuels.</div>`;
    return;
  }

  els.houseShoppingList.innerHTML = shopping.slice(0, 28).map((entry) => `
    <div class="shopping-row">
      <span>${entry.item.friendlyName}<small>besoin x${entry.quantity}${entry.owned ? ` | acquis x${Math.min(entry.owned, entry.quantity)}` : ""}</small></span>
      <strong>${entry.toCraft > 0 ? `x${entry.toCraft}` : "OK"}</strong>
    </div>
  `).join("");

  els.houseRoomDetails.innerHTML = rooms.map((room) => `
    <article class="room-detail">
      <div class="room-detail-head">
        <div>
          <h4>${room.name} #${room.index}</h4>
          <span>${room.width}x${room.depth}x${room.height} | T${room.materialTier} | sol objets ${room.objectFloor}/${room.floorArea} | surface ${surfaceSummary(room.entries).used}/${surfaceSummary(room.entries).capacity}${room.restPropertyCapPercent != null ? ` | cap ${Math.round(room.restPropertyCapPercent * 100)}% du reste` : ""}</span>
        </div>
        <strong>${room.creditedScore.toFixed(1)}</strong>
      </div>
      <div class="room-object-list">${roomObjectDetails(room)}</div>
    </article>
  `).join("");
}

function renderDataCards() {
  els.dataHint.textContent = `${state.data.meta.fileCount} fichiers lus`;
  const config = state.data.housingConfig ?? {};
  const dynamicCount = state.data.housing.filter((item) => item.hasDynamicFurnishingValue).length;
  els.dataCards.innerHTML = `
    <article class="data-card"><span>Objets housing utiles</span><strong>${state.data.housingItems.length}</strong></article>
    <article class="data-card"><span>Recettes</span><strong>${state.data.recipes.length}</strong></article>
    <article class="data-card"><span>Occupations objet</span><strong>${state.data.occupancy?.length ?? 0}</strong></article>
    <article class="data-card"><span>Categories piece</span><strong>${state.data.roomCategories.length}</strong></article>
    <article class="data-card"><span>Valeurs dynamiques</span><strong>${dynamicCount}</strong></article>
    <article class="data-card"><span>Rendement doublons piece</span><strong>${config.roomCategoryDiminishingReturnRate ?? "?"}</strong></article>
    <article class="data-card"><span>Tiers maison</span><strong>${state.data.roomTiers.length}</strong></article>
  `;
  els.dataLists.innerHTML = `
    <section class="data-list">
      <h4>Categories de pieces</h4>
      ${state.data.roomCategories.map((room) => `
        <div class="data-row">
          <span>${room.name}</span>
          <small>${room.canBeRoomCategory ? "piece" : "support"}${room.maxSupportPercentOfPrimary != null ? ` | support ${Math.round(room.maxSupportPercentOfPrimary * 100)}%` : ""}${Object.keys(room.maxSupportPercentOfPrimaryPerCategory ?? {}).length ? ` | exceptions ${Object.entries(room.maxSupportPercentOfPrimaryPerCategory).map(([name, value]) => `${name} ${Math.round(value * 100)}%`).join(", ")}` : ""}${room.capToPercentOfRestOfProperty != null ? ` | propriete ${Math.round(room.capToPercentOfRestOfProperty * 100)}%` : ""}</small>
        </div>
      `).join("")}
    </section>
    <section class="data-list">
      <h4>Tiers de maison</h4>
      ${state.data.roomTiers.map((tier) => `
        <div class="data-row">
          <span>Tier ${tier.tier}</span>
          <small>soft ${tier.softCap} | hard ${tier.hardCap} | retour ${Math.round(tier.diminishingReturnPercent * 100)}%</small>
        </div>
      `).join("")}
    </section>
    <section class="data-list">
      <h4>Regles config serveur</h4>
      <div class="data-row"><span>Doublons de piece</span><small>${config.roomCategoryDiminishingReturnRate ?? "?"}</small></div>
      <div class="data-row"><span>Multiplicateurs residents</span><small>${(config.housePointsMultiplierPerResidentsCount ?? []).join(", ")}</small></div>
    </section>
  `;
}

function renderViews() {
  for (const tab of els.viewTabs) {
    tab.classList.toggle("active", tab.dataset.viewTarget === state.activeView);
  }
  for (const view of els.views) {
    view.classList.toggle("active", view.dataset.view === state.activeView);
  }
  for (const panel of els.sidePanels) {
    const views = panel.dataset.sidePanel.split(/\s+/);
    panel.classList.toggle("active", views.includes(state.activeView));
  }
  const titles = {
    house: "Optimiser une maison",
    room: "Optimiser une piece",
    objects: "Objets disponibles",
    data: "Regles extraites",
  };
  els.viewTitle.textContent = titles[state.activeView] ?? "Eco Housing";
}

function renderStats(items) {
  els.housingCount.textContent = state.data.housingItems.length;
  els.visibleCount.textContent = items.length;
  els.skillCount.textContent = state.selectedSkills.size;
}

function render() {
  state.craftCache = new Map();
  saveAppConfig();
  const items = filteredItems();
  renderViews();
  renderRoomControls();
  renderAuthorizationButtons();
  renderOwnedButtons();
  renderAuthorizationModal();
  renderOwnedModal();
  renderStats(items);
  renderOptimizer();
  renderHousePlanner();
  renderDataCards();
  renderTable(items);
}

async function init() {
  const response = await fetch("./eco-data.json");
  if (!response.ok) throw new Error("Impossible de charger eco-data.json");
  state.data = buildModel(await response.json());
  loadAppConfig();
  loadOwnedItems();

  renderRooms();
  renderTiers();
  renderCategories();
  renderSkills();
  renderMaterialInputs();
  render();

  for (const tab of els.viewTabs) {
    tab.addEventListener("click", () => {
      state.activeView = tab.dataset.viewTarget;
      render();
    });
  }
  els.searchInput.addEventListener("input", () => {
    state.search = els.searchInput.value;
    render();
  });
  els.roomSelect.addEventListener("change", () => {
    state.room = els.roomSelect.value;
    render();
  });
  els.roomWidthInput.addEventListener("input", () => {
    state.roomWidth = Number.parseInt(els.roomWidthInput.value, 10) || 1;
    state.roomWidth = normalizedRoomWidth();
    els.roomWidthInput.value = String(state.roomWidth);
    render();
  });
  els.roomDepthInput.addEventListener("input", () => {
    state.roomDepth = Number.parseInt(els.roomDepthInput.value, 10) || 1;
    state.roomDepth = normalizedRoomDepth();
    els.roomDepthInput.value = String(state.roomDepth);
    render();
  });
  els.roomHeightInput.addEventListener("input", () => {
    state.roomHeight = Number.parseInt(els.roomHeightInput.value, 10) || 3;
    state.roomHeight = normalizedRoomHeight();
    els.roomHeightInput.value = String(state.roomHeight);
    render();
  });
  els.houseHeightInput.addEventListener("input", () => {
    state.houseHeight = Number.parseInt(els.houseHeightInput.value, 10) || 3;
    state.houseHeight = normalizedHouseHeight();
    els.houseHeightInput.value = String(state.houseHeight);
    render();
  });
  els.residentCountInput.addEventListener("input", () => {
    state.residentCount = Number.parseInt(els.residentCountInput.value, 10) || 1;
    state.residentCount = normalizedResidentCount();
    els.residentCountInput.value = String(state.residentCount);
    render();
  });
  els.tierSelect.addEventListener("change", () => {
    state.roomTier = Number(els.tierSelect.value);
    renderTierHelp();
    render();
  });
  els.roomTierButtons.addEventListener("click", (event) => {
    const button = event.target.closest(".tier-button");
    if (!button) return;
    state.roomTier = Number(button.dataset.tier);
    renderTierHelp();
    render();
  });
  els.roomTypeBar.addEventListener("click", (event) => {
    const button = event.target.closest(".room-type-button");
    if (!button) return;
    state.room = button.dataset.room;
    render();
  });
  els.tierHelpButton.addEventListener("click", () => {
    els.tierHelp.classList.toggle("visible");
  });
  els.categorySelect.addEventListener("change", () => {
    state.category = els.categorySelect.value;
    render();
  });
  els.availabilitySelect.addEventListener("change", () => {
    state.availability = els.availabilitySelect.value;
    render();
  });
  for (const button of els.authorizationOpen) {
    button.addEventListener("click", openAuthorizationModal);
  }
  els.authorizationClose.addEventListener("click", closeAuthorizationModal);
  els.authorizationModal.addEventListener("click", (event) => {
    if (event.target === els.authorizationModal) closeAuthorizationModal();
  });
  els.authorizationSearch.addEventListener("input", () => {
    state.authorizationSearch = els.authorizationSearch.value;
    renderAuthorizationModal();
  });
  els.authorizationAllowAll.addEventListener("click", () => {
    state.disabledOptimizationItems.clear();
    render();
  });
  els.authorizationCategories.addEventListener("click", (event) => {
    const button = event.target.closest("[data-auth-category-filter]");
    if (!button) return;
    state.authorizationCategory = button.dataset.authCategoryFilter;
    renderAuthorizationModal();
  });
  els.authorizationItems.addEventListener("change", (event) => {
    const input = event.target.closest("[data-auth-item]");
    if (!input) return;
    if (input.checked) state.disabledOptimizationItems.delete(input.dataset.authItem);
    else state.disabledOptimizationItems.add(input.dataset.authItem);
    render();
  });
  for (const button of els.ownedOpen) {
    button.addEventListener("click", openOwnedModal);
  }
  els.ownedClose.addEventListener("click", closeOwnedModal);
  els.ownedModal.addEventListener("click", (event) => {
    if (event.target === els.ownedModal) closeOwnedModal();
  });
  els.ownedSearch.addEventListener("input", () => {
    state.ownedSearch = els.ownedSearch.value;
    renderOwnedModal();
  });
  els.ownedClear.addEventListener("click", () => {
    state.ownedItems.clear();
    saveOwnedItems();
    render();
  });
  els.ownedCategories.addEventListener("click", (event) => {
    const button = event.target.closest("[data-owned-category-filter]");
    if (!button) return;
    state.ownedCategory = button.dataset.ownedCategoryFilter;
    renderOwnedModal();
  });
  els.ownedItems.addEventListener("input", (event) => {
    const input = event.target.closest("[data-owned-item]");
    if (!input) return;
    const quantity = Math.max(0, Math.min(999, Number.parseInt(input.value, 10) || 0));
    input.value = String(quantity);
    if (quantity > 0) state.ownedItems.set(input.dataset.ownedItem, quantity);
    else state.ownedItems.delete(input.dataset.ownedItem);
    saveOwnedItems();
    render();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!els.authorizationModal.hidden) closeAuthorizationModal();
    if (!els.ownedModal.hidden) closeOwnedModal();
  });
  els.selectAllSkills.addEventListener("click", () => {
    for (const skill of selectableSkills()) state.selectedSkills.add(skill.className);
    renderSkills();
    render();
  });
  els.clearSkills.addEventListener("click", () => {
    state.selectedSkills.clear();
    renderSkills();
    render();
  });
}

init().catch((error) => {
  document.body.innerHTML = `<main class="app"><div class="empty">${error.message}</div></main>`;
});

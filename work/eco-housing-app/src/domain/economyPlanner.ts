import { createCostResolver, effectiveListingUnitCost } from "./costResolver";
import type { EcoModel, EconomyAnalysis, EconomyCategoryAnalysis, EconomyCheaperAlternative, EconomyMarketGap, EconomyObjectiveKind, EconomyPurchaseItem, EconomyPurchaseSource, EconomyRejectedItem, EconomyRejectionReason, EconomyStockUse, EconomySummary, EcoEconomyData, HousingItem, ItemClass, OptimizationEntry, SkillClass } from "./types";

export interface EconomyPlanInput {
  enabled?: boolean;
  economyData?: EcoEconomyData | null;
  selectedSkills: Set<SkillClass>;
  ownedItems: Map<ItemClass, number>;
  budget?: number | null;
  currency?: string | null;
  objective?: EconomyObjectiveKind;
  candidates?: HousingItem[];
}

export function isEconomyEnabled(input: EconomyPlanInput) {
  return Boolean(input.enabled && input.economyData);
}

export function summarizeEntryEconomy(model: EcoModel, input: EconomyPlanInput, entries: OptimizationEntry[], score: number): EconomySummary | null {
  if (!isEconomyEnabled(input)) return null;
  const itemCounts = new Map<ItemClass, number>();
  const itemScores = new Map<ItemClass, number>();
  for (const entry of entries) itemCounts.set(entry.item.itemClass, (itemCounts.get(entry.item.itemClass) ?? 0) + 1);
  for (const entry of entries) itemScores.set(entry.item.itemClass, (itemScores.get(entry.item.itemClass) ?? 0) + entry.score);
  return summarizeItemEconomy(model, input, itemCounts, score, itemScores, input.candidates);
}

export function summarizeItemEconomy(model: EcoModel, input: EconomyPlanInput, itemCounts: Map<ItemClass, number>, score: number, itemScores = new Map<ItemClass, number>(), candidates: HousingItem[] = []): EconomySummary | null {
  if (!isEconomyEnabled(input)) return null;
  const resolver = createCostResolver({
    model,
    economyData: input.economyData,
    selectedSkills: input.selectedSkills,
    ownedItems: input.ownedItems,
    currency: input.currency || null,
  });
  const purchaseList = [...itemCounts.entries()]
    .filter(([, quantity]) => quantity > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([itemClass, quantity]) => {
      const resolved = resolver.resolve(itemClass, quantity);
      const xp = itemScores.get(itemClass) ?? estimateItemXp(model, itemClass, quantity);
      const paidSource = resolved.sources.find((source) => source.kind === "buy" && source.unitCost != null);
      return {
        itemClass,
        quantity,
        availableQuantity: resolved.availableQuantity,
        unitCost: resolved.unitCost,
        totalCost: resolved.totalCost,
        currency: resolved.currency,
        source: resolved.source,
        stockBlocking: resolved.stockBlocking,
        xp,
        xpPerCredit: resolved.totalCost != null && resolved.totalCost > 0 ? xp / resolved.totalCost : null,
        bestStoreName: paidSource?.storeName ?? null,
        bestSeller: paidSource?.seller ?? null,
        sources: resolved.sources.map((source) => ({ ...source })),
      };
    });

  const warnings: string[] = [];
  const stockBlocking = purchaseList.filter((entry) => entry.stockBlocking || entry.totalCost == null);
  const stockUsage = summarizeStockUsage(input.economyData!, purchaseList, input.currency || null);
  const stockOveruse = stockUsage.filter((entry) => entry.stockBlocking);
  const ownedUsage = summarizeOwnedUsage(input.ownedItems, purchaseList);
  const ownedOveruse = ownedUsage.filter((entry) => entry.stockBlocking);
  const globalCost = summarizeGlobalSourceCost(purchaseList);
  const objectCost = stockBlocking.length || stockOveruse.length || ownedOveruse.length ? null : globalCost;
  const budget = normalizeBudget(input.budget);
  const totalCost = objectCost;
  const remainingBudget = budget == null || totalCost == null ? null : budget - totalCost;
  if (stockBlocking.length) warnings.push("Some objects cannot be bought or crafted from the current economy snapshot.");
  if (stockOveruse.length) warnings.push("The selected plan consumes more global market stock than the current economy snapshot provides.");
  if (ownedOveruse.length) warnings.push("The selected plan consumes more owned objects than configured.");
  if (budget != null && totalCost != null && totalCost > budget) warnings.push("Budget exceeded.");
  const analysis = analyzePurchaseList(model, purchaseList, candidates, resolver, normalizeBudget(input.budget), input.economyData!, input.currency || null);

  return {
    enabled: true,
    objective: input.objective ?? "maxXpUnderBudget",
    budget,
    currency: input.currency || (purchaseList.find((entry) => entry.currency)?.currency ?? null),
    totalCost,
    objectCost,
    materialCost: null,
    remainingBudget,
    xpPerCredit: totalCost != null && totalCost > 0 ? score / totalCost : null,
    purchaseList,
    stockBlocking,
    stockUsage,
    stockOveruse,
    ownedUsage,
    ownedOveruse,
    analysis,
    warnings,
  };
}

export function economyAccepts(summary: EconomySummary | null) {
  if (!summary?.enabled) return true;
  if (summary.stockBlocking.length) return false;
  if (summary.stockOveruse.length) return false;
  if (summary.ownedOveruse.length) return false;
  if (summary.budget != null && summary.totalCost != null && summary.totalCost > summary.budget) return false;
  return summary.totalCost != null;
}

export function compareEconomyTie(a: EconomySummary | null | undefined, b: EconomySummary | null | undefined) {
  const costA = a?.totalCost ?? Infinity;
  const costB = b?.totalCost ?? Infinity;
  return costA - costB;
}

export function economyScoreValue(summary: EconomySummary | null | undefined, score: number) {
  if (summary?.objective === "bestXpPerCredit") return summary.xpPerCredit ?? 0;
  return score;
}

function normalizeBudget(value: number | null | undefined) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function estimateItemXp(model: EcoModel, itemClass: ItemClass, quantity: number) {
  const item = model.housingItems.find((entry) => entry.itemClass === itemClass);
  return (item?.value ?? 0) * quantity;
}

function summarizeGlobalSourceCost(purchaseList: EconomyPurchaseItem[]) {
  const paidSources = purchaseList.flatMap((entry) => entry.sources).filter((source) => source.totalCost != null && source.totalCost > 0);
  const currencies = [...new Set(paidSources.map((source) => source.currency).filter(Boolean))];
  if (currencies.length > 1) return null;

  let total = 0;
  const countedStations = new Map<string, EconomyPurchaseSource>();
  for (const source of paidSources) {
    if (source.kind === "station") {
      const key = stockKey(source.itemClass, source.currency, source.storeName, source.seller, source.unitCost);
      const current = countedStations.get(key);
      if (!current || source.quantity > current.quantity) countedStations.set(key, source);
      continue;
    }
    total += source.totalCost ?? 0;
  }
  for (const source of countedStations.values()) total += source.totalCost ?? 0;
  return total;
}

function summarizeStockUsage(economyData: EcoEconomyData, purchaseList: EconomyPurchaseItem[], currency: string | null): EconomyStockUse[] {
  const usedByListing = new Map<string, EconomyStockUse>();
  for (const source of stockTrackedSources(purchaseList)) {
    const key = stockKey(source.itemClass, source.currency, source.storeName, source.seller, source.unitCost);
    const current = usedByListing.get(key) ?? {
      itemClass: source.itemClass,
      quantity: 0,
      availableQuantity: availableStock(economyData, source, currency),
      currency: source.currency,
      storeName: source.storeName,
      seller: source.seller,
      unitCost: source.unitCost,
      stockBlocking: false,
    };
    current.quantity += source.quantity;
    current.stockBlocking = current.quantity > current.availableQuantity;
    usedByListing.set(key, current);
  }
  return [...usedByListing.values()].sort((a, b) => a.itemClass.localeCompare(b.itemClass) || (a.storeName ?? "").localeCompare(b.storeName ?? "") || (a.seller ?? "").localeCompare(b.seller ?? ""));
}

function stockTrackedSources(purchaseList: EconomyPurchaseItem[]) {
  const sources: EconomyPurchaseSource[] = [];
  const stationSources = new Map<string, EconomyPurchaseSource>();
  for (const source of purchaseList.flatMap((entry) => entry.sources)) {
    if (source.kind === "buy") {
      sources.push(source);
      continue;
    }
    if (source.kind !== "station" || source.unitCost == null) continue;
    const key = stockKey(source.itemClass, source.currency, source.storeName, source.seller, source.unitCost);
    const current = stationSources.get(key);
    if (!current || source.quantity > current.quantity) stationSources.set(key, source);
  }
  return [...sources, ...stationSources.values()];
}

function summarizeOwnedUsage(ownedItems: Map<ItemClass, number>, purchaseList: EconomyPurchaseItem[]): EconomyStockUse[] {
  const used = new Map<ItemClass, EconomyStockUse>();
  for (const source of purchaseList.flatMap((entry) => entry.sources).filter((source) => source.kind === "owned")) {
    const current = used.get(source.itemClass) ?? {
      itemClass: source.itemClass,
      quantity: 0,
      availableQuantity: ownedItems.get(source.itemClass) ?? 0,
      currency: null,
      storeName: null,
      seller: null,
      unitCost: 0,
      stockBlocking: false,
    };
    current.quantity += source.quantity;
    current.stockBlocking = current.quantity > current.availableQuantity;
    used.set(source.itemClass, current);
  }
  return [...used.values()].sort((a, b) => a.itemClass.localeCompare(b.itemClass));
}

function availableStock(economyData: EcoEconomyData, source: EconomyPurchaseSource, currency: string | null) {
  return economyData.listings
    .filter((listing) => listing.itemClass === source.itemClass)
    .filter((listing) => !currency || listing.currency === currency)
    .filter((listing) => listing.currency === source.currency)
    .filter((listing) => (listing.storeName ?? null) === (source.storeName ?? null))
    .filter((listing) => (listing.seller ?? null) === (source.seller ?? null))
    .filter((listing) => effectiveListingUnitCost(listing.price, listing.taxRate, listing.fee) === source.unitCost)
    .reduce((total, listing) => total + listing.quantity, 0);
}

function stockKey(itemClass: string, listingCurrency: string | null, storeName: string | null | undefined, seller: string | null | undefined, unitCost: number | null | undefined) {
  return [itemClass, listingCurrency ?? "", storeName ?? "", seller ?? "", unitCost ?? ""].join("|");
}

function analyzePurchaseList(model: EcoModel, purchaseList: EconomyPurchaseItem[], candidates: HousingItem[], resolver: ReturnType<typeof createCostResolver>, budget: number | null, economyData: EcoEconomyData, currency: string | null): EconomyAnalysis {
  const priced = purchaseList.filter((entry) => entry.totalCost != null && entry.totalCost > 0);
  const withRatio = priced.filter((entry) => entry.xpPerCredit != null);
  const expensiveThreshold = withRatio.length
    ? median(withRatio.map((entry) => entry.xpPerCredit ?? 0)) * 0.5
    : 0;
  const selected = new Set(purchaseList.map((entry) => entry.itemClass));
  const candidateRows = analyzeCandidateRows(candidates, resolver, budget, economyData, currency);
  return {
    bestXpPerCredit: [...withRatio].sort((a, b) => (b.xpPerCredit ?? 0) - (a.xpPerCredit ?? 0))[0] ?? null,
    worstXpPerCredit: [...withRatio].sort((a, b) => (a.xpPerCredit ?? Infinity) - (b.xpPerCredit ?? Infinity))[0] ?? null,
    strongestXp: [...purchaseList].sort((a, b) => b.xp - a.xp)[0] ?? null,
    unavailableItems: purchaseList.filter((entry) => entry.source === "unavailable" || entry.totalCost == null),
    stockLimitedItems: purchaseList.filter((entry) => entry.stockBlocking),
    expensiveItems: expensiveThreshold > 0 ? withRatio.filter((entry) => (entry.xpPerCredit ?? 0) < expensiveThreshold) : [],
    rejectedItems: candidateRows
      .filter((entry) => !selected.has(entry.itemClass))
      .sort((a, b) => rejectionRank(a.reason) - rejectionRank(b.reason) || b.xp - a.xp || a.itemClass.localeCompare(b.itemClass))
      .slice(0, 50),
    categories: analyzeCategoryCandidates(candidateRows),
    cheaperAlternatives: analyzeCheaperAlternatives(model, purchaseList, resolver),
    marketGaps: analyzeMarketGaps(candidates, resolver, economyData, currency),
  };
}

function analyzeMarketGaps(candidates: HousingItem[], resolver: ReturnType<typeof createCostResolver>, economyData: EcoEconomyData, currency: string | null): EconomyMarketGap[] {
  const unique = new Map<ItemClass, HousingItem>();
  for (const candidate of candidates) if (!unique.has(candidate.itemClass)) unique.set(candidate.itemClass, candidate);
  return [...unique.values()]
    .flatMap((item): EconomyMarketGap[] => {
      const resolved = resolver.resolve(item.itemClass, 1);
      const hasListing = Boolean(resolver.cheapestListing(item.itemClass));
      const allListings = economyData.listings.filter((listing) => listing.itemClass === item.itemClass);
      const availableCurrencies = currency
        ? [...new Set(allListings.filter((listing) => listing.currency !== currency).map((listing) => listing.currency))].sort()
        : [];
      const base = {
        itemClass: item.itemClass,
        category: item.category,
        xp: item.value,
        canCraft: resolved.canCraft,
        totalCost: resolved.totalCost,
        currency: resolved.currency,
      };
      if (currency && !hasListing && availableCurrencies.length && resolved.source === "unavailable") {
        return [{ ...base, reason: "otherCurrency", availableCurrencies }];
      }
      if (resolved.source === "unavailable") return [{ ...base, reason: "unavailable" }];
      if (resolved.totalCost == null) return [{ ...base, reason: "noPrice" }];
      if (!hasListing) return [{ ...base, reason: "noListing" }];
      return [];
    })
    .sort((a, b) => marketGapRank(a.reason) - marketGapRank(b.reason) || b.xp - a.xp || a.itemClass.localeCompare(b.itemClass))
    .slice(0, 50);
}

function analyzeCheaperAlternatives(model: EcoModel, purchaseList: EconomyPurchaseItem[], resolver: ReturnType<typeof createCostResolver>): EconomyCheaperAlternative[] {
  const rows: EconomyCheaperAlternative[] = [];
  const housingByClass = new Map(model.housingItems.map((item) => [item.itemClass, item]));
  for (const purchase of purchaseList) {
    if (purchase.totalCost == null || purchase.totalCost <= 0) continue;
    const group = model.equivalenceGroupByItemClass.get(purchase.itemClass);
    if (!group) continue;
    const currentItem = housingByClass.get(purchase.itemClass);
    for (const option of group.itemClasses) {
      if (option === purchase.itemClass) continue;
      const alternativeItem = housingByClass.get(option);
      if (!alternativeItem || !currentItem || alternativeItem.category !== currentItem.category || Math.abs(alternativeItem.value - currentItem.value) > 0.01) continue;
      const resolved = resolver.resolve(option, purchase.quantity);
      if (resolved.totalCost == null || resolved.availableQuantity < purchase.quantity || resolved.totalCost >= purchase.totalCost - 0.01) continue;
      rows.push({
        itemClass: purchase.itemClass,
        alternativeItemClass: option,
        category: currentItem.category,
        currentTotalCost: purchase.totalCost,
        alternativeTotalCost: resolved.totalCost,
        savings: purchase.totalCost - resolved.totalCost,
        currency: resolved.currency ?? purchase.currency,
        xp: purchase.xp,
      });
    }
  }
  return rows
    .sort((a, b) => b.savings - a.savings || a.itemClass.localeCompare(b.itemClass) || a.alternativeItemClass.localeCompare(b.alternativeItemClass))
    .slice(0, 20);
}

function analyzeCandidateRows(candidates: HousingItem[], resolver: ReturnType<typeof createCostResolver>, budget: number | null, economyData: EcoEconomyData, currency: string | null): EconomyRejectedItem[] {
  const unique = new Map<ItemClass, HousingItem>();
  for (const candidate of candidates) if (!unique.has(candidate.itemClass)) unique.set(candidate.itemClass, candidate);
  return [...unique.values()]
    .map((item) => {
      const resolved = resolver.resolve(item.itemClass, 1);
      const availableCurrencies = otherAvailableCurrencies(economyData, item.itemClass, currency);
      const reason = rejectionReason(resolved, budget, currency, availableCurrencies);
      return {
        itemClass: item.itemClass,
        category: item.category,
        reason,
        xp: item.value,
        availableQuantity: resolved.availableQuantity,
        unitCost: resolved.unitCost,
        totalCost: resolved.totalCost,
        currency: resolved.currency,
        xpPerCredit: resolved.totalCost != null && resolved.totalCost > 0 ? item.value / resolved.totalCost : null,
        availableCurrencies: availableCurrencies.length ? availableCurrencies : undefined,
      };
    });
}

function analyzeCategoryCandidates(candidateRows: EconomyRejectedItem[]): EconomyCategoryAnalysis[] {
  const byCategory = new Map<string, EconomyRejectedItem[]>();
  for (const row of candidateRows) {
    const entries = byCategory.get(row.category) ?? [];
    entries.push(row);
    byCategory.set(row.category, entries);
  }
  return [...byCategory.entries()]
    .map(([category, entries]) => {
      const available = entries.filter((entry) => entry.reason === "notSelected");
      const priced = available.filter((entry) => entry.totalCost != null && entry.totalCost > 0 && entry.xpPerCredit != null);
      const obtainable = entries.filter((entry) => entry.reason === "notSelected" || entry.reason === "overBudget");
      return {
        category,
        bestXpPerCredit: [...priced].sort((a, b) => (b.xpPerCredit ?? 0) - (a.xpPerCredit ?? 0) || b.xp - a.xp || a.itemClass.localeCompare(b.itemClass))[0] ?? null,
        strongestXp: [...obtainable].sort((a, b) => b.xp - a.xp || (a.totalCost ?? Infinity) - (b.totalCost ?? Infinity) || a.itemClass.localeCompare(b.itemClass))[0] ?? null,
        cheapestAvailable: [...available].sort((a, b) => (a.totalCost ?? Infinity) - (b.totalCost ?? Infinity) || b.xp - a.xp || a.itemClass.localeCompare(b.itemClass))[0] ?? null,
        unavailableItems: entries.filter((entry) => entry.reason === "unavailable" || entry.reason === "otherCurrency"),
        stockLimitedItems: entries.filter((entry) => entry.reason === "stock"),
        noPriceItems: entries.filter((entry) => entry.reason === "noPrice"),
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category));
}

function rejectionReason(resolved: ReturnType<ReturnType<typeof createCostResolver>["resolve"]>, budget: number | null, currency: string | null, availableCurrencies: string[]): EconomyRejectionReason {
  if (currency && availableCurrencies.length && resolved.source === "unavailable") return "otherCurrency";
  if (resolved.source === "unavailable") return "unavailable";
  if (resolved.availableQuantity < resolved.quantity) return "stock";
  if (resolved.totalCost == null) return "noPrice";
  if (budget != null && resolved.totalCost > budget) return "overBudget";
  return "notSelected";
}

function rejectionRank(reason: EconomyRejectionReason) {
  return { unavailable: 0, otherCurrency: 1, stock: 2, noPrice: 3, overBudget: 4, notSelected: 5 }[reason];
}

function otherAvailableCurrencies(economyData: EcoEconomyData, itemClass: string, currency: string | null) {
  if (!currency) return [];
  return [...new Set(economyData.listings
    .filter((listing) => listing.itemClass === itemClass && listing.currency !== currency)
    .map((listing) => listing.currency))]
    .sort();
}

function marketGapRank(reason: EconomyMarketGap["reason"]) {
  return { unavailable: 0, otherCurrency: 1, noPrice: 2, noListing: 3 }[reason];
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

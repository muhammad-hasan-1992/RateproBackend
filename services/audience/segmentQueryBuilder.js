// services/audience/segmentQueryBuilder.js
/**
 * Converts safe frontend filters → Mongo query
 * Prevents $where, $expr, injection
 *
 * Supported Filters:
 * ─────────────────────────────────────────────────────────────
 * BASIC:
 *   - status: "Active" | "Inactive" | "Blocked"
 *   - hasTag: string (tag name)
 *   - hasTags: string[] (multiple tags, OR logic)
 *   - hasAllTags: string[] (multiple tags, AND logic)
 *   - autoTag: string
 *   - hasAutoTags: string[] (multiple auto-tags)
 *
 * CATEGORY:
 *   - categoryId: ObjectId (single category)
 *   - categoryIds: ObjectId[] (multiple categories, OR logic)
 *   - categoryType: "internal" | "external" (requires lookup)
 *
 * TIME-BASED:
 *   - inactiveDays: number (lastActivity older than X days)
 *   - activeDays: number (lastActivity within X days)
 *   - createdLastDays: number (created within X days)
 *   - createdBeforeDays: number (created more than X days ago)
 *
 * SURVEY BEHAVIOR:
 *   - respondedLastDays: number (responded within X days)
 *   - notRespondedDays: number (no response in X days)
 *   - invitedButNotResponded: boolean
 *   - hasResponded: boolean (ever responded)
 *   - neverResponded: boolean (invited but never responded)
 *   - minResponses: number (responded to at least X surveys)
 *   - maxResponses: number (responded to at most X surveys)
 *
 * NPS & RATINGS:
 *   - npsBelow: number (NPS score < X)
 *   - npsAbove: number (NPS score > X)
 *   - npsBetween: [min, max]
 *   - npsCategory: "promoter" | "passive" | "detractor"
 *   - ratingBelow: number
 *   - ratingAbove: number
 *
 * LOCATION (Enrichment):
 *   - country: string
 *   - countries: string[] (OR logic)
 *   - city: string
 *   - cities: string[]
 *   - region: string
 *   - regions: string[]
 *
 * COMPANY:
 *   - company: string (exact match)
 *   - companyContains: string (partial match)
 *   - domain: string (email domain)
 *
 * ─────────────────────────────────────────────────────────────
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Helper: Get date X days ago
 */
function daysAgo(days) {
  return new Date(Date.now() - days * DAY_MS);
}

/**
 * Helper: Safely convert to ObjectId-like array
 */
function toIdArray(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.filter(Boolean);
  return [input];
}

/**
 * Main query builder
 */
function buildContactQuery(filters = {}) {
  const query = {};

  // ─────────────────────────────────────────────────────────────
  // BASIC FILTERS
  // ─────────────────────────────────────────────────────────────

  // Status
  if (filters.status) {
    query.status = filters.status;
  }

  // Single tag
  if (filters.hasTag) {
    query.tags = { $in: [filters.hasTag] };
  }

  // Multiple tags (OR - has any of these)
  if (filters.hasTags && Array.isArray(filters.hasTags)) {
    query.tags = { $in: filters.hasTags };
  }

  // Multiple tags (AND - has all of these)
  if (filters.hasAllTags && Array.isArray(filters.hasAllTags)) {
    query.tags = { $all: filters.hasAllTags };
  }

  // Auto-tag
  if (filters.autoTag) {
    query.autoTags = { $in: [filters.autoTag] };
  }

  // Multiple auto-tags
  if (filters.hasAutoTags && Array.isArray(filters.hasAutoTags)) {
    query.autoTags = { $in: filters.hasAutoTags };
  }

  // ─────────────────────────────────────────────────────────────
  // CATEGORY FILTERS
  // ─────────────────────────────────────────────────────────────

  // Single category
  if (filters.categoryId) {
    query.contactCategories = filters.categoryId;
  }

  // Multiple categories (OR - belongs to any of these)
  if (filters.categoryIds && Array.isArray(filters.categoryIds)) {
    query.contactCategories = { $in: filters.categoryIds };
  }

  // ─────────────────────────────────────────────────────────────
  // TIME-BASED FILTERS
  // ─────────────────────────────────────────────────────────────

  // Inactive for X days (no activity since)
  if (filters.inactiveDays) {
    query.lastActivity = { $lte: daysAgo(filters.inactiveDays) };
  }

  // Active within X days
  if (filters.activeDays) {
    query.lastActivity = {
      ...query.lastActivity,
      $gte: daysAgo(filters.activeDays),
    };
  }

  // Created within last X days
  if (filters.createdLastDays) {
    query.createdAt = { $gte: daysAgo(filters.createdLastDays) };
  }

  // Created more than X days ago
  if (filters.createdBeforeDays) {
    query.createdAt = {
      ...query.createdAt,
      $lte: daysAgo(filters.createdBeforeDays),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // SURVEY BEHAVIOR FILTERS
  // ─────────────────────────────────────────────────────────────

  // Responded within last X days
  if (filters.respondedLastDays) {
    query["surveyStats.lastResponseDate"] = {
      $gte: daysAgo(filters.respondedLastDays),
    };
  }

  // No response in last X days (but has responded before)
  if (filters.notRespondedDays) {
    query["surveyStats.lastResponseDate"] = {
      $lte: daysAgo(filters.notRespondedDays),
    };
    query["surveyStats.respondedCount"] = { $gt: 0 };
  }

  // Invited but never responded
  if (filters.invitedButNotResponded === true) {
    query["surveyStats.invitedCount"] = { $gt: 0 };
    query["surveyStats.respondedCount"] = 0;
  }

  // Has responded at least once
  if (filters.hasResponded === true) {
    query["surveyStats.respondedCount"] = { $gt: 0 };
  }

  // Never responded (regardless of invitation)
  if (filters.neverResponded === true) {
    query.$or = [
      { "surveyStats.respondedCount": 0 },
      { "surveyStats.respondedCount": { $exists: false } },
    ];
  }

  // Minimum responses
  if (filters.minResponses !== undefined) {
    query["surveyStats.respondedCount"] = {
      ...query["surveyStats.respondedCount"],
      $gte: filters.minResponses,
    };
  }

  // Maximum responses
  if (filters.maxResponses !== undefined) {
    query["surveyStats.respondedCount"] = {
      ...query["surveyStats.respondedCount"],
      $lte: filters.maxResponses,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // NPS & RATING FILTERS
  // ─────────────────────────────────────────────────────────────

  // NPS below X (detractors typically < 7)
  if (filters.npsBelow !== undefined) {
    query["surveyStats.latestNpsScore"] = { $lt: filters.npsBelow };
  }

  // NPS above X (promoters typically >= 9)
  if (filters.npsAbove !== undefined) {
    query["surveyStats.latestNpsScore"] = {
      ...query["surveyStats.latestNpsScore"],
      $gt: filters.npsAbove,
    };
  }

  // NPS between range [min, max]
  if (filters.npsBetween && Array.isArray(filters.npsBetween)) {
    const [min, max] = filters.npsBetween;
    query["surveyStats.latestNpsScore"] = {
      $gte: min,
      $lte: max,
    };
  }

  // NPS category
  if (filters.npsCategory) {
    query["surveyStats.npsCategory"] = filters.npsCategory;
  }

  // Rating below X
  if (filters.ratingBelow !== undefined) {
    query["surveyStats.latestRating"] = { $lt: filters.ratingBelow };
  }

  // Rating above X
  if (filters.ratingAbove !== undefined) {
    query["surveyStats.latestRating"] = {
      ...query["surveyStats.latestRating"],
      $gt: filters.ratingAbove,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // LOCATION (ENRICHMENT) FILTERS
  // ─────────────────────────────────────────────────────────────

  // Single country
  if (filters.country) {
    query["enrichment.country"] = filters.country;
  }

  // Multiple countries (OR)
  if (filters.countries && Array.isArray(filters.countries)) {
    query["enrichment.country"] = { $in: filters.countries };
  }

  // Single city
  if (filters.city) {
    query["enrichment.city"] = filters.city;
  }

  // Multiple cities (OR)
  if (filters.cities && Array.isArray(filters.cities)) {
    query["enrichment.city"] = { $in: filters.cities };
  }

  // Single region
  if (filters.region) {
    query["enrichment.region"] = filters.region;
  }

  // Multiple regions (OR)
  if (filters.regions && Array.isArray(filters.regions)) {
    query["enrichment.region"] = { $in: filters.regions };
  }

  // ─────────────────────────────────────────────────────────────
  // COMPANY FILTERS
  // ─────────────────────────────────────────────────────────────

  // Exact company match
  if (filters.company) {
    query.company = filters.company;
  }

  // Partial company match (contains)
  if (filters.companyContains) {
    query.company = { $regex: filters.companyContains, $options: "i" };
  }

  // Email domain
  if (filters.domain) {
    query["enrichment.domain"] = filters.domain;
  }

  // ─────────────────────────────────────────────────────────────
  // COMPOSITE / ADVANCED FILTERS
  // ─────────────────────────────────────────────────────────────

  // Custom $and conditions (for complex queries)
  if (filters.$and && Array.isArray(filters.$and)) {
    query.$and = filters.$and.map((subFilter) => buildContactQuery(subFilter));
  }

  // Custom $or conditions
  if (filters.$or && Array.isArray(filters.$or)) {
    // Merge with existing $or if present
    const orConditions = filters.$or.map((subFilter) =>
      buildContactQuery(subFilter)
    );
    if (query.$or) {
      query.$and = query.$and || [];
      query.$and.push({ $or: query.$or });
      query.$or = orConditions;
    } else {
      query.$or = orConditions;
    }
  }

  return query;
}

/**
 * Validate filters object (security layer)
 */
function validateFilters(filters = {}) {
  const ALLOWED_KEYS = new Set([
    // Basic
    "status",
    "hasTag",
    "hasTags",
    "hasAllTags",
    "autoTag",
    "hasAutoTags",
    // Category
    "categoryId",
    "categoryIds",
    // Time
    "inactiveDays",
    "activeDays",
    "createdLastDays",
    "createdBeforeDays",
    // Survey behavior
    "respondedLastDays",
    "notRespondedDays",
    "invitedButNotResponded",
    "hasResponded",
    "neverResponded",
    "minResponses",
    "maxResponses",
    // NPS & Rating
    "npsBelow",
    "npsAbove",
    "npsBetween",
    "npsCategory",
    "ratingBelow",
    "ratingAbove",
    // Location
    "country",
    "countries",
    "city",
    "cities",
    "region",
    "regions",
    // Company
    "company",
    "companyContains",
    "domain",
    // Composite
    "$and",
    "$or",
  ]);

  const invalidKeys = Object.keys(filters).filter(
    (key) => !ALLOWED_KEYS.has(key)
  );

  if (invalidKeys.length > 0) {
    throw new Error(`Invalid filter keys: ${invalidKeys.join(", ")}`);
  }

  return true;
}

/**
 * Build query with validation
 */
function buildSafeContactQuery(filters = {}) {
  validateFilters(filters);
  return buildContactQuery(filters);
}

module.exports = {
  buildContactQuery,
  buildSafeContactQuery,
  validateFilters,
};

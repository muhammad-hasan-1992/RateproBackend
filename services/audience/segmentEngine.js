// services/audience/segmentEngine.js
/**
 * Dynamic segment definitions for the Audience Intelligence Layer
 * These are query blueprints using the new filter syntax
 */

const buildDynamicSegments = () => [
  // ─────────────────────────────────────────────────────────────
  // ACTIVITY-BASED SEGMENTS
  // ─────────────────────────────────────────────────────────────
  {
    key: "recentResponders",
    title: "Responded in last 30 days",
    description: "Contacts who submitted a survey response in the last month",
    filters: {
      respondedLastDays: 30,
    },
  },
  {
    key: "recentlyActive",
    title: "Active in last 7 days",
    description: "Contacts with any activity in the last week",
    filters: {
      activeDays: 7,
    },
  },
  {
    key: "dormant",
    title: "Dormant (90+ days)",
    description: "No activity in the last 90 days",
    filters: {
      inactiveDays: 90,
    },
  },

  // ─────────────────────────────────────────────────────────────
  // NPS-BASED SEGMENTS
  // ─────────────────────────────────────────────────────────────
  {
    key: "promoters",
    title: "Promoters (NPS 9-10)",
    description: "Highly satisfied customers likely to recommend",
    filters: {
      npsCategory: "promoter",
    },
  },
  {
    key: "passives",
    title: "Passives (NPS 7-8)",
    description: "Satisfied but not enthusiastic customers",
    filters: {
      npsCategory: "passive",
    },
  },
  {
    key: "detractors",
    title: "Detractors (NPS 0-6)",
    description: "Unhappy customers who may damage brand",
    filters: {
      npsCategory: "detractor",
    },
  },
  {
    key: "lowNps",
    title: "NPS Below 6",
    description: "Contacts with latest NPS score under 6",
    filters: {
      npsBelow: 6,
    },
  },
  {
    key: "atRisk",
    title: "At-Risk Customers",
    description: "Detractors who haven't been contacted in 30 days",
    filters: {
      npsCategory: "detractor",
      inactiveDays: 30,
    },
  },

  // ─────────────────────────────────────────────────────────────
  // ENGAGEMENT-BASED SEGMENTS
  // ─────────────────────────────────────────────────────────────
  {
    key: "invitedNotResponded",
    title: "Invited but not responded",
    description: "Contacts who received invitations but never responded",
    filters: {
      invitedButNotResponded: true,
    },
  },
  {
    key: "highEngagement",
    title: "High Engagement",
    description: "Contacts who have responded to 3+ surveys",
    filters: {
      minResponses: 3,
    },
  },
  {
    key: "newContacts",
    title: "New Contacts (7 days)",
    description: "Contacts added in the last week",
    filters: {
      createdLastDays: 7,
    },
  },
  {
    key: "neverSurveyed",
    title: "Never Surveyed",
    description: "Contacts who have never received a survey",
    filters: {
      neverResponded: true,
    },
  },

  // ─────────────────────────────────────────────────────────────
  // CATEGORY-BASED SEGMENTS (examples - categoryIds are placeholders)
  // ─────────────────────────────────────────────────────────────
  {
    key: "internalContacts",
    title: "Internal Contacts",
    description: "Employees and internal stakeholders",
    filters: {
      hasTag: "internal",
    },
  },
  {
    key: "externalClients",
    title: "External Clients",
    description: "External customers and clients",
    filters: {
      hasTag: "external",
    },
  },

  // ─────────────────────────────────────────────────────────────
  // VIP & SPECIAL SEGMENTS
  // ─────────────────────────────────────────────────────────────
  {
    key: "vipCustomers",
    title: "VIP Customers",
    description: "Contacts tagged as VIP",
    filters: {
      hasTag: "VIP",
    },
  },
  {
    key: "promoterVips",
    title: "VIP Promoters",
    description: "VIP customers who are also promoters",
    filters: {
      hasAllTags: ["VIP"],
      npsCategory: "promoter",
    },
  },
];

/**
 * Get segment definition by key
 */
function getSegmentByKey(key) {
  return buildDynamicSegments().find((s) => s.key === key);
}

/**
 * Get all segment keys
 */
function getSegmentKeys() {
  return buildDynamicSegments().map((s) => s.key);
}

module.exports = {
  buildDynamicSegments,
  getSegmentByKey,
  getSegmentKeys,
};

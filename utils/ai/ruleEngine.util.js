// utils/ai/ruleEngine.util.js
/**
 * Rule Engine for AI Analysis
 * Client Requirement 5 & 6: Action & Workflow Triggering Based on Analysis
 * 
 * Expanded to cover all client requirements:
 * - Rating ≤ 2 triggers
 * - NPS Detractor detection
 * - Negative keywords in comment
 * - "Contact me" response detection
 * - High urgency escalation
 * - Complaint/Praise/Suggestion classification
 */

// Negative keywords that should trigger alerts
const NEGATIVE_KEYWORDS = [
  "terrible", "awful", "horrible", "worst", "hate", "angry", "furious",
  "disappointed", "unacceptable", "disgusting", "pathetic", "useless",
  "scam", "fraud", "lawsuit", "lawyer", "legal", "report", "complain",
  "refund", "cancel", "never again", "waste of money", "rip off"
];

// Keywords indicating user wants to be contacted
const CONTACT_ME_KEYWORDS = [
  "contact me", "call me", "reach out", "get in touch", "phone me",
  "email me", "callback", "call back", "speak to someone", "talk to manager",
  "need help", "urgent help", "please call", "waiting for call"
];

/**
 * Check if text contains any negative keywords
 */
function containsNegativeKeywords(text) {
  if (!text) return { found: false, keywords: [] };
  const lowerText = text.toLowerCase();
  const foundKeywords = NEGATIVE_KEYWORDS.filter(kw => lowerText.includes(kw));
  return { found: foundKeywords.length > 0, keywords: foundKeywords };
}

/**
 * Check if user requested to be contacted
 */
function requestsContact(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return CONTACT_ME_KEYWORDS.some(kw => lowerText.includes(kw));
}

/**
 * Evaluate insight and response to determine actions
 * Returns array of action types to trigger
 */
exports.evaluate = (insight, response = {}) => {
  const actions = [];
  const reasons = [];

  // Get text content for keyword analysis
  const textContent = [
    response.review,
    ...(response.answers || []).map(a => a.answer)
  ].filter(Boolean).join(" ");

  // ─────────────────────────────────────────────────────────
  // RULE 1: Negative sentiment + High urgency → Immediate action
  // ─────────────────────────────────────────────────────────
  if (insight.sentiment === "negative" && insight.urgency === "high") {
    actions.push("CREATE_ACTION");
    actions.push("SEND_ALERT");
    actions.push("ESCALATE");
    reasons.push("negative_high_urgency");
  }

  // ─────────────────────────────────────────────────────────
  // RULE 2: Any negative sentiment → Dashboard flag
  // ─────────────────────────────────────────────────────────
  if (insight.sentiment === "negative") {
    if (!actions.includes("DASHBOARD_FLAG")) {
      actions.push("DASHBOARD_FLAG");
    }
    if (!actions.includes("CREATE_ACTION")) {
      actions.push("CREATE_ACTION");
    }
    reasons.push("negative_sentiment");
  }

  // ─────────────────────────────────────────────────────────
  // RULE 3: Low rating (≤2 on 5-point scale) → High priority action
  // Client Requirement 6.1: Rating ≤ 2 trigger
  // ─────────────────────────────────────────────────────────
  if (response.rating !== undefined && response.rating !== null && response.rating <= 2) {
    if (!actions.includes("CREATE_ACTION")) {
      actions.push("CREATE_ACTION");
    }
    actions.push("SEND_ALERT");
    reasons.push("low_rating");
  }

  // ─────────────────────────────────────────────────────────
  // RULE 4: NPS Detractor (score 0-6) → Follow-up action
  // Client Requirement 6.1: NPS Detractor trigger
  // ─────────────────────────────────────────────────────────
  if (response.score !== undefined && response.score !== null && response.score <= 6) {
    if (!actions.includes("CREATE_ACTION")) {
      actions.push("CREATE_ACTION");
    }
    reasons.push("nps_detractor");
  }

  // ─────────────────────────────────────────────────────────
  // RULE 5: Negative keywords in comment
  // Client Requirement 6.1: Negative keywords in comment trigger
  // ─────────────────────────────────────────────────────────
  const negativeKeywordCheck = containsNegativeKeywords(textContent);
  if (negativeKeywordCheck.found) {
    if (!actions.includes("CREATE_ACTION")) {
      actions.push("CREATE_ACTION");
    }
    actions.push("DASHBOARD_FLAG");
    reasons.push(`negative_keywords:${negativeKeywordCheck.keywords.slice(0, 3).join(",")}`);
  }

  // ─────────────────────────────────────────────────────────
  // RULE 6: "Contact me" response → Callback action
  // Client Requirement 6.1: "Contact me" response trigger
  // ─────────────────────────────────────────────────────────
  if (requestsContact(textContent)) {
    actions.push("CREATE_CALLBACK");
    actions.push("SEND_ALERT");
    reasons.push("contact_requested");
  }

  // ─────────────────────────────────────────────────────────
  // RULE 7: Complaint classification → Follow-up
  // ─────────────────────────────────────────────────────────
  if (insight.classification?.isComplaint) {
    if (!actions.includes("CREATE_ACTION")) {
      actions.push("CREATE_ACTION");
    }
    reasons.push("complaint_classified");
  }

  // ─────────────────────────────────────────────────────────
  // RULE 8: Suggestion → Low priority improvement task
  // ─────────────────────────────────────────────────────────
  if (insight.classification?.isSuggestion) {
    actions.push("CREATE_SUGGESTION");
    reasons.push("suggestion_received");
  }

  // ─────────────────────────────────────────────────────────
  // RULE 9: Positive feedback → Recognition tracking
  // Client Requirement 6: Positive feedback contributing to recognition
  // ─────────────────────────────────────────────────────────
  if (insight.sentiment === "positive" && insight.classification?.isPraise) {
    actions.push("TRACK_PRAISE");
    reasons.push("praise_received");
  }

  // ─────────────────────────────────────────────────────────
  // RULE 10: High urgency alone → Alert
  // ─────────────────────────────────────────────────────────
  if (insight.urgency === "high" && !actions.includes("SEND_ALERT")) {
    actions.push("SEND_ALERT");
    reasons.push("high_urgency");
  }

  // Return unique actions with metadata
  return {
    actions: [...new Set(actions)],
    reasons,
    triggeredAt: new Date().toISOString()
  };
};

// Export helper functions for testing
exports.containsNegativeKeywords = containsNegativeKeywords;
exports.requestsContact = requestsContact;
exports.NEGATIVE_KEYWORDS = NEGATIVE_KEYWORDS;
exports.CONTACT_ME_KEYWORDS = CONTACT_ME_KEYWORDS;
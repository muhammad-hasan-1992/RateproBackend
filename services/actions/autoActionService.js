// services/actions/autoActionService.js
const Action = require("../../models/Action");
const Logger = require("../../utils/auditLog");

/**
 * Action Rules Configuration
 * Client Requirement 5: Action & Workflow Triggering Based on Analysis
 * 
 * Priority Logic:
 * - HIGH: negative sentiment + high urgency, OR low rating (≤2), OR NPS detractor (≤3)
 * - MEDIUM: negative sentiment + medium urgency, OR complaint classification, OR NPS detractor (4-6)
 * - LOW: negative sentiment + low urgency, OR suggestions
 */

// Keywords indicating user wants to be contacted
const CONTACT_ME_KEYWORDS = [
  "contact me", "call me", "reach out", "get in touch", "phone me",
  "email me", "callback", "call back", "speak to someone", "talk to manager",
  "need help", "urgent help", "please call", "waiting for call"
];

// Negative keywords that should trigger alerts
const NEGATIVE_KEYWORDS = [
  "terrible", "awful", "horrible", "worst", "hate", "angry", "furious",
  "disappointed", "unacceptable", "disgusting", "pathetic", "useless",
  "scam", "fraud", "lawsuit", "lawyer", "legal", "report",
  "refund", "cancel", "never again", "waste of money", "rip off"
];

/**
 * Check if user requested to be contacted
 */
function requestsContact(response) {
  const text = [
    response.review,
    ...(response.answers || []).map(a => 
      typeof a.answer === 'string' ? a.answer : ''
    )
  ].filter(Boolean).join(" ").toLowerCase();
  
  return CONTACT_ME_KEYWORDS.some(kw => text.includes(kw));
}

/**
 * Check for negative keywords
 */
function containsNegativeKeywords(response) {
  const text = [
    response.review,
    ...(response.answers || []).map(a => 
      typeof a.answer === 'string' ? a.answer : ''
    )
  ].filter(Boolean).join(" ").toLowerCase();
  
  const found = NEGATIVE_KEYWORDS.filter(kw => text.includes(kw));
  return { hasNegativeKeywords: found.length > 0, keywords: found };
}

/**
 * Determine priority based on sentiment + urgency combination
 */
function determinePriorityFromInsight(insight, response) {
  const sentiment = insight.sentiment;
  const urgency = insight.urgency;
  const rating = response.rating;
  const npsScore = response.score;

  // Critical conditions → HIGH
  if (urgency === "high") return "high";
  if (rating !== undefined && rating !== null && rating <= 2) return "high";
  if (npsScore !== undefined && npsScore !== null && npsScore <= 3) return "high";
  if (containsNegativeKeywords(response).hasNegativeKeywords) return "high";
  if (requestsContact(response)) return "high";

  // Negative + medium urgency → MEDIUM
  if (sentiment === "negative" && urgency === "medium") return "medium";
  if (npsScore !== undefined && npsScore !== null && npsScore <= 6) return "medium";
  if (insight.classification?.isComplaint) return "medium";

  // Negative + low urgency → LOW (not high!)
  if (sentiment === "negative" && urgency === "low") return "low";

  // Default
  return "low";
}

const ACTION_RULES = {
  // ─────────────────────────────────────────────────────────
  // HIGH PRIORITY TRIGGERS
  // ─────────────────────────────────────────────────────────
  
  // Negative sentiment with HIGH urgency → High priority
  negativeHighUrgency: {
    condition: (insight) => insight.sentiment === "negative" && insight.urgency === "high",
    action: {
      title: "Urgent Negative Feedback",
      priority: "high",
      category: "Customer Complaint",
      tags: ["auto", "negative-sentiment", "urgent", "high-urgency"]
    }
  },

  // Low rating (≤2) → High priority
  lowRating: {
    condition: (insight, response) => response.rating && response.rating <= 2,
    action: {
      title: "Low Rating Alert",
      priority: "high",
      category: "Low Satisfaction",
      tags: ["auto", "low-rating", "follow-up"]
    }
  },

  // NPS Detractor with very low score (0-3) → High priority
  severeDetractor: {
    condition: (insight, response) => response.score !== undefined && response.score <= 3,
    action: {
      title: "Severe NPS Detractor",
      priority: "high",
      category: "Detractor Recovery",
      tags: ["auto", "nps", "detractor", "critical"]
    }
  },

  // Contact request → High priority
  contactRequest: {
    condition: (insight, response) => requestsContact(response),
    action: {
      title: "Customer Callback Requested",
      priority: "high",
      category: "Callback",
      tags: ["auto", "callback", "urgent", "contact-request"]
    }
  },

  // Negative keywords → High priority
  negativeKeywords: {
    condition: (insight, response) => containsNegativeKeywords(response).hasNegativeKeywords,
    action: {
      title: "Negative Keywords Detected",
      priority: "high",
      category: "Customer Complaint",
      tags: ["auto", "negative-keywords", "escalate"]
    }
  },

  // ─────────────────────────────────────────────────────────
  // MEDIUM PRIORITY TRIGGERS
  // ─────────────────────────────────────────────────────────

  // Negative sentiment with MEDIUM urgency → Medium priority
  negativeMediumUrgency: {
    condition: (insight) => insight.sentiment === "negative" && insight.urgency === "medium",
    action: {
      title: "Negative Feedback Detected",
      priority: "medium",
      category: "Customer Complaint",
      tags: ["auto", "negative-sentiment", "medium-urgency"]
    }
  },

  // NPS Detractor (4-6) → Medium priority
  detractor: {
    condition: (insight, response) => 
      response.score !== undefined && response.score >= 4 && response.score <= 6,
    action: {
      title: "NPS Detractor Identified",
      priority: "medium",
      category: "Detractor Recovery",
      tags: ["auto", "nps", "detractor"]
    }
  },

  // Complaint classification → Medium priority
  complaint: {
    condition: (insight) => insight.classification?.isComplaint === true,
    action: {
      title: "Customer Complaint",
      priority: "medium",
      category: "Complaint",
      tags: ["auto", "complaint"]
    }
  },

  // ─────────────────────────────────────────────────────────
  // LOW PRIORITY TRIGGERS
  // ─────────────────────────────────────────────────────────

  // Negative sentiment with LOW urgency → Low priority (NOT high!)
  negativeLowUrgency: {
    condition: (insight) => insight.sentiment === "negative" && insight.urgency === "low",
    action: {
      title: "Negative Feedback (Low Urgency)",
      priority: "low",
      category: "Feedback Review",
      tags: ["auto", "negative-sentiment", "low-urgency"]
    }
  },

  // Suggestion handling → Low priority
  suggestion: {
    condition: (insight) => insight.classification?.isSuggestion === true,
    action: {
      title: "Customer Suggestion",
      priority: "low",
      category: "Improvement",
      tags: ["auto", "suggestion", "improvement"]
    }
  },

  // ─────────────────────────────────────────────────────────
  // NO ACTION (TRACKING ONLY)
  // ─────────────────────────────────────────────────────────

  // Praise tracking (for recognition) - no action created
  praise: {
    condition: (insight) => insight.classification?.isPraise === true && insight.sentiment === "positive",
    action: {
      title: "Positive Feedback Received",
      priority: "low",
      category: "Recognition",
      tags: ["auto", "praise", "recognition"]
    },
    createAction: false // Don't create action, just track
  }
};

/**
 * Evaluate all rules and determine which actions to trigger
 */
exports.evaluateRules = (insight, response) => {
  const triggeredRules = [];

  for (const [ruleName, rule] of Object.entries(ACTION_RULES)) {
    try {
      if (rule.condition(insight, response)) {
        triggeredRules.push({
          ruleName,
          ...rule.action,
          createAction: rule.createAction !== false
        });
      }
    } catch (error) {
      console.error(`[AutoAction] Rule evaluation error for ${ruleName}:`, error.message);
    }
  }

  return triggeredRules;
};

/**
 * Create action from AI insight
 * Client Requirement 5: Automatically trigger actions based on rules and AI signals
 */
exports.createActionFromInsight = async ({
  insight,
  response,
  survey,
  tenantId
}) => {
  // Evaluate all rules
  const triggeredRules = this.evaluateRules(insight, response);

  // If no rules triggered and AI didn't recommend action, skip
  if (triggeredRules.length === 0 && !insight.shouldGenerateAction) {
    console.log(`[AutoAction] No action required for response ${response._id}`);
    return null;
  }

  // Find the highest priority rule
  const priorityOrder = { high: 3, medium: 2, low: 1 };
  const rulesToCreate = triggeredRules.filter(r => r.createAction !== false);
  
  if (rulesToCreate.length === 0 && !insight.shouldGenerateAction) {
    // Only praise/recognition triggered, no action needed
    Logger.info("autoAction", "Positive feedback tracked (no action created)", {
      context: { responseId: response._id, surveyId: survey._id, tenantId }
    });
    return null;
  }

  // Sort by priority and get the most important rule
  rulesToCreate.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
  const primaryRule = rulesToCreate[0] || {
    title: "Customer Feedback Issue",
    priority: insight.urgency === "high" ? "high" : "medium",
    category: "Survey Feedback",
    tags: ["auto", "survey"]
  };

  // Build description from insight
  const description = buildActionDescription(insight, response, survey);

  // Calculate due date based on priority
  const dueDate = calculateDueDate(primaryRule.priority);

  // Create the action
  const action = await Action.create({
    title: primaryRule.title,
    description,
    priority: primaryRule.priority,
    category: primaryRule.category,
    tenant: tenantId,
    status: "pending",
    source: "ai_generated",
    dueDate,
    // ✅ NEW: SLA Tracking fields
    // Client Requirement 6.3: SLA tracking
    sla: {
      targetResolutionTime: dueDate,
      remindersSent: 0,
      nextReminderAt: calculateNextReminder(primaryRule.priority),
      isBreached: false
    },
    metadata: {
      surveyId: survey._id,
      responseId: response._id,
      sentiment: insight.sentiment,
      confidence: insight.confidence,
      urgency: insight.urgency,
      triggeredRules: triggeredRules.map(r => r.ruleName)
    },
    tags: [...new Set([...primaryRule.tags, ...(insight.themes || []).slice(0, 3)])]
  });

  Logger.info("autoAction", "Action created from insight", {
    context: {
      actionId: action._id,
      responseId: response._id,
      surveyId: survey._id,
      tenantId,
      priority: action.priority,
      triggeredRules: triggeredRules.map(r => r.ruleName)
    }
  });

  return action;
};

/**
 * Build detailed action description
 */
function buildActionDescription(insight, response, survey) {
  const parts = [];

  parts.push(`Survey: ${survey.title || "Unknown"}`);
  parts.push(`Sentiment: ${insight.sentiment || "N/A"}`);
  
  if (insight.urgency) {
    parts.push(`Urgency: ${insight.urgency}`);
  }

  if (response.rating) {
    parts.push(`Rating: ${response.rating}/5`);
  }

  if (response.score !== undefined) {
    parts.push(`NPS Score: ${response.score}/10`);
  }

  if (insight.summary) {
    parts.push(`\nSummary: ${insight.summary}`);
  }

  if (response.review) {
    parts.push(`\nCustomer Feedback: "${response.review.substring(0, 300)}${response.review.length > 300 ? '...' : ''}"`);
  }

  if (insight.keywords?.length > 0) {
    parts.push(`\nKey Topics: ${insight.keywords.slice(0, 5).join(", ")}`);
  }

  if (insight.emotions?.length > 0) {
    parts.push(`Detected Emotions: ${insight.emotions.join(", ")}`);
  }

  return parts.join("\n");
}

/**
 * Calculate due date based on priority
 */
function calculateDueDate(priority) {
  const now = new Date();
  
  switch (priority) {
    case "high":
      // Due within 4 hours
      return new Date(now.getTime() + 4 * 60 * 60 * 1000);
    case "medium":
      // Due within 24 hours
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "low":
      // Due within 72 hours
      return new Date(now.getTime() + 72 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() + 48 * 60 * 60 * 1000);
  }
}

/**
 * Calculate next reminder time based on priority
 * Client Requirement 6.3: Auto-reminders (24h/48h/72h)
 */
function calculateNextReminder(priority) {
  const now = new Date();
  switch (priority) {
    case "high":
      // First reminder in 4 hours
      return new Date(now.getTime() + 4 * 60 * 60 * 1000);
    case "medium":
      // First reminder in 24 hours
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "low":
      // First reminder in 48 hours
      return new Date(now.getTime() + 48 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

/**
 * Check for repeated complaint themes and generate alerts
 * Client Requirement 5: Repeated complaint themes generating alerts
 */
exports.checkRepeatedComplaints = async (tenantId, options = {}) => {
  const { hours = 24, threshold = 3 } = options;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const recentActions = await Action.find({
    tenant: tenantId,
    source: { $in: ["ai_generated", "survey_feedback"] },
    createdAt: { $gte: since }
  }).lean();

  // Group by category
  const categoryGroups = {};
  recentActions.forEach(action => {
    const cat = action.category || "uncategorized";
    if (!categoryGroups[cat]) categoryGroups[cat] = [];
    categoryGroups[cat].push(action);
  });

  // Find categories exceeding threshold
  const alerts = [];
  for (const [category, actions] of Object.entries(categoryGroups)) {
    if (actions.length >= threshold) {
      alerts.push({
        type: "repeated_complaint",
        category,
        count: actions.length,
        threshold,
        period: `${hours} hours`,
        message: `${actions.length} ${category} issues detected in the last ${hours} hours`,
        severity: actions.length >= threshold * 2 ? "critical" : "warning"
      });
    }
  }

  return alerts;
};

/**
 * Escalate high-risk feedback to higher priority
 * Client Requirement 5: High-risk feedback escalating to higher-priority workflows
 */
exports.escalateAction = async (actionId, reason) => {
  const action = await Action.findById(actionId);
  
  if (!action) {
    throw new Error("Action not found");
  }

  // Track escalation in history
  action.assignmentHistory.push({
    from: action.assignedTo,
    to: null,
    by: null,
    at: new Date(),
    auto: true,
    note: `Auto-escalated: ${reason}`
  });

  // Upgrade priority
  if (action.priority === "low") action.priority = "medium";
  else if (action.priority === "medium") action.priority = "high";

  // Update due date for urgency
  action.dueDate = calculateDueDate(action.priority);
  
  action.tags.push("escalated");

  await action.save();

  Logger.info("autoAction", "Action escalated", {
    context: {
      actionId,
      newPriority: action.priority,
      reason
    }
  });

  return action;
};

/**
 * Track positive feedback for recognition
 * Client Requirement 5: Positive feedback contributing to recognition tracking
 */
exports.trackPraise = async ({ response, survey, tenantId, insight }) => {
  // This could be stored in a separate collection or used for employee recognition
  const praiseRecord = {
    surveyId: survey._id,
    responseId: response._id,
    tenantId,
    sentiment: insight.sentiment,
    keywords: insight.keywords,
    summary: insight.summary,
    rating: response.rating,
    score: response.score,
    trackedAt: new Date()
  };

  Logger.info("autoAction", "Praise tracked", {
    context: praiseRecord
  });

  return praiseRecord;
};

module.exports = exports;
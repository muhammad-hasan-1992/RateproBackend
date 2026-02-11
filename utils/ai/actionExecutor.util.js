// utils/ai/actionExecutor.util.js
// ============================================================================
// Action Executor — Processes AI-determined actions from response analysis
//
// ✅ REFACTORED: All Action creation routed through actionService.createAction()
// Non-action operations (STORE_METADATA, DASHBOARD_FLAG, etc.) remain unchanged.
// ============================================================================

const SurveyResponse = require("../../models/SurveyResponse");
const Logger = require("../../utils/auditLog");

/**
 * Execute triggered actions and store analysis metadata
 * Client Requirement 2: Each response enriched with analytical metadata
 * Client Requirement 5: Action & Workflow Triggering
 */
exports.execute = async ({
  actions,
  insight,
  response,
  survey,
  tenantId
}) => {
  const results = [];

  // ─────────────────────────────────────────────────────────
  // FIRST: Store analysis metadata on the response
  // Client Requirement 2: Response-Level Content Analysis
  // ─────────────────────────────────────────────────────────
  try {
    await SurveyResponse.findByIdAndUpdate(response._id, {
      $set: {
        "analysis.sentiment": insight.sentiment || null,
        "analysis.sentimentScore": insight.sentimentScore || null,
        "analysis.urgency": insight.urgency || null,
        "analysis.emotions": insight.emotions || [],
        "analysis.keywords": insight.keywords || [],
        "analysis.themes": insight.themes || [],
        "analysis.classification": {
          isComplaint: insight.classification?.isComplaint || insight.sentiment === "negative",
          isPraise: insight.classification?.isPraise || insight.sentiment === "positive",
          isSuggestion: insight.classification?.isSuggestion || false
        },
        "analysis.summary": insight.summary || "",
        "analysis.npsCategory": categorizeNPS(response.score),
        "analysis.ratingCategory": categorizeRating(response.rating),
        "analysis.analyzedAt": new Date()
      }
    });
    results.push({ action: "STORE_METADATA", status: "done" });
  } catch (err) {
    Logger.error("actionExecutor", "Failed to store analysis metadata", {
      context: { responseId: response._id, error: err.message }
    });
    results.push({ action: "STORE_METADATA", status: "failed", error: err.message });
  }

  // ─────────────────────────────────────────────────────────
  // Handle action array (can be old format or new format)
  // ─────────────────────────────────────────────────────────
  const actionList = Array.isArray(actions)
    ? (actions.actions || actions)  // Support both { actions: [...] } and [...]
    : [];

  // Lazy-load actionService only if we have actions to create
  let createAction = null;

  for (const action of actionList) {
    const actionType = typeof action === "string" ? action : action.type;

    // ─────────────────────────────────────────────────────────
    // CREATE_ACTION: Generate follow-up task
    // ✅ REFACTORED: Routes through actionService.createAction
    // ─────────────────────────────────────────────────────────
    if (actionType === "CREATE_ACTION") {
      try {
        if (!createAction) {
          createAction = require("../../services/action/actionService").createAction;
        }

        const priority = determinePriority(insight, response);
        const description = buildActionDescription(insight, response, survey);

        const created = await createAction({
          data: {
            title: getActionTitle(insight, response),
            description,
            priority,
            category: determineCategory(insight),
            source: "ai_generated",
            tags: ["auto", "survey", insight.sentiment].filter(Boolean),
            // Phase 1 fields
            problemStatement: insight.summary || description.substring(0, 2000),
            rootCause: {
              category: mapInsightToRootCause(insight),
              summary: insight.summary || null
            },
            priorityReason: `AI analysis: ${insight.sentiment} sentiment, ${insight.urgency || 'normal'} urgency`,
            evidence: {
              responseCount: 1,
              respondentCount: 1,
              responseIds: response._id ? [response._id] : [],
              commentExcerpts: [{
                text: (response.review || insight.summary || '').substring(0, 500),
                sentiment: insight.sentiment || 'neutral',
                responseId: response._id || undefined
              }],
              confidenceScore: insight.confidence != null ? Math.round(insight.confidence * 100) : null
            },
            metadata: {
              surveyId: survey._id,
              responseId: response._id,
              sentiment: insight.sentiment,
              urgency: insight.urgency
            }
          },
          tenantId,
          userId: null,  // System-triggered
          options: { skipNotification: false }
        });
        results.push({ action: actionType, status: "done", id: created._id });
      } catch (err) {
        results.push({ action: actionType, status: "failed", error: err.message });
      }
    }

    // ─────────────────────────────────────────────────────────
    // CREATE_CALLBACK: Customer requested contact
    // ✅ REFACTORED: Routes through actionService.createAction
    // ─────────────────────────────────────────────────────────
    if (actionType === "CREATE_CALLBACK") {
      try {
        if (!createAction) {
          createAction = require("../../services/action/actionService").createAction;
        }

        const created = await createAction({
          data: {
            title: "Customer Callback Requested",
            description: `Customer requested to be contacted.\n\nFeedback: "${response.review || 'No review provided'}"`,
            priority: "high",
            category: "Callback",
            source: "ai_generated",
            tags: ["auto", "callback", "urgent"],
            problemStatement: "Customer explicitly requested to be contacted",
            urgencyReason: "Direct callback request from customer",
            evidence: {
              responseCount: 1,
              respondentCount: 1,
              responseIds: response._id ? [response._id] : [],
              commentExcerpts: [{
                text: (response.review || 'Callback requested').substring(0, 500),
                sentiment: 'negative',
                responseId: response._id || undefined
              }]
            },
            metadata: {
              surveyId: survey._id,
              responseId: response._id,
              sentiment: insight.sentiment
            }
          },
          tenantId,
          userId: null,
          options: { skipNotification: false }
        });
        results.push({ action: actionType, status: "done", id: created._id });
      } catch (err) {
        results.push({ action: actionType, status: "failed", error: err.message });
      }
    }

    // ─────────────────────────────────────────────────────────
    // CREATE_SUGGESTION: Low priority improvement idea
    // ✅ REFACTORED: Routes through actionService.createAction
    // ─────────────────────────────────────────────────────────
    if (actionType === "CREATE_SUGGESTION") {
      try {
        if (!createAction) {
          createAction = require("../../services/action/actionService").createAction;
        }

        const created = await createAction({
          data: {
            title: "Customer Suggestion",
            description: `Customer provided a suggestion.\n\nFeedback: "${response.review || 'See survey response'}"`,
            priority: "low",
            category: "Improvement",
            source: "ai_generated",
            tags: ["auto", "suggestion", "improvement"],
            problemStatement: insight.summary || "Customer suggestion for improvement",
            evidence: {
              responseCount: 1,
              respondentCount: 1,
              responseIds: response._id ? [response._id] : [],
              commentExcerpts: [{
                text: (response.review || 'Suggestion provided').substring(0, 500),
                sentiment: insight.sentiment || 'neutral',
                responseId: response._id || undefined
              }]
            },
            metadata: {
              surveyId: survey._id,
              responseId: response._id,
              sentiment: insight.sentiment
            }
          },
          tenantId,
          userId: null,
          options: { skipNotification: false }
        });
        results.push({ action: actionType, status: "done", id: created._id });
      } catch (err) {
        results.push({ action: actionType, status: "failed", error: err.message });
      }
    }

    // ─────────────────────────────────────────────────────────
    // SEND_ALERT: Notify admins
    // ─────────────────────────────────────────────────────────
    if (actionType === "SEND_ALERT") {
      // Future: email / slack / webhook / push notification
      results.push({ action: actionType, status: "queued" });
    }

    // ─────────────────────────────────────────────────────────
    // DASHBOARD_FLAG: Mark for dashboard visibility
    // ─────────────────────────────────────────────────────────
    if (actionType === "DASHBOARD_FLAG") {
      try {
        await SurveyResponse.findByIdAndUpdate(response._id, {
          $set: { "analysis.flaggedForReview": true }
        });
        results.push({ action: actionType, status: "flagged" });
      } catch (err) {
        results.push({ action: actionType, status: "failed", error: err.message });
      }
    }

    // ─────────────────────────────────────────────────────────
    // ESCALATE: Increase priority of existing actions
    // ─────────────────────────────────────────────────────────
    if (actionType === "ESCALATE") {
      results.push({ action: actionType, status: "escalation_pending" });
    }

    // ─────────────────────────────────────────────────────────
    // TRACK_PRAISE: Record positive feedback for recognition
    // ─────────────────────────────────────────────────────────
    if (actionType === "TRACK_PRAISE") {
      Logger.info("actionExecutor", "Praise tracked for recognition", {
        context: {
          responseId: response._id,
          surveyId: survey._id,
          tenantId,
          sentiment: insight.sentiment,
          summary: insight.summary
        }
      });
      results.push({ action: actionType, status: "tracked" });
    }
  }

  return results;
};

// ─────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────

function categorizeNPS(score) {
  if (score === undefined || score === null) return null;
  if (score >= 9) return "promoter";
  if (score <= 6) return "detractor";
  return "passive";
}

function categorizeRating(rating, max = 5) {
  if (rating === undefined || rating === null) return null;
  const pct = (rating / max) * 100;
  if (pct >= 90) return "excellent";
  if (pct >= 70) return "good";
  if (pct >= 50) return "average";
  if (pct >= 30) return "poor";
  return "very_poor";
}

function getActionTitle(insight, response) {
  if (insight.classification?.isComplaint) return "Customer Complaint";
  if (response.score !== undefined && response.score <= 6) return "NPS Detractor Follow-up";
  if (response.rating && response.rating <= 2) return "Low Rating Alert";
  if (insight.urgency === "high") return "Urgent Customer Issue";
  return "Customer Feedback Issue";
}

function determinePriority(insight, response) {
  // High priority conditions
  if (insight.urgency === "high") return "high";
  if (insight.sentiment === "negative" && response.score !== undefined && response.score <= 3) return "high";
  if (response.rating && response.rating <= 1) return "high";

  // Medium priority conditions
  if (insight.sentiment === "negative") return "medium";
  if (response.score !== undefined && response.score <= 6) return "medium";
  if (response.rating && response.rating <= 2) return "medium";

  return "low";
}

function determineCategory(insight) {
  if (insight.classification?.isComplaint) return "Customer Complaint";
  if (insight.classification?.isSuggestion) return "Improvement";
  if (insight.sentiment === "negative") return "Negative Feedback";
  return "Survey Feedback";
}

function calculateDueDate(priority) {
  const now = new Date();
  switch (priority) {
    case "high": return new Date(now.getTime() + 4 * 60 * 60 * 1000);      // 4 hours
    case "medium": return new Date(now.getTime() + 24 * 60 * 60 * 1000);   // 24 hours
    case "low": return new Date(now.getTime() + 72 * 60 * 60 * 1000);      // 72 hours
    default: return new Date(now.getTime() + 48 * 60 * 60 * 1000);         // 48 hours
  }
}

/**
 * Map AI insight themes/keywords to rootCause category enum
 */
function mapInsightToRootCause(insight) {
  const text = [
    ...(insight.themes || []),
    ...(insight.keywords || []),
    insight.summary || ''
  ].join(' ').toLowerCase();

  const mapping = {
    'compensation': 'compensation', 'salary': 'compensation', 'pay': 'compensation',
    'process': 'process', 'workflow': 'process',
    'communication': 'communication', 'transparency': 'communication',
    'management': 'management', 'leadership': 'management',
    'workload': 'workload', 'burnout': 'workload', 'stress': 'workload',
    'culture': 'culture', 'diversity': 'culture',
    'resources': 'resources', 'tools': 'resources', 'training': 'resources'
  };

  for (const [keyword, category] of Object.entries(mapping)) {
    if (text.includes(keyword)) return category;
  }
  return 'unknown';
}

function buildActionDescription(insight, response, survey) {
  const parts = [];

  parts.push(`Survey: ${survey?.title || "Unknown"}`);
  parts.push(`Sentiment: ${insight.sentiment || "N/A"}`);

  if (insight.urgency) parts.push(`Urgency: ${insight.urgency}`);
  if (response.rating) parts.push(`Rating: ${response.rating}/5`);
  if (response.score !== undefined) parts.push(`NPS Score: ${response.score}/10`);
  if (insight.summary) parts.push(`\nSummary: ${insight.summary}`);

  if (response.review) {
    const truncated = response.review.length > 300
      ? response.review.substring(0, 300) + "..."
      : response.review;
    parts.push(`\nCustomer Feedback: "${truncated}"`);
  }

  if (insight.keywords?.length > 0) {
    parts.push(`\nKey Topics: ${insight.keywords.slice(0, 5).join(", ")}`);
  }

  if (insight.emotions?.length > 0) {
    parts.push(`Detected Emotions: ${insight.emotions.join(", ")}`);
  }

  return parts.join("\n");
}

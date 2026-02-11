// services/action/actionService.js
// ============================================================================
// Action Service — Single Source of Truth for Action Creation
//
// ALL action creation paths (manual, AI, pipeline) MUST go through
// createAction(). This enforces:
//   ✅ Joi validation
//   ✅ Tenant isolation
//   ✅ Auto-dueDate calculation
//   ✅ Assignee validation
//   ✅ Assignment rules
//   ✅ Phase 1 field population
//   ✅ Evidence & metadata enrichment from feedback
//   ✅ Immutable field enforcement
//   ✅ Strict field whitelisting
// ============================================================================

const Action = require("../../models/Action");
const FeedbackAnalysis = require("../../models/FeedbackAnalysis");
const User = require("../../models/User");
const { sendNotification } = require("../../utils/sendNotification");
const assignmentService = require("./assignmentService");
const { createActionSchema } = require("../../validators/actionValidator");
const Logger = require("../../utils/logger");

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate that a user belongs to a tenant
 */
async function validateUserBelongsToTenant(userId, tenantId) {
    if (!userId) return null;
    const user = await User.findById(userId).select("_id tenant name email");
    if (!user) return null;
    if (user.tenant.toString() !== tenantId.toString()) return null;
    return user;
}

/**
 * Push assignment history entry to action
 */
function pushAssignmentHistory(action, { from, to, toTeam, byUserId, auto = false, note = null }) {
    action.assignmentHistory = action.assignmentHistory || [];
    action.assignmentHistory.push({
        from: from || null,
        to: to || null,
        toTeam: toTeam || null,
        by: byUserId,
        at: new Date(),
        auto,
        note
    });
}

// ============================================================================
// Service-level Joi validation
// ============================================================================

/**
 * Validate incoming data against the createAction schema.
 * Called inside the service — so ALL creation paths are validated,
 * regardless of whether they enter via route or internal call.
 */
function validateCreatePayload(data) {
    const { error, value } = createActionSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true   // Remove any field not in the schema
    });
    if (error) {
        const msg = error.details.map(d => d.message).join("; ");
        throw { statusCode: 400, message: `Validation failed: ${msg}` };
    }
    return value;
}

// ============================================================================
// Feedback enrichment — Phase 1 field population
// ============================================================================

/**
 * Enrich action payload with Phase 1 fields derived from feedback.
 *
 * @param {Object} actionPayload - The payload being constructed
 * @param {Object} feedback - The FeedbackAnalysis document
 * @param {Object} data - The validated incoming data
 * @param {string} tenantId - Tenant ID for ownership checks
 * @returns {void} Mutates actionPayload in place
 */
async function enrichFromFeedback(actionPayload, feedback, data, tenantId) {
    // ── Ownership validation (Gap 3 fix) ────────────────────────────
    // feedback.tenant was already checked above; now validate survey if present
    if (feedback.survey) {
        // survey is populated from FeedbackAnalysis in the AI controller,
        // but when called from manual creation it may be just an ObjectId.
        // We only write it to metadata if it exists.
        const surveyId = typeof feedback.survey === 'object'
            ? (feedback.survey._id || feedback.survey)
            : feedback.survey;
        actionPayload.metadata = {
            ...(actionPayload.metadata || {}),
            surveyId: surveyId || null
        };
    }

    // response ref
    if (feedback.response) {
        actionPayload.metadata = {
            ...(actionPayload.metadata || {}),
            responseId: feedback.response || null
        };
    }

    // sentiment
    if (feedback.sentiment) {
        actionPayload.metadata = {
            ...(actionPayload.metadata || {}),
            sentiment: feedback.sentiment
        };
    }

    // confidence from caller (AI pipeline provides this)
    if (data.metadata?.confidence != null) {
        actionPayload.metadata = {
            ...(actionPayload.metadata || {}),
            confidence: data.metadata.confidence
        };
    }

    // ── Problem statement fallback ──────────────────────────────────
    if (!actionPayload.problemStatement) {
        // Use feedback summary if available, categories string, or description
        const feedbackSummary = feedback.summary || feedback.categories?.join(', ') || null;
        actionPayload.problemStatement = feedbackSummary || actionPayload.description;
    }

    // ── Root cause from feedback category ───────────────────────────
    if (!actionPayload.rootCause || !actionPayload.rootCause.category || actionPayload.rootCause.category === 'unknown') {
        const feedbackCategory = feedback.category || (feedback.categories && feedback.categories[0]) || null;
        if (feedbackCategory) {
            actionPayload.rootCause = {
                ...(actionPayload.rootCause || {}),
                category: mapFeedbackCategoryToRootCause(feedbackCategory),
                summary: actionPayload.rootCause?.summary || null
            };
        }
    }

    // ── Evidence (per-feedback, aggregated for multi-feedback by caller) ─
    if (!actionPayload.evidence || !actionPayload.evidence.responseCount) {
        actionPayload.evidence = {
            responseCount: 1,
            respondentCount: 1,
            responseIds: feedback.response ? [feedback.response] : [],
            commentExcerpts: [{
                text: (feedback.summary || feedback.categories?.join(', ') || actionPayload.description || '').substring(0, 500),
                sentiment: feedback.sentiment || 'neutral',
                responseId: feedback.response || undefined
            }],
            confidenceScore: data.metadata?.confidence != null
                ? Math.round(data.metadata.confidence * 100)
                : null
        };
    }
}

/**
 * Map a free-text feedback category to a rootCause enum value.
 */
function mapFeedbackCategoryToRootCause(feedbackCategory) {
    if (!feedbackCategory || typeof feedbackCategory !== 'string') return 'unknown';

    const lc = feedbackCategory.toLowerCase();
    const mapping = {
        'compensation': 'compensation', 'salary': 'compensation', 'pay': 'compensation', 'benefits': 'compensation',
        'process': 'process', 'workflow': 'process', 'procedure': 'process', 'inefficiency': 'process',
        'communication': 'communication', 'transparency': 'communication', 'feedback': 'communication',
        'management': 'management', 'leadership': 'management', 'supervisor': 'management',
        'workload': 'workload', 'burnout': 'workload', 'overtime': 'workload', 'stress': 'workload',
        'culture': 'culture', 'diversity': 'culture', 'inclusion': 'culture', 'environment': 'culture',
        'resources': 'resources', 'tools': 'resources', 'training': 'resources', 'equipment': 'resources'
    };

    for (const [keyword, category] of Object.entries(mapping)) {
        if (lc.includes(keyword)) return category;
    }
    return 'unknown';
}

// ============================================================================
// CORE: createAction  —  Single Entry Point
// ============================================================================

/**
 * Create a new action with full Phase 1 support.
 *
 * ALL creation paths (manual controller, AI pipeline, pipeline processors)
 * MUST call this function. Direct Action.create() outside this service is
 * explicitly forbidden.
 *
 * @param {Object} params
 * @param {Object} params.data     - Action data (validated against createActionSchema)
 * @param {string} params.tenantId - Tenant ObjectId (enforced; cannot be overridden by data)
 * @param {string} params.userId   - Creator's ObjectId (enforced; cannot be overridden by data)
 * @param {Object} [params.options] - Optional flags
 * @param {boolean} [params.options.skipNotification] - Skip assignee notification (AI bulk mode)
 * @returns {Promise<Object>} Created action document (populated)
 */
async function createAction({ data, tenantId, userId, options = {} }) {
    // ── 1. Service-level Joi validation (Gap 1 fix) ─────────────────
    const validated = validateCreatePayload(data);

    // ── 2. Destructure validated fields (strict whitelist) ──────────
    const {
        feedbackId, title, description, priority,
        assignedTo, team, dueDate, tags, category, source,
        // Phase 1 fields
        problemStatement, rootCause, affectedAudience,
        priorityReason, urgencyReason, evidence, metadata
    } = validated;

    // ── 3. Feedback ownership validation ────────────────────────────
    let feedback = null;
    if (feedbackId) {
        feedback = await FeedbackAnalysis.findById(feedbackId);
        if (!feedback || feedback.tenant.toString() !== tenantId.toString()) {
            throw { statusCode: 404, message: "Feedback not found or not in tenant" };
        }
    }

    // ── 4. Assignee tenant validation (Gap 3 fix) ───────────────────
    let validatedAssignee = null;
    if (assignedTo) {
        validatedAssignee = await validateUserBelongsToTenant(assignedTo, tenantId);
        if (!validatedAssignee) {
            throw { statusCode: 404, message: "Assignee not found or not in tenant" };
        }
    }

    // ── 5. Auto due-date calculation ────────────────────────────────
    const now = new Date();
    const prioritiesMap = { high: 1, medium: 7, low: 14, "long-term": 30 };
    const autoDueDate = dueDate
        ? new Date(dueDate)
        : new Date(now.getTime() + (prioritiesMap[priority] || 7) * 24 * 60 * 60 * 1000);

    // ── 6. Build action payload (strict whitelist — no spread) ──────
    const actionPayload = {
        // Immutable fields — service-enforced, never from caller
        tenant: tenantId,
        createdBy: userId || null,  // null for system-triggered actions
        autoAssigned: false,
        isDeleted: false,

        // Core fields
        title: title || description.substring(0, 80),
        feedback: feedbackId || null,
        description,
        priority,
        assignedTo: validatedAssignee ? validatedAssignee._id : null,
        assignedToTeam: null,
        team: team || null,
        dueDate: autoDueDate,
        tags: tags || [],
        category: category || "general",
        source: source || "manual",

        // Phase 1 fields (caller-provided values first)
        problemStatement: problemStatement || null,
        rootCause: rootCause || { category: 'unknown' },
        affectedAudience: affectedAudience || { segments: [], estimatedCount: 0 },
        priorityReason: priorityReason || null,
        urgencyReason: urgencyReason || null,
        evidence: evidence || null,
        metadata: metadata || {}
    };

    // ── 7. Feedback enrichment (populates Phase 1 from feedback) ────
    if (feedback) {
        await enrichFromFeedback(actionPayload, feedback, validated, tenantId);
    } else if (!actionPayload.problemStatement) {
        // Fallback: problemStatement = description
        actionPayload.problemStatement = description;
    }

    // ── 8. Apply assignment rules ───────────────────────────────────
    if (!actionPayload.assignedTo) {
        const ruleResult = await assignmentService.applyAssignmentRules(actionPayload, tenantId);
        if (ruleResult) {
            if (ruleResult.assignedTo) actionPayload.assignedTo = ruleResult.assignedTo;
            if (ruleResult.assignedToTeam) actionPayload.assignedToTeam = ruleResult.assignedToTeam;
            if (ruleResult.priority) actionPayload.priority = ruleResult.priority;
            actionPayload.autoAssigned = true;
        }
    }

    // ── 9. Create action ────────────────────────────────────────────
    const action = await Action.create(actionPayload);

    // ── 10. Push assignment history ─────────────────────────────────
    if (action.autoAssigned && action.assignedTo) {
        pushAssignmentHistory(action, {
            from: null,
            to: action.assignedTo,
            toTeam: action.assignedToTeam,
            byUserId: userId,
            auto: true,
            note: "Auto-assigned on create"
        });
        await action.save();
    }

    // ── 11. Populate refs for response ──────────────────────────────
    await action.populate([
        { path: "feedback", select: "sentiment categories" },
        { path: "assignedTo", select: "name email" },
        { path: "createdBy", select: "name email" }
    ]);

    // ── 12. Notify assignee (unless suppressed) ─────────────────────
    if (!options.skipNotification && action.assignedTo) {
        try {
            await sendNotification({
                userId: action.assignedTo._id || action.assignedTo,
                type: "action_assigned",
                message: `New ${action.priority} priority action assigned: ${action.description?.substring(0, 100)}`,
                data: { actionId: action._id, priority: action.priority, dueDate: action.dueDate }
            });
        } catch (notifErr) {
            // Non-blocking — log and continue
            Logger.error("createAction", "Failed to send assignee notification", {
                error: notifErr,
                context: { actionId: action._id, assignedTo: action.assignedTo }
            });
        }
    }

    return action;
}

// ============================================================================
// updateAction
// ============================================================================

/**
 * Update action with validation and notifications
 */
async function updateAction({ actionId, data, tenantId, userId, userRole }) {
    const action = await Action.findOne({ _id: actionId, tenant: tenantId, isDeleted: false });
    if (!action) throw { statusCode: 404, message: "Action not found" };

    // Authorization
    const canUpdate = userRole === "admin" || userRole === "companyAdmin" ||
        (action.assignedTo && action.assignedTo.toString() === userId.toString());
    if (!canUpdate) throw { statusCode: 403, message: "Not authorized to update this action" };

    const allowed = ["description", "priority", "team", "status", "dueDate", "tags", "category", "resolution"];
    const oldStatus = action.status;

    for (const key of Object.keys(data)) {
        if (allowed.includes(key)) action[key] = data[key];
    }

    if (data.status === "resolved" && oldStatus !== "resolved") {
        action.completedAt = new Date();
        action.completedBy = userId;
    }

    await action.save();

    await action.populate([
        { path: "feedback", select: "sentiment categories" },
        { path: "assignedTo", select: "name email avatar" },
        { path: "createdBy", select: "name email" },
        { path: "completedBy", select: "name email" }
    ]);

    // Notify on status change
    if (oldStatus !== action.status && action.assignedTo && action.assignedTo._id.toString() !== userId.toString()) {
        await sendNotification({
            userId: action.assignedTo._id,
            type: "action_status_updated",
            message: `Action status updated to: ${action.status}`,
            data: { actionId: action._id, oldStatus, newStatus: action.status }
        });
    }

    return action;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
    validateUserBelongsToTenant,
    pushAssignmentHistory,
    validateCreatePayload,
    createAction,
    updateAction
};

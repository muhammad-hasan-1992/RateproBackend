// validators/actionValidator.js
const Joi = require("joi");

// ============================================================================
// Root Cause Categories (matches Action.js schema enum)
// ============================================================================
const ROOT_CAUSE_CATEGORIES = [
    'compensation', 'process', 'communication', 'management',
    'workload', 'culture', 'resources', 'unknown'
];

// ============================================================================
// Create Action Schema — Phase 1 Enhanced
// Accepts both basic fields and Phase 1 enrichment fields.
// Used by service-level validation (not just route-level).
// ============================================================================
exports.createActionSchema = Joi.object({
    // ── Core Fields (required) ─────────────────────────────────────────
    description: Joi.string().min(5).required(),
    priority: Joi.string().valid("high", "medium", "low", "long-term").required(),

    // ── Core Fields (optional) ─────────────────────────────────────────
    feedbackId: Joi.string().hex().length(24).optional(),
    title: Joi.string().min(3).optional().allow(''),
    assignedTo: Joi.string().hex().length(24).optional().allow(null),
    team: Joi.string().min(2).optional().allow(null),
    dueDate: Joi.date().optional().allow(null),
    tags: Joi.array().items(Joi.string()).optional(),
    category: Joi.string().optional(),
    source: Joi.string().valid("manual", "survey_feedback", "ai_generated").optional(),

    // ── Phase 1: Problem Framing ───────────────────────────────────────
    problemStatement: Joi.string().max(2000).optional().allow(null, ''),

    affectedAudience: Joi.object({
        segments: Joi.array().items(Joi.string()).optional(),
        estimatedCount: Joi.number().integer().min(0).optional()
    }).optional().allow(null),

    // ── Phase 1: Root Cause ────────────────────────────────────────────
    rootCause: Joi.object({
        category: Joi.string().valid(...ROOT_CAUSE_CATEGORIES).optional(),
        summary: Joi.string().max(1000).optional().allow(null, '')
    }).optional().allow(null),

    // ── Phase 1: Priority Rationale ────────────────────────────────────
    priorityReason: Joi.string().max(500).optional().allow(null, ''),
    urgencyReason: Joi.string().max(500).optional().allow(null, ''),

    // ── Phase 1: Evidence ──────────────────────────────────────────────
    evidence: Joi.object({
        responseCount: Joi.number().integer().min(0).optional(),
        respondentCount: Joi.number().integer().min(0).optional(),
        responseIds: Joi.array().items(Joi.string().hex().length(24)).optional(),
        commentExcerpts: Joi.array().items(Joi.object({
            text: Joi.string().max(500).required(),
            sentiment: Joi.string().valid('positive', 'neutral', 'negative').optional(),
            responseId: Joi.string().hex().length(24).optional()
        })).optional(),
        confidenceScore: Joi.number().min(0).max(100).optional()
    }).optional().allow(null),

    // ── Phase 1: Metadata ──────────────────────────────────────────────
    metadata: Joi.object({
        surveyId: Joi.string().hex().length(24).optional().allow(null),
        responseId: Joi.string().hex().length(24).optional().allow(null),
        sentiment: Joi.string().valid('positive', 'neutral', 'negative').optional(),
        confidence: Joi.number().min(0).max(1).optional(),
        urgency: Joi.string().valid('low', 'medium', 'high').optional()
    }).optional().allow(null),

    // ── Phase 1: Flags ─────────────────────────────────────────────────
    legacyAction: Joi.boolean().optional(),
    hasActionPlan: Joi.boolean().optional()
});

// ============================================================================
// Update Action Schema
// ============================================================================
exports.updateActionSchema = Joi.object({
    description: Joi.string().min(5).optional(),
    priority: Joi.string().valid("high", "medium", "low", "long-term").optional(),
    assignedTo: Joi.string().hex().length(24).allow(null).optional(),
    team: Joi.string().min(2).allow(null).optional(),
    status: Joi.string().valid("pending", "open", "in-progress", "resolved").optional(),
    dueDate: Joi.date().allow(null).optional(),
    tags: Joi.array().items(Joi.string()).optional(),
    category: Joi.string().optional(),
    resolution: Joi.string().optional()
});

// ============================================================================
// Bulk Update Schema
// ============================================================================
exports.bulkUpdateSchema = Joi.object({
    actionIds: Joi.array().items(Joi.string().hex().length(24)).min(1).required(),
    updates: Joi.object({
        priority: Joi.string().valid("high", "medium", "low", "long-term").optional(),
        status: Joi.string().valid("pending", "open", "in-progress", "resolved").optional(),
        assignedTo: Joi.string().hex().length(24).allow(null).optional(),
        team: Joi.string().optional().allow(null)
    }).min(1).required()
});

// ============================================================================
// Assign Action Schema
// ============================================================================
exports.assignActionSchema = Joi.object({
    assignedTo: Joi.string().hex().length(24).optional().allow(null),
    team: Joi.string().min(2).optional().allow(null)
});

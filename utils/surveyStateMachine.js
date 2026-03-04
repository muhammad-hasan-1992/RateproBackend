// utils/surveyStateMachine.js
// ============================================================================
// Centralized Survey State Machine
// 
// Single source of truth for all status transitions and allowed actions.
// All controllers MUST use this utility — no inline status logic.
//
// IMPORTANT: "deleted" is NOT a status — it's a soft-delete flag (deleted: true).
// Deletion eligibility is handled by canDelete(), not by status transitions.
//
// NOTE: If building a cron job for scheduled → active auto-publish,
// it MUST use validateStatusTransition('scheduled', 'active') — never set
// status directly.
// ============================================================================

/**
 * Valid status transitions map
 * Key: current status → Value: array of allowed target statuses
 * 
 * NOTE: "deleted" is intentionally absent — it's a flag, not a status.
 */
const VALID_TRANSITIONS = {
    draft: ['active', 'scheduled'],
    scheduled: ['active', 'draft'],
    active: ['inactive', 'closed'],
    inactive: ['active'],
    closed: ['archived'],
    archived: [],  // Terminal state
};

/**
 * All valid survey statuses
 */
const SURVEY_STATUSES = Object.keys(VALID_TRANSITIONS);

/**
 * Validate if a status transition is allowed
 * 
 * @param {string} from - Current status
 * @param {string} to - Target status
 * @returns {{ valid: boolean, message?: string }}
 */
function validateStatusTransition(from, to) {
    if (!VALID_TRANSITIONS[from]) {
        return { valid: false, message: `Unknown current status: "${from}"` };
    }

    if (!VALID_TRANSITIONS[to]) {
        return { valid: false, message: `Unknown target status: "${to}"` };
    }

    if (!VALID_TRANSITIONS[from].includes(to)) {
        return {
            valid: false,
            message: `Cannot transition from "${from}" to "${to}". Allowed transitions from "${from}": [${VALID_TRANSITIONS[from].join(', ')}]`
        };
    }

    return { valid: true };
}

/**
 * Check if a survey can be soft-deleted based on status and response count.
 * Deletion is a flag (deleted: true), NOT a status transition.
 * 
 * @param {string} status - Current survey status
 * @param {number} totalResponses - Number of responses stored on the survey model
 * @param {number} actualResponseCount - Live count from SurveyResponse.countDocuments
 * @returns {{ allowed: boolean, message?: string }}
 */
function canDelete(status, totalResponses = 0, actualResponseCount = 0) {
    const deletableStatuses = ['draft', 'inactive', 'scheduled'];

    if (!deletableStatuses.includes(status)) {
        return {
            allowed: false,
            message: `Cannot delete a survey with status "${status}". Only draft, inactive, or scheduled surveys can be deleted.`
        };
    }

    // Use the higher of the two counts as safety measure
    const effectiveCount = Math.max(totalResponses, actualResponseCount);
    if (effectiveCount > 0) {
        return {
            allowed: false,
            message: `Cannot delete survey with ${effectiveCount} response(s). Archive it instead.`
        };
    }

    return { allowed: true };
}

/**
 * Get allowed actions for a survey based on status and response count
 * This is returned from the API so the frontend doesn't duplicate business logic.
 * 
 * @param {string} status - Survey status
 * @param {number} totalResponses - Number of responses collected
 * @returns {Object} Map of action → boolean
 */
function getAllowedActions(status, totalResponses = 0) {
    const hasResponses = totalResponses > 0;

    return {
        edit: ['draft', 'scheduled'].includes(status),
        delete: ['draft', 'inactive', 'scheduled'].includes(status) && !hasResponses,
        activate: status === 'inactive',
        deactivate: status === 'active',
        close: status === 'active',
        archive: status === 'closed',
        analytics: hasResponses,
        feedback: hasResponses,
        distribution: status === 'active',
        viewDetail: true,
    };
}

module.exports = {
    VALID_TRANSITIONS,
    SURVEY_STATUSES,
    validateStatusTransition,
    canDelete,
    getAllowedActions,
};

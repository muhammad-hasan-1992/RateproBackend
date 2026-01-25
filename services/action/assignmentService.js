// services/action/assignmentService.js
const Action = require("../../models/Action");
const AssignmentRule = require("../../models/AssignmentRule");
const Tenant = require("../../models/Tenant");

/**
 * Apply assignment rules to determine auto-assignment
 * Supports: single_owner, round_robin, least_load
 * Falls back to tenant default if no rule matches
 */
async function applyAssignmentRules(actionObj, tenantId, creatorId = null) {
    const rules = await AssignmentRule.find({ tenant: tenantId, isActive: true }).sort({ priority: -1 }).lean();

    for (const rule of rules) {
        let match = true;
        for (const cond of (rule.conditions || [])) {
            // Get value from action or metadata (for sentiment, urgency, etc.)
            let value = actionObj[cond.field];
            if (value === undefined && actionObj.metadata) {
                value = actionObj.metadata[cond.field];
            }

            // Evaluate condition
            if (cond.operator === '==' && String(value) !== String(cond.value)) {
                match = false; break;
            }
            if (cond.operator === '!=' && String(value) === String(cond.value)) {
                match = false; break;
            }
            if (cond.operator === 'contains' && (!value || !String(value).toLowerCase().includes(String(cond.value).toLowerCase()))) {
                match = false; break;
            }
            if (cond.operator === 'in' && Array.isArray(cond.value) && !cond.value.includes(value)) {
                match = false; break;
            }
            if (cond.operator === '>=' && Number(value) < Number(cond.value)) {
                match = false; break;
            }
            if (cond.operator === '<=' && Number(value) > Number(cond.value)) {
                match = false; break;
            }
        }
        if (!match) continue;

        const assignment = rule.assignment || {};
        const result = { assignedTo: null, assignedToTeam: null, priority: null, autoAssigned: true, note: `Rule "${rule.name}" applied` };

        if (assignment.mode === "single_owner" && assignment.targetUser) {
            result.assignedTo = assignment.targetUser;
            result.assignedToTeam = assignment.targetTeam || null;
        } else if (assignment.mode === "round_robin") {
            const members = assignment.teamMembers || [];
            if (members.length > 0) {
                const nextRule = await AssignmentRule.findOneAndUpdate(
                    { _id: rule._id },
                    [{ $set: { lastAssignedIndex: { $add: [{ $ifNull: ["$lastAssignedIndex", -1] }, 1] } } }],
                    { new: true }
                ).lean().catch(() => null);

                let idx = 0;
                if (nextRule && typeof nextRule.lastAssignedIndex === 'number') {
                    idx = nextRule.lastAssignedIndex % members.length;
                }
                result.assignedTo = members[idx];
                result.assignedToTeam = assignment.targetTeam || null;
            }
        } else if (assignment.mode === "least_load") {
            const members = assignment.teamMembers || [];
            if (members.length > 0) {
                const counts = await Promise.all(members.map(async (m) => {
                    const count = await Action.countDocuments({ tenant: tenantId, assignedTo: m, status: { $ne: 'resolved' }, isDeleted: false });
                    return { member: m, count };
                }));
                counts.sort((a, b) => a.count - b.count);
                result.assignedTo = counts[0].member;
                result.assignedToTeam = assignment.targetTeam || null;
            }
        } else {
            result.assignedTo = assignment.targetUser || null;
            result.assignedToTeam = assignment.targetTeam || null;
        }

        if (rule.priorityOverride) {
            result.priority = rule.priorityOverride;
        }

        return result;
    }

    // No rule matched - apply fallback logic
    return applyFallbackAssignment(tenantId, creatorId);
}

/**
 * Fallback assignment when no rules match
 * Uses tenant settings: defaultAssignee, autoAssignToCreator
 */
async function applyFallbackAssignment(tenantId, creatorId) {
    const tenant = await Tenant.findById(tenantId).select("actionSettings").lean();

    if (!tenant?.actionSettings) {
        return null; // No fallback configured
    }

    const { defaultAssignee, defaultTeam, autoAssignToCreator } = tenant.actionSettings;

    // Priority: defaultAssignee > autoAssignToCreator
    if (defaultAssignee) {
        return {
            assignedTo: defaultAssignee,
            assignedToTeam: defaultTeam || null,
            priority: null,
            autoAssigned: true,
            note: "Assigned to tenant default assignee"
        };
    }

    if (autoAssignToCreator && creatorId) {
        return {
            assignedTo: creatorId,
            assignedToTeam: defaultTeam || null,
            priority: null,
            autoAssigned: true,
            note: "Auto-assigned to action creator"
        };
    }

    // No fallback available
    return null;
}

module.exports = {
    applyAssignmentRules,
    applyFallbackAssignment
};


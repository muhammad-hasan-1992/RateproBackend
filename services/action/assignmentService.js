// services/action/assignmentService.js
const Action = require("../../models/Action");
const AssignmentRule = require("../../models/AssignmentRule");

/**
 * Apply assignment rules to determine auto-assignment
 * Supports: single_owner, round_robin, least_load
 */
async function applyAssignmentRules(actionObj, tenantId) {
    const rules = await AssignmentRule.find({ tenant: tenantId, isActive: true }).sort({ priority: -1 }).lean();

    for (const rule of rules) {
        let match = true;
        for (const cond of (rule.conditions || [])) {
            const value = actionObj[cond.field] || actionObj.metadata?.[cond.field];
            if (cond.operator === '==' && String(value) !== String(cond.value)) {
                match = false; break;
            }
            if (cond.operator === 'contains' && (!value || !String(value).includes(cond.value))) {
                match = false; break;
            }
        }
        if (!match) continue;

        const assignment = rule.assignment || {};
        const result = { assignedTo: null, assignedToTeam: null, priority: null, autoAssigned: true, note: `Rule ${rule._id} applied` };

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

    return null;
}

module.exports = {
    applyAssignmentRules
};

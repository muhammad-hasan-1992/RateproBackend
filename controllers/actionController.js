// controllers/actionController.js
const Action = require("../models/Action");
const FeedbackAnalysis = require("../models/FeedbackAnalysis");
const AssignmentRule = require("../models/AssignmentRule");
const User = require("../models/User");
const Survey = require("../models/Survey");
const aiClient = require("../utils/aiClient");
const { sendNotification } = require("../utils/sendNotification");
const Joi = require("joi");
const followUp = require("./feedbackController");
const Logger = require("../utils/logger");
const mongoose = require("mongoose");

// ----------------- Validation schemas (centralized) -----------------
const createActionSchema = Joi.object({
  feedbackId: Joi.string().hex().length(24).optional(),
  title: Joi.string().min(3).optional().allow(''),
  description: Joi.string().min(5).required(),
  priority: Joi.string().valid("high", "medium", "low", "long-term").required(),
  assignedTo: Joi.string().hex().length(24).optional().allow(null),
  team: Joi.string().min(2).optional().allow(null),
  dueDate: Joi.date().optional().allow(null),
  tags: Joi.array().items(Joi.string()).optional(),
  category: Joi.string().optional(),
  source: Joi.string().valid("manual", "survey_feedback", "ai_generated").optional()
});

const updateActionSchema = Joi.object({
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

const bulkUpdateSchema = Joi.object({
  actionIds: Joi.array().items(Joi.string().hex().length(24)).min(1).required(),
  updates: Joi.object({
    priority: Joi.string().valid("high", "medium", "low", "long-term").optional(),
    status: Joi.string().valid("pending", "open", "in-progress", "resolved").optional(),
    assignedTo: Joi.string().hex().length(24).allow(null).optional(),
    team: Joi.string().optional().allow(null)
  }).min(1).required()
});

// ----------------- Helper utilities (kept inside controller for now) -----------------

/**
 * Validate that an objectId belongs to the tenant (generic)
 */
async function validateUserBelongsToTenant(userId, tenantId) {
  if (!userId) return null;
  const user = await User.findById(userId).select("_id tenant name email");
  if (!user) return null;
  if (user.tenant.toString() !== tenantId.toString()) return null;
  return user;
}

/**
 * Create assignment history entry and push into action
 * action: mongoose document
 */
async function pushAssignmentHistory(action, { from, to, toTeam, byUserId, auto = false, note = null }) {
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

/**
 * Apply assignment rules (basic engine).
 * Supports condition operators '==' and 'contains'.
 * Assignment modes:
 *  - single_owner : rule.assignment.targetUser (userId)
 *  - round_robin  : rule.assignment.teamMembers (array of userIds) + rule._id used to track lastAssigned info
 *  - least_load   : placeholder (requires open-action counts)
 *
 * NOTE: AssignmentRule model expected shape (example):
 * {
 *   tenant: ObjectId,
 *   priority: Number, // sort order
 *   conditions: [{ field: "category", operator: "==", value: "Medical Service" }, ...],
 *   assignment: { mode: "single_owner"|"round_robin"|"least_load", targetUser: userId, targetTeam: 'Healthcare Team', teamMembers: [userId...] },
 *   priorityOverride: "high" | null,
 *   isActive: true
 * }
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
      // add operators as needed
    }
    if (!match) continue;

    // We have a matching rule
    const assignment = rule.assignment || {};
    const result = { assignedTo: null, assignedToTeam: null, priority: null, autoAssigned: true, note: `Rule ${rule._id} applied` };

    if (assignment.mode === "single_owner" && assignment.targetUser) {
      result.assignedTo = assignment.targetUser;
      result.assignedToTeam = assignment.targetTeam || null;
    } else if (assignment.mode === "round_robin") {
      // pick next from teamMembers array and atomically update rule's lastIndex (best-effort)
      const members = assignment.teamMembers || [];
      if (members.length > 0) {
        // Compute next index using a findOneAndUpdate on the rule doc (atomic)
        // We store lastAssignedIndex on rule doc (best-effort). If not present, treat as -1.
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
      // Placeholder: assign to member with fewest open actions (requires extra query) - basic implementation
      const members = assignment.teamMembers || [];
      if (members.length > 0) {
        // get counts
        const counts = await Promise.all(members.map(async (m) => {
          const count = await Action.countDocuments({ tenant: tenantId, assignedTo: m, status: { $ne: 'resolved' }, isDeleted: false });
          return { member: m, count };
        }));
        counts.sort((a, b) => a.count - b.count);
        result.assignedTo = counts[0].member;
        result.assignedToTeam = assignment.targetTeam || null;
      }
    } else {
      // If no assignment mode matches, try direct targetUser/team
      result.assignedTo = assignment.targetUser || null;
      result.assignedToTeam = assignment.targetTeam || null;
    }

    if (rule.priorityOverride) {
      result.priority = rule.priorityOverride;
    }

    return result; // first matching rule applies
  }

  // No rule matched
  return null;
}

// ----------------- Controller actions -----------------

// Create new action
exports.createAction = async (req, res, next) => {
  try {
    const { error, value } = createActionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { feedbackId, title, description, priority, assignedTo, team, dueDate, tags, category, source } = value;

    // Validate feedback tenant ownership
    if (feedbackId) {
      const feedback = await FeedbackAnalysis.findById(feedbackId);
      if (!feedback || feedback.tenant.toString() !== req.user.tenant.toString()) {
        return res.status(404).json({ success: false, message: "Feedback not found or not in tenant" });
      }
    }

    // Validate assignedTo if provided (tenant owner)
    let validatedAssignee = null;
    if (assignedTo) {
      validatedAssignee = await validateUserBelongsToTenant(assignedTo, req.user.tenant);
      if (!validatedAssignee) {
        return res.status(404).json({ success: false, message: "Assignee not found or not in tenant" });
      }
    }

    // Auto due date mapping (centralized)
    const now = new Date();
    const prioritiesMap = { high: 1, medium: 7, low: 14, "long-term": 30 };
    const autoDueDate = dueDate ? new Date(dueDate) : new Date(now.getTime() + (prioritiesMap[priority] || 7) * 24 * 60 * 60 * 1000);

    // Build base action object (not saved yet)
    const actionPayload = {
      title: title || description.substring(0, 80),
      feedback: feedbackId || null,
      description,
      priority,
      assignedTo: validatedAssignee ? validatedAssignee._id : null,
      assignedToTeam: validatedAssignee ? null : null,
      team: team || null,
      tenant: req.user.tenant,
      dueDate: autoDueDate,
      tags: tags || [],
      category: category || "general",
      createdBy: req.user._id,
      source: source || "manual",
      autoAssigned: false
    };

    // If assignedTo not given, try assignment rules
    if (!actionPayload.assignedTo) {
      const ruleResult = await applyAssignmentRules(actionPayload, req.user.tenant);
      if (ruleResult) {
        if (ruleResult.assignedTo) actionPayload.assignedTo = ruleResult.assignedTo;
        if (ruleResult.assignedToTeam) actionPayload.assignedToTeam = ruleResult.assignedToTeam;
        if (ruleResult.priority) actionPayload.priority = ruleResult.priority;
        actionPayload.autoAssigned = true;
      }
    }

    const action = await Action.create(actionPayload);

    // Push assignmentHistory if auto-assigned
    if (action.autoAssigned && action.assignedTo) {
      await pushAssignmentHistory(action, { from: null, to: action.assignedTo, toTeam: action.assignedToTeam, byUserId: req.user._id, auto: true, note: "Auto-assigned on create" });
      await action.save();
    }

    // Populate for response
    await action.populate([
      { path: "feedback", select: "sentiment category summary" },
      { path: "assignedTo", select: "name email" },
      { path: "createdBy", select: "name email" }
    ]);

    // Send notification if assigned
    if (action.assignedTo) {
      await sendNotification({
        userId: action.assignedTo,
        type: "action_assigned",
        message: `New ${action.priority} priority action assigned: ${action.description}`,
        data: { actionId: action._id, priority: action.priority, dueDate: action.dueDate }
      });
    }

    // Update dashboard metrics (ensure implementation exists)
    // if (typeof dashboardMetrics?.updateDashboardMetrics === 'function') {
    //   try { await dashboardMetrics.updateDashboardMetrics(req.user.tenant); } catch (e) { /* don't block response */ }
    // }

    Logger.info("createAction", "Action created successfully", {
      context: {
        userId: req.user._id,
        actionId: action._id,
        tenantId: req.user.tenant,
        priority: action.priority,
        assignedTo: action.assignedTo
      },
      req
    });

    res.status(201).json({ success: true, message: "Action created successfully", data: action });

  } catch (err) {
    Logger.error("createAction", "Error creating action", {
      error: err, // 🔑 FULL ERROR OBJECT
      context: {
        body: req.body,
        userId: req.user?._id
      },
      req
    });
    res.status(500).json({ success: false, message: "Error creating action", error: err.message });
  }
};

// Get actions with filtering + pagination (honour soft-delete)
exports.getActions = async (req, res, next) => {
  try {
    const {
      page = 1, limit = 20, priority, status, assignedTo, team, category, search,
      sortBy = "createdAt", sortOrder = "desc", dateFrom, dateTo
    } = req.query;

    const filter = { tenant: req.user.tenant, isDeleted: false };

    if (priority && priority !== "all") filter.priority = priority;
    if (status && status !== "all") filter.status = status;
    if (assignedTo && assignedTo !== "all") filter.assignedTo = assignedTo;
    if (team && team !== "all") filter.team = new RegExp(team, "i");
    if (category && category !== "all") filter.category = new RegExp(category, "i");

    if (search) {
      const s = new RegExp(search, "i");
      filter.$or = [{ description: s }, { team: s }, { category: s }, { title: s }];
    }

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }

    const skip = (page - 1) * limit;
    const sortQuery = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [actions, totalActions] = await Promise.all([
      Action.find(filter)
        .populate([
          { path: "feedback", select: "sentiment category summary" },
          { path: "assignedTo", select: "name email avatar" },
          { path: "createdBy", select: "name email" }
        ])
        .sort(sortQuery)
        .skip(skip)
        .limit(parseInt(limit)),
      Action.countDocuments(filter)
    ]);

    // NOTE: analytics aggregation is heavy; consider caching in production
    const analytics = await Action.aggregate([
      { $match: { tenant: req.user.tenant, isDeleted: false } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          high: { $sum: { $cond: [{ $eq: ["$priority", "high"] }, 1, 0] } },
          medium: { $sum: { $cond: [{ $eq: ["$priority", "medium"] }, 1, 0] } },
          low: { $sum: { $cond: [{ $eq: ["$priority", "low"] }, 1, 0] } },
          longTerm: { $sum: { $cond: [{ $eq: ["$priority", "long-term"] }, 1, 0] } },
          open: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ["$status", "in-progress"] }, 1, 0] } },
          resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } }
        }
      }
    ]);

    Logger.info("getActions", "Fetched actions", {
      context: {
        userId: req.user._id,
        tenantId: req.user.tenant,
        total: totalActions
      },
      req
    });
    res.status(200).json({
      success: true,
      data: {
        actions,
        pagination: { current: parseInt(page), pages: Math.ceil(totalActions / limit), total: totalActions, limit: parseInt(limit) },
        analytics: analytics[0] || { total: 0, high: 0, medium: 0, low: 0, longTerm: 0, open: 0, inProgress: 0, resolved: 0 }
      }
    });
  } catch (err) {
    Logger.error("getActions", "Error fetching actions", {
      error: err,
      context: {
        query: req.query,
        userId: req.user?._id
      },
      req
    });
    res.status(500).json({ success: false, message: "Error fetching actions", error: err.message });
  }
};

// Get action by id
exports.getActionById = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid action id" });

    const action = await Action.findOne({ _id: id, tenant: req.user.tenant, isDeleted: false })
      .populate([
        { path: "feedback", populate: { path: "survey", select: "title" } },
        { path: "assignedTo", select: "name email avatar department" },
        { path: "createdBy", select: "name email" }
      ]);

    if (!action) {
      Logger.warn("getActionById", "Action not found", {
        context: {
          actionId: id,
          tenant: req.user.tenant,
          userId: req.user?._id
        },
        req
      });
      return res.status(404).json({ success: false, message: "Action not found" });
    }

    Logger.info("getActionById", "Fetched action", {
      context: {
        actionId: id,
        tenant: req.user.tenant,
        userId: req.user?._id
      },
      req
    });
    res.status(200).json({ success: true, data: action });
  } catch (err) {
    Logger.error("getActionById", "Error fetching action", {
      error: err,
      context: {
        actionId: req.params.id,
        tenant: req.user.tenant
      },
      req
    });
    res.status(500).json({ success: false, message: "Error fetching action", error: err.message });
  }
};

// Update action (whitelisted fields only)
exports.updateAction = async (req, res, next) => {
  try {
    const { error, value } = updateActionSchema.validate(req.body);
    if (error) {
      Logger.warn("updateAction", "Validation failed", {
        context: {
          tenant: req.user.tenant,
          userId: req.user?._id,
          details: error.details[0].message
        },
        req
      });
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const action = await Action.findOne({ _id: req.params.id, tenant: req.user.tenant, isDeleted: false });
    if (!action) return res.status(404).json({ success: false, message: "Action not found" });

    // Authorization check (prefer RBAC middleware; this is lowest common)
    const canUpdate = req.user.role === "admin" || req.user.role === "companyAdmin" ||
      (action.assignedTo && action.assignedTo.toString() === req.user._id.toString());
    if (!canUpdate) {
      Logger.warn("updateAction", "Unauthorized update attempt", {
        context: {
          actionId: req.params.id,
          tenant: req.user.tenant,
          userId: req.user?._id
        },
        req
      });
      return res.status(403).json({ success: false, message: "Not authorized to update this action" });
    }

    // Allowed fields to update
    const allowed = ["description", "priority", "team", "status", "dueDate", "tags", "category", "resolution"];
    for (const key of Object.keys(value)) {
      if (allowed.includes(key)) action[key] = value[key];
    }

    const oldStatus = action.status;
    const oldAssignee = action.assignedTo ? action.assignedTo.toString() : null;

    if (value.status === "resolved" && oldStatus !== "resolved") {
      action.completedAt = new Date();
      action.completedBy = req.user._id;
    }

    await action.save();

    await action.populate([
      { path: "feedback", select: "sentiment category summary" },
      { path: "assignedTo", select: "name email avatar" },
      { path: "createdBy", select: "name email" },
      { path: "completedBy", select: "name email" }
    ]);

    // Notify on status change (avoid notifying the user who changed it)
    if (oldStatus !== action.status && action.assignedTo && action.assignedTo._id.toString() !== req.user._id.toString()) {
      await sendNotification({
        userId: action.assignedTo._id,
        type: "action_status_updated",
        message: `Action status updated to: ${action.status}`,
        data: { actionId: action._id, oldStatus, newStatus: action.status }
      });
    }

    Logger.info("updateAction", "Action updated", {
      context: {
        actionId: req.params.id,
        tenant: req.user.tenant,
        userId: req.user?._id
      },
      req
    });
    res.status(200).json({ success: true, message: "Action updated successfully", data: action });

  } catch (err) {
    Logger.error("updateAction", "Error updating action", {
      error: err,
      context: {
        actionId: req.params.id,
        tenant: req.user.tenant
      },
      req
    });
    res.status(500).json({ success: false, message: "Error updating action", error: err.message });
  }
};

// Soft-delete action
exports.deleteAction = async (req, res, next) => {
  try {
    const action = await Action.findOne({ _id: req.params.id, tenant: req.user.tenant, isDeleted: false });
    if (!action) return res.status(404).json({ success: false, message: "Action not found" });

    // Authorization: only admin/companyAdmin can delete
    if (!(req.user.role === "admin" || req.user.role === "companyAdmin")) {
      return res.status(403).json({ success: false, message: "Not authorized to delete action" });
    }

    action.isDeleted = true;
    action.deletedAt = new Date();
    action.deletedBy = req.user._id;
    await action.save();

    Logger.info("deleteAction", "Action soft-deleted", {
      context: {
        actionId: req.params.id,
        tenant: req.user.tenant,
        userId: req.user._id
      },
      req
    });

    res.status(200).json({ success: true, message: "Action deleted successfully (soft-delete)" });

  } catch (err) {
    Logger.error("deleteAction", "Error deleting action", {
      error: err,
      context: {
        actionId: req.params.id,
        tenant: req.user.tenant
      },
      req
    });
    res.status(500).json({ success: false, message: "Error deleting action", error: err.message });
  }
};

// Assign action to user/team (manual override)
exports.assignAction = async (req, res, next) => {
  try {
    const { assignedTo, team } = req.body;

    const action = await Action.findOne({ _id: req.params.id, tenant: req.user.tenant, isDeleted: false });
    if (!action) return res.status(404).json({ success: false, message: "Action not found" });

    // Permission: admin/companyAdmin or current assignee
    const canAssign = req.user.role === "admin" || req.user.role === "companyAdmin" || (action.assignedTo && action.assignedTo.toString() === req.user._id.toString());
    if (!canAssign) return res.status(403).json({ success: false, message: "Not authorized to assign this action" });

    // If assignedTo provided, validate user belongs to tenant
    let newAssignee = null;
    if (assignedTo) {
      newAssignee = await validateUserBelongsToTenant(assignedTo, req.user.tenant);
      if (!newAssignee) return res.status(404).json({ success: false, message: "Assignee not found or not in tenant" });
    }

    const oldAssignee = action.assignedTo ? action.assignedTo.toString() : null;
    const from = oldAssignee ? new mongoose.Types.ObjectId(oldAssignee) : null;

    action.assignedTo = newAssignee ? newAssignee._id : null;
    action.assignedToTeam = team || action.assignedToTeam;

    // mark as manual override
    action.autoAssigned = false;

    // push history
    await pushAssignmentHistory(action, { from, to: action.assignedTo, toTeam: action.assignedToTeam, byUserId: req.user._id, auto: false, note: "Manual assignment" });

    await action.save();
    await action.populate({ path: "assignedTo", select: "name email avatar" });

    // Send notification to new assignee
    if (action.assignedTo && oldAssignee !== action.assignedTo.toString()) {
      await sendNotification({
        userId: action.assignedTo,
        type: "action_assigned",
        message: `New action assigned: ${action.description}`,
        data: { actionId: action._id, priority: action.priority }
      });
    }

    Logger.info("assignAction", "Action assigned", {
      context: {
        actionId: req.params.id,
        tenant: req.user.tenant,
        userId: req.user._id,
        assignedTo: action.assignedTo
      },
      req
    });
    res.status(200).json({ success: true, message: "Action assigned successfully", data: action });

  } catch (err) {
    Logger.error("assignAction", "Error assigning action", {
      error: err,
      context: {
        actionId: req.params.id,
        tenant: req.user.tenant
      },
      req
    });
    res.status(500).json({ success: false, message: "Error assigning action", error: err.message });
  }
};

// Get actions by priority
exports.getActionsByPriority = async (req, res, next) => {
  try {
    const { priority } = req.params;
    if (!["high", "medium", "low", "long-term"].includes(priority)) {
      return res.status(400).json({ success: false, message: "Invalid priority level" });
    }

    const actions = await Action.find({ tenant: req.user.tenant, priority, isDeleted: false })
      .populate([{ path: "assignedTo", select: "name email avatar" }, { path: "feedback", select: "sentiment category" }])
      .sort({ createdAt: -1 });

    Logger.info("getActionsByPriority", "Fetched actions by priority", {
      context: {
        tenant: req.user.tenant,
        userId: req.user?._id,
        priority,
        total: actions.length
      },
      req
    });

    res.status(200).json({ success: true, data: actions });

  } catch (err) {
    Logger.error("getActionsByPriority", "Error", {
      error: err,
      context: {
        tenant: req.user.tenant
      },
      req
    });
    res.status(500).json({ success: false, message: "Error fetching actions", error: err.message });
  }
};

// Get actions by status
exports.getActionsByStatus = async (req, res, next) => {
  try {
    const { status } = req.params;
    if (!["pending", "open", "in-progress", "resolved"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const actions = await Action.find({ tenant: req.user.tenant, status, isDeleted: false })
      .populate([{ path: "assignedTo", select: "name email avatar" }, { path: "feedback", select: "sentiment category" }])
      .sort({ createdAt: -1 });

    Logger.info("getActionsByStatus", "Fetched actions by status", {
      context: {
        tenant: req.user.tenant,
        userId: req.user?._id,
        status,
        total: actions.length
      },
      req
    });
    res.status(200).json({ success: true, data: actions });

  } catch (err) {
    Logger.error("getActionsByStatus", "Error", {
      error: err,
      context: {
        tenant: req.user.tenant
      },
      req
    });
    res.status(500).json({ success: false, message: "Error fetching actions", error: err.message });
  }
};

// Analytics summary (kept similar but honour soft-delete)
exports.getActionsAnalytics = async (req, res, next) => {
  try {
    const { period = "30" } = req.query;
    const daysAgo = new Date(); daysAgo.setDate(daysAgo.getDate() - parseInt(period));
    Logger.info("getActionsAnalytics", "Fetching analytics", {
      context: {
        tenant: req.user.tenant,
        userId: req.user?._id,
        period
      },
      req
    });

    const analytics = await Action.aggregate([
      { $match: { tenant: req.user.tenant, createdAt: { $gte: daysAgo }, isDeleted: false } },
      {
        $facet: {
          byPriority: [{ $group: { _id: "$priority", count: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } } } }],
          byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
          byTeam: [{ $group: { _id: "$team", count: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } } } }, { $sort: { count: -1 } }, { $limit: 10 }],
          timeline: [{ $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, created: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } } } }, { $sort: { _id: 1 } }],
          overdue: [{ $match: { dueDate: { $lt: new Date() }, status: { $ne: "resolved" } } }, { $count: "total" }],
          avgResolutionTime: [{ $match: { status: "resolved", completedAt: { $exists: true } } }, { $project: { resolutionTime: { $subtract: ["$completedAt", "$createdAt"] } } }, { $group: { _id: null, avgTime: { $avg: "$resolutionTime" } } }]
        }
      }
    ]);

    const result = analytics[0] || {};
    Logger.info("getActionsAnalytics", "Fetched analytics", {
      context: {
        tenant: req.user.tenant,
        stats: {
          byPriority: result.byPriority?.length || 0
        }
      },
      req
    });

    res.status(200).json({
      success: true,
      data: {
        byPriority: result.byPriority || [],
        byStatus: result.byStatus || [],
        byTeam: result.byTeam || [],
        timeline: result.timeline || [],
        overdue: result.overdue?.[0]?.total || 0,
        avgResolutionTime: result.avgResolutionTime?.[0]?.avgTime || 0,
        period: parseInt(period)
      }
    });

  } catch (err) {
    Logger.error("getActionsAnalytics", "Error", {
      error: err,
      context: {
        tenant: req.user.tenant
      },
      req
    });
    res.status(500).json({ success: false, message: "Error fetching analytics", error: err.message });
  }
};

// Bulk update actions
exports.bulkUpdateActions = async (req, res, next) => {
  try {
    let actionIds;
    let updates;

    const { error, value } = bulkUpdateSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    ({ actionIds, updates } = value);
    const actions = await Action.find({ _id: { $in: actionIds }, tenant: req.user.tenant, isDeleted: false });
    if (actions.length !== actionIds.length) return res.status(404).json({ success: false, message: "Some actions not found" });

    // Whitelist updates - protect against ACL injection
    const allowedUpdates = {};
    if (updates.priority) allowedUpdates.priority = updates.priority;
    if (typeof updates.status !== 'undefined') allowedUpdates.status = updates.status;
    if (typeof updates.assignedTo !== 'undefined') allowedUpdates.assignedTo = updates.assignedTo;
    if (typeof updates.team !== 'undefined') allowedUpdates.team = updates.team;

    const result = await Action.updateMany({ _id: { $in: actionIds }, tenant: req.user.tenant }, { $set: allowedUpdates });
    Logger.info("bulkUpdateActions", "Bulk update completed", {
      context: {
        tenant: req.user.tenant,
        userId: req.user?._id,
        modifiedCount: result.modifiedCount
      },
      req
    });

    res.status(200).json({ success: true, message: `${result.modifiedCount} actions updated successfully`, data: { modifiedCount: result.modifiedCount } });

  } catch (err) {
    Logger.error("bulkUpdateActions", "Error updating actions", {
      error: err?.message,
      stack: err?.stack,
      context: {
        tenant: req.user.tenant,
        userId: req.user?._id,
        actionIds,
        updates: updates ? Object.keys(updates) : undefined,
      },
      req
    });
    res.status(500).json({ success: false, message: "Error updating actions", error: err.message });
  }
};

// Generate actions from feedback using AI (and apply assignment rules)
exports.generateActionsFromFeedback = async (req, res, next) => {
  try {
    const { feedbackIds, options = {} } = req.body;
    if (!Array.isArray(feedbackIds) || feedbackIds.length === 0) return res.status(400).json({ success: false, message: "Feedback IDs array required" });

    const feedbacks = await FeedbackAnalysis.find({ _id: { $in: feedbackIds }, tenant: req.user.tenant }).populate("survey", "title");
    if (feedbacks.length === 0) return res.status(404).json({ success: false, message: "No feedback found" });

    const feedbackSummary = feedbacks.map(f => ({ id: f._id, sentiment: f.sentiment, category: f.category, summary: f.summary, survey: f.survey?.title }));

    // Build a helpful but bounded prompt (avoid excessive tokens)
    const prompt = `Create a compact JSON array of suggested actions for these feedbacks. Each item: { description, priority (high|medium|low|long-term), team, category }. Feedback: ${JSON.stringify(feedbackSummary)}`;

    try {
      const aiResponse = await aiClient.complete({ prompt, maxTokens: 800 });
      let suggestedActions;
      try { suggestedActions = JSON.parse(aiResponse.text); } catch (e) {
        suggestedActions = null;
      }

      if (!Array.isArray(suggestedActions)) {
        // fallback: basic generated actions for negative sentiments
        suggestedActions = [];
        for (const f of feedbacks) {
          if (f.sentiment === "negative") {
            suggestedActions.push({
              description: `Investigate: ${f.summary?.substring(0, 200) || "Follow-up required"}`,
              priority: "high",
              team: "Customer Service",
              category: "Customer Issue",
              feedbackId: f._id
            });
          }
        }
      }

      const createdActions = [];
      for (const a of suggestedActions) {
        const payload = {
          title: a.title || (a.description || "").substring(0, 80),
          feedback: a.feedbackId || feedbacks[0]._id,
          description: a.description,
          priority: a.priority || "medium",
          team: a.team || "General",
          category: a.category || "AI Generated",
          tenant: req.user.tenant,
          createdBy: req.user._id,
          source: "ai_generated",
          tags: ["ai-generated", "feedback-analysis"],
          autoAssigned: false
        };

        // Apply assignment rules before creating
        const ruleResult = await applyAssignmentRules(payload, req.user.tenant);
        if (ruleResult) {
          if (ruleResult.assignedTo) payload.assignedTo = ruleResult.assignedTo;
          if (ruleResult.assignedToTeam) payload.assignedToTeam = ruleResult.assignedToTeam;
          if (ruleResult.priority) payload.priority = ruleResult.priority;
          payload.autoAssigned = true;
        }

        const action = await Action.create(payload);

        // push history if auto assigned
        if (payload.autoAssigned && action.assignedTo) {
          await pushAssignmentHistory(action, { from: null, to: action.assignedTo, toTeam: action.assignedToTeam, byUserId: req.user._id, auto: true, note: "Auto-assigned by rules on AI generation" });
          await action.save();
        }

        createdActions.push(action);
      }

      if (createdActions.length > 0) {
        const actionIds = createdActions.map(a => a._id);
        await followUp({ actionIds, messageTemplate: "Your feedback received, we are on it!" });
      }

      Logger.info("generateActionsFromFeedback", "Actions generated", {
        context: {
          tenant: req.user.tenant,
          userId: req.user?._id,
          createdCount: createdActions.length
        },
        req
      }); res.status(200).json({ success: true, message: `${createdActions.length} actions generated`, data: { actions: createdActions, feedbackProcessed: feedbacks.length } });

    } catch (aiError) {
      // Fallback logic already handled above; return error if catastrophic
      Logger.error("generateActionsFromFeedback", "AI error", {
        error: aiError,
        context: {
          userId: req.user?._id
        },
        req
      });// As fallback, create basic actions for negative feedbacks (already handled in code above if parsing failed)
      return res.status(500).json({ success: false, message: "AI service error generating actions", error: aiError.message });
    }

  } catch (err) {
    Logger.error("generateActionsFromFeedback", "Unexpected error", {
      error: err,
      context: {
        userId: req.user?._id
      },
      req
    }); res.status(500).json({ success: false, message: "Error generating actions from feedback", error: err.message });
  }
};

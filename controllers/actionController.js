// // controllers/actionController.js
// const Action = require("../models/Action");
// const FeedbackAnalysis = require("../models/FeedbackAnalysis");
// const AssignmentRule = require("../models/AssignmentRule");
// const User = require("../models/User");
// const Survey = require("../models/Survey");
// const aiClient = require("../utils/aiClient");
// const { sendNotification } = require("../utils/sendNotification");
// const Joi = require("joi");
// const followUp = require("./feedbackController")
// const Logger = require("../utils/auditLog");

// // Validation schemas
// const createActionSchema = Joi.object({
//   feedbackId: Joi.string().hex().length(24).optional(),
//   description: Joi.string().min(5).required(),
//   priority: Joi.string().valid("high", "medium", "long-term").required(),
//   assignedTo: Joi.string().hex().length(24).optional(),
//   team: Joi.string().min(2).optional(),
//   dueDate: Joi.date().optional(),
//   tags: Joi.array().items(Joi.string()).optional(),
//   category: Joi.string().optional()
// });

// const updateActionSchema = Joi.object({
//   description: Joi.string().min(5).optional(),
//   priority: Joi.string().valid("high", "medium", "long-term").optional(),
//   assignedTo: Joi.string().hex().length(24).allow(null).optional(),
//   team: Joi.string().min(2).optional(),
//   status: Joi.string().valid("open", "in-progress", "resolved").optional(),
//   dueDate: Joi.date().allow(null).optional(),
//   tags: Joi.array().items(Joi.string()).optional(),
//   category: Joi.string().optional(),
//   resolution: Joi.string().optional(),
//   completedAt: Joi.date().optional()
// });

// const bulkUpdateSchema = Joi.object({
//   actionIds: Joi.array().items(Joi.string().hex().length(24)).min(1).required(),
//   updates: Joi.object({
//     priority: Joi.string().valid("high", "medium", "long-term").optional(),
//     status: Joi.string().valid("open", "in-progress", "resolved").optional(),
//     assignedTo: Joi.string().hex().length(24).allow(null).optional(),
//     team: Joi.string().optional()
//   }).min(1).required()
// });

// // @desc    Create new action
// // @route   POST /api/actions
// // @access  Private (companyAdmin, admin)
// exports.createAction = async (req, res, next) => {
//   try {
//     const { error, value } = createActionSchema.validate(req.body);
//     if (error) {
//       return res.status(400).json({
//         success: false,
//         message: error.details[0].message
//       });
//     }

//     const { feedbackId, description, priority, assignedTo, team, dueDate, tags, category } = value;

//     // Validate feedback
//     if (feedbackId) {
//       const feedback = await FeedbackAnalysis.findById(feedbackId);
//       if (!feedback || feedback.tenant.toString() !== req.user.tenant.toString()) {
//         return res.status(404).json({
//           success: false,
//           message: "Feedback not found"
//         });
//       }
//     }

//     // Validate assignee
//     if (assignedTo) {
//       const assignee = await User.findById(assignedTo);
//       if (!assignee || assignee.tenant.toString() !== req.user.tenant.toString()) {
//         return res.status(404).json({
//           success: false,
//           message: "Assignee not found"
//         });
//       }
//     }

//     // Auto due date
//     let autoDueDate = dueDate;
//     if (!autoDueDate) {
//       const now = new Date();
//       const priorities = { high: 1, medium: 7, "long-term": 30 };
//       autoDueDate = new Date(now.getTime() + (priorities[priority] || 7) * 24 * 60 * 60 * 1000);
//     }

//     const action = await Action.create({
//       feedback: feedbackId || null,
//       description,
//       priority,
//       assignedTo: assignedTo || null,
//       team: team || null,
//       tenant: req.user.tenant,
//       dueDate: autoDueDate,
//       tags: tags || [],
//       category: category || "general",
//       createdBy: req.user._id
//     });

//     await action.populate([
//       { path: "feedback", select: "sentiment category summary" },
//       { path: "assignedTo", select: "name email" },
//       { path: "createdBy", select: "name email" }
//     ]);

//     // Send notification if assigned
//     if (assignedTo) {
//       await sendNotification({
//         userId: assignedTo,
//         type: "action_assigned",
//         message: `New ${priority} priority action assigned: ${description}`,
//         data: { actionId: action._id, priority, dueDate: autoDueDate }
//       });
//     }

//     await updateDashboardMetrics(req.user.tenant);

//     // ✅ Only log when success
//     await Logger.info("createAction", "Action created successfully", {
//       status: "success",
//       userId: req.user._id,
//       actionId: action._id,
//       tenantId: req.user.tenant,
//       priority,
//       assignedTo
//     });

//     res.status(201).json({
//       success: true,
//       message: "Action created successfully",
//       data: action
//     });

//   } catch (error) {
//     // ❌ Only log on error
//     await Logger.error("createAction", "Error creating action", {
//       status: "error",
//       error: error.message,
//       stack: error.stack,
//       userId: req.user?._id,
//       body: req.body
//     });

//     res.status(500).json({
//       success: false,
//       message: "Error creating action",
//       error: error.message
//     });
//   }
// };

// // @desc    Get all actions with filtering and pagination
// // @route   GET /api/actions
// // @access  Private
// exports.getActions = async (req, res, next) => {
//   try {
//     const {
//       page = 1,
//       limit = 20,
//       priority,
//       status,
//       assignedTo,
//       team,
//       category,
//       search,
//       sortBy = "createdAt",
//       sortOrder = "desc",
//       dateFrom,
//       dateTo
//     } = req.query;

//     // Build filter query
//     const filter = { tenant: req.user.tenant };

//     if (priority && priority !== "all") filter.priority = priority;
//     if (status && status !== "all") filter.status = status;
//     if (assignedTo && assignedTo !== "all") filter.assignedTo = assignedTo;
//     if (team && team !== "all") filter.team = new RegExp(team, "i");
//     if (category && category !== "all") filter.category = new RegExp(category, "i");

//     if (search) {
//       filter.$or = [
//         { description: new RegExp(search, "i") },
//         { team: new RegExp(search, "i") },
//         { category: new RegExp(search, "i") }
//       ];
//     }

//     if (dateFrom || dateTo) {
//       filter.createdAt = {};
//       if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
//       if (dateTo) filter.createdAt.$lte = new Date(dateTo);
//     }

//     // Calculate pagination
//     const skip = (page - 1) * limit;
//     const sortQuery = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

//     // Execute queries
//     const [actions, totalActions] = await Promise.all([
//       Action.find(filter)
//         .populate([
//           { path: "feedback", select: "sentiment category summary" },
//           { path: "assignedTo", select: "name email avatar" },
//           { path: "createdBy", select: "name email" }
//         ])
//         .sort(sortQuery)
//         .skip(skip)
//         .limit(parseInt(limit)),
//       Action.countDocuments(filter)
//     ]);

//     // Calculate analytics
//     const analytics = await Action.aggregate([
//       { $match: { tenant: req.user.tenant } },
//       {
//         $group: {
//           _id: null,
//           total: { $sum: 1 },
//           high: { $sum: { $cond: [{ $eq: ["$priority", "high"] }, 1, 0] } },
//           medium: { $sum: { $cond: [{ $eq: ["$priority", "medium"] }, 1, 0] } },
//           longTerm: { $sum: { $cond: [{ $eq: ["$priority", "long-term"] }, 1, 0] } },
//           open: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } },
//           inProgress: { $sum: { $cond: [{ $eq: ["$status", "in-progress"] }, 1, 0] } },
//           resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } }
//         }
//       }
//     ]);

//     // ✅ Success log
//     await Logger.info("getActions", "Fetched actions successfully", {
//       status: "success",
//       userId: req.user._id,
//       tenantId: req.user.tenant,
//       total: totalActions,
//       filters: req.query
//     });

//     res.status(200).json({
//       success: true,
//       data: {
//         actions,
//         pagination: {
//           current: parseInt(page),
//           pages: Math.ceil(totalActions / limit),
//           total: totalActions,
//           limit: parseInt(limit)
//         },
//         analytics: analytics[0] || {
//           total: 0, high: 0, medium: 0, longTerm: 0,
//           open: 0, inProgress: 0, resolved: 0
//         }
//       }
//     });

//   } catch (error) {
//     // ❌ Error log
//     await Logger.error("getActions", "Error fetching actions", {
//       status: "error",
//       error: error.message,
//       stack: error.stack,
//       userId: req.user?._id,
//       query: req.query
//     });

//     res.status(500).json({
//       success: false,
//       message: "Error fetching actions",
//       error: error.message
//     });
//   }
// };

// // @desc    Get action by ID
// // @route   GET /api/actions/:id
// // @access  Private
// exports.getActionById = async (req, res, next) => {
//   try {
//     const action = await Action.findOne({
//       _id: req.params.id,
//       tenant: req.user.tenant
//     }).populate([
//       {
//         path: "feedback",
//         populate: {
//           path: "survey",
//           select: "title"
//         }
//       },
//       { path: "assignedTo", select: "name email avatar department" },
//       { path: "createdBy", select: "name email" }
//     ]);

//     if (!action) {
//       await Logger.warn("getActionById", "Action not found", {
//         actionId: req.params.id,
//         tenant: req.user.tenant,
//         userId: req.user?._id
//       });

//       return res.status(404).json({
//         success: false,
//         message: "Action not found"
//       });
//     }

//     await Logger.info("getActionById", "Fetched action successfully", {
//       actionId: req.params.id,
//       tenant: req.user.tenant,
//       userId: req.user?._id
//     });

//     res.status(200).json({
//       success: true,
//       data: action
//     });
//   } catch (error) {
//     await Logger.error("getActionById", "Error fetching action", {
//       error: error.message,
//       actionId: req.params.id,
//       tenant: req.user.tenant,
//       userId: req.user?._id
//     });

//     res.status(500).json({
//       success: false,
//       message: "Error fetching action",
//       error: error.message
//     });
//   }
// };

// // @desc    Update action
// // @route   PUT /api/actions/:id
// // @access  Private (companyAdmin, admin, assigned member)
// exports.updateAction = async (req, res, next) => {
//   try {
//     const { error, value } = updateActionSchema.validate(req.body);
//     if (error) {
//       await Logger.warn("updateAction", "Validation failed", {
//         tenant: req.user.tenant,
//         userId: req.user?._id,
//         details: error.details[0].message
//       });

//       return res.status(400).json({
//         success: false,
//         message: error.details[0].message
//       });
//     }

//     const action = await Action.findOne({
//       _id: req.params.id,
//       tenant: req.user.tenant
//     });

//     if (!action) {
//       await Logger.warn("updateAction", "Action not found", {
//         actionId: req.params.id,
//         tenant: req.user.tenant,
//         userId: req.user?._id
//       });

//       return res.status(404).json({
//         success: false,
//         message: "Action not found"
//       });
//     }

//     const canUpdate =
//       req.user.role === "admin" ||
//       req.user.role === "companyAdmin" ||
//       (action.assignedTo && action.assignedTo.toString() === req.user._id.toString());

//     if (!canUpdate) {
//       await Logger.warn("updateAction", "Unauthorized update attempt", {
//         actionId: req.params.id,
//         tenant: req.user.tenant,
//         userId: req.user?._id
//       });

//       return res.status(403).json({
//         success: false,
//         message: "Not authorized to update this action"
//       });
//     }

//     const oldStatus = action.status;
//     const oldAssignee = action.assignedTo;

//     Object.assign(action, value);

//     if (value.status === "resolved" && oldStatus !== "resolved") {
//       action.completedAt = new Date();
//       action.completedBy = req.user._id;
//     }

//     await action.save();

//     await action.populate([
//       { path: "feedback", select: "sentiment category summary" },
//       { path: "assignedTo", select: "name email avatar" },
//       { path: "createdBy", select: "name email" },
//       { path: "completedBy", select: "name email" }
//     ]);

//     if (oldStatus !== action.status) {
//       if (action.assignedTo && action.assignedTo._id.toString() !== req.user._id.toString()) {
//         await sendNotification({
//           userId: action.assignedTo._id,
//           type: "action_status_updated",
//           message: `Action status updated to: ${action.status}`,
//           data: { actionId: action._id, oldStatus, newStatus: action.status }
//         });
//       }
//     }

//     if (oldAssignee?.toString() !== action.assignedTo?.toString() && action.assignedTo) {
//       await sendNotification({
//         userId: action.assignedTo._id,
//         type: "action_assigned",
//         message: `Action assigned to you: ${action.description}`,
//         data: { actionId: action._id, priority: action.priority }
//       });
//     }

//     await Logger.info("updateAction", "Action updated successfully", {
//       actionId: req.params.id,
//       tenant: req.user.tenant,
//       userId: req.user?._id
//     });

//     res.status(200).json({
//       success: true,
//       message: "Action updated successfully",
//       data: action
//     });

//   } catch (error) {
//     await Logger.error("updateAction", "Error updating action", {
//       error: error.message,
//       actionId: req.params.id,
//       tenant: req.user.tenant,
//       userId: req.user?._id
//     });

//     res.status(500).json({
//       success: false,
//       message: "Error updating action",
//       error: error.message
//     });
//   }
// };

// // @desc    Delete action
// // @route   DELETE /api/actions/:id
// // @access  Private (companyAdmin, admin)
// exports.deleteAction = async (req, res, next) => {
//   try {
//     const action = await Action.findOneAndDelete({
//       _id: req.params.id,
//       tenant: req.user.tenant
//     });

//     if (!action) {
//       await Logger.warn("deleteAction", "Action not found for deletion", {
//         actionId: req.params.id,
//         tenant: req.user.tenant,
//         userId: req.user?._id
//       });

//       return res.status(404).json({
//         success: false,
//         message: "Action not found"
//       });
//     }

//     await Logger.info("deleteAction", "Action deleted successfully", {
//       actionId: req.params.id,
//       tenant: req.user.tenant,
//       userId: req.user?._id
//     });

//     res.status(200).json({
//       success: true,
//       message: "Action deleted successfully"
//     });

//   } catch (error) {
//     await Logger.error("deleteAction", "Error deleting action", {
//       error: error.message,
//       actionId: req.params.id,
//       tenant: req.user.tenant,
//       userId: req.user?._id
//     });

//     res.status(500).json({
//       success: false,
//       message: "Error deleting action",
//       error: error.message
//     });
//   }
// };

// // @desc    Assign action to user
// // @route   PUT /api/actions/:id/assign
// // @access  Private (companyAdmin, admin)
// exports.assignAction = async (req, res, next) => {
//   try {
//     const { assignedTo, team } = req.body;

//     const action = await Action.findOne({
//       _id: req.params.id,
//       tenant: req.user.tenant
//     });

//     if (!action) {
//       await Logger.warn("assignAction", "Action not found", {
//         actionId: req.params.id,
//         tenant: req.user.tenant,
//         userId: req.user?._id
//       });

//       return res.status(404).json({
//         success: false,
//         message: "Action not found"
//       });
//     }

//     // Validate assignee if provided
//     if (assignedTo) {
//       const assignee = await User.findById(assignedTo);
//       if (!assignee || assignee.tenant.toString() !== req.user.tenant.toString()) {
//         await Logger.warn("assignAction", "Invalid assignee provided", {
//           actionId: req.params.id,
//           tenant: req.user.tenant,
//           userId: req.user?._id,
//           assignedTo
//         });

//         return res.status(404).json({
//           success: false,
//           message: "Assignee not found"
//         });
//       }
//     }

//     const oldAssignee = action.assignedTo;
//     action.assignedTo = assignedTo || null;
//     action.team = team || action.team;

//     await action.save();
//     await action.populate({ path: "assignedTo", select: "name email avatar" });

//     // Send notification to new assignee
//     if (assignedTo && oldAssignee?.toString() !== assignedTo) {
//       await sendNotification({
//         userId: assignedTo,
//         type: "action_assigned",
//         message: `New action assigned: ${action.description}`,
//         data: { actionId: action._id, priority: action.priority }
//       });
//     }

//     await Logger.info("assignAction", "Action assigned successfully", {
//       actionId: req.params.id,
//       tenant: req.user.tenant,
//       userId: req.user?._id,
//       assignedTo
//     });

//     res.status(200).json({
//       success: true,
//       message: "Action assigned successfully",
//       data: action
//     });

//   } catch (error) {
//     await Logger.error("assignAction", "Error assigning action", {
//       error: error.message,
//       actionId: req.params.id,
//       tenant: req.user.tenant,
//       userId: req.user?._id
//     });

//     res.status(500).json({
//       success: false,
//       message: "Error assigning action",
//       error: error.message
//     });
//   }
// };

// // @desc    Get actions by priority
// // @route   GET /api/actions/priority/:priority
// // @access  Private
// exports.getActionsByPriority = async (req, res, next) => {
//   try {
//     const { priority } = req.params;

//     if (!["high", "medium", "long-term"].includes(priority)) {
//       await Logger.warn("getActionsByPriority", "Invalid priority level", {
//         tenant: req.user.tenant,
//         userId: req.user?._id,
//         priority
//       });

//       return res.status(400).json({
//         success: false,
//         message: "Invalid priority level"
//       });
//     }

//     const actions = await Action.find({
//       tenant: req.user.tenant,
//       priority
//     })
//       .populate([
//         { path: "assignedTo", select: "name email avatar" },
//         { path: "feedback", select: "sentiment category" }
//       ])
//       .sort({ createdAt: -1 });

//     await Logger.info("getActionsByPriority", "Fetched actions by priority successfully", {
//       tenant: req.user.tenant,
//       userId: req.user?._id,
//       priority,
//       total: actions.length
//     });

//     res.status(200).json({
//       success: true,
//       data: actions
//     });

//   } catch (error) {
//     await Logger.error("getActionsByPriority", "Error fetching actions by priority", {
//       error: error.message,
//       tenant: req.user.tenant,
//       userId: req.user?._id
//     });

//     res.status(500).json({
//       success: false,
//       message: "Error fetching actions",
//       error: error.message
//     });
//   }
// };

// // @desc    Get actions by status
// // @route   GET /api/actions/status/:status
// // @access  Private
// exports.getActionsByStatus = async (req, res, next) => {
//   try {
//     const { status } = req.params;

//     if (!["open", "in-progress", "resolved"].includes(status)) {
//       await Logger.warn("getActionsByStatus", "Invalid status value", {
//         tenant: req.user.tenant,
//         userId: req.user?._id,
//         status
//       });

//       return res.status(400).json({
//         success: false,
//         message: "Invalid status"
//       });
//     }

//     const actions = await Action.find({
//       tenant: req.user.tenant,
//       status
//     })
//       .populate([
//         { path: "assignedTo", select: "name email avatar" },
//         { path: "feedback", select: "sentiment category" }
//       ])
//       .sort({ createdAt: -1 });

//     await Logger.info("getActionsByStatus", "Fetched actions by status successfully", {
//       tenant: req.user.tenant,
//       userId: req.user?._id,
//       status,
//       total: actions.length
//     });

//     res.status(200).json({
//       success: true,
//       data: actions
//     });

//   } catch (error) {
//     await Logger.error("getActionsByStatus", "Error fetching actions by status", {
//       error: error.message,
//       tenant: req.user.tenant,
//       userId: req.user?._id
//     });

//     res.status(500).json({
//       success: false,
//       message: "Error fetching actions",
//       error: error.message
//     });
//   }
// };

// // @desc    Get actions analytics
// // @route   GET /api/actions/analytics/summary
// // @access  Private (companyAdmin, admin)
// exports.getActionsAnalytics = async (req, res, next) => {
//   try {
//     const { period = "30" } = req.query;
//     const daysAgo = new Date();
//     daysAgo.setDate(daysAgo.getDate() - parseInt(period));

//     await Logger.info("getActionsAnalytics", "Fetching actions analytics", {
//       tenant: req.user.tenant,
//       userId: req.user?._id,
//       period
//     });

//     const analytics = await Action.aggregate([
//       {
//         $match: {
//           tenant: req.user.tenant,
//           createdAt: { $gte: daysAgo }
//         }
//       },
//       {
//         $facet: {
//           byPriority: [
//             {
//               $group: {
//                 _id: "$priority",
//                 count: { $sum: 1 },
//                 resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } }
//               }
//             }
//           ],
//           byStatus: [
//             {
//               $group: {
//                 _id: "$status",
//                 count: { $sum: 1 }
//               }
//             }
//           ],
//           byTeam: [
//             {
//               $group: {
//                 _id: "$team",
//                 count: { $sum: 1 },
//                 resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } }
//               }
//             },
//             { $sort: { count: -1 } },
//             { $limit: 10 }
//           ],
//           timeline: [
//             {
//               $group: {
//                 _id: {
//                   $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
//                 },
//                 created: { $sum: 1 },
//                 resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } }
//               }
//             },
//             { $sort: { _id: 1 } }
//           ],
//           overdue: [
//             {
//               $match: {
//                 dueDate: { $lt: new Date() },
//                 status: { $ne: "resolved" }
//               }
//             },
//             { $count: "total" }
//           ],
//           avgResolutionTime: [
//             {
//               $match: {
//                 status: "resolved",
//                 completedAt: { $exists: true }
//               }
//             },
//             {
//               $project: {
//                 resolutionTime: { $subtract: ["$completedAt", "$createdAt"] }
//               }
//             },
//             {
//               $group: {
//                 _id: null,
//                 avgTime: { $avg: "$resolutionTime" }
//               }
//             }
//           ]
//         }
//       }
//     ]);

//     const result = analytics[0];

//     await Logger.info("getActionsAnalytics", "Fetched analytics successfully", {
//       tenant: req.user.tenant,
//       userId: req.user?._id,
//       period,
//       stats: {
//         byPriority: result.byPriority?.length || 0,
//         byStatus: result.byStatus?.length || 0,
//         byTeam: result.byTeam?.length || 0
//       }
//     });

//     res.status(200).json({
//       success: true,
//       data: {
//         byPriority: result.byPriority,
//         byStatus: result.byStatus,
//         byTeam: result.byTeam,
//         timeline: result.timeline,
//         overdue: result.overdue[0]?.total || 0,
//         avgResolutionTime: result.avgResolutionTime[0]?.avgTime || 0,
//         period: parseInt(period)
//       }
//     });

//   } catch (error) {
//     await Logger.error("getActionsAnalytics", "Error fetching actions analytics", {
//       tenant: req.user.tenant,
//       userId: req.user?._id,
//       error: error.message
//     });

//     res.status(500).json({
//       success: false,
//       message: "Error fetching analytics",
//       error: error.message
//     });
//   }
// };

// // @desc    Bulk update actions
// // @route   PUT /api/actions/bulk/update
// // @access  Private (companyAdmin, admin)
// exports.bulkUpdateActions = async (req, res, next) => {
//   try {
//     const { error, value } = bulkUpdateSchema.validate(req.body);
//     if (error) {
//       await Logger.warn("bulkUpdateActions", "Validation failed for bulk update", {
//         tenant: req.user.tenant,
//         userId: req.user?._id,
//         validationError: error.details[0].message
//       });

//       return res.status(400).json({
//         success: false,
//         message: error.details[0].message
//       });
//     }

//     const { actionIds, updates } = value;

//     await Logger.info("bulkUpdateActions", "Starting bulk update for actions", {
//       tenant: req.user.tenant,
//       userId: req.user?._id,
//       actionCount: actionIds.length,
//       updates
//     });

//     // Validate all actions exist and belong to tenant
//     const actions = await Action.find({
//       _id: { $in: actionIds },
//       tenant: req.user.tenant
//     });

//     if (actions.length !== actionIds.length) {
//       await Logger.warn("bulkUpdateActions", "Some actions not found for tenant", {
//         tenant: req.user.tenant,
//         userId: req.user?._id,
//         found: actions.length,
//         expected: actionIds.length
//       });

//       return res.status(404).json({
//         success: false,
//         message: "Some actions not found"
//       });
//     }

//     // Perform bulk update
//     const result = await Action.updateMany(
//       {
//         _id: { $in: actionIds },
//         tenant: req.user.tenant
//       },
//       { $set: updates }
//     );

//     await Logger.info("bulkUpdateActions", "Bulk update completed successfully", {
//       tenant: req.user.tenant,
//       userId: req.user?._id,
//       modifiedCount: result.modifiedCount
//     });

//     res.status(200).json({
//       success: true,
//       message: `${result.modifiedCount} actions updated successfully`,
//       data: { modifiedCount: result.modifiedCount }
//     });

//   } catch (error) {
//     await Logger.error("bulkUpdateActions", "Error performing bulk update", {
//       tenant: req.user.tenant,
//       userId: req.user?._id,
//       error: error.message
//     });

//     res.status(500).json({
//       success: false,
//       message: "Error updating actions",
//       error: error.message
//     });
//   }
// };

// // @desc    Generate actions from feedback using AI
// // @route   POST /api/actions/generate-from-feedback
// // @access  Private
// exports.generateActionsFromFeedback = async (req, res, next) => {
//   try {
//     const { feedbackIds, options = {} } = req.body;

//     const applyAssignmentRules = async (action) => {
//       const rules = await AssignmentRule.find({ tenant: req.tenantId, isActive: true })
//         .sort({ priority: -1 });

//       for (const rule of rules) {
//         let match = true;
//         for (const cond of rule.conditions) {
//           const value = action[cond.field] || action.metadata?.[cond.field];
//           // Simple match logic
//           if (cond.operator === '==' && value !== cond.value) match = false;
//           if (cond.operator === 'contains' && !String(value).includes(cond.value)) match = false;
//         }
//         if (match) {
//           action.assignedTo = rule.assignment.targetUser || null;
//           action.team = rule.assignment.targetTeam || null;
//           action.priority = rule.priorityOverride || action.priority;
//           break;
//         }
//       }
//     };

//     if (!feedbackIds || !Array.isArray(feedbackIds) || feedbackIds.length === 0) {
//       await Logger.warn("generateActionsFromFeedback", "Invalid feedbackIds received", {
//         tenant: req.user.tenant,
//         userId: req.user?._id,
//         body: req.body
//       });

//       return res.status(400).json({
//         success: false,
//         message: "Feedback IDs array required"
//       });
//     }

//     const feedbacks = await FeedbackAnalysis.find({
//       _id: { $in: feedbackIds },
//       tenant: req.user.tenant
//     }).populate("survey", "title");

//     if (feedbacks.length === 0) {
//       await Logger.warn("generateActionsFromFeedback", "No feedback found for provided IDs", {
//         tenant: req.user.tenant,
//         userId: req.user?._id,
//         feedbackIds
//       });

//       return res.status(404).json({
//         success: false,
//         message: "No feedback found"
//       });
//     }

//     const feedbackSummary = feedbacks.map(f => ({
//       id: f._id,
//       sentiment: f.sentiment,
//       category: f.category,
//       summary: f.summary,
//       survey: f.survey?.title
//     }));

//     const prompt = `Based on the following... Return JSON array...`;

//     try {
//       const aiResponse = await aiClient.complete({ prompt, maxTokens: 1000 });

//       let suggestedActions;
//       try {
//         suggestedActions = JSON.parse(aiResponse.text);
//       } catch {
//         suggestedActions = [{
//           description: "Review customer service...",
//           priority: "medium",
//           team: "Customer Service",
//           category: "Process Improvement"
//         }];
//       }

//       const createdActions = [];
//       for (const actionData of suggestedActions) {
//         const action = await Action.create({
//           feedback: feedbacks[0]._id,
//           description: actionData.description,
//           priority: actionData.priority || "medium",
//           team: actionData.team || "General",
//           category: actionData.category || "AI Generated",
//           tenant: req.user.tenant,
//           createdBy: req.user._id,
//           tags: ["ai-generated", "feedback-analysis"]
//         });
//         createdActions.push(action);
//       }

//       if (createdActions.length > 0) {
//         const actionIds = createdActions.map(a => a._id);
//         await followUp({
//           actionIds,
//           messageTemplate: "Your feedback received, we are on it!"
//         });
//       }

//       await Logger.info("generateActionsFromFeedback", "Actions generated successfully from feedback", {
//         tenant: req.user.tenant,
//         userId: req.user?._id,
//         createdCount: createdActions.length,
//         feedbackCount: feedbacks.length
//       });

//       res.status(200).json({
//         success: true,
//         message: `${createdActions.length} actions generated`,
//         data: {
//           actions: createdActions,
//           feedbackProcessed: feedbacks.length
//         }
//       });

//     } catch (aiError) {
//       await Logger.error("generateActionsFromFeedback", "AI service failed, using fallback logic", {
//         tenant: req.user.tenant,
//         userId: req.user?._id,
//         error: aiError.message
//       });

//       const fallbackActions = await Promise.all(
//         feedbacks
//           .filter(f => f.sentiment === "negative")
//           .map(f => Action.create({
//             feedback: f._id,
//             description: `Address concerns: ${f.summary?.substring(0, 100) || "Review feedback"}`,
//             priority: "high",
//             team: "Customer Service",
//             category: "Customer Issue",
//             tenant: req.user.tenant,
//             createdBy: req.user._id,
//             tags: ["auto-generated", "negative-feedback"]
//           }))
//       );

//       if (fallbackActions.length > 0) {
//         const actionIds = fallbackActions.map(a => a._id);
//         await followUp({
//           actionIds,
//           messageTemplate: "Your feedback received, we are on it!"
//         });
//       }

//       await Logger.info("generateActionsFromFeedback", "Fallback actions generated due to AI error", {
//         tenant: req.user.tenant,
//         userId: req.user?._id,
//         fallbackCount: fallbackActions.length
//       });

//       res.status(200).json({
//         success: true,
//         message: `${fallbackActions.length} basic actions generated (AI unavailable)`,
//         data: {
//           actions: fallbackActions,
//           feedbackProcessed: feedbacks.length,
//           fallback: true
//         }
//       });
//     }
//   } catch (error) {
//     await Logger.error("generateActionsFromFeedback", "Unexpected error generating actions", {
//       tenant: req.user.tenant,
//       userId: req.user?._id,
//       error: error.message
//     });

//     res.status(500).json({
//       success: false,
//       message: "Error generating actions from feedback",
//       error: error.message
//     });
//   }
// };
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
const Logger = require("../utils/auditLog");
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

    await Logger.info("createAction", "Action created", {
      userId: req.user._id, actionId: action._id, tenantId: req.user.tenant, priority: action.priority, assignedTo: action.assignedTo
    });

    res.status(201).json({ success: true, message: "Action created successfully", data: action });

  } catch (err) {
    await Logger.error("createAction", "Error creating action", { error: err.message, stack: err.stack, body: req.body, userId: req.user?._id });
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
      { $group: {
        _id: null,
        total: { $sum: 1 },
        high: { $sum: { $cond: [{ $eq: ["$priority", "high"] }, 1, 0] } },
        medium: { $sum: { $cond: [{ $eq: ["$priority", "medium"] }, 1, 0] } },
        low: { $sum: { $cond: [{ $eq: ["$priority", "low"] }, 1, 0] } },
        longTerm: { $sum: { $cond: [{ $eq: ["$priority", "long-term"] }, 1, 0] } },
        open: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $eq: ["$status", "in-progress"] }, 1, 0] } },
        resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } }
      }}
    ]);

    await Logger.info("getActions", "Fetched actions", { userId: req.user._id, tenantId: req.user.tenant, total: totalActions });

    res.status(200).json({
      success: true,
      data: {
        actions,
        pagination: { current: parseInt(page), pages: Math.ceil(totalActions / limit), total: totalActions, limit: parseInt(limit) },
        analytics: analytics[0] || { total: 0, high: 0, medium: 0, low: 0, longTerm: 0, open: 0, inProgress: 0, resolved: 0 }
      }
    });
  } catch (err) {
    await Logger.error("getActions", "Error fetching actions", { error: err.message, stack: err.stack, query: req.query, userId: req.user?._id });
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
      await Logger.warn("getActionById", "Action not found", { actionId: id, tenant: req.user.tenant, userId: req.user?._id });
      return res.status(404).json({ success: false, message: "Action not found" });
    }

    await Logger.info("getActionById", "Fetched action", { actionId: id, tenant: req.user.tenant, userId: req.user?._id });
    res.status(200).json({ success: true, data: action });
  } catch (err) {
    await Logger.error("getActionById", "Error fetching action", { error: err.message, actionId: req.params.id, tenant: req.user.tenant });
    res.status(500).json({ success: false, message: "Error fetching action", error: err.message });
  }
};

// Update action (whitelisted fields only)
exports.updateAction = async (req, res, next) => {
  try {
    const { error, value } = updateActionSchema.validate(req.body);
    if (error) {
      await Logger.warn("updateAction", "Validation failed", { tenant: req.user.tenant, userId: req.user?._id, details: error.details[0].message });
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const action = await Action.findOne({ _id: req.params.id, tenant: req.user.tenant, isDeleted: false });
    if (!action) return res.status(404).json({ success: false, message: "Action not found" });

    // Authorization check (prefer RBAC middleware; this is lowest common)
    const canUpdate = req.user.role === "admin" || req.user.role === "companyAdmin" ||
      (action.assignedTo && action.assignedTo.toString() === req.user._id.toString());
    if (!canUpdate) {
      await Logger.warn("updateAction", "Unauthorized update attempt", { actionId: req.params.id, tenant: req.user.tenant, userId: req.user?._id });
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

    await Logger.info("updateAction", "Action updated", { actionId: req.params.id, tenant: req.user.tenant, userId: req.user?._id });
    res.status(200).json({ success: true, message: "Action updated successfully", data: action });

  } catch (err) {
    await Logger.error("updateAction", "Error updating action", { error: err.message, actionId: req.params.id, tenant: req.user.tenant });
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

    await Logger.info("deleteAction", "Action soft-deleted", { actionId: req.params.id, tenant: req.user.tenant, userId: req.user._id });
    res.status(200).json({ success: true, message: "Action deleted successfully (soft-delete)" });

  } catch (err) {
    await Logger.error("deleteAction", "Error deleting action", { error: err.message, actionId: req.params.id, tenant: req.user.tenant });
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
    const from = oldAssignee ? mongoose.Types.ObjectId(oldAssignee) : null;

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

    await Logger.info("assignAction", "Action assigned", { actionId: req.params.id, tenant: req.user.tenant, userId: req.user._id, assignedTo: action.assignedTo });
    res.status(200).json({ success: true, message: "Action assigned successfully", data: action });

  } catch (err) {
    await Logger.error("assignAction", "Error assigning action", { error: err.message, actionId: req.params.id, tenant: req.user.tenant });
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

    await Logger.info("getActionsByPriority", "Fetched actions by priority", { tenant: req.user.tenant, userId: req.user?._id, priority, total: actions.length });
    res.status(200).json({ success: true, data: actions });

  } catch (err) {
    await Logger.error("getActionsByPriority", "Error", { error: err.message, tenant: req.user.tenant });
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

    await Logger.info("getActionsByStatus", "Fetched actions by status", { tenant: req.user.tenant, userId: req.user?._id, status, total: actions.length });
    res.status(200).json({ success: true, data: actions });

  } catch (err) {
    await Logger.error("getActionsByStatus", "Error", { error: err.message, tenant: req.user.tenant });
    res.status(500).json({ success: false, message: "Error fetching actions", error: err.message });
  }
};

// Analytics summary (kept similar but honour soft-delete)
exports.getActionsAnalytics = async (req, res, next) => {
  try {
    const { period = "30" } = req.query;
    const daysAgo = new Date(); daysAgo.setDate(daysAgo.getDate() - parseInt(period));
    await Logger.info("getActionsAnalytics", "Fetching analytics", { tenant: req.user.tenant, userId: req.user?._id, period });

    const analytics = await Action.aggregate([
      { $match: { tenant: req.user.tenant, createdAt: { $gte: daysAgo }, isDeleted: false } },
      { $facet: {
        byPriority: [ { $group: { _id: "$priority", count: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } } } } ],
        byStatus: [ { $group: { _id: "$status", count: { $sum: 1 } } } ],
        byTeam: [ { $group: { _id: "$team", count: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } } } }, { $sort: { count: -1 } }, { $limit: 10 } ],
        timeline: [ { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, created: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } } } }, { $sort: { _id: 1 } } ],
        overdue: [ { $match: { dueDate: { $lt: new Date() }, status: { $ne: "resolved" } } }, { $count: "total" } ],
        avgResolutionTime: [ { $match: { status: "resolved", completedAt: { $exists: true } } }, { $project: { resolutionTime: { $subtract: ["$completedAt", "$createdAt"] } } }, { $group: { _id: null, avgTime: { $avg: "$resolutionTime" } } } ]
      } }
    ]);

    const result = analytics[0] || {};
    await Logger.info("getActionsAnalytics", "Fetched analytics", { tenant: req.user.tenant, stats: { byPriority: result.byPriority?.length || 0 } });

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
    await Logger.error("getActionsAnalytics", "Error", { error: err.message, tenant: req.user.tenant });
    res.status(500).json({ success: false, message: "Error fetching analytics", error: err.message });
  }
};

// Bulk update actions
exports.bulkUpdateActions = async (req, res, next) => {
  try {
    const { error, value } = bulkUpdateSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { actionIds, updates } = value;
    const actions = await Action.find({ _id: { $in: actionIds }, tenant: req.user.tenant, isDeleted: false });
    if (actions.length !== actionIds.length) return res.status(404).json({ success: false, message: "Some actions not found" });

    // Whitelist updates - protect against ACL injection
    const allowedUpdates = {};
    if (updates.priority) allowedUpdates.priority = updates.priority;
    if (typeof updates.status !== 'undefined') allowedUpdates.status = updates.status;
    if (typeof updates.assignedTo !== 'undefined') allowedUpdates.assignedTo = updates.assignedTo;
    if (typeof updates.team !== 'undefined') allowedUpdates.team = updates.team;

    const result = await Action.updateMany({ _id: { $in: actionIds }, tenant: req.user.tenant }, { $set: allowedUpdates });
    await Logger.info("bulkUpdateActions", "Bulk update completed", { tenant: req.user.tenant, userId: req.user?._id, modifiedCount: result.modifiedCount });

    res.status(200).json({ success: true, message: `${result.modifiedCount} actions updated successfully`, data: { modifiedCount: result.modifiedCount } });

  } catch (err) {
    await Logger.error("bulkUpdateActions", "Error", { error: err.message, userId: req.user?._id });
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

      await Logger.info("generateActionsFromFeedback", "Actions generated", { tenant: req.user.tenant, userId: req.user?._id, createdCount: createdActions.length });
      res.status(200).json({ success: true, message: `${createdActions.length} actions generated`, data: { actions: createdActions, feedbackProcessed: feedbacks.length } });

    } catch (aiError) {
      // Fallback logic already handled above; return error if catastrophic
      await Logger.error("generateActionsFromFeedback", "AI error", { error: aiError.message, userId: req.user?._id });
      // As fallback, create basic actions for negative feedbacks (already handled in code above if parsing failed)
      return res.status(500).json({ success: false, message: "AI service error generating actions", error: aiError.message });
    }

  } catch (err) {
    await Logger.error("generateActionsFromFeedback", "Unexpected error", { error: err.message, userId: req.user?._id });
    res.status(500).json({ success: false, message: "Error generating actions from feedback", error: err.message });
  }
};

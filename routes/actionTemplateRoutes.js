// routes/actionTemplateRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { setTenantId } = require("../middlewares/tenantMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const ActionTemplate = require("../models/ActionTemplate");
const Action = require("../models/Action");
const { applyAssignmentRules } = require("../services/action/assignmentService");
const Logger = require("../utils/logger");

router.use(protect);
router.use(setTenantId);

/**
 * GET /api/actions/templates
 * List all action templates for tenant
 */
router.get("/", async (req, res) => {
    try {
        const { tag, active } = req.query;

        const query = { tenant: req.user.tenant };
        if (active !== undefined) query.isActive = active === "true";
        if (tag) query.tags = tag;

        const templates = await ActionTemplate.find(query)
            .populate("assignment.defaultAssignee", "name email")
            .populate("createdBy", "name email")
            .sort({ usageCount: -1, name: 1 });

        res.json({ success: true, templates });
    } catch (error) {
        Logger.error("getActionTemplates", "Error fetching templates", { error, req });
        res.status(500).json({ success: false, message: "Error fetching templates" });
    }
});

/**
 * POST /api/actions/templates
 * Create a new action template
 */
router.post("/", allowRoles("companyAdmin", "admin"), async (req, res) => {
    try {
        const { name, description, defaults, assignment, tags } = req.body;

        if (!name || !defaults?.title) {
            return res.status(400).json({ success: false, message: "Name and default title required" });
        }

        const template = await ActionTemplate.create({
            tenant: req.user.tenant,
            name,
            description,
            defaults,
            assignment,
            tags,
            createdBy: req.user._id
        });

        Logger.info("createActionTemplate", "Template created", {
            context: { templateId: template._id, name },
            req
        });

        res.status(201).json({ success: true, template });
    } catch (error) {
        Logger.error("createActionTemplate", "Error creating template", { error, req });
        res.status(500).json({ success: false, message: "Error creating template" });
    }
});

/**
 * PUT /api/actions/templates/:id
 * Update an action template
 */
router.put("/:id", allowRoles("companyAdmin", "admin"), async (req, res) => {
    try {
        const template = await ActionTemplate.findOneAndUpdate(
            { _id: req.params.id, tenant: req.user.tenant },
            { $set: req.body },
            { new: true }
        );

        if (!template) {
            return res.status(404).json({ success: false, message: "Template not found" });
        }

        res.json({ success: true, template });
    } catch (error) {
        Logger.error("updateActionTemplate", "Error updating template", { error, req });
        res.status(500).json({ success: false, message: "Error updating template" });
    }
});

/**
 * DELETE /api/actions/templates/:id
 * Delete an action template
 */
router.delete("/:id", allowRoles("companyAdmin", "admin"), async (req, res) => {
    try {
        const result = await ActionTemplate.deleteOne({
            _id: req.params.id,
            tenant: req.user.tenant
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: "Template not found" });
        }

        res.json({ success: true, message: "Template deleted" });
    } catch (error) {
        Logger.error("deleteActionTemplate", "Error deleting template", { error, req });
        res.status(500).json({ success: false, message: "Error deleting template" });
    }
});

/**
 * POST /api/actions/templates/:id/create
 * Create an action from a template
 */
router.post("/:id/create", async (req, res) => {
    try {
        const template = await ActionTemplate.findOne({
            _id: req.params.id,
            tenant: req.user.tenant,
            isActive: true
        });

        if (!template) {
            return res.status(404).json({ success: false, message: "Template not found" });
        }

        // Merge template defaults with request overrides
        const { title, description, priority, assignedTo, dueDate, metadata } = req.body;

        // Calculate due date from offset if not provided
        let actionDueDate = dueDate;
        if (!actionDueDate && template.defaults.dueDateOffsetDays) {
            const offset = template.defaults.dueDateOffsetDays * 24 * 60 * 60 * 1000;
            actionDueDate = new Date(Date.now() + offset);
        }

        // Determine assignment
        let assignee = assignedTo;
        let assigneeTeam = template.assignment?.defaultTeam;
        let autoAssigned = false;

        if (!assignee && template.assignment?.useRules) {
            // Use assignment rules
            const ruleResult = await applyAssignmentRules(
                { category: template.defaults.category, priority: priority || template.defaults.priority },
                req.user.tenant,
                req.user._id
            );
            if (ruleResult) {
                assignee = ruleResult.assignedTo;
                assigneeTeam = ruleResult.assignedToTeam;
                autoAssigned = true;
            }
        } else if (!assignee) {
            assignee = template.assignment?.defaultAssignee;
        }

        const action = await Action.create({
            tenant: req.user.tenant,
            title: title || template.defaults.title,
            description: description || template.defaults.description,
            priority: priority || template.defaults.priority,
            status: template.defaults.status,
            category: template.defaults.category,
            dueDate: actionDueDate,
            assignedTo: assignee,
            assignedToTeam: assigneeTeam,
            autoAssigned,
            createdBy: req.user._id,
            metadata: {
                ...metadata,
                createdFromTemplate: template._id,
                templateName: template.name
            }
        });

        // Update template usage stats
        await ActionTemplate.findByIdAndUpdate(template._id, {
            $inc: { usageCount: 1 },
            lastUsedAt: new Date()
        });

        Logger.info("createFromTemplate", "Action created from template", {
            context: { actionId: action._id, templateId: template._id },
            req
        });

        res.status(201).json({ success: true, action });
    } catch (error) {
        Logger.error("createFromTemplate", "Error creating action from template", { error, req });
        res.status(500).json({ success: false, message: "Error creating action from template" });
    }
});

module.exports = router;

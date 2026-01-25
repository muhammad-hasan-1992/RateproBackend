// routes/escalationRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { setTenantId } = require("../middlewares/tenantMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const EscalationRule = require("../models/EscalationRule");
const { runEscalationCheck } = require("../crons/escalation.cron");
const Logger = require("../utils/logger");

// Protect all routes
router.use(protect);
router.use(setTenantId);

/**
 * GET /api/escalation/rules
 * List all escalation rules for tenant
 */
router.get("/rules", allowRoles("companyAdmin", "admin"), async (req, res) => {
    try {
        const rules = await EscalationRule.find({ tenant: req.user.tenant })
            .populate("action.escalateTo", "name email")
            .sort({ priority: -1, createdAt: -1 });

        res.json({ success: true, rules });
    } catch (error) {
        Logger.error("getEscalationRules", "Error fetching rules", { error, req });
        res.status(500).json({ success: false, message: "Error fetching rules" });
    }
});

/**
 * POST /api/escalation/rules
 * Create a new escalation rule
 */
router.post("/rules", allowRoles("companyAdmin", "admin"), async (req, res) => {
    try {
        const { name, description, trigger, conditions, action, priority, isActive } = req.body;

        if (!name || !trigger?.type) {
            return res.status(400).json({ success: false, message: "Name and trigger type are required" });
        }

        const rule = await EscalationRule.create({
            tenant: req.user.tenant,
            name,
            description,
            trigger,
            conditions,
            action,
            priority: priority || 0,
            isActive: isActive !== false
        });

        await rule.populate("action.escalateTo", "name email");

        Logger.info("createEscalationRule", "Escalation rule created", {
            context: { ruleId: rule._id, name },
            req
        });

        res.status(201).json({ success: true, rule });
    } catch (error) {
        Logger.error("createEscalationRule", "Error creating rule", { error, req });
        res.status(500).json({ success: false, message: "Error creating rule" });
    }
});

/**
 * PUT /api/escalation/rules/:id
 * Update an escalation rule
 */
router.put("/rules/:id", allowRoles("companyAdmin", "admin"), async (req, res) => {
    try {
        const rule = await EscalationRule.findOne({
            _id: req.params.id,
            tenant: req.user.tenant
        });

        if (!rule) {
            return res.status(404).json({ success: false, message: "Rule not found" });
        }

        const { name, description, trigger, conditions, action, priority, isActive } = req.body;

        if (name) rule.name = name;
        if (description !== undefined) rule.description = description;
        if (trigger) rule.trigger = trigger;
        if (conditions) rule.conditions = conditions;
        if (action) rule.action = action;
        if (priority !== undefined) rule.priority = priority;
        if (isActive !== undefined) rule.isActive = isActive;

        await rule.save();
        await rule.populate("action.escalateTo", "name email");

        Logger.info("updateEscalationRule", "Escalation rule updated", {
            context: { ruleId: rule._id },
            req
        });

        res.json({ success: true, rule });
    } catch (error) {
        Logger.error("updateEscalationRule", "Error updating rule", { error, req });
        res.status(500).json({ success: false, message: "Error updating rule" });
    }
});

/**
 * DELETE /api/escalation/rules/:id
 * Delete an escalation rule
 */
router.delete("/rules/:id", allowRoles("companyAdmin", "admin"), async (req, res) => {
    try {
        const result = await EscalationRule.deleteOne({
            _id: req.params.id,
            tenant: req.user.tenant
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: "Rule not found" });
        }

        Logger.info("deleteEscalationRule", "Escalation rule deleted", {
            context: { ruleId: req.params.id },
            req
        });

        res.json({ success: true, message: "Rule deleted" });
    } catch (error) {
        Logger.error("deleteEscalationRule", "Error deleting rule", { error, req });
        res.status(500).json({ success: false, message: "Error deleting rule" });
    }
});

/**
 * POST /api/escalation/trigger
 * Manually trigger escalation check (admin only)
 */
router.post("/trigger", allowRoles("admin"), async (req, res) => {
    try {
        const result = await runEscalationCheck();
        res.json({ success: true, ...result });
    } catch (error) {
        Logger.error("triggerEscalation", "Error triggering escalation", { error, req });
        res.status(500).json({ success: false, message: "Error triggering escalation" });
    }
});

module.exports = router;

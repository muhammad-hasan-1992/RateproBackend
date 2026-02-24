// controllers/platformOversightController.js
const Contact = require("../models/ContactManagement");
const Survey = require("../models/Survey");
const Action = require("../models/Action");
const User = require("../models/User");
const Tenant = require("../models/Tenant");
const Logger = require("../utils/auditLog");

/**
 * Platform Oversight Controller
 *
 * Read-only endpoints for System Admins to inspect tenant data
 * for support, auditing, and debugging purposes.
 *
 * All routes are protected by requireSystemAdmin + enforcePlatformScope
 * in platform.routes.js.
 */

// ============================================================================
// TENANT CONTACTS
// ============================================================================

/**
 * GET /api/platform/oversight/tenants/:tenantId/contacts
 * List contacts belonging to a specific tenant
 */
exports.getTenantContacts = async (req, res, next) => {
    try {
        const { tenantId } = req.params;
        const { page = 1, limit = 20, search } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const filter = { tenant: tenantId, deleted: { $ne: true } };
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } },
                { phone: { $regex: search, $options: "i" } },
            ];
        }

        const [contacts, total] = await Promise.all([
            Contact.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .select("name email phone category tags status createdAt")
                .lean(),
            Contact.countDocuments(filter),
        ]);

        res.status(200).json({
            success: true,
            data: {
                contacts,
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (err) {
        Logger.error("platformOversight", "Error fetching tenant contacts", { error: err, req });
        next(err);
    }
};

// ============================================================================
// TENANT SURVEYS
// ============================================================================

/**
 * GET /api/platform/oversight/tenants/:tenantId/surveys
 * List surveys belonging to a specific tenant
 */
exports.getTenantSurveys = async (req, res, next) => {
    try {
        const { tenantId } = req.params;
        const { page = 1, limit = 20, status } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const filter = { tenant: tenantId, deleted: { $ne: true } };
        if (status) filter.status = status;

        const [surveys, total] = await Promise.all([
            Survey.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .select("title status type responseCount createdAt scheduledAt closedAt")
                .populate("createdBy", "name email")
                .lean(),
            Survey.countDocuments(filter),
        ]);

        res.status(200).json({
            success: true,
            data: {
                surveys,
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (err) {
        Logger.error("platformOversight", "Error fetching tenant surveys", { error: err, req });
        next(err);
    }
};

// ============================================================================
// TENANT ACTIONS
// ============================================================================

/**
 * GET /api/platform/oversight/tenants/:tenantId/actions
 * List actions belonging to a specific tenant
 */
exports.getTenantActions = async (req, res, next) => {
    try {
        const { tenantId } = req.params;
        const { page = 1, limit = 20, status, priority } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const filter = { tenant: tenantId, deleted: { $ne: true } };
        if (status) filter.status = status;
        if (priority) filter.priority = priority;

        const [actions, total] = await Promise.all([
            Action.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .select("title status priority category dueDate assignedTo createdAt")
                .populate("assignedTo", "name email")
                .lean(),
            Action.countDocuments(filter),
        ]);

        res.status(200).json({
            success: true,
            data: {
                actions,
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (err) {
        Logger.error("platformOversight", "Error fetching tenant actions", { error: err, req });
        next(err);
    }
};

// ============================================================================
// TENANT USERS
// ============================================================================

/**
 * GET /api/platform/oversight/tenants/:tenantId/users
 * List users belonging to a specific tenant
 */
exports.getTenantUsers = async (req, res, next) => {
    try {
        const { tenantId } = req.params;
        const { page = 1, limit = 20, role } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const filter = { tenant: tenantId, deleted: { $ne: true } };
        if (role) filter.role = role;

        const [users, total] = await Promise.all([
            User.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .select("name email role isActive isVerified department createdAt lastLogin")
                .populate("department", "name")
                .lean(),
            User.countDocuments(filter),
        ]);

        res.status(200).json({
            success: true,
            data: {
                users,
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (err) {
        Logger.error("platformOversight", "Error fetching tenant users", { error: err, req });
        next(err);
    }
};

// ============================================================================
// TENANT OVERVIEW
// ============================================================================

/**
 * GET /api/platform/oversight/tenants/:tenantId
 * Get tenant profile details with usage summary
 */
exports.getTenantOverview = async (req, res, next) => {
    try {
        const { tenantId } = req.params;

        const tenant = await Tenant.findById(tenantId)
            .populate("admin", "name email")
            .lean();

        if (!tenant) {
            return res.status(404).json({ success: false, message: "Tenant not found" });
        }

        // Collect counts in parallel
        const [userCount, contactCount, surveyCount, actionCount] = await Promise.all([
            User.countDocuments({ tenant: tenantId, deleted: { $ne: true } }),
            Contact.countDocuments({ tenant: tenantId, deleted: { $ne: true } }),
            Survey.countDocuments({ tenant: tenantId, deleted: { $ne: true } }),
            Action.countDocuments({ tenant: tenantId, deleted: { $ne: true } }),
        ]);

        res.status(200).json({
            success: true,
            data: {
                tenant,
                counts: { users: userCount, contacts: contactCount, surveys: surveyCount, actions: actionCount },
            },
        });
    } catch (err) {
        Logger.error("platformOversight", "Error fetching tenant overview", { error: err, req });
        next(err);
    }
};

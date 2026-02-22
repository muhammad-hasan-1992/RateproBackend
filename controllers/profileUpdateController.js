// controllers/profileUpdateController.js
const ProfileUpdateRequest = require("../models/ProfileUpdateRequest");
const Tenant = require("../models/Tenant");
const notificationService = require("../services/notifications/notificationService");
const User = require("../models/User");
const Logger = require("../utils/auditLog");
const mongoose = require("mongoose");

// ============================================================================
// COMPANYADMIN — SUBMIT PROFILE UPDATE REQUEST
// ============================================================================

/**
 * POST /api/profile-updates
 * CompanyAdmin submits a company profile change request for admin approval.
 * Only whitelisted tenant fields are accepted.
 */
exports.submitProfileUpdate = async (req, res, next) => {
    try {
        const { changes } = req.body;

        if (!changes || typeof changes !== "object" || Object.keys(changes).length === 0) {
            return res.status(400).json({
                success: false,
                message: "changes object is required and must not be empty",
            });
        }

        // Whitelist validation
        const allowedFields = ProfileUpdateRequest.ALLOWED_FIELDS;
        const invalidFields = Object.keys(changes).filter((f) => !allowedFields.includes(f));
        if (invalidFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Invalid fields: ${invalidFields.join(", ")}. Allowed: ${allowedFields.join(", ")}`,
            });
        }

        // Get current tenant values for snapshot
        const tenant = await Tenant.findById(req.user.tenant);
        if (!tenant) {
            return res.status(404).json({ success: false, message: "Tenant not found" });
        }

        // Build current values snapshot (only for fields being changed)
        const currentValues = {};
        for (const field of Object.keys(changes)) {
            currentValues[field] = tenant[field] ?? null;
        }

        // Check for duplicate pending request
        const existingPending = await ProfileUpdateRequest.findOne({
            tenant: req.user.tenant,
            status: "pending",
        });

        if (existingPending) {
            return res.status(409).json({
                success: false,
                message: "A pending profile update request already exists. Please wait for it to be reviewed.",
            });
        }

        const request = await ProfileUpdateRequest.create({
            requestedBy: req.user._id,
            tenant: req.user.tenant,
            proposedChanges: changes,
            currentValues,
        });

        // Notify system admins about the pending request
        const adminUsers = await User.find({ role: "admin", deleted: { $ne: true } }).select("_id");
        for (const admin of adminUsers) {
            await notificationService.createNotification({
                userId: admin._id,
                tenantId: null, // platform scope
                title: "Company Profile Update Request",
                message: `${req.user.name} from "${tenant.name}" has requested company profile changes.`,
                type: "alert",
                priority: "medium",
                reference: { type: "ProfileUpdateRequest", id: request._id },
                actionUrl: `/platform/profile-updates/${request._id}`,
                source: "system",
            });
        }

        Logger.info("profileUpdate", "Profile update request submitted", {
            context: { requestId: request._id, userId: req.user._id, tenant: req.user.tenant },
            req,
        });

        res.status(201).json({
            success: true,
            message: "Company profile update request submitted for admin approval",
            data: request,
        });
    } catch (err) {
        Logger.error("profileUpdate", "Error submitting profile update request", { error: err, req });
        next(err);
    }
};

// ============================================================================
// COMPANYADMIN — VIEW OWN REQUESTS
// ============================================================================

/**
 * GET /api/profile-updates
 * CompanyAdmin views their own profile update request history.
 */
exports.listMyRequests = async (req, res, next) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const filter = { tenant: req.user.tenant };
        if (status) filter.status = status;

        const [requests, total] = await Promise.all([
            ProfileUpdateRequest.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .populate("requestedBy", "name email")
                .populate("reviewedBy", "name email")
                .lean(),
            ProfileUpdateRequest.countDocuments(filter),
        ]);

        res.status(200).json({
            success: true,
            data: {
                requests,
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (err) {
        Logger.error("profileUpdate", "Error listing profile update requests", { error: err, req });
        next(err);
    }
};

// ============================================================================
// ADMIN — LIST PENDING REQUESTS (PLATFORM SCOPE)
// ============================================================================

/**
 * GET /api/platform/profile-updates/pending
 * System Admin views all pending profile update requests across tenants.
 */
exports.listPendingRequests = async (req, res, next) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [requests, total] = await Promise.all([
            ProfileUpdateRequest.find({ status: "pending" })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .populate("requestedBy", "name email role")
                .populate("tenant", "name contactEmail")
                .lean(),
            ProfileUpdateRequest.countDocuments({ status: "pending" }),
        ]);

        res.status(200).json({
            success: true,
            data: {
                requests,
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (err) {
        Logger.error("profileUpdate", "Error listing pending requests", { error: err, req });
        next(err);
    }
};

// ============================================================================
// ADMIN — REVIEW (APPROVE/REJECT) REQUEST
// ============================================================================

/**
 * PATCH /api/platform/profile-updates/:id
 * System Admin approves or rejects a profile update request.
 * If approved, proposed changes are atomically applied to the Tenant model.
 */
exports.reviewRequest = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { action, reviewNote } = req.body;

        if (!["approve", "reject"].includes(action)) {
            return res.status(400).json({
                success: false,
                message: "action must be 'approve' or 'reject'",
            });
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid request ID format",
            });
        }

        const request = await ProfileUpdateRequest.findById(id);

        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        if (request.status !== "pending") {
            return res.status(409).json({
                success: false,
                message: `Request has already been ${request.status}`,
            });
        }

        const newStatus = action === "approve" ? "approved" : "rejected";

        // If approving, apply changes atomically to Tenant
        if (action === "approve") {
            const allowedFields = ProfileUpdateRequest.ALLOWED_FIELDS;
            const updateFields = {};

            for (const [field, value] of Object.entries(request.proposedChanges)) {
                if (allowedFields.includes(field)) {
                    updateFields[field] = value;
                }
            }

            const tenant = await Tenant.findByIdAndUpdate(
                request.tenant,
                { $set: updateFields },
                { new: true, runValidators: true }
            );

            if (!tenant) {
                return res.status(404).json({ success: false, message: "Tenant not found" });
            }

            Logger.info("profileUpdate", "Company profile changes applied", {
                context: {
                    requestId: id,
                    tenantId: request.tenant,
                    appliedFields: Object.keys(updateFields),
                    reviewedBy: req.user._id,
                },
                req,
            });
        }

        // Update request status
        request.status = newStatus;
        request.reviewedBy = req.user._id;
        request.reviewedAt = new Date();
        request.reviewNote = reviewNote || null;
        await request.save();

        // Notify the requesting CompanyAdmin
        await notificationService.createNotification({
            userId: request.requestedBy,
            tenantId: request.tenant, // tenant scope
            title: `Company Profile Update ${newStatus === "approved" ? "Approved" : "Rejected"}`,
            message: newStatus === "approved"
                ? "Your company profile update has been approved and applied."
                : `Your company profile update was rejected.${reviewNote ? ` Reason: ${reviewNote}` : ""}`,
            type: newStatus === "approved" ? "success" : "warning",
            priority: "medium",
            reference: { type: "ProfileUpdateRequest", id: request._id },
            actionUrl: "/profile",
            source: "system",
        });

        Logger.info("profileUpdate", `Profile update request ${newStatus}`, {
            context: { requestId: id, action, reviewedBy: req.user._id },
            req,
        });

        res.status(200).json({
            success: true,
            message: `Request ${newStatus}`,
            data: request,
        });
    } catch (err) {
        Logger.error("profileUpdate", "Error reviewing profile update request", { error: err, req });
        next(err);
    }
};

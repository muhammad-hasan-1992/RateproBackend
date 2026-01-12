// controllers/permissionAssignmentController.js
const PermissionAssignment = require('../models/PermissionAssignment');
const User = require('../models/User');
const Permission = require('../models/Permission');
const Joi = require('joi');
const Logger = require('../utils/auditLog');

// Validation
const assignPermissionSchema = Joi.object({
    userId: Joi.string().hex().length(24).required(),
    permissionId: Joi.string().hex().length(24).required(),
});

// Validation for deleting assignment
const deleteAssignmentSchema = Joi.object({
    id: Joi.string().hex().length(24).required(),
});

// POST: Task assign karo aur permission direct assign ho jaaye
exports.assignPermission = async (req, res, next) => {
    try {
        const { error } = assignPermissionSchema.validate(req.body);
        if (error) return res.status(400).json({ message: error.details[0].message });

        const { userId, permissionId } = req.body;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (req.user.role !== 'admin' && user.tenant?.toString() !== req.tenantId) {
            return res.status(403).json({ message: 'Access denied: User not in your tenant' });
        }

        const permission = await Permission.findById(permissionId);
        if (!permission) return res.status(404).json({ message: 'Permission not found' });

        const existing = await PermissionAssignment.findOne({
            userId,
            permissionId,
            tenantId: req.tenantId,
        });
        if (existing) return res.status(400).json({ message: 'Permission already assigned' });

        const assignment = await PermissionAssignment.create({
            userId,
            permissionId,
            tenantId: req.tenantId,
        });

        const populated = await PermissionAssignment.findById(assignment._id)
            .populate('userId', 'name email')
            .populate('permissionId', 'name description');

        // ✅ Log only when successful (201)
        // Logger.info("assignPermission", "Permission successfully assigned", {
        //     context: {
        //         triggeredBy: req.user?.email,
        //         tenantId: req.tenantId,
        //         userId,
        //         permissionId,
        //         assignmentId: assignment._id,
        //         statusCode: 201
        //     },
        //     req
        // });

        res.status(201).json({
            success: true,
            message: 'Task assigned and permission granted',
            assignment: populated
        });

    } catch (err) {
        console.error('assignPermission error:', err);

        // ❌ Log only on error
        Logger.error("assignPermission", "Failed to assign permission", {
            error: err,
            context: {
                triggeredBy: req.user?.email,
                tenantId: req.tenantId
            },
            req
        });

        res.status(500).json({ success: false, message: err.message });
    }
};

// DELETE: Task remove karo aur permission hatao
exports.removePermission = async (req, res, next) => {
    try {
        const { error } = deleteAssignmentSchema.validate(req.params);
        if (error) return res.status(400).json({ message: error.details[0].message });

        const { id } = req.params;

        const assignment = await PermissionAssignment.findById(id);
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

        if (req.user.role !== 'admin' && assignment.tenantId.toString() !== req.tenantId) {
            return res.status(403).json({ message: 'Access denied' });
        }

        await PermissionAssignment.findByIdAndDelete(id);

        // ✅ Log only when successfully deleted (200)
        // Logger.info("removePermission", "Permission assignment removed", {
        //     context: {
        //         triggeredBy: req.user?.email,
        //         tenantId: req.tenantId,
        //         assignmentId: id,
        //         statusCode: 200
        //     },
        //     req
        // });

        res.status(200).json({
            success: true,
            message: 'Task removed and permission revoked'
        });

    } catch (err) {
        console.error('removePermission error:', err);

        // ❌ Log only on real errors
        Logger.error("removePermission", "Failed to remove permission assignment", {
            error: err,
            context: {
                triggeredBy: req.user?.email,
                tenantId: req.tenantId
            },
            req
        });

        res.status(500).json({ success: false, message: err.message });
    }
};

// GET: Saare assignments fetch karo (table ke liye)
exports.getAssignments = async (req, res, next) => {
    try {
        const query = req.user.role === 'admin' ? {} : { tenantId: req.tenantId };

        const assignments = await PermissionAssignment.find(query)
            .populate('userId', 'name email')
            .populate('permissionId', 'name description')
            .lean();

        // ✅ Log success (200)
        // Logger.info("getAssignments", "Fetched permission assignments successfully", {
        //     context: {
        //         triggeredBy: req.user?.email,
        //         tenantId: req.tenantId,
        //         assignmentCount: assignments.length,
        //         statusCode: 200
        //     },
        //     req
        // });

        res.status(200).json({
            success: true,
            assignments
        });

    } catch (err) {
        console.error('getAssignments error:', err);

        // ❌ Log actual error
        Logger.error("getAssignments", "Failed to fetch permission assignments", {
            error: err,
            context: {
                triggeredBy: req.user?.email,
                tenantId: req.tenantId
            },
            req
        });

        res.status(500).json({ success: false, message: err.message });
    }
};

// GET: Tenant ke users fetch karo (dropdown ke liye)
exports.getTenantUsers = async (req, res, next) => {
    try {
        const query = req.user.role === 'admin'
            ? {}
            : { tenant: req.tenantId, role: 'member' };

        const users = await User.find(query)
            .select('_id name email role')
            .lean();

        // ✅ log success when response is 200
        // Logger.info("getTenantUsers", "Fetched tenant users successfully", {
        //     context: {
        //         triggeredBy: req.user?.email,
        //         tenantId: req.tenantId,
        //         userCount: users.length,
        //         statusCode: 200
        //     },
        //     req
        // });


        res.status(200).json({
            success: true,
            users
        });

    } catch (err) {
        console.error('getTenantUsers error:', err);

        // ❌ log error
        Logger.error("getTenantUsers", "Failed to fetch tenant users", {
            error: err,
            context: {
                triggeredBy: req.user?.email,
                tenantId: req.tenantId
            },
            req
        });

        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// controllers/permissionAssignmentController.js
exports.getUserPermissions = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const tenantId = req.tenantId;

        const user = await User.findById(userId).populate({
            path: 'customRoles',
            match: { isActive: true, deleted: false },
            populate: { path: 'permissions', select: 'name description' },
        });

        if (!user) {
            Logger.warn("getUserPermissions", "User not found while fetching permissions", {
                context: {
                    triggeredBy: req.user?.email,
                    userId,
                    tenantId,
                    statusCode: 404
                },
                req
            });
            return res.status(404).json({ message: 'User not found' });
        }

        const rolePermissions = user.customRoles?.flatMap(role =>
            role.permissions.map(perm => ({
                _id: perm._id,
                name: perm.name,
                description: perm.description,
            }))
        ) || [];

        const directPermissions = await PermissionAssignment.find({
            userId,
            tenantId,
        }).populate('permissionId', 'name description');

        const assignedPermissions = directPermissions.map(assignment => ({
            _id: assignment.permissionId._id,
            name: assignment.permissionId.name,
            description: assignment.permissionId.description,
        }));

        const allPermissions = [
            ...new Map(
                [...rolePermissions, ...assignedPermissions].map(perm => [perm._id.toString(), perm])
            ).values(),
        ];

        // ✅ success log
        // Logger.info("getUserPermissions", "User permissions fetched successfully", {
        //     context: {
        //         triggeredBy: req.user?.email,
        //         userId,
        //         tenantId,
        //         totalPermissions: allPermissions.length,
        //         statusCode: 200
        //     },
        //     req
        // });


        return res.status(200).json({ permissions: allPermissions });
    } catch (err) {
        console.error('getUserPermissions: Error', { error: err.message });

        // ❌ error log
        Logger.error("getUserPermissions", "Error fetching user permissions", {
            error: err,
            context: {
                triggeredBy: req.user?.email,
                tenantId: req.tenantId
            },
            req
        });
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}; 
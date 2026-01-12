// middlewares/permissionMiddleware.js
const User = require("../models/User");
const CustomRole = require("../models/CustomRole");
const PermissionAssignment = require('../models/PermissionAssignment');
const Permission = require('../models/Permission');

exports.allowPermission = (permission) => async (req, res, next) => {
  try {

    // ✅ Allow admin and companyAdmin to bypass permission check
    if (req.user.role === 'admin' || req.user.role === 'companyAdmin') {
      return next();
    }

    // Fetch user with populated customRoles
    const user = await User.findById(req.user._id).populate({
      path: 'customRoles',
      match: { isActive: true, deleted: false },
      populate: { path: 'permissions', select: 'name' },
    });

    // Check permission in customRoles
    const hasRolePermission = user.customRoles?.some((role) =>
      role.permissions.some((perm) => perm.name === permission)
    );

    // Check permission in PermissionAssignment
    const permissionDoc = await Permission.findOne({ name: permission });
    if (!permissionDoc) {
      return res.status(404).json({ message: 'Permission not found' });
    }

    const hasDirectPermission = await PermissionAssignment.findOne({
      userId: req.user._id,
      permissionId: permissionDoc._id,
      tenantId: req.user.tenant?._id,
    });

    const hasPermission = hasRolePermission || !!hasDirectPermission;

    if (!hasPermission) {
      return res.status(403).json({ message: 'Permission denied: Insufficient permissions' });
    }

    // Tenant validation (same as original)
    const { tenant, company } = req.body;
    if (req.user.role === 'companyAdmin' && company) {
      return res.status(400).json({ message: 'Deprecated field: Use tenant instead of company' });
    }

    if (req.user.role === 'companyAdmin' && tenant && tenant !== req.user.tenant._id?.toString()) {
      return res.status(403).json({ message: 'Access denied: Invalid tenant' });
    }

    next();
  } catch (err) {
    console.error('allowPermission: Error', { error: err.message });
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};
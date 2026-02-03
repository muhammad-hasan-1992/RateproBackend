// controllers/roleController.js
const mongoose = require('mongoose');
const CustomRole = require("../models/CustomRole");
const User = require("../models/User");
const Permission = require("../models/Permission");
const Joi = require("joi");
const crypto = require("crypto");
const Logger = require("../utils/logger");

// Validation Schemas
const createRoleSchema = Joi.object({
  name: Joi.string().min(3).max(50).required().messages({
    "string.min": "Role name must be at least 3 characters",
    "string.max": "Role name cannot exceed 50 characters",
    "any.required": "Role name is required",
  }),
  permissions: Joi.array().items(Joi.string().hex().length(24)).optional(),
  description: Joi.string().allow("").optional(),
  tenantId: Joi.string().hex().length(24).optional(),
});

const getRolesSchema = Joi.object({
  tenantId: Joi.string().hex().length(24).optional(),
});

const assignRoleSchema = Joi.object({
  roleId: Joi.string().hex().length(24).required(),
});

const removeRoleSchema = Joi.object({
  roleId: Joi.string().hex().length(24).required(),
});

const getUsersByRoleSchema = Joi.object({
  roleId: Joi.string().hex().length(24).required(),
});

// Create a new role
exports.createRole = async (req, res) => {
  try {
    const { name, permissions, description, tenantId } = req.body;

    if (!name || !permissions || !tenantId) {
      return res.status(400).json({ message: "Name, permissions, and tenantId are required" });
    }

    if (!req.user.tenant || !req.user.tenant._id) {
      return res.status(403).json({ message: "User has no associated tenant" });
    }

    if (req.user.tenant._id.toString() !== tenantId) {
      return res.status(403).json({
        message: `Cannot create role for another tenant. User tenant: ${req.user.tenant._id}, Payload tenant: ${tenantId}`,
      });
    }

    // --- Role-based restrictions ---
    if (req.user.role === "companyAdmin") {
      // ✅ companyAdmin allowed
    } else if (req.user.role === "member") {
      const populatedUser = await User.findById(req.user._id).populate({
        path: "customRoles",
        populate: { path: "permissions" },
      });

      if (!populatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const hasPermission = populatedUser.customRoles?.some(
        (role) =>
          role.permissions &&
          role.permissions.some((p) => p.name === "role:create")
      );

      if (!hasPermission) {
        return res.status(403).json({ message: "Access denied: Permission 'role:create' required" });
      }
    } else {
      return res.status(403).json({ message: "Only CompanyAdmin or Member (with permission) can create roles" });
    }

    // --- Validate permissions ---
    const validPermissions = await Permission.find({ _id: { $in: permissions } });
    if (validPermissions.length !== permissions.length) {
      return res.status(400).json({ message: "Invalid permissions provided" });
    }

    // --- Generate unique signature for permissions (kept for backward compatibility) ---
    const sorted = validPermissions.map((p) => p._id.toString()).sort().join("_");
    const permissionsSignature = crypto.createHash("md5").update(sorted).digest("hex");

    // UPDATED: Check for duplicate role name regardless of permissions
    const existingRole = await CustomRole.findOne({
      name,
      tenant: tenantId,
    });

    if (existingRole) {
      return res.status(400).json({
        message: "A role with this name already exists. Please choose a unique name."
      });
    }

    // --- Create role ---
    const permissionsWithNames = validPermissions.map((perm) => ({
      _id: perm._id,
      name: perm.name,
    }));

    const role = await CustomRole.create({
      name,
      permissions: permissionsWithNames,
      description,
      tenant: tenantId,
      createdBy: req.user._id,
      permissionsSignature,
    });

    await role.populate("permissions", "name");

    // Logger.info("createRole", "Role created successfully", {
    //   context: {
    //     triggeredBy: req.user?.email,
    //     tenantId,
    //     roleId: role._id,
    //     roleName: role.name,
    //     totalPermissions: permissions.length,
    //     statusCode: 201,
    //   },
    //   req
    // });


    return res.status(201).json({ role });
  } catch (error) {
    console.error("💥 Error creating role:", error);

    Logger.error("createRole", "Unhandled error in role creation", {
      error,
      context: {
        triggeredBy: req.user?.email,
        tenantId: req.tenantId,
      },
      req
    });

    return res.status(500).json({ message: "Failed to create role", error: error.message });
  }
};

// Get all roles
exports.getRoles = async (req, res, next) => {
  try {
    const { error } = getRolesSchema.validate(req.query);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { tenantId } = req.query;
    let query = {};

    if (req.user.role === "companyAdmin") {
      // ✅ companyAdmin is always allowed
      query.tenant = new mongoose.Types.ObjectId(req.tenantId);
    } else if (req.user.role === "member") {
      // check if member has 'role:read' permission
      const populatedUser = await User.findById(req.user._id).populate({
        path: "customRoles",
        populate: { path: "permissions" },
      });

      if (!populatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const hasPermission = populatedUser.customRoles?.some(
        (role) =>
          role.permissions &&
          role.permissions.some((p) => p.name === "role:read")
      );

      if (!hasPermission) {
        return res.status(403).json({ message: "Access denied: Permission 'role:read' required" });
      }

      query.tenant = new mongoose.Types.ObjectId(req.user.tenant._id);
    }

    const roles = await CustomRole.find(query).populate("permissions tenant");
    const total = await CustomRole.countDocuments(query);

    // Logger.info("getRoles", "Roles retrieved successfully", {
    //   context: {
    //     triggeredBy: req.user?.email,
    //     tenantId: req.tenantId,
    //     total,
    //     statusCode: 200,
    //   },
    //   req
    // });

    return res.status(200).json({ message: "Roles retrieved", roles, total });
  } catch (err) {
    console.error("💥 Error getting roles:", err);

    Logger.error("getRoles", "Unhandled error in getRoles controller", {
      error,
      context: {
        triggeredBy: req.user?.email,
        tenantId: req.tenantId,
      },
      req
    });

    return res.status(500).json({ message: "Failed to fetch roles", error: err.message });
  }
};

// Assign role to user
exports.assignRoleToUser = async (req, res, next) => {
  try {
    const { error: bodyError } = assignRoleSchema.validate(req.body);
    const { error: paramError } = Joi.object({
      userId: Joi.string().hex().length(24).required(),
    }).validate(req.params);

    if (bodyError || paramError) {
      return res.status(400).json({ message: (bodyError || paramError).details[0].message });
    }

    const { userId } = req.params;
    const { roleId } = req.body;

    // --- Role-based restrictions ---
    if (req.user.role === "companyAdmin") {
      // ✅ allowed directly
    } else if (req.user.role === "member") {
      const populatedUser = await User.findById(req.user._id).populate({
        path: "customRoles",
        populate: { path: "permissions" },
      });

      if (!populatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const hasPermission = populatedUser.customRoles?.some(
        (role) =>
          role.permissions &&
          role.permissions.some((p) => p.name === "role:assign")
      );

      if (!hasPermission) {
        return res.status(403).json({ message: "Access denied: Permission 'role:assign' required" });
      }
    } else {
      return res.status(403).json({ message: "Only companyAdmin or member (with permission) can assign roles" });
    }

    const role = await CustomRole.findById(roleId).populate("tenant");
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role !== "member") {
      return res.status(400).json({ message: "Can only assign roles to members" });
    }

    if (req.user.role !== "admin" && role.tenant && role.tenant._id.toString() !== req.tenantId) {
      return res.status(403).json({ message: "Cannot assign role from different tenant" });
    }

    if (req.user.role !== "admin" && user.tenant && user.tenant.toString() !== req.tenantId) {
      return res.status(403).json({ message: "Cannot assign role to user from different tenant" });
    }

    // ✅ assign role
    user.customRoles = user.customRoles || [];
    if (!user.customRoles.some((r) => r.toString() === roleId)) {
      user.customRoles.push(roleId);
      await user.save();
    }

    if (!role.users.includes(userId)) {
      role.users.push(userId);
      role.userCount = role.users.length;
      await role.save();
    }

    const updatedUser = await User.findById(userId)
      .select("-password")
      .populate("tenant customRoles");

    // Logger.info("assignRoleToUser", "Role assigned successfully", {
    //   context: {
    //     triggeredBy: req.user?.email,
    //     tenantId: req.tenantId,
    //     assignedRole: role.name,
    //     targetUser: updatedUser.email,
    //     statusCode: 200,
    //   },
    //   req
    // });


    return res.status(200).json({ message: "Role assigned", user: updatedUser });
  } catch (err) {
    console.error("💥 Error assigning role:", err);
    Logger.error("assignRoleToUser", "Unexpected error while assigning role", {
      error,
      context: {
        triggeredBy: req.user?.email,
        tenantId: req.tenantId,
      },
      req
    });
    return res.status(500).json({ message: "Failed to assign role", error: err.message });
  }
};

// Remove role from user
exports.removeRoleFromUser = async (req, res, next) => {
  try {
    const { error: bodyError } = removeRoleSchema.validate(req.body);
    const { error: paramError } = Joi.object({
      userId: Joi.string().hex().length(24).required(),
    }).validate(req.params);

    if (bodyError || paramError) {
      Logger.warn("removeRoleFromUser", "Validation failed", {
        context: {
          bodyError,
          paramError,
        },
        req
      });
      return res
        .status(400)
        .json({ message: (bodyError || paramError).details[0].message });
    }

    const { userId } = req.params;
    const { roleId } = req.body;

    // Logger.info("removeRoleFromUser", "Starting role removal", {
    //   context: {
    //     userId,
    //     roleId,
    //     performedBy: req.user._id,
    //     tenantId: req.tenantId,
    //   },
    //   req
    // });

    // --- Role-based restrictions ---
    if (req.user.role === 'companyAdmin') {
      // Logger.info("removeRoleFromUser", "Request by companyAdmin", {
      //   context: {
      //     adminId: req.user._id,
      //   },
      //   req
      // });
    } else if (req.user.role === 'member') {
      const populatedUser = await User.findById(req.user._id).populate({
        path: 'customRoles',
        populate: { path: 'permissions' },
      });

      if (!populatedUser) {
        Logger.error("removeRoleFromUser", "Requesting user not found", {
          context: {
            userId: req.user._id,
          },
          req
        });
        return res.status(404).json({ message: 'User not found' });
      }

      const hasPermission = populatedUser.customRoles?.some(
        (role) =>
          role.permissions &&
          role.permissions.some((p) => p.name === 'role:remove')
      );

      if (!hasPermission) {
        Logger.warn("removeRoleFromUser", "Missing permission role:remove", {
          context: {
            userId: req.user._id,
          },
          req
        });
        return res.status(403).json({
          message: "Access denied: Permission 'role:remove' required",
        });
      }
    } else {
      Logger.warn("removeRoleFromUser", "Invalid user role", {
        context: {
          userRole: req.user.role,
        },
        req
      });
      return res.status(403).json({
        message: 'Only companyAdmin or member (with permission) can remove roles',
      });
    }

    const role = await CustomRole.findById(roleId).populate('tenant');
    if (!role) {
      Logger.warn("removeRoleFromUser", "Role not found", {
        context: {
          roleId,
        },
        req
      });
      return res.status(404).json({ message: 'Role not found' });
    }

    const user = await User.findById(userId);
    if (!user) {
      Logger.warn("removeRoleFromUser", "User not found", {
        context: {
          userId,
        },
        req
      });
      return res.status(404).json({ message: 'User not found' });
    }

    // Tenant validation
    if (
      req.user.role !== 'admin' &&
      role.tenant &&
      role.tenant._id.toString() !== req.tenantId
    ) {
      Logger.warn("removeRoleFromUser", "Attempt to remove role from another tenant", {
        context: {
          tenantId: req.tenantId,
          roleTenant: role.tenant._id,
        },
        req
      });
      return res
        .status(403)
        .json({ message: 'Cannot remove role from different tenant' });
    }

    if (
      req.user.role !== 'admin' &&
      user.tenant &&
      user.tenant.toString() !== req.tenantId
    ) {
      Logger.warn("removeRoleFromUser", "Attempt to remove role from user of another tenant", {
        context: {
          tenantId: req.tenantId,
          userTenant: user.tenant,
        },
        req
      });
      return res
        .status(403)
        .json({ message: 'Cannot remove role from user of different tenant' });
    }

    // Actual removal logic
    user.customRoles = (user.customRoles || []).filter(
      (r) => !(r._id ? r._id.equals(roleId) : r.equals(roleId))
    );
    await user.save();

    role.users = (role.users || []).filter((u) => u.toString() !== userId);
    role.userCount = role.users.length;
    await role.save();

    // Logger.info("removeRoleFromUser", "Role successfully removed", {
    //   context: {
    //     userId,
    //     roleId,
    //     tenantId: req.tenantId,
    //   },
    //   req
    // });

    const updatedUser = await User.findById(userId)
      .select('-password')
      .populate('tenant customRoles');

    return res.status(200).json({ message: 'Role removed', user: updatedUser });
  } catch (err) {
    Logger.error("removeRoleFromUser", "Error while removing role", {
      error,
      context: {
        userId,
        roleId,
      },
      req
    });
    next(err);
  }
};

// Update an existing role
exports.updateRole = async (req, res, next) => {
  try {
    const { error: bodyError } = createRoleSchema.validate(req.body);
    const { error: paramError } = Joi.object({
      roleId: Joi.string().hex().length(24).required(),
    }).validate(req.params);

    if (bodyError || paramError) {
      Logger.warn("updateRole", "Validation failed", {
        context: {
          bodyError,
          paramError,
        },
        req
      });
      return res
        .status(400)
        .json({ message: (bodyError || paramError).details[0].message });
    }

    const { roleId } = req.params;
    const { name, permissions, description, tenantId } = req.body;

    // Logger.info("updateRole", "Starting role update", {
    //   context: {
    //     roleId,
    //     performedBy: req.user._id,
    //     tenantId: req.tenantId,
    //   },
    //   req
    // });

    // --- Role-based restrictions ---
    if (req.user.role === 'companyAdmin') {
      // Logger.info("updateRole", "Request by companyAdmin", {
      //   context: {
      //     adminId: req.user._id,
      //   },
      //   req
      // });
    } else if (req.user.role === 'member') {
      const populatedUser = await User.findById(req.user._id).populate({
        path: 'customRoles',
        populate: { path: 'permissions' },
      });

      if (!populatedUser) {
        Logger.error("updateRole", "Requesting user not found", {
          context: {
            userId: req.user._id,
          },
          req
        });
        return res.status(404).json({ message: 'User not found' });
      }

      const hasPermission = populatedUser.customRoles?.some(
        (role) =>
          role.permissions &&
          role.permissions.some((p) => p.name === 'role:update')
      );

      if (!hasPermission) {
        Logger.warn("updateRole", "Missing permission role:update", {
          context: {
            userId: req.user._id,
          },
          req
        });
        return res
          .status(403)
          .json({ message: "Access denied: Permission 'role:update' required" });
      }
    } else {
      Logger.warn("updateRole", "Invalid user role", {
        context: {
          userRole: req.user.role,
        },
        req
      });
      return res.status(403).json({
        message:
          'Only companyAdmin or member (with permission) can update roles',
      });
    }

    // Fetch role
    const role = await CustomRole.findById(roleId).populate('tenant');
    if (!role) {
      Logger.warn("updateRole", "Role not found", {
        context: {
          roleId,
        },
        req
      });
      return res.status(404).json({ message: 'Role not found' });
    }

    // Tenant check
    if (
      req.user.role !== 'admin' &&
      role.tenant &&
      role.tenant._id &&
      role.tenant._id.toString() !== req.tenantId
    ) {
      Logger.warn("updateRole", "Attempt to update role from different tenant", {
        context: {
          tenantId: req.tenantId,
          roleTenant: role.tenant._id,
        },
        req
      });
      return res
        .status(403)
        .json({ message: 'Cannot update role from different tenant' });
    }

    // Validate permissions
    if (permissions && permissions.length > 0) {
      const validPermissions = await Permission.find({
        _id: { $in: permissions },
      });
      if (validPermissions.length !== permissions.length) {
        Logger.warn("updateRole", "Invalid permission IDs provided", {
          context: {
            providedCount: permissions.length,
            validCount: validPermissions.length,
          },
        });
        return res.status(400).json({ message: 'Invalid permission IDs' });
      }
    }

    // --- Update Role ---
    role.name = name || role.name;
    role.permissions = permissions || role.permissions;
    role.description = description || role.description;
    role.tenant = tenantId || role.tenant;

    await role.save();
    // Logger.info("updateRole", "Role successfully updated", {
    //   context: {
    //     roleId,
    //     updatedBy: req.user._id,
    //   },
    //   req
    // });

    const updatedRole = await CustomRole.findById(roleId).populate(
      'permissions tenant'
    );

    return res.status(200).json({ message: 'Role updated', role: updatedRole });
  } catch (err) {
    Logger.error("updateRole", "Error updating role", {
      context: {
        error: err.message,
        stack: err.stack,
      },
      req
    });
    next(err);
  }
};

// Delete a role
exports.deleteRole = async (req, res, next) => {
  try {
    const { error } = Joi.object({
      roleId: Joi.string().hex().length(24).required(),
    }).validate(req.params);

    if (error) {
      Logger.warn("deleteRole", "Validation failed", {
        context: {
          details: error.details[0],
        },
        req
      });
      return res.status(400).json({ message: error.details[0].message });
    }

    const { roleId } = req.params;
    // Logger.info("deleteRole", "Start deleting role", {
    //   context: {
    //     roleId,
    //     performedBy: req.user._id,
    //     tenantId: req.tenantId,
    //   },
    //   req
    // });

    // --- Role-based restrictions ---
    if (req.user.role === 'companyAdmin') {
      // Logger.info("deleteRole", "Request by companyAdmin", {
      //   context: {
      //     adminId: req.user._id,
      //   },
      //   req
      // });
    } else if (req.user.role === 'member') {
      const populatedUser = await User.findById(req.user._id).populate({
        path: 'customRoles',
        populate: { path: 'permissions' },
      });

      if (!populatedUser) {
        Logger.error("deleteRole", "User not found", {
          context: {
            userId: req.user._id,
          },
          req
        });
        return res.status(404).json({ message: 'User not found' });
      }

      const hasPermission = populatedUser.customRoles?.some(
        (role) =>
          role.permissions &&
          role.permissions.some((p) => p.name === 'role:delete')
      );

      if (!hasPermission) {
        Logger.warn("deleteRole", "Missing permission role:delete", {
          context: {
            userId: req.user._id,
          },
          req
        });
        return res
          .status(403)
          .json({ message: "Access denied: Permission 'role:delete' required" });
      }
    } else {
      Logger.warn("deleteRole", "Invalid role access attempt", {
        context: {
          userRole: req.user.role,
        },
        req
      });
      return res.status(403).json({
        message:
          'Only companyAdmin or member (with permission) can delete roles',
      });
    }

    // --- Find Role ---
    const role = await CustomRole.findById(roleId).populate('tenant');
    if (!role) {
      Logger.warn("deleteRole", "Role not found", {
        context: {
          roleId,
        },
        req
      });
      return res.status(404).json({ message: 'Role not found' });
    }

    // --- Tenant Scoping ---
    if (
      req.user.role !== 'admin' &&
      role.tenant &&
      role.tenant._id &&
      role.tenant._id.toString() !== req.tenantId
    ) {
      Logger.warn("deleteRole", "Cross-tenant deletion attempt", {
        context: {
          requestTenant: req.tenantId,
          roleTenant: role.tenant._id,
        },
        req
      });
      return res
        .status(403)
        .json({ message: 'Cannot delete role from different tenant' });
    }

    // --- Remove role from all users ---
    const updatedUsers = await User.updateMany(
      { customRoles: roleId },
      { $pull: { customRoles: roleId } }
    );
    // Logger.info("deleteRole", "Role removed from users", {
    //   context: {
    //     roleId,
    //     affectedUsers: updatedUsers.modifiedCount,
    //   },
    //   req
    // });

    // --- Delete role ---
    await CustomRole.findByIdAndDelete(roleId);
    // Logger.info("deleteRole", "Role deleted successfully", {
    //   context: {
    //     roleId,
    //     deletedBy: req.user._id,
    //   },
    //   req
    // });

    return res.status(200).json({ message: 'Role deleted successfully' });
  } catch (err) {
    Logger.error("deleteRole", "Error while deleting role", {
      error,
      context: {
        roleId,
      },
      req
    });
    next(err);
  }
};

// Get users by role
exports.getUsersByRole = async (req, res, next) => {
  try {
    // --- Validate Params ---
    const { error } = getUsersByRoleSchema.validate(req.params);
    if (error) {
      Logger.warn("getUsersByRole: Validation failed", {
        context: {
          details: error.details[0],
          performedBy: req.user?._id,
        },
        req
      });
      return res.status(400).json({ message: error.details[0].message });
    }

    const { roleId } = req.params;
    // Logger.info("getUsersByRole: Start fetching users by role", {
    //   context: {
    //     roleId,
    //     performedBy: req.user._id,
    //     tenantId: req.tenantId,
    //   },
    //   req
    // });

    // --- Role-based restrictions ---
    if (req.user.role === "companyAdmin") {
      // Logger.info("getUsersByRole: Access granted to companyAdmin", {
      //   context: {
      //     userId: req.user._id,
      //   },
      //   req
      // });
    } else if (req.user.role === "member") {
      const populatedUser = await User.findById(req.user._id).populate({
        path: "customRoles",
        populate: { path: "permissions" },
      });

      if (!populatedUser) {
        Logger.error("getUsersByRole: User not found", {
          context: {
            userId: req.user._id,
          },
          req
        });
        return res.status(404).json({ message: "User not found" });
      }

      const hasPermission = populatedUser.customRoles?.some(
        (role) =>
          role.permissions &&
          role.permissions.some((p) => p.name === "role:read")
      );

      if (!hasPermission) {
        Logger.warn("getUsersByRole: Missing permission 'role:read'", {
          context: {
            userId: req.user._id,
          },
          req
        });
        return res
          .status(403)
          .json({ message: "Access denied: Permission 'role:read' required" });
      }

      // Logger.info("getUsersByRole: Member permission verified", {
      //   context: {
      //     userId: req.user._id,
      //   },
      //   req
      // });
    } else {
      Logger.warn("getUsersByRole: Unauthorized role access attempt", {
        context: {
          userRole: req.user.role,
          userId: req.user._id,
        },
        req
      });
      return res.status(403).json({
        message:
          "Only companyAdmin or member (with permission) can view users by role",
      });
    }

    // --- Fetch Role + Users ---
    const role = await CustomRole.findById(roleId).populate(
      "tenant users",
      "name email _id"
    );

    if (!role) {
      Logger.warn("getUsersByRole: Role not found", { context: { roleId }, req });
      return res.status(404).json({ message: "Role not found" });
    }

    // --- Tenant Scoping ---
    if (
      req.user.role !== "admin" &&
      role.tenant &&
      role.tenant._id &&
      role.tenant._id.toString() !== req.tenantId
    ) {
      Logger.warn("getUsersByRole: Cross-tenant access attempt", {
        context: {
          requestTenant: req.tenantId,
          roleTenant: role.tenant._id,
          performedBy: req.user._id,
        },
        req
      });
      return res
        .status(403)
        .json({ message: "Cannot view users for role from different tenant" });
    }

    // --- Success ---
    // Logger.info("getUsersByRole", "Users retrieved successfully", {
    //   context: {
    //     roleId,
    //     totalUsers: role.users?.length || 0,
    //     requestedBy: req.user._id,
    //   },
    //   req
    // });

    return res
      .status(200)
      .json({ message: "Users retrieved successfully", users: role.users || [] });
  } catch (err) {
    Logger.error("getUsersByRole", "Error occurred", {
      error,
      context: {
        performedBy: req.user?._id,
        tenantId: req.tenantId,
      },
      req
    });
    next(err);
  }
};

// models/CustomRole.js
const mongoose = require('mongoose');
const crypto = require("crypto");

const customRoleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Role name is required"],
    trim: true,
  },
  description: {
    type: String,
    default: "",
  },
  // Linked to Tenant (company)
  tenant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: [true, "Tenant is required"],
  },
  // Permissions linked (array of refs to Permission model)
  permissions: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Permission",
      validate: {
        validator: async function (id) {
          const permission = await mongoose.model('Permission').findById(id);
          return !!permission;
        },
        message: "Invalid permission ID",
      },
    }
  ],
  users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Track assigned users
  userCount: { type: Number, default: 0 }, // Store count of assigned users
  // Who created this role (companyAdmin)
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: [true, "Creator is required"],
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  deleted: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

customRoleSchema.add({
  permissionsSignature: {
    type: String,
    required: false, // Optional now - kept for backward compatibility
    default: "",
  }
});

// Update permissionsSignature on save (kept for backward compatibility)
customRoleSchema.pre("save", function (next) {
  if (this.permissions && this.permissions.length > 0) {
    const sorted = this.permissions.map(id => id.toString()).sort().join("_");
    this.permissionsSignature = crypto.createHash("md5").update(sorted).digest("hex");
  } else {
    this.permissionsSignature = "";
  }
  next();
});

// UPDATED: Unique index on tenant + name only (prevents duplicate role names)
// Role names must be unique per tenant, regardless of permissions
customRoleSchema.index({ tenant: 1, name: 1 }, { unique: true });

// Pre-validate hook to ensure tenant exists
customRoleSchema.pre('validate', async function (next) {
  if (this.tenant) {
    const tenant = await mongoose.model('Tenant').findById(this.tenant);
    if (!tenant) {
      return next(new Error("Invalid tenant ID"));
    }
  }
  next();
});

module.exports = mongoose.model('CustomRole', customRoleSchema);
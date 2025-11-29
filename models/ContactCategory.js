const mongoose = require('mongoose');

const ContactCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Category name is required"],
    trim: true,
  },
  tenant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: function () {
      // Tenant required only for non-admin users
      return !this.isDefault;
    },
  },
  type: {
    type: String,
    enum: ["internal", "external"],
    default: "internal",
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true, // usually companyAdmin or admin
  },
  isDefault: {
    type: Boolean,
    default: false, // for system-defined categories
  },
  active: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

// Optional: ensure name is unique per tenant
ContactCategorySchema.index({ tenant: 1, name: 1 }, { unique: true });

// Example pre-validation
ContactCategorySchema.pre('save', function (next) {
  if (!this.tenant) {
    return next(new Error("UserCategory must belong to a Tenant"));
  }
  next();
});

module.exports = mongoose.model("UserCategory", ContactCategorySchema);
const mongoose = require('mongoose');

const ContactCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Category name is required"],
    trim: true,
  },
  
  description: {
    type: String,
    trim: true,
    default: "",
  },

  tenant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: function () {
      // Tenant required only for non-default categories
      return !this.isDefault;
    },
    index: true,
  },

  // 🔥 UPDATED: Removed restrictive enum - name is the label now
  // type field kept for backward compatibility (internal vs external classification)
  type: {
    type: String,
    enum: ["internal", "external"],
    default: "external",
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: function () {
      return !this.isDefault; // System defaults don't need createdBy
    },
  },

  isDefault: {
    type: Boolean,
    default: false, // for system-defined categories
  },

  active: {
    type: Boolean,
    default: true,
    index: true,
  },
}, { timestamps: true });

// Ensure name is unique per tenant
ContactCategorySchema.index(
  { tenant: 1, name: 1 },
  { 
    unique: true,
    partialFilterExpression: { active: true } // Only enforce on active categories
  }
);

// Pre-validation hook
ContactCategorySchema.pre('save', function (next) {
  // For non-default categories, tenant is required
  if (!this.isDefault && !this.tenant) {
    return next(new Error("Category must belong to a Tenant"));
  }
  next();
});

module.exports = mongoose.model("ContactCategory", ContactCategorySchema);
// models/Ticket.js
const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema(
    {
        subject: {
            type: String,
            required: [true, "Subject is required"],
            trim: true,
            minlength: [5, "Subject must be at least 5 characters"],
            maxlength: [200, "Subject cannot exceed 200 characters"],
        },
        description: {
            type: String,
            required: [true, "Description is required"],
            minlength: [10, "Description must be at least 10 characters"],
            maxlength: [2000, "Description cannot exceed 2000 characters"],
        },
        status: {
            type: String,
            enum: ["open", "in-progress", "resolved", "closed"],
            default: "open",
        },
        priority: {
            type: String,
            enum: ["low", "medium", "high", "critical"],
            default: "medium",
            required: [true, "Priority is required"],
        },
        category: {
            type: String,
            required: [true, "Category is required"],
            trim: true,
            enum: ["technical", "bug", "feature", "access", "training", "billing", "other"],
        },
        contactEmail: {
            type: String,
            required: [true, "Contact email is required"],
            lowercase: true,
            trim: true,
            validate: {
                validator: function (email) {
                    return /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(email);
                },
                message: "Please provide a valid email address",
            },
        },
        attachments: [
            {
                fileName: { type: String, required: true },
                fileUrl: { type: String, required: true },
                fileType: { type: String, required: true },
                fileSize: { type: Number, required: true },
                cloudinaryId: { type: String, required: true },
                uploadedAt: { type: Date, default: Date.now },
            },
        ],
        comments: [
            {
                id: { type: String },
                author: {  type: mongoose.Schema.Types.ObjectId, ref: "User"  },
                role: { type: String, required: true },
                timestamp: { type: Date, default: Date.now },
                message: { type: String, required: true },
            }
        ],
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Created by user is required"],
        },
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Tenant",
            required: [true, "Company/Tenant ID is required"],
        },
        resolvedAt: { type: Date },
        closedAt: { type: Date },
        assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        tags: [{ type: String, trim: true }],
        internalNotes: [
            {
                note: { type: String, required: true },
                createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
                createdAt: { type: Date, default: Date.now },
            },
        ],
    },
    {
        timestamps: true, // auto creates createdAt & updatedAt
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    },


);

// Indexes
ticketSchema.index({ companyId: 1, status: 1 });
ticketSchema.index({ createdBy: 1, createdAt: -1 });
ticketSchema.index({ status: 1, priority: 1 });
ticketSchema.index({ category: 1 });
ticketSchema.index({ createdAt: -1 });

// Virtuals
ticketSchema.virtual("daysSinceCreation").get(function () {
    return Math.floor((new Date() - this.createdAt) / (1000 * 60 * 60 * 24));
});

ticketSchema.virtual("attachmentCount").get(function () {
    return this.attachments ? this.attachments.length : 0;
});

ticketSchema.virtual("isResolved").get(function () {
    return this.status === "resolved" || this.status === "closed";
});

ticketSchema.virtual("lastUpdated").get(function () {
    return this.updatedAt; // readable alias for updatedAt
});

// Pre-save hook to set resolved/closed timestamps
ticketSchema.pre("save", function (next) {
    if (this.isModified("status")) {
        if (this.status === "resolved" && !this.resolvedAt) this.resolvedAt = new Date();
        if (this.status === "closed" && !this.closedAt) this.closedAt = new Date();
    }
    next();
});

// Pre-findOneAndUpdate hook
ticketSchema.pre("findOneAndUpdate", function (next) {
    const update = this.getUpdate();
    if (update.status) {
        if (update.status === "resolved" && !update.resolvedAt) update.resolvedAt = new Date();
        if (update.status === "closed" && !update.closedAt) update.closedAt = new Date();
    }
    next();
});

// Statics
ticketSchema.statics.getByStatus = function (status, companyId = null) {
    const filter = { status };
    if (companyId) filter.companyId = companyId;
    return this.find(filter);
};

ticketSchema.statics.getByPriority = function (priority, companyId = null) {
    const filter = { priority };
    if (companyId) filter.companyId = companyId;
    return this.find(filter);
};

// Methods
ticketSchema.methods.addInternalNote = function (note, userId) {
    this.internalNotes.push({ note, createdBy: userId });
    return this.save();
};

ticketSchema.methods.assignTo = function (userId) {
    this.assignedTo = userId;
    return this.save();
};

module.exports = mongoose.model("Ticket", ticketSchema);
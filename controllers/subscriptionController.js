// controllers/subscriptionController.js
const Subscription = require("../models/Subscription");
const Log = require("../models/Logs");
const mongoose = require("mongoose");

// OPTIMIZED LOGGING HELPER FUNCTION
const createSubscriptionLog = async (
  userId,
  tenantId,
  action,
  description,
  status,
  subscriptionId = null,
  ipAddress = null,
  userAgent = null,
  additionalData = {}
) => {
  try {
    const cleanData = {
      userId: userId || null,
      tenantId: tenantId || null,
      action: String(action || "UNKNOWN_ACTION"),
      description: String(description || "No description"),
      status: status || "success",
      surveyId:
        subscriptionId && mongoose.Types.ObjectId.isValid(subscriptionId)
          ? subscriptionId
          : null,
      ipAddress: String(ipAddress || "unknown"),
      userAgent: String(userAgent || "unknown"),
      logLevel:
        status === "error" ? "ERROR" : status === "failed" ? "WARNING" : "INFO",
      functionName: String(action || "unknown"),
      message: String(description || "No message"),
      additionalData: {
        ...additionalData,
        subscriptionId: subscriptionId,
        actionType: action,
        status: status,
        tenantId: tenantId,
      },
    };

    const log = await Log.create(cleanData);
    return log;
  } catch (error) {
    console.error("❌ Subscription Log creation error:", error.message);
  }
};

// @desc: Subscription management controller
// @route: Various routes for subscription management
// @access: Admin and Company Admin roles
exports.createSubscriptionPlan = async (req, res, next) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin role required.",
      });
    }

    const {
      name,
      price,
      billingCycle,
      credits,
      features,
      description,
      isActive,
    } = req.body;

    // Simple validation
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Plan name is required",
      });
    }

    if (price === undefined || price === null) {
      return res.status(400).json({
        success: false,
        message: "Plan price is required",
      });
    }

    if (!billingCycle || !["monthly", "yearly"].includes(billingCycle)) {
      return res.status(400).json({
        success: false,
        message: "Valid billing cycle (monthly/yearly) is required",
      });
    }

    if (credits === undefined || credits === null) {
      return res.status(400).json({
        success: false,
        message: "Credits are required",
      });
    }

    // Check for existing plan with same name
    const existingPlan = await Subscription.findOne({
      name: name.trim(),
      isTemplate: true,
    });

    if (existingPlan) {
      return res.status(400).json({
        success: false,
        message: "Subscription plan with this name already exists",
      });
    }

    // Create subscription plan (template)
    const subscriptionPlan = await Subscription.create({
      name: name.trim(),
      price: Number(price),
      billingCycle: billingCycle,
      credits: Number(credits),
      features: features || [],
      description: description || "",
      isActive: isActive !== false,
      isTemplate: true,
      createdBy: req.user._id,
    });

    // ✅ LOG SUCCESS
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_PLAN_CREATE",
      `Subscription plan created: ${name}`,
      "success",
      subscriptionPlan._id,
      req.ip,
      req.get("User-Agent"),
      {
        planName: name,
        price: price,
        billingCycle: billingCycle,
        credits: credits,
      }
    );

    res.status(201).json({
      success: true,
      message: "Subscription plan created successfully",
      data: subscriptionPlan,
    });
  } catch (err) {
    // ✅ ERROR LOG
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_PLAN_CREATE",
      `Subscription plan creation failed: ${err.message}`,
      "error",
      null,
      req.ip,
      req.get("User-Agent"),
      {
        error: err.message,
        planData: req.body,
      }
    );

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// @desc: Update Subscription Plan
// @route: PUT /api/subscriptions/plans/:planId
// @access: Admin only
exports.updateSubscriptionPlan = async (req, res, next) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin role required.",
      });
    }

    const { planId } = req.params;
    const updateData = req.body;

    // Validate plan ID
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan ID",
      });
    }

    // Find existing plan (template)
    const existingPlan = await Subscription.findOne({
      _id: planId,
      isTemplate: true,
    });

    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    // Prepare update data
    const allowedUpdates = [
      "name",
      "price",
      "billingCycle",
      "credits",
      "features",
      "description",
      "isActive",
    ];
    const filteredUpdates = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        filteredUpdates[key] = updateData[key];
      }
    });

    filteredUpdates.updatedBy = req.user._id;
    filteredUpdates.updatedAt = new Date();

    // Update subscription plan
    const updatedPlan = await Subscription.findByIdAndUpdate(
      planId,
      filteredUpdates,
      { new: true, runValidators: true }
    );

    // ✅ LOG SUCCESS
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_PLAN_UPDATE",
      `Subscription plan updated: ${updatedPlan.name}`,
      "success",
      updatedPlan._id,
      req.ip,
      req.get("User-Agent"),
      {
        changes: Object.keys(filteredUpdates),
        planName: updatedPlan.name,
        price: updatedPlan.price,
      }
    );

    res.status(200).json({
      success: true,
      message: "Subscription plan updated successfully",
      data: updatedPlan,
    });
  } catch (err) {
    // ✅ ERROR LOG
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_PLAN_UPDATE",
      `Subscription plan update failed: ${err.message}`,
      "error",
      req.params.planId,
      req.ip,
      req.get("User-Agent"),
      {
        error: err.message,
        planId: req.params.planId,
      }
    );

    next(err);
  }
};

// @desc: delete Subscription Plan
// @route: DELETE /api/subscriptions/plans/:planId
// @access: Admin only

// ADMIN: Delete Subscription Plan
exports.deleteSubscriptionPlan = async (req, res, next) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin role required.",
      });
    }

    const { planId } = req.params;

    // Validate plan ID
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan ID",
      });
    }

    // Find plan (template)
    const plan = await Subscription.findOne({
      _id: planId,
      isTemplate: true,
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    // Check if any tenant is using this plan
    const activeSubscriptions = await Subscription.countDocuments({
      planTemplate: planId,
      isTemplate: false,
    });

    if (activeSubscriptions > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete plan. ${activeSubscriptions} tenant(s) are using this plan.`,
      });
    }

    // Store plan data for logging before deletion
    const planData = {
      id: plan._id,
      name: plan.name,
      price: plan.price,
    };

    // Delete plan
    await Subscription.findByIdAndDelete(planId);

    // ✅ LOG SUCCESS
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_PLAN_DELETE",
      `Subscription plan deleted: ${plan.name}`,
      "success",
      planId,
      req.ip,
      req.get("User-Agent"),
      {
        deletedPlan: planData,
        deletedBy: req.user.email,
      }
    );

    res.status(200).json({
      success: true,
      message: "Subscription plan deleted successfully",
      data: {
        deletedPlan: planData,
        deletionTime: new Date().toISOString(),
      },
    });
  } catch (err) {
    // ✅ ERROR LOG
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_PLAN_DELETE",
      `Subscription plan deletion failed: ${err.message}`,
      "error",
      req.params.planId,
      req.ip,
      req.get("User-Agent"),
      {
        error: err.message,
        planId: req.params.planId,
      }
    );

    next(err);
  }
};

// @desc: Get all Subscription Plans (Templates)
// @route: GET /api/subscriptions/plans
// @access: Admin only

// ADMIN: Get all subscription plans (Templates)
exports.getAllSubscriptionPlans = async (req, res, next) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin role required.",
      });
    }

    const { page = 1, limit = 10, isActive } = req.query;

    // Build filter for template plans
    const filter = { isTemplate: true };
    if (isActive !== undefined) filter.isActive = isActive === "true";

    // Get subscription plans with pagination
    const plans = await Subscription.find(filter)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // Get total count
    const total = await Subscription.countDocuments(filter);

    // ✅ LOG SUCCESS
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_PLANS_FETCH_ALL",
      `Fetched ${plans.length} subscription plans`,
      "success",
      null,
      req.ip,
      req.get("User-Agent"),
      {
        totalPlans: total,
        returnedCount: plans.length,
        page: parseInt(page),
        limit: parseInt(limit),
      }
    );

    res.status(200).json({
      success: true,
      data: {
        plans,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / limit),
          totalRecords: total,
        },
      },
    });
  } catch (err) {
    // ✅ ERROR LOG
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_PLANS_FETCH_ALL",
      `Failed to fetch subscription plans: ${err.message}`,
      "error",
      null,
      req.ip,
      req.get("User-Agent"),
      {
        error: err.message,
        query: req.query,
      }
    );

    next(err);
  }
};

// @desc: Get Available Subscription Plans for Company Admin
// @route: GET /api/subscriptions/available-plans
// @access: Company Admin only

// COMPANY ADMIN: Get available subscription plans for selection
exports.getAvailablePlans = async (req, res, next) => {
  try {
    const { billingCycle } = req.query;

    // Build filter for active template plans
    const filter = {
      isTemplate: true,
      isActive: true,
    };

    if (billingCycle) {
      filter.billingCycle = billingCycle;
    }

    const plans = await Subscription.find(filter)
      .select("name price billingCycle credits features description")
      .sort({ price: 1 });

    // ✅ LOG SUCCESS
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "AVAILABLE_PLANS_FETCH",
      `Fetched ${plans.length} available plans for selection`,
      "success",
      null,
      req.ip,
      req.get("User-Agent"),
      {
        totalPlans: plans.length,
        billingCycle: billingCycle || "all",
      }
    );

    res.status(200).json({
      success: true,
      data: plans,
    });
  } catch (err) {
    // ✅ ERROR LOG
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "AVAILABLE_PLANS_FETCH",
      `Failed to fetch available plans: ${err.message}`,
      "error",
      null,
      req.ip,
      req.get("User-Agent"),
      {
        error: err.message,
      }
    );

    next(err);
  }
};

// COMPANY ADMIN: Get current subscription
exports.getCurrentSubscription = async (req, res, next) => {
  try {
    const subscription = await Subscription.findOne({
      tenant: req.user.tenant,
      isTemplate: false,
    })
      .populate("planTemplate", "name price billingCycle features")
      .populate("tenant", "name email");

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: "No active subscription found",
        data: null,
      });
    }

    // ✅ LOG SUCCESS
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "CURRENT_SUBSCRIPTION_FETCH",
      `Current subscription fetched: ${subscription.planTemplate?.name}`,
      "success",
      subscription._id,
      req.ip,
      req.get("User-Agent"),
      {
        subscriptionId: subscription._id,
        planName: subscription.planTemplate?.name,
        status: subscription.status,
      }
    );

    res.status(200).json({
      success: true,
      data: subscription,
    });
  } catch (err) {
    // ✅ ERROR LOG
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "CURRENT_SUBSCRIPTION_FETCH",
      `Error fetching current subscription: ${err.message}`,
      "error",
      null,
      req.ip,
      req.get("User-Agent"),
      {
        error: err.message,
        tenantId: req.user.tenant,
      }
    );

    next(err);
  }
};

// @desc: Update Subscription
// @route: PUT /api/subscriptions/current
// @access: Company Admin and Admin

// COMPANY ADMIN: Update Subscription
exports.updateSubscription = async (req, res, next) => {
  try {
    // Company admin aur super admin dono ko allow karo
    if (req.user.role !== "companyAdmin" && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Company Admin or Admin role required.",
      });
    }

    const updateData = req.body;

    // Find company's current subscription
    const existingSubscription = await Subscription.findOne({
      tenant: req.user.tenant,
      isTemplate: false,
    });

    if (!existingSubscription) {
      return res.status(404).json({
        success: false,
        message: "Subscription not found for this company",
      });
    }

    // Prepare update data - company admin specific fields only
    const allowedUpdates = ["status", "credits", "features", "autoRenew"];

    const filteredUpdates = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        filteredUpdates[key] = updateData[key];
      }
    });

    // Add update metadata
    filteredUpdates.updatedBy = req.user._id;
    filteredUpdates.updatedAt = new Date();

    // Update subscription
    const updatedSubscription = await Subscription.findByIdAndUpdate(
      existingSubscription._id,
      filteredUpdates,
      { new: true, runValidators: true }
    )
      .populate("planTemplate", "name price billingCycle features")
      .populate("tenant", "name email");

    // ✅ LOG SUCCESS
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_UPDATE",
      `Subscription updated by company admin`,
      "success",
      updatedSubscription._id,
      req.ip,
      req.get("User-Agent"),
      {
        changes: Object.keys(filteredUpdates),
        subscriptionId: updatedSubscription._id,
        updatedFields: filteredUpdates,
      }
    );

    res.status(200).json({
      success: true,
      message: "Subscription updated successfully",
      data: updatedSubscription,
    });
  } catch (err) {
    // ✅ ERROR LOG
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_UPDATE",
      `Subscription update failed: ${err.message}`,
      "error",
      null,
      req.ip,
      req.get("User-Agent"),
      {
        error: err.message,
        updateData: req.body,
      }
    );

    next(err);
  }
};

// @desc: Activate Subscription
// @route: POST /api/subscriptions/activate
// @access: Company Admin only

// COMPANY ADMIN: Activate subscription (DEBUG VERSION)
exports.activateSubscription = async (req, res, next) => {
  try {

    const { planId, pland, paymentDetails } = req.body; // dono check karo

    // Check for typo 'pland' and use 'planId'
    const actualPlanId = planId || pland;

    if (!actualPlanId) {
      return res.status(400).json({
        success: false,
        message:
          "Plan ID is required. Please provide 'planId' in request body.",
      });
    }

    // Validate plan ID
    if (!mongoose.Types.ObjectId.isValid(actualPlanId)) {
      return res.status(400).json({
        success: false,
        message: `Invalid subscription plan ID format: ${actualPlanId}`,
      });
    }

    // Get the plan template
    const planTemplate = await Subscription.findOne({
      _id: actualPlanId,
      isTemplate: true,
      isActive: true,
    });

    if (!planTemplate) {
      // Check if plan exists but inactive
      const inactivePlan = await Subscription.findOne({
        _id: actualPlanId,
        isTemplate: true,
      });

      if (inactivePlan) {
        return res.status(400).json({
          success: false,
          message: "Subscription plan is inactive. Please contact admin.",
        });
      }

      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    // Check if tenant already has an active subscription
    const existingSubscription = await Subscription.findOne({
      tenant: req.user.tenant,
      isTemplate: false,
      status: "active",
    });

    if (existingSubscription) {
      return res.status(400).json({
        success: false,
        message: "Tenant already has an active subscription",
      });
    }

    // Calculate dates
    const startDate = new Date();
    const endDate = new Date();

    if (planTemplate.billingCycle === "monthly") {
      endDate.setMonth(endDate.getMonth() + 1);
    } else if (planTemplate.billingCycle === "yearly") {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    // Create tenant subscription
    const tenantSubscription = await Subscription.create({
      // Plan details
      name: planTemplate.name,
      price: planTemplate.price,
      billingCycle: planTemplate.billingCycle,
      credits: planTemplate.credits,
      features: planTemplate.features,

      // Tenant association
      tenant: req.user.tenant,
      planTemplate: actualPlanId,
      isTemplate: false,

      // Subscription details
      status: "active",
      startDate: startDate,
      endDate: endDate,

      // Payment details
      paymentDetails: paymentDetails || {},
      activatedBy: req.user._id,
      activatedAt: startDate,
    });
    const populatedSubscription = await Subscription.findById(
      tenantSubscription._id
    )
      .populate("planTemplate", "name price features")
      .populate("tenant", "name email");

    // ✅ LOG SUCCESS
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_ACTIVATION",
      `Subscription activated: ${planTemplate.name}`,
      "success",
      tenantSubscription._id,
      req.ip,
      req.get("User-Agent"),
      {
        planName: planTemplate.name,
        price: planTemplate.price,
        billingCycle: planTemplate.billingCycle,
        startDate: startDate,
        endDate: endDate,
      }
    );

    res.status(201).json({
      success: true,
      message: "Subscription activated successfully",
      data: populatedSubscription,
    });
  } catch (err) {
    console.error("💥 Error activating subscription:", err);

    // ✅ ERROR LOG
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_ACTIVATION",
      `Subscription activation failed: ${err.message}`,
      "error",
      null,
      req.ip,
      req.get("User-Agent"),
      {
        error: err.message,
        planId: req.body.planId || req.body.pland,
      }
    );

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// @desc: Request Upgrade
// @route: POST /api/subscriptions/request-upgrade
// @access: Company Admin only

// COMPANY ADMIN: Request upgrade
exports.requestUpgrade = async (req, res, next) => {
  try {
    const { planId, planName, reason, contactPreference } = req.body;

    // Validate request
    if (!planId && !planName) {
      return res.status(400).json({
        success: false,
        message: "Plan ID or Plan Name is required for upgrade",
      });
    }

    // Get current subscription
    const currentSubscription = await Subscription.findOne({
      tenant: req.user.tenant,
      isTemplate: false,
    }).populate("planTemplate", "name price");

    if (!currentSubscription) {
      return res.status(404).json({
        success: false,
        message: "No existing subscription found to upgrade",
      });
    }

    // ✅ LOG SUCCESS
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_UPGRADE_REQUEST",
      `Upgrade request submitted: ${currentSubscription.planTemplate?.name} → ${planName || planId
      }`,
      "success",
      currentSubscription._id,
      req.ip,
      req.get("User-Agent"),
      {
        currentPlan: currentSubscription.planTemplate?.name,
        requestedPlan: planName || planId,
        reason: reason,
      }
    );

    res.status(200).json({
      success: true,
      message: "Upgrade request received. Our team will contact you shortly.",
      data: {
        requestId: `UPG-${Date.now()}`,
        currentPlan: currentSubscription.planTemplate?.name,
        requestedPlan: planName || planId,
        estimatedProcessing: "1-2 business days",
      },
    });
  } catch (err) {
    // ✅ ERROR LOG
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_UPGRADE_REQUEST",
      `Upgrade request failed: ${err.message}`,
      "error",
      null,
      req.ip,
      req.get("User-Agent"),
      {
        error: err.message,
        requestData: req.body,
      }
    );

    next(err);
  }
};

// @desc: Cancel Subscription
// @route: POST /api/subscriptions/cancel
// @access: Company Admin only

// COMPANY ADMIN: Cancel subscription
exports.cancelSubscription = async (req, res, next) => {
  try {
    const { cancellationReason, feedback } = req.body;

    // Find current subscription
    const subscription = await Subscription.findOne({
      tenant: req.user.tenant,
      isTemplate: false,
    })
      .populate("planTemplate", "name price")
      .populate("tenant", "name email");

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: "Subscription not found",
      });
    }

    // Check if already cancelled
    if (subscription.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Subscription is already cancelled",
      });
    }

    // Update subscription
    const updatedSubscription = await Subscription.findOneAndUpdate(
      { tenant: req.user.tenant, isTemplate: false },
      {
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: req.user._id,
        cancellationReason: cancellationReason || "Not specified",
        feedback: feedback || "",
        endDate: new Date(), // Immediate cancellation
      },
      { new: true }
    )
      .populate("planTemplate", "name price")
      .populate("tenant", "name email");

    // ✅ LOG SUCCESS
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_CANCEL",
      `Subscription cancelled: ${subscription.planTemplate?.name}`,
      "success",
      updatedSubscription._id,
      req.ip,
      req.get("User-Agent"),
      {
        subscriptionId: updatedSubscription._id,
        planName: subscription.planTemplate?.name,
        cancellationReason: cancellationReason,
        endDate: updatedSubscription.endDate,
      }
    );

    res.status(200).json({
      success: true,
      message: "Subscription cancelled successfully",
      data: {
        subscription: updatedSubscription,
        cancellationDetails: {
          effectiveDate: updatedSubscription.endDate,
          reason: cancellationReason,
          contactEmail: "support@yourcompany.com",
        },
      },
    });
  } catch (err) {
    // ✅ ERROR LOG
    await createSubscriptionLog(
      req.user._id,
      req.user.tenant,
      "SUBSCRIPTION_CANCEL",
      `Subscription cancellation failed: ${err.message}`,
      "error",
      null,
      req.ip,
      req.get("User-Agent"),
      {
        error: err.message,
        cancellationData: req.body,
      }
    );

    next(err);
  }
};

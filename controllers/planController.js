// controllers/planController.js
const Plan = require('../models/Plan');
const Tenant = require('../models/Tenant');
const Logger = require('../utils/auditLog');

exports.createPlan = async (req, res) => {
  try {
    const { name, description, features, limits, isActive = true } = req.body;

    const existing = await Plan.findOne({ name });
    if (existing) {
      return res.status(400).json({ message: "Plan with this name already exists" });
    }

    const plan = await Plan.create({
      name,
      description,
      features: features || {},
      limits: limits || { responsesPerMonth: 1000, teamMembers: 5 },
      isActive
    });

    // Logger.info("createPlan", "Plan created", {
    //   context: {
    //     planId: plan._id,
    //     createdBy: req.user._id
    //   },
    //   req
    // });

    res.status(201).json({
      success: true,
      plan
    });
  } catch (err) {
    Logger.error("createPlan", "Error creating plan", {
      error: err,
      context: {},
      req
    });
    res.status(500).json({ message: err.message });
  }
};

exports.getAllPlans = async (req, res) => {
  try {
    const plans = await Plan.find().sort({ createdAt: -1 });
    // Logger.info("getAllPlans", "Plans retrieved", {
    //   context: {
    //     retrievedBy: req.user._id
    //   },
    //   req
    // });
    res.json({ success: true, plans });
  } catch (err) {
    Logger.error("getAllPlans", "Error retrieving plans", {
      error: err,
      context: {},
      req
    });
    res.status(500).json({ message: err.message });
  }
};

exports.getPlanById = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: "Plan not found" });
    
    // Logger.info("getPlanById", "Plan retrieved", {
    //   context: {
    //     planId: plan._id,
    //     retrievedBy: req.user._id
    //   },
    //   req
    // });

    res.json({ success: true, plan });
  } catch (err) {
    Logger.error("getPlanById", "Error retrieving plan", {
      error: err,
      context: {},
      req
    });
    res.status(500).json({ message: err.message });
  }
};

exports.updatePlan = async (req, res) => {
  try {
    const plan = await Plan.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!plan) return res.status(404).json({ message: "Plan not found" });

    // Logger.info("updatePlan", "Plan updated", {
    //   context: {
    //     planId: plan._id,
    //     updatedBy: req.user._id
    //   },
    //   req
    // });
    res.json({ success: true, plan });
  } catch (err) {
    Logger.error("updatePlan", "Error updating plan", {
      error: err,
      context: {},
      req
    });
    res.status(500).json({ message: err.message });
  }
};

exports.deletePlan = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: "Plan not found" });

    // Optional: Prevent deleting if tenants are using it
    const inUse = await Tenant.countDocuments({ plan: plan._id });
    if (inUse > 0) {
      return res.status(400).json({ message: "Cannot delete plan in use by tenants" });
    }

    await plan.remove();
    // Logger.info("deletePlan", "Plan deleted", {
    //   context: {
    //     planId: plan._id,
    //     deletedBy: req.user._id
    //   },
    //   req
    // });
    res.json({ success: true, message: "Plan deleted" });
  } catch (err) {
    Logger.error("deletePlan", "Error deleting plan", {
      error: err,
      context: {},
      req
    });
    res.status(500).json({ message: err.message });
  }
};

exports.togglePlanStatus = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: "Plan not found" });

    plan.isActive = !plan.isActive;
    await plan.save();

    // Logger.info("togglePlanStatus", "Plan status toggled", {
    //   context: {
    //     planId: plan._id,
    //     toggledBy: req.user._id
    //   },
    //   req
    // });

    res.json({ success: true, plan });
  } catch (err) {
    Logger.error("togglePlanStatus", "Error toggling plan status", {
      error: err,
      context: {},
      req
    });
    res.status(500).json({ message: err.message });
  }
};
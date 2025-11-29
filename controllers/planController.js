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

    await Logger.info("Plan created", { planId: plan._id, createdBy: req.user._id });

    res.status(201).json({
      success: true,
      plan
    });
  } catch (err) {
    await Logger.error("createPlan error", { error: err.message });
    res.status(500).json({ message: err.message });
  }
};

exports.getAllPlans = async (req, res) => {
  try {
    const plans = await Plan.find().sort({ createdAt: -1 });
    res.json({ success: true, plans });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getPlanById = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: "Plan not found" });
    res.json({ success: true, plan });
  } catch (err) {
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

    await Logger.info("Plan updated", { planId: plan._id, updatedBy: req.user._id });
    res.json({ success: true, plan });
  } catch (err) {
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
    await Logger.info("Plan deleted", { planId: plan._id, deletedBy: req.user._id });

    res.json({ success: true, message: "Plan deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.togglePlanStatus = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: "Plan not found" });

    plan.isActive = !plan.isActive;
    await plan.save();

    res.json({ success: true, plan });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
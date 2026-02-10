// routes/actionPlanRoutes.js
// ============================================================================
// Action Plan Routes - TENANT LAYER (Company Admin + Member)
// Implements human confirmation workflow with proper authorization
// ============================================================================

const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { setTenantId } = require("../middlewares/tenantMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const { enforceTenantScope } = require("../middlewares/scopeMiddleware");

// Controller
const actionPlanController = require("../controllers/actionPlan/actionPlanController");

// ============================================================================
// 🔒 Middleware - TENANT LAYER
// ============================================================================
router.use(protect);
router.use(setTenantId);
router.use(enforceTenantScope);

// ============================================================================
// Action Plan Routes
// ============================================================================

// Get action plan by ID
router.get("/:id", actionPlanController.getActionPlan);

// Update action plan
router.put("/:id", allowRoles("companyAdmin", "member"), actionPlanController.updateActionPlan);

// Submit action plan for approval
router.post("/:id/submit", allowRoles("companyAdmin", "member"), actionPlanController.submitForApproval);

// Confirm/approve action plan (human confirmation - CompanyAdmin only)
router.post("/:id/confirm", allowRoles("companyAdmin"), actionPlanController.confirmActionPlan);

// Start action plan execution
router.post("/:id/start", allowRoles("companyAdmin", "member"), actionPlanController.startExecution);

// Complete action plan
router.post("/:id/complete", allowRoles("companyAdmin", "member"), actionPlanController.completeActionPlan);

// ============================================================================
// Action Step Routes (nested under action plan)
// ============================================================================

// Get all steps for an action plan
router.get("/:id/steps", actionPlanController.getSteps);

// Add custom step to action plan
router.post("/:id/steps", allowRoles("companyAdmin", "member"), actionPlanController.addStep);

module.exports = router;

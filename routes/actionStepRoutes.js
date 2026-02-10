// routes/actionStepRoutes.js
// ============================================================================
// Action Step Routes - Individual step operations
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
// Action Step Routes
// ============================================================================

// Update step status (complete, skip, start)
router.put("/:stepId/status", allowRoles("companyAdmin", "member"), actionPlanController.updateStepStatus);

// Update step details
router.put("/:stepId", allowRoles("companyAdmin", "member"), actionPlanController.updateStep);

// Delete step
router.delete("/:stepId", allowRoles("companyAdmin"), actionPlanController.deleteStep);

module.exports = router;

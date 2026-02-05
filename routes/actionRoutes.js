// routes/actionRoutes.js
// ============================================================================
// Action Routes - TENANT LAYER (Company Admin + Member)
// 
// These routes are for tenant-scoped action management.
// System Admin (role: 'admin') MUST NOT access these routes.
// ============================================================================

const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { setTenantId, tenantCheck } = require("../middlewares/tenantMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const { enforceTenantScope } = require("../middlewares/scopeMiddleware");
const { checkSurveyActionPermission } = require("../middlewares/actionPermissionMiddleware");

// ============================================================================
// MODULAR CONTROLLERS (Clean Architecture)
// ============================================================================
const { createAction } = require("../controllers/action/createAction.controller");
const { getActions } = require("../controllers/action/getActions.controller");
const { getActionById } = require("../controllers/action/getActionById.controller");
const { updateAction } = require("../controllers/action/updateAction.controller");
const { deleteAction } = require("../controllers/action/deleteAction.controller");
const { assignAction } = require("../controllers/action/assignAction.controller");
const { getActionsByPriority } = require("../controllers/action/getActionsByPriority.controller");
const { getActionsByStatus } = require("../controllers/action/getActionsByStatus.controller");
const { getActionsAnalytics } = require("../controllers/action/getActionsAnalytics.controller");
const { bulkUpdateActions } = require("../controllers/action/bulkUpdateActions.controller");
const { generateActionsFromFeedback } = require("../controllers/action/generateActionsFromFeedback.controller");

// ============================================================================
// 🔒 Middleware to protect all routes - TENANT LAYER
// ============================================================================
// Middleware chain: protect → setTenantId → enforceTenantScope
// This explicitly BLOCKS System Admin from accessing tenant actions
router.use(protect);
router.use(setTenantId);
router.use(enforceTenantScope);  // Blocks System Admin from tenant resources

// Action CRUD routes
router.route("/")
  .get(checkSurveyActionPermission("view"), getActions)
  .post(allowRoles("companyAdmin"), createAction);

router.route("/:id")
  .get(checkSurveyActionPermission("view"), getActionById)
  .put(allowRoles("companyAdmin", "member"), checkSurveyActionPermission("assign"), updateAction)
  .delete(allowRoles("companyAdmin"), deleteAction);

// Specialized action routes - Permission-based assignment
router.put("/:id/assign", allowRoles("companyAdmin", "member"), checkSurveyActionPermission("assign"), assignAction);
router.get("/priority/:priority", checkSurveyActionPermission("view"), getActionsByPriority);
router.get("/status/:status", checkSurveyActionPermission("view"), getActionsByStatus);
router.get("/analytics/summary", allowRoles("companyAdmin"), getActionsAnalytics);

// Bulk operations
router.put("/bulk/update", allowRoles("companyAdmin", "admin"), bulkUpdateActions);

// AI-powered action generation from feedback
router.post("/generate/feedback", allowRoles("companyAdmin", "admin"), generateActionsFromFeedback);

module.exports = router;
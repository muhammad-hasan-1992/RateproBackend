// routes/actionRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { setTenantId, tenantCheck } = require("../middlewares/tenantMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");

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

// Middleware to protect all routes
router.use(protect);
router.use(setTenantId);

// Action CRUD routes
router.route("/")
  .get(getActions)
  .post(allowRoles("companyAdmin", "admin"), createAction);

router.route("/:id")
  .get(getActionById)
  .put(allowRoles("companyAdmin", "admin", "member"), updateAction)
  .delete(allowRoles("companyAdmin", "admin"), deleteAction);

// Specialized action routes
router.put("/:id/assign", allowRoles("companyAdmin", "admin"), assignAction);
router.get("/priority/:priority", getActionsByPriority);
router.get("/status/:status", getActionsByStatus);
router.get("/analytics/summary", allowRoles("companyAdmin", "admin"), getActionsAnalytics);

// Bulk operations
router.put("/bulk/update", allowRoles("companyAdmin", "admin"), bulkUpdateActions);

// AI-powered action generation from feedback
router.post("/generate/feedback", allowRoles("companyAdmin", "admin"), generateActionsFromFeedback);

module.exports = router;
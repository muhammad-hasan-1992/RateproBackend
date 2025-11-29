// routes/actionRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { setTenantId, tenantCheck } = require("../middlewares/tenantMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const {
  createAction,
  getActions,
  getActionById,
  updateAction,
  deleteAction,
  assignAction,
  getActionsByPriority,
  getActionsByStatus,
  getActionsAnalytics,
  bulkUpdateActions,
  generateActionsFromFeedback
} = require("../controllers/actionController");

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
// routes/roleRoutes.js
// ============================================================================
// Role Routes - TENANT LAYER (Company Admin Only)
// 
// These routes are for tenant-scoped role management.
// System Admin (role: 'admin') MUST NOT access these routes.
// Only Company Admin can manage roles within their tenant.
// ============================================================================

const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const { setTenantId } = require("../middlewares/tenantMiddleware");
const { enforceTenantScope } = require("../middlewares/scopeMiddleware");
const {
  createRole,
  getRoles,
  assignRoleToUser,
  removeRoleFromUser,
  updateRole,
  deleteRole,
  getUsersByRole,
} = require("../controllers/roleController");

// ============================================================================
// 🔒 Middleware to protect all routes - TENANT LAYER
// ============================================================================
// Middleware chain: protect → setTenantId → enforceTenantScope → allowRoles
// This explicitly BLOCKS System Admin from accessing tenant roles
router.use(protect);
router.use(setTenantId);
router.use(enforceTenantScope);  // Blocks System Admin from tenant resources

// Role management (companyAdmin only within their tenant)
router.post("/", allowRoles("companyAdmin"), createRole);
router.get("/", allowRoles("companyAdmin"), getRoles);
router.post("/assign/:userId", allowRoles("companyAdmin"), assignRoleToUser);
router.post("/remove/:userId", allowRoles("companyAdmin"), removeRoleFromUser);
router.put("/:roleId", allowRoles("companyAdmin"), updateRole);
router.delete("/:roleId", allowRoles("companyAdmin"), deleteRole);
router.get("/:roleId/users", allowRoles("companyAdmin"), getUsersByRole);

module.exports = router;
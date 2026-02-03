// routes/permissionRoutes.js
// ============================================================================
// Permission Routes - TENANT LAYER (Company Admin Only)
// 
// These routes are for tenant-scoped permission listing.
// System Admin (role: 'admin') MUST NOT access these routes.
// ============================================================================

const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const { setTenantId } = require("../middlewares/tenantMiddleware");
const { enforceTenantScope } = require("../middlewares/scopeMiddleware");
const Permission = require("../models/Permission");

// Middleware chain: protect → setTenantId → enforceTenantScope
router.use(protect);
router.use(setTenantId);
router.use(enforceTenantScope);  // Blocks System Admin from tenant resources

// Get all permissions (for role assignment UI)
router.get("/", allowRoles("companyAdmin"), async (req, res) => {
  try {
    const permissions = await Permission.find().select('_id name description group');
    if (!permissions || permissions.length === 0) {
      return res.status(404).json({ message: "No permissions found" });
    }
    res.status(200).json({ permissions });
  } catch (err) {
    console.error("Error fetching permissions:", err);
    res.status(500).json({ message: "Failed to fetch permissions", error: err.message });
  }
});

module.exports = router;
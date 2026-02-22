// routes/profileUpdateRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const { setTenantId } = require("../middlewares/tenantMiddleware");
const { enforceTenantScope } = require("../middlewares/scopeMiddleware");

const {
    submitProfileUpdate,
    listMyRequests,
} = require("../controllers/profileUpdateController");

// All routes require authentication
router.use(protect);
router.use(setTenantId);

// ============================================================================
// TENANT LAYER — CompanyAdmin Only
// ============================================================================

// Submit a company profile change request
router.post(
    "/",
    enforceTenantScope,
    allowRoles("companyAdmin"),
    submitProfileUpdate
);

// View own request history
router.get(
    "/",
    enforceTenantScope,
    allowRoles("companyAdmin"),
    listMyRequests
);

module.exports = router;

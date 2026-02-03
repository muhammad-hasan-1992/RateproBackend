// routes/dashboardRoutes.js
// ============================================================================
// ⚠️ DEPRECATED: This file is deprecated as of January 2026.
// All dashboard routes have been consolidated into surveyRoutes.js
// Use: /api/surveys/dashboards/executive and /api/surveys/dashboards/operational
// This file will be removed in a future release.
// ============================================================================
// 
// TENANT LAYER: System Admin MUST NOT access these routes.
// ============================================================================

const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { setTenantId } = require("../middlewares/tenantMiddleware");
const { enforceTenantScope } = require("../middlewares/scopeMiddleware");
const { getExecutiveDashboard, getOperationalDashboard } = require("../controllers/dashboardController");

// Deprecation warning middleware
const deprecationWarning = (req, res, next) => {
  console.warn(`[DEPRECATED] ${req.method} ${req.originalUrl} - Use /api/surveys/dashboards/* instead`);
  res.set('Deprecation', 'true');
  res.set('Sunset', '2026-06-01');
  res.set('Link', '</api/surveys/dashboards>; rel="successor-version"');
  next();
};

// Middleware chain: protect → setTenantId → enforceTenantScope → deprecationWarning
router.use(protect, setTenantId, enforceTenantScope, deprecationWarning);
router.get("/executive", getExecutiveDashboard);
router.get("/operational", getOperationalDashboard);
module.exports = router;
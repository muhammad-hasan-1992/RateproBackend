// routes/feedbackRoutes.js
// ============================================================================
// ⚠️ DEPRECATED: This file is deprecated as of January 2026.
// All feedback routes have been consolidated into surveyRoutes.js
// Use: /api/surveys/feedback/analyze, /api/surveys/actions/generate, /api/surveys/feedback/follow-up
// This file will be removed in a future release.
// ============================================================================

const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const { setTenantId } = require("../middlewares/tenantMiddleware");
const { analyzeFeedback, generateActions, followUp } = require("../controllers/feedbackController");

// Deprecation warning middleware
const deprecationWarning = (req, res, next) => {
  console.warn(`[DEPRECATED] ${req.method} ${req.originalUrl} - Use /api/surveys/feedback/* instead`);
  res.set('Deprecation', 'true');
  res.set('Sunset', '2026-06-01');
  res.set('Link', '</api/surveys/feedback>; rel="successor-version"');
  next();
};

router.use(protect, setTenantId, deprecationWarning);
router.post("/analyze", allowRoles("companyAdmin", "member"), analyzeFeedback);
router.post("/actions/generate", allowRoles("companyAdmin", "member"), generateActions);
router.post("/follow-up", allowRoles("companyAdmin", "member"), followUp);
module.exports = router;

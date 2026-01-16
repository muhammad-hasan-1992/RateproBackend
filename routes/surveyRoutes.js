// routes/surveyRoutes.js
const express = require("express");
const router = express.Router();
const { upload } = require("../middlewares/multer");
const { protect } = require("../middlewares/authMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const { allowPermission } = require("../middlewares/permissionMiddleware");
const { tenantCheck } = require("../middlewares/tenantMiddleware");
const { surveyResponseLimiter, anonymousSurveyLimiter } = require("../middlewares/rateLimiter");

// ============================================================================
// MODULAR CONTROLLERS (Preferred - Clean Architecture)
// ============================================================================

// Survey CRUD Controllers
const createSurveyController = require("../controllers/survey/createSurvey.controller");
const { publishSurvey } = require("../controllers/survey/publishSurvey.controller");
const { listSurveys } = require("../controllers/survey/listSurveys.controller");
const { getSurveyById } = require("../controllers/survey/getSurvey.controller");
const updateSurvey = require("../controllers/survey/updateSurvey.controller");
const deleteSurvey = require("../controllers/survey/deleteSurvey.controller");
const { toggleSurveyStatus } = require("../controllers/survey/toggleStatus.controller");
const { scheduleSurvey } = require("../controllers/survey/scheduleSurvey.controller");
const setAudience = require("../controllers/survey/setAudience.controller");

// QR Code Controllers
const { getAnonymousSurveyQRCode } = require("../controllers/survey/getAnonymousSurveyQRCode.controller");
const { getInviteQRCode } = require("../controllers/survey/getInviteQRCode.controller");
const { getSurveyQRCode } = require("../controllers/survey/getSurveyQRCode.controller");

// Public Survey Controllers
const { getPublicSurveys } = require("../controllers/survey/getPublicSurveys.controller");
const { getPublicSurveyById } = require("../controllers/survey/getPublicSurveyById.controller");

// Survey Response & Export Controllers
const { getSurveyResponses } = require("../controllers/survey/getSurveyResponses.controller");
const { exportSurveyReport } = require("../controllers/survey/exportSurveyReport.controller");
const { exportResponses } = require("../controllers/survey/exportResponses.controller");
const { verifySurveyPassword } = require("../controllers/survey/verifySurveyPassword.controller");
const { createQuestion, deleteQuestion } = require("../controllers/survey/questions.controller");

// Response Controllers (Public/Invited)
const { verifyInviteToken } = require("../controllers/responses/verifyToken.controller");
const { submitInvitedResponse } = require("../controllers/responses/submittedInvitedResponse.controller");
const { submitAnonymousResponse } = require("../controllers/responses/submitAnonymousResponse.controller");

// Analytics Controllers
const { getAnalytics } = require("../controllers/analytics/getAnalytics.controller");

// ============================================================================
// LEGACY CONTROLLERS (To be migrated - Used where modular not available)
// ============================================================================
const {
  getSurveyAnalytics,
} = require("../controllers/surveyController");

// Feedback Controllers (Modular)
const { analyzeFeedback } = require("../controllers/feedback/analyzeFeedback.controller");
const { generateActions } = require("../controllers/feedback/generateActions.controller");
const { followUp } = require("../controllers/feedback/followUp.controller");

const {
  getExecutiveDashboard,
  getOperationalDashboard,
} = require("../controllers/dashboardController");


// ============================================================================
// 🟢 PUBLIC ROUTES (No Authentication Required)
// ============================================================================

// Public survey listing (for embedded/shared surveys)
router.get("/public/all", getPublicSurveys);
router.get("/public/:id", getPublicSurveyById);

// ============================================================================
// 📨 RESPONSE ROUTES (Token-based, No Auth Required)
// ============================================================================

// Invited survey flow: verify token → get survey → submit response
router.get("/responses/invited/:token", verifyInviteToken);
router.post("/responses/invited/:token", surveyResponseLimiter, submitInvitedResponse);

// Anonymous survey flow: direct submit with surveyId
router.post("/responses/anonymous/:surveyId", surveyResponseLimiter, anonymousSurveyLimiter, submitAnonymousResponse);


// ============================================================================
// 🔒 PROTECTED ROUTES (Authentication Required)
// ============================================================================
router.use(protect);

// Tenant middleware for non-admin users
const setTenantId = (req, res, next) => {
  if (req.user.role === "admin") {
    return next();
  }
  if (!req.user.tenant) {
    return res.status(403).json({ message: "Access denied: No tenant associated with this user" });
  }
  req.tenantId = req.user.tenant._id
    ? req.user.tenant._id.toString()
    : req.user.tenant.toString();
  next();
};

router.use(setTenantId);


// ============================================================================
// 📋 SURVEY CRUD ROUTES
// ============================================================================

// Create & Publish
router.post(
  "/save-draft",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:create"),
  upload.single("logo"),
  createSurveyController
);

router.post(
  "/create",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:create"),
  upload.single("logo"),
  publishSurvey
);

router.post(
  "/publish",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:publish"),
  publishSurvey
);

router.post(
  "/:surveyId/publish",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:publish"),
  publishSurvey
);

// List & Get
router.get(
  "/",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:read"),
  listSurveys
);

router.get(
  "/:id",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:detail:view"),
  getSurveyById
);

// Update & Delete
router.put(
  "/:surveyId",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:settings:update"),
  upload.single("logo"),
  updateSurvey
);

router.delete(
  "/:surveyId",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:delete"),
  deleteSurvey
);

// Status & Schedule
router.put(
  "/toggle/:id",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:settings:update"),
  toggleSurveyStatus
);

router.post(
  "/:surveyId/schedule",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:settings:update"),
  scheduleSurvey
);

// Audience
router.post(
  "/:surveyId/audience",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:settings:update"),
  setAudience
);


// ============================================================================
// 📊 ANALYTICS & RESPONSES ROUTES
// ============================================================================

router.get(
  "/:surveyId/responses",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:responses:view"),
  getSurveyResponses  // TODO: Migrate to modular controller
);

router.get(
  "/:surveyId/analytics",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:analytics:view"),
  getAnalytics
);


// ============================================================================
// 📱 QR CODE ROUTES
// ============================================================================

router.get(
  "/:surveyId/qr",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:share"),
  getAnonymousSurveyQRCode
);

router.get(
  "/:surveyId/invite-qr/:inviteId",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:share"),
  getInviteQRCode
);

// Legacy QR route (for backward compatibility)
router.get(
  "/qr/:id",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:share"),
  getSurveyQRCode
);


// ============================================================================
// 📤 EXPORT ROUTES
// ============================================================================

router.get(
  "/report/:id",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("survey:report:view"),
  exportSurveyReport
);


// ============================================================================
// 🤖 FEEDBACK AI ROUTES (Legacy - Consider moving to /api/feedback)
// ============================================================================

router.post(
  "/feedback/analyze",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("feedback:analyze"),
  analyzeFeedback
);

router.post(
  "/actions/generate",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("action:generate"),
  generateActions
);

router.post(
  "/feedback/follow-up",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("feedback:follow-up"),
  followUp
);


// ============================================================================
// 📈 DASHBOARD ROUTES (Legacy - Consider moving to /api/dashboard)
// ============================================================================

router.get(
  "/dashboards/executive",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("dashboard:view"),
  getExecutiveDashboard
);

router.get(
  "/dashboards/operational",
  tenantCheck,
  allowRoles("admin", "companyAdmin"),
  allowPermission("dashboard:view"),
  getOperationalDashboard
);


module.exports = router;

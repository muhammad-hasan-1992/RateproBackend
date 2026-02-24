// routes/surveyRoutes.js
// ============================================================================
// Survey Routes - TENANT LAYER (Company Admin + Member)
// 
// These routes are for tenant-scoped resources.
// System Admin (role: 'admin') MUST NOT access these routes.
// ============================================================================

const express = require("express");
const router = express.Router();
const { upload } = require("../middlewares/multer");
const { protect } = require("../middlewares/authMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const { allowPermission } = require("../middlewares/permissionMiddleware");
const { tenantCheck, setTenantId } = require("../middlewares/tenantMiddleware");
const { enforceTenantScope } = require("../middlewares/scopeMiddleware");
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
const activateSurvey = require("../controllers/survey/activateSurvey.controller");
const deactivateSurvey = require("../controllers/survey/deactivateSurvey.controller");
const { toggleSurveyStatus } = require("../controllers/survey/toggleStatus.controller");
const { scheduleSurvey } = require("../controllers/survey/scheduleSurvey.controller");
const setAudience = require("../controllers/survey/setAudience.controller");
const getTenantMembers = require("../controllers/survey/getTenantMembers.controller");

// Survey Permission Middleware (department-scoped)
const { surveyPermission } = require("../middlewares/surveyPermissionMiddleware");

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

// Legacy dashboard routes now redirect to /api/analytics/* — see bottom of file


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
// 🔒 PROTECTED ROUTES (Authentication Required - TENANT LAYER)
// ============================================================================
// Middleware chain: protect → setTenantId → enforceTenantScope
// This explicitly BLOCKS System Admin from accessing tenant survey resources
router.use(protect);

router.use(setTenantId);
router.use(enforceTenantScope);  // Blocks System Admin from tenant resources


// ============================================================================
// 📋 SURVEY CRUD ROUTES
// ============================================================================

// Create & Publish
router.post(
  "/save-draft",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("survey:create"),
  upload.single("logo"),
  createSurveyController
);

router.post(
  "/create",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("survey:create"),
  upload.single("logo"),
  publishSurvey
);

router.post(
  "/publish",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("survey:publish"),
  publishSurvey
);

router.post(
  "/:surveyId/publish",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("survey:publish"),
  publishSurvey
);

// List & Get
router.get(
  "/",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("survey:read"),
  listSurveys
);

// Responsible member assignment — must be before /:id to avoid route capture
router.get(
  "/tenant-members",
  tenantCheck,
  allowRoles("companyAdmin"),
  allowPermission("survey:create"),
  getTenantMembers
);

router.get(
  "/:id",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("survey:detail:view"),
  getSurveyById
);

// Update & Delete
router.put(
  "/:surveyId",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("survey:settings:update"),
  upload.single("logo"),
  updateSurvey
);

router.delete(
  "/:surveyId",
  tenantCheck,
  surveyPermission("survey:delete"),
  deleteSurvey
);

// ============================================================================
// 📊 SURVEY STATUS ROUTES (Explicit Activate/Deactivate)
// ============================================================================

// Activate survey (department-scoped)
router.put(
  "/:surveyId/activate",
  tenantCheck,
  surveyPermission("survey:activate"),
  activateSurvey
);

// Deactivate survey (department-scoped)
router.put(
  "/:surveyId/deactivate",
  tenantCheck,
  surveyPermission("survey:deactivate"),
  deactivateSurvey
);

// Legacy toggle route (deprecated - use explicit activate/deactivate)
router.put(
  "/toggle/:id",
  tenantCheck,
  allowRoles("companyAdmin"),
  allowPermission("survey:settings:update"),
  toggleSurveyStatus
);

router.post(
  "/:surveyId/schedule",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("survey:settings:update"),
  scheduleSurvey
);

// Audience
router.post(
  "/:surveyId/audience",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("survey:settings:update"),
  setAudience
);


// ============================================================================
// 📊 ANALYTICS & RESPONSES ROUTES
// ============================================================================

router.get(
  "/:surveyId/responses",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("survey:responses:view"),
  getSurveyResponses  // TODO: Migrate to modular controller
);

router.get(
  "/:surveyId/analytics",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("survey:analytics:view"),
  getAnalytics
);


// ============================================================================
// 📱 QR CODE ROUTES
// ============================================================================

router.get(
  "/:surveyId/qr",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("survey:share"),
  getAnonymousSurveyQRCode
);

router.get(
  "/:surveyId/invite-qr/:inviteId",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("survey:share"),
  getInviteQRCode
);

// Legacy QR route (for backward compatibility)
router.get(
  "/qr/:id",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("survey:share"),
  getSurveyQRCode
);


// ============================================================================
// 📤 EXPORT ROUTES
// ============================================================================

router.get(
  "/report/:id",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("survey:report:view"),
  exportSurveyReport
);


// ============================================================================
// 🤖 FEEDBACK AI ROUTES (Legacy - Consider moving to /api/feedback)
// ============================================================================

router.post(
  "/feedback/analyze",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("feedback:analyze"),
  analyzeFeedback
);

router.post(
  "/actions/generate",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("action:generate"),
  generateActions
);

router.post(
  "/feedback/follow-up",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("feedback:follow-up"),
  followUp
);


// ============================================================================
// 📈 DASHBOARD ROUTES (DEPRECATED — Redirects to /api/analytics/*)
// ============================================================================

router.get(
  "/dashboards/executive",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("dashboard:view"),
  (req, res) => {
    res.redirect(307, `/api/analytics/executive?${new URLSearchParams(req.query)}`);
  }
);

router.get(
  "/dashboards/operational",
  tenantCheck,
  allowRoles("companyAdmin", "member"),
  allowPermission("dashboard:view"),
  (req, res) => {
    res.redirect(307, `/api/analytics/operational?${new URLSearchParams(req.query)}`);
  }
);


module.exports = router;

// routes/segmentation.routes.js
const express = require("express");
const router = express.Router();

const { protect } = require("../middlewares/authMiddleware");
const { setTenantId } = require("../middlewares/tenantMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const { enforceTenantScope } = require("../middlewares/scopeMiddleware");

const segmentationController = require("../controllers/audience/segmentation.controller");

// 🔹 All routes require authentication, tenant context, and tenant scope
router.use(protect, setTenantId, enforceTenantScope);

// ─────────────────────────────────────────────────────────────
// SEGMENT CRUD
// ─────────────────────────────────────────────────────────────

/**
 * @route   POST /api/segments
 * @desc    Create a new segment
 * @access  CompanyAdmin | Admin
 */
router.post(
  "/",
  allowRoles("companyAdmin"),
  segmentationController.createSegment
);

/**
 * @route   GET /api/segments
 * @desc    List all segments for tenant
 * @access  CompanyAdmin | Admin | Member
 */
router.get(
  "/",
  allowRoles("companyAdmin", "member"),
  segmentationController.listSegments
);

/**
 * @route   GET /api/segments/filters/options
 * @desc    Get available filter options for segment builder
 * @access  CompanyAdmin | Admin
 */
router.get(
  "/filters/options",
  allowRoles("companyAdmin"),
  segmentationController.getFilterOptions
);

/**
 * @route   POST /api/segments/preview
 * @desc    Preview filters without saving (segment builder)
 * @access  CompanyAdmin | Admin
 */
router.post(
  "/preview",
  allowRoles("companyAdmin"),
  segmentationController.previewFilters
);

/**
 * @route   GET /api/segments/:id
 * @desc    Get single segment by ID
 * @access  CompanyAdmin | Admin | Member
 */
router.get(
  "/:id",
  allowRoles("companyAdmin", "member"),
  segmentationController.getSegment
);

/**
 * @route   PUT /api/segments/:id
 * @desc    Update a segment
 * @access  CompanyAdmin | Admin
 */
router.put(
  "/:id",
  allowRoles("companyAdmin"),
  segmentationController.updateSegment
);

/**
 * @route   DELETE /api/segments/:id
 * @desc    Delete a segment
 * @access  CompanyAdmin | Admin
 */
router.delete(
  "/:id",
  allowRoles("companyAdmin"),
  segmentationController.deleteSegment
);

// ─────────────────────────────────────────────────────────────
// SEGMENT CONTACTS
// ─────────────────────────────────────────────────────────────

/**
 * @route   GET /api/segments/:id/preview
 * @desc    Preview contacts matching segment (quick view)
 * @access  CompanyAdmin | Admin
 */
router.get(
  "/:id/preview",
  allowRoles("companyAdmin"),
  segmentationController.previewSegment
);

/**
 * @route   GET /api/segments/:id/count
 * @desc    Get count of contacts in segment
 * @access  CompanyAdmin | Admin | Member
 */
router.get(
  "/:id/count",
  allowRoles("companyAdmin", "member"),
  segmentationController.countSegment
);

/**
 * @route   GET /api/segments/:id/contacts
 * @desc    List contacts in segment with pagination & search
 * @access  CompanyAdmin | Admin
 */
router.get(
  "/:id/contacts",
  allowRoles("companyAdmin"),
  segmentationController.listContactsBySegment
);

module.exports = router;

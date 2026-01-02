// routes/segmentation.routes.js
const express = require("express");
const router = express.Router();

const { protect } = require("../middlewares/authMiddleware");
const { setTenantId } = require("../middlewares/tenantMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");

const segmentationController = require("../controllers/audience/segmentation.controller");

// 🔹 All routes require authentication and tenant context
router.use(protect, setTenantId);

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
  allowRoles("companyAdmin", "admin"),
  segmentationController.createSegment
);

/**
 * @route   GET /api/segments
 * @desc    List all segments for tenant
 * @access  CompanyAdmin | Admin | Member
 */
router.get(
  "/",
  allowRoles("companyAdmin", "admin", "member"),
  segmentationController.listSegments
);

/**
 * @route   GET /api/segments/filters/options
 * @desc    Get available filter options for segment builder
 * @access  CompanyAdmin | Admin
 */
router.get(
  "/filters/options",
  allowRoles("companyAdmin", "admin"),
  segmentationController.getFilterOptions
);

/**
 * @route   POST /api/segments/preview
 * @desc    Preview filters without saving (segment builder)
 * @access  CompanyAdmin | Admin
 */
router.post(
  "/preview",
  allowRoles("companyAdmin", "admin"),
  segmentationController.previewFilters
);

/**
 * @route   GET /api/segments/:id
 * @desc    Get single segment by ID
 * @access  CompanyAdmin | Admin | Member
 */
router.get(
  "/:id",
  allowRoles("companyAdmin", "admin", "member"),
  segmentationController.getSegment
);

/**
 * @route   PUT /api/segments/:id
 * @desc    Update a segment
 * @access  CompanyAdmin | Admin
 */
router.put(
  "/:id",
  allowRoles("companyAdmin", "admin"),
  segmentationController.updateSegment
);

/**
 * @route   DELETE /api/segments/:id
 * @desc    Delete a segment
 * @access  CompanyAdmin | Admin
 */
router.delete(
  "/:id",
  allowRoles("companyAdmin", "admin"),
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
  allowRoles("companyAdmin", "admin"),
  segmentationController.previewSegment
);

/**
 * @route   GET /api/segments/:id/count
 * @desc    Get count of contacts in segment
 * @access  CompanyAdmin | Admin | Member
 */
router.get(
  "/:id/count",
  allowRoles("companyAdmin", "admin", "member"),
  segmentationController.countSegment
);

/**
 * @route   GET /api/segments/:id/contacts
 * @desc    List contacts in segment with pagination & search
 * @access  CompanyAdmin | Admin
 */
router.get(
  "/:id/contacts",
  allowRoles("companyAdmin", "admin"),
  segmentationController.listContactsBySegment
);

module.exports = router;

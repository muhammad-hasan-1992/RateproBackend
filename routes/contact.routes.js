// routes/contact.routes.js
/**
 * CONSOLIDATED CONTACT ROUTES
 * This is the single source of truth for all contact-related routes.
 * 
 * Base path: /api/contacts
 */
const express = require("express");
const router = express.Router();

const { protect } = require("../middlewares/authMiddleware");
const { setTenantId } = require("../middlewares/tenantMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const { excelUpload } = require("../middlewares/multer");

// Controllers
const createContactController = require("../controllers/contact/createContact.controller");
const listContactsController = require("../controllers/contact/listContacts.controller");
const getContactController = require("../controllers/contact/getContact.controller");
const updateContactController = require("../controllers/contact/updateContact.controller");
const deleteContactController = require("../controllers/contact/deleteContact.controller");
const bulkUploadController = require("../controllers/contact/contactBulkUpload.controller");
const exportController = require("../controllers/contact/exportContacts.controller");

// 🔒 All routes require authentication and tenant context
router.use(protect, setTenantId);

// ─────────────────────────────────────────────────────────────
// EXPORT ROUTES (must be before /:id to avoid conflicts)
// ─────────────────────────────────────────────────────────────

/**
 * @route   GET /api/contacts/export/excel
 * @desc    Export all contacts to Excel
 * @access  CompanyAdmin | Admin
 */
router.get(
  "/export/excel",
  allowRoles("companyAdmin", "admin"),
  exportController.exportContactsExcel
);

/**
 * @route   GET /api/contacts/export/pdf
 * @desc    Export all contacts to PDF
 * @access  CompanyAdmin | Admin
 */
router.get(
  "/export/pdf",
  allowRoles("companyAdmin", "admin"),
  exportController.exportContactsPDF
);

/**
 * @route   GET /api/contacts/export/csv
 * @desc    Export all contacts to CSV
 * @access  CompanyAdmin | Admin
 */
router.get(
  "/export/csv",
  allowRoles("companyAdmin", "admin"),
  exportController.exportContactsCSV
);

// ─────────────────────────────────────────────────────────────
// BULK OPERATIONS
// ─────────────────────────────────────────────────────────────

/**
 * @route   POST /api/contacts/bulk-upload
 * @desc    Bulk upload contacts from Excel file
 * @access  CompanyAdmin
 */
router.post(
  "/bulk-upload",
  allowRoles("companyAdmin"),
  excelUpload.single("excel"),
  bulkUploadController.bulkUploadContacts
);

// ─────────────────────────────────────────────────────────────
// CRUD OPERATIONS
// ─────────────────────────────────────────────────────────────

/**
 * @route   GET /api/contacts
 * @desc    List contacts with pagination, search, filters
 * @access  CompanyAdmin | Admin | Member
 */
router.get(
  "/",
  allowRoles("companyAdmin", "admin", "member"),
  listContactsController.listContacts
);

/**
 * @route   POST /api/contacts
 * @desc    Create a new contact
 * @access  CompanyAdmin | Admin
 */
router.post(
  "/",
  allowRoles("companyAdmin", "admin"),
  createContactController.createContact
);

/**
 * @route   GET /api/contacts/:id
 * @desc    Get single contact by ID
 * @access  CompanyAdmin | Admin | Member
 */
router.get(
  "/:id",
  allowRoles("companyAdmin", "admin", "member"),
  getContactController.getContact
);

/**
 * @route   PUT /api/contacts/:id
 * @desc    Update a contact
 * @access  CompanyAdmin | Admin
 */
router.put(
  "/:id",
  allowRoles("companyAdmin", "admin"),
  updateContactController.updateContact
);

/**
 * @route   DELETE /api/contacts/:id
 * @desc    Delete a contact
 * @access  CompanyAdmin | Admin
 */
router.delete(
  "/:id",
  allowRoles("companyAdmin", "admin"),
  deleteContactController.deleteContact
);

module.exports = router;

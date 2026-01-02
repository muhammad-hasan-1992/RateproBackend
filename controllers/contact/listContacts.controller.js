// controllers/contact/listContacts.controller.js
const ContactService = require("../../services/contact/contactService");

/**
 * GET /api/contacts
 * Query params: page, limit, search, status, categoryId
 */
exports.listContacts = async (req, res) => {
  try {
    const result = await ContactService.list({
      tenantId: req.tenantId,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
      search: req.query.search || "",
      status: req.query.status,
      categoryId: req.query.categoryId,
    });

    res.json({
      success: true,
      data: {
        contacts: result.items,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: Math.ceil(result.total / result.limit),
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

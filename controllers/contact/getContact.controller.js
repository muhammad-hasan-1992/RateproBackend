// controllers/contact/getContact.controller.js
const ContactService = require("../../services/contact/contactService");

/**
 * GET /api/contacts/:id
 */
exports.getContact = async (req, res) => {
  try {
    const contact = await ContactService.getById({
      tenantId: req.tenantId,
      contactId: req.params.id,
    });

    res.json({
      success: true,
      data: { contact },
    });
  } catch (err) {
    const status = err.message === "Contact not found" ? 404 : 500;
    res.status(status).json({
      success: false,
      message: err.message,
    });
  }
};
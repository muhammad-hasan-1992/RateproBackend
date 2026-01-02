// controllers/contact/deleteContact.controller.js
const ContactService = require("../../services/contact/contactService");

/**
 * DELETE /api/contacts/:id
 */
exports.deleteContact = async (req, res) => {
  try {
    await ContactService.remove({
      tenantId: req.tenantId,
      contactId: req.params.id,
    });

    res.json({
      success: true,
      message: "Contact deleted successfully",
    });
  } catch (err) {
    const status = err.message.includes("not found") ? 404 : 500;
    res.status(status).json({
      success: false,
      message: err.message,
    });
  }
};

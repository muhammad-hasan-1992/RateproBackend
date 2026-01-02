// RateproBackend/controllers/contact/createContact.controller.js
const ContactService = require("../../services/contact/contactService");

exports.createContact = async (req, res) => {
  try {
    const contact = await ContactService.create({
      tenantId: req.tenantId,
      payload: req.body,
    });
    
    res.status(201).json({
      success: true,
      data: { contact },
    });
  } catch (err) {
    const status = err.message.includes("already exists") ? 409 : 400;
    res.status(status).json({
      success: false,
      message: err.message,
    });
  }
};
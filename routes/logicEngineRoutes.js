// routes/logicEngineRoutes.js   ← YE FILE ABHI BANANI HAI
const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { setTenantId } = require("../middlewares/tenantMiddleware");
const { evaluateLogic } = require("../controllers/logicEngineController");

// Ye route har survey answer change pe frontend call karega
router.post(
  "/surveys/:id/evaluate",
  protect,
  setTenantId,
  evaluateLogic
);

module.exports = router;
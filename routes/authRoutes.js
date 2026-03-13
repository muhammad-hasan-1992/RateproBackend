// // routes/authRoutes.js

// const express = require("express");
// const router = express.Router();
// const upload = require("../middlewares/multer");
// const { protect } = require("../middlewares/authMiddleware");
// const { authLimiter } = require("../middlewares/rateLimiter");
// const passport = require("passport");

// const {
//   registerUser,
//   resendOtp,
//   verifyEmail,
//   verifyEmailLink,
//   forgotPassword,
//   resetPassword,
//   updateProfile,
//   logoutUser,
//   verifyResetCode,
//   getMe,
//   loginUser,
//   verifyLoginOTP,
//   refreshAccessToken,
// } = require("../controllers/authController");

// // Auth routes
// router.post("/register", registerUser);
// router.post("/resend-otp", resendOtp);
// router.post("/verify-email", verifyEmail);
// router.get("/verify-email-link", verifyEmailLink);
// router.post("/login", loginUser);
// // router.get("/refresh-token", refreshAccessToken);

// router.post("/forgot-password", forgotPassword);
// router.post("/reset-password", resetPassword);
// router.post("/verify-reset-code", verifyResetCode);

// router.put("/update-profile", protect, upload.single("avatar"), updateProfile);
// router.post("/logout", logoutUser);
// router.get("/me", protect, getMe);


// module.exports = router;

// /routes/authRoutes.js
const express = require("express");
const router = express.Router();
// const upload = require("../middlewares/multer");
const { upload } = require('../middlewares/multer');
const { protect } = require("../middlewares/authMiddleware");
const { authLimiter, loginLimiter } = require("../middlewares/rateLimiter");
const { allowRoles } = require("../middlewares/roleMiddleware");
const {
  registerUser,
  resendOtp,
  verifyEmail,
  verifyEmailLink,
  forgotPassword,
  resetPassword,
  verifyResetCode,
  updateProfile,
  logoutUser,
  getMe,
  loginUser,
  refreshAccessToken,
} = require("../controllers/authController");

// Public routes with rate limiting
router.post("/register", authLimiter, registerUser);
router.post("/resend-otp", authLimiter, resendOtp);
router.post("/verify-email", authLimiter, verifyEmail);
router.get("/verify-email-link", authLimiter, verifyEmailLink);
router.post("/login", loginLimiter, loginUser);
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", authLimiter, resetPassword);
router.post("/verify-reset-code", authLimiter, verifyResetCode);

// Protected routes
router.put("/update-profile", protect, allowRoles("admin", "companyAdmin", "member", "user"), upload.single("avatar"), updateProfile);
router.post("/logout", protect, logoutUser);
router.get("/me", protect, allowRoles("admin", "companyAdmin", "member", "user"), getMe);
router.post("/refresh", refreshAccessToken);
module.exports = router;
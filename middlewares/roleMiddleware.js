// middlewares/roleMiddleware.js
exports.allowRoles = (...roles) => (req, res, next) => {

  if (req.user.role === "member") {
    // Member ko controller tak jane do, wahan permission check hoga
    return next();
  }

  if (!roles.includes(req.user.role)) {
    // console.log('allowRoles: Role not allowed', { userRole: req.user.role, allowedRoles: roles });
    return res.status(403).json({ message: 'Access denied: Role not authorized' });
  }
  next();
};
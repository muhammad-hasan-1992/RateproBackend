// middlewares/featureFlagMiddleware.js
exports.requireFlag = (flag) => async (req, res, next) => {
  if (req.user.role === 'admin') return next();

  const flags = await FeatureFlag.findOne({ tenant: req.tenantId });
  if (!flags || !flags.flags[flag]) {
    return res.status(403).json({ message: `Feature "${flag}" not available on your plan` });
  }
  next();
};
// // middleware/tenantMiddleware.js

// const User = require("../models/User");
// const asyncHandler = require('express-async-handler');
// const Survey = require('../models/Survey');
// const SurveyResponse = require('../models/SurveyResponse');
// const FeedbackAnalysis = require('../models/FeedbackAnalysis');
// const Action = require('../models/Action');

// exports.setTenantId = async (req, res, next) => {
//   try {
//      // 🟢 Skip for public routes
//     const PUBLIC_PATHS = ["/api/surveys/public", "/api/auth/login", "/api/auth/register"];
//     if (PUBLIC_PATHS.some(path => req.originalUrl.startsWith(path))) {
//       return next();
//     }

//     // Ensure req.user is set by protect middleware
//     if (!req.user || !req.user._id) {
//       console.error('setTenantId: No user found in request');
//       return res.status(401).json({ message: 'Unauthorized: No user found' });
//     }

//     // Get tenant from req.user.tenant (set by protect middleware)
//     const user = await User.findById(req.user._id).select('tenant');
//     if (!user || !user.tenant) {
//       console.error('setTenantId: User has no tenant', { userId: req.user._id });
//       return res.status(403).json({ message: 'Access denied: User not associated with any tenant' });
//     }

//     // Set tenantId in req
//     req.tenantId = user.tenant.toString();
//     console.log('setTenantId: Tenant ID set', { tenantId: req.tenantId, userId: req.user._id });

//     // Optional: Check req.body.tenant if provided (for backward compatibility)
//     const { tenant } = req.body || {};
//     if (tenant && tenant !== req.tenantId) {
//       console.error('setTenantId: Tenant mismatch', {
//         providedTenant: tenant,
//         userTenant: req.tenantId,
//       });
//       return res.status(403).json({ message: 'Access denied: Invalid tenant' });
//     }

//     next();
//   } catch (err) {
//     console.error('setTenantId: Error', { error: err.message });
//     return res.status(500).json({ message: 'Internal Server Error' });
//   }
// };

// exports.tenantCheck = asyncHandler(async (req, res, next) => {
//   const { id, surveyId, responseId, feedbackId, actionId } = req.params;
//   const tenantId = req.tenantId; // 👈 ek hi naam rakho
//   let resource;
  


//   if (id || surveyId) {
//     console.log("tenantCheck: Fetching Survey", { id: id || surveyId });
//     resource = await Survey.findById(id || surveyId).select("tenant");
//   } else if (responseId) {
//     console.log("tenantCheck: Fetching SurveyResponse", { responseId });
//     resource = await SurveyResponse.findById(responseId).select("tenant");
//   } else if (feedbackId) {
//     console.log("tenantCheck: Fetching FeedbackAnalysis", { feedbackId });
//     resource = await FeedbackAnalysis.findById(feedbackId).select("tenant");
//   } else if (actionId) {
//     console.log("tenantCheck: Fetching Action", { actionId });
//     resource = await Action.findById(actionId).select("tenant");
//   }

//   console.log("tenantCheck: Resource fetched", {
//     resource: resource ? { id: resource._id, tenant: resource.tenant } : null,
//   });

//   // 🔹 List / Create case (jab resource nahi mila)
//   if (!resource) {
//     // For list/create operations, just verify the user has a valid tenant
//     if (!req.user?.tenant) {
//       console.error("tenantCheck: No tenant found for user");
//       return res.status(403).json({ message: "No tenant associated with user" });
//     }
//     return next();
//   }

//   // 🔹 Resource mila to tenant verify karo
//   if (resource.tenant.toString() !== tenantId) {
//     console.error("tenantCheck: Tenant mismatch or resource not found", {
//       resourceTenant: resource ? resource.tenant.toString() : null,
//       requestTenantId: tenantId,
//       resourceId: id || surveyId || responseId || feedbackId || actionId,
//     });
//     return res.status(403).json({ message: "Tenant mismatch" });
//   }

//   req.resource = resource;
//   console.log("tenantCheck: Tenant verified, proceeding", {
//     resourceId: resource._id,
//     tenantId,
//   });
//   next();
// });

// middleware/tenantMiddleware.js
const User = require("../models/User");
const asyncHandler = require("express-async-handler");
const Survey = require("../models/Survey");
const SurveyResponse = require("../models/SurveyResponse");
const FeedbackAnalysis = require("../models/FeedbackAnalysis");
const Action = require("../models/Action");

exports.setTenantId = async (req, res, next) => {
  try {
    // 🟢 Skip for public routes
    const PUBLIC_PATHS = ["/api/surveys/public", "/api/auth/login", "/api/auth/register"];
    if (PUBLIC_PATHS.some((path) => req.originalUrl.startsWith(path))) {
      return next();
    }

    // Ensure req.user is set by protect middleware
    if (!req.user || !req.user._id) {
      console.error("setTenantId: No user found in request");
      return res.status(401).json({ message: "Unauthorized: No user found" });
    }

    // ✅ Skip tenant check for admins
    if (req.user.role === "admin") {
      console.log("setTenantId: Admin user detected, skipping tenant validation");
      req.tenantId = null; // No tenant restriction for admin
      return next();
    }

    // 🔹 Regular (non-admin) user tenant enforcement
    const user = await User.findById(req.user._id).select("tenant");
    if (!user || !user.tenant) {
      console.error("setTenantId: User has no tenant", { userId: req.user._id });
      return res
        .status(403)
        .json({ message: "Access denied: User not associated with any tenant" });
    }

    // Set tenantId in req
    req.tenantId = user.tenant.toString();
    console.log("setTenantId: Tenant ID set", { tenantId: req.tenantId, userId: req.user._id });

    // Optional: Validate body tenant
    const { tenant } = req.body || {};
    if (tenant && tenant !== req.tenantId) {
      console.error("setTenantId: Tenant mismatch", {
        providedTenant: tenant,
        userTenant: req.tenantId,
      });
      return res.status(403).json({ message: "Access denied: Invalid tenant" });
    }

    next();
  } catch (err) {
    console.error("setTenantId: Error", { error: err.message });
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.tenantCheck = asyncHandler(async (req, res, next) => {
  const { id, surveyId, responseId, feedbackId, actionId } = req.params;
  const tenantId = req.tenantId;
  let resource;

  // ✅ Skip tenant validation for admins
  if (req.user.role === "admin") {
    // console.log("tenantCheck: Admin user detected, skipping tenant validation");
    return next();
  }

  // 🔹 Check tenant association for non-admin users
  if (id || surveyId) {
    console.log("tenantCheck: Fetching Survey", { id: id || surveyId });
    resource = await Survey.findById(id || surveyId).select("tenant");
  } else if (responseId) {
    console.log("tenantCheck: Fetching SurveyResponse", { responseId });
    resource = await SurveyResponse.findById(responseId).select("tenant");
  } else if (feedbackId) {
    console.log("tenantCheck: Fetching FeedbackAnalysis", { feedbackId });
    resource = await FeedbackAnalysis.findById(feedbackId).select("tenant");
  } else if (actionId) {
    console.log("tenantCheck: Fetching Action", { actionId });
    resource = await Action.findById(actionId).select("tenant");
  }

  console.log("tenantCheck: Resource fetched", {
    resource: resource ? { id: resource._id, tenant: resource.tenant } : null,
  });

  // 🔹 List / Create case (when no resource found)
  if (!resource) {
    if (!req.user?.tenant) {
      console.error("tenantCheck: No tenant found for user");
      return res.status(403).json({ message: "No tenant associated with user" });
    }
    return next();
  }

  // 🔹 Resource tenant validation
  if (resource.tenant.toString() !== tenantId) {
    console.error("tenantCheck: Tenant mismatch or resource not found", {
      resourceTenant: resource ? resource.tenant.toString() : null,
      requestTenantId: tenantId,
      resourceId: id || surveyId || responseId || feedbackId || actionId,
    });
    return res.status(403).json({ message: "Tenant mismatch" });
  }

  req.resource = resource;
  console.log("tenantCheck: Tenant verified, proceeding", {
    resourceId: resource._id,
    tenantId,
  });
  next();
});

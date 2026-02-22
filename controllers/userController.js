// /controllers/userController.js
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Tenant = require("../models/Tenant");
const OTP = require("../models/OTP");
// const UserCategory = require('../models/ContactCategory');
const Department = require("../models/Department")
const Permission = require("../models/Permission");
const sendEmail = require("../utils/sendEmail");
const cloudinary = require("../utils/cloudinary");
const PDFDocument = require("pdfkit");
const axios = require("axios");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const moment = require("moment");
const Joi = require("joi");
const getBaseURL = require("../utils/getBaseURL");
const XLSX = require('xlsx');
const Logger = require("../utils/logger");

// Multer setup for Excel
const multer = require('multer');
const EmailTemplate = require("../models/EmailTemplate");
const upload = multer({ storage: multer.memoryStorage() });

// Helper: Generate OTP Code
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Validation Schemas
const bulkUserSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  isActive: Joi.boolean().optional(),
  role: Joi.string().valid('member').required(),
  department: Joi.string().required(), // Department name (not ID)
});

const createUserSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  isActive: Joi.boolean().optional(),
  role: Joi.string().valid("admin", "companyAdmin", "member").required(),
  tenantName: Joi.string().min(2).max(100).optional(),
  department: Joi.string().optional(),
  tenant: Joi.string().optional(),
});

const updateUserSchema = Joi.object({
  name: Joi.string().min(2).max(50).optional(),
  email: Joi.string().email().optional(),
  phone: Joi.string().optional(),
  bio: Joi.string().optional(),
  department: Joi.string().optional(),
  isActive: Joi.boolean().optional(),
  avatar: Joi.object({
    public_id: Joi.string(),
    url: Joi.string(),
  }).optional(),
  role: Joi.string().valid("admin", "companyAdmin", "member").optional(),
  companyName: Joi.string().min(2).max(100).optional(),
});

const getAllUsersSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().allow("").optional(), // Allow empty string or undefined
  sort: Joi.string().default("createdAt"),
  role: Joi.string().valid("admin", "companyAdmin", "member", "user").allow("").optional(),
  active: Joi.string().valid("true", "false").optional(),
});

const idSchema = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

const notificationSchema = Joi.object({
  subject: Joi.string().required(),
  message: Joi.string().required(),
});

const updateMeSchema = Joi.object({
  name: Joi.string().min(2).max(50).optional(),
  email: Joi.string().email().optional(),
  phone: Joi.string().allow("").optional(),
  bio: Joi.string().allow("").optional(),
  department: Joi.string().allow("").optional(),
  tenant: Joi.object({
    name: Joi.string().optional(),
    address: Joi.string().optional(),
    contactEmail: Joi.string().email().optional(),
    contactPhone: Joi.string().optional(),
    website: Joi.string().optional(),
    totalEmployees: Joi.number().integer().min(0).optional(),
    departments: Joi.array().items(Joi.string()).optional(),
  }).optional(),
});

// Bulk Create Users from Excel File
exports.bulkCreateUsers = async (req, res) => {
  const functionName = "bulkCreateUsers";
  try {
    const currentUser = req.user;

    // 🔒 1. Access Restriction
    if (currentUser.role?.toLowerCase() !== "companyadmin") {
      return res.status(403).json({ message: "Access denied: Only CompanyAdmin can perform bulk upload" });
    }

    // 📁 2. Check if file exists
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: "No Excel file uploaded" });
    }

    // 📊 3. Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    if (!workbook.SheetNames.length) {
      return res.status(400).json({ message: "Excel file contains no sheets" });
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });

    // 🧾 4. Validate row count & header structure
    if (rows.length < 2) {
      return res.status(400).json({ message: "Empty or invalid Excel file. Must have at least one data row." });
    }

    const headers = rows[0].map(h => h?.toString().trim().toLowerCase());
    const requiredHeaders = ["name", "email", "password", "role", "status", "department", "categories"];
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    if (missingHeaders.length) {
      return res.status(400).json({ message: `Missing columns: ${missingHeaders.join(", ")}` });
    }

    // 🎯 Extract data rows (excluding headers)
    const dataRows = rows.slice(1);

    // 🏢 5. Tenant Validation
    const tenantId = currentUser.tenant._id ? currentUser.tenant._id.toString() : currentUser.tenant;
    const tenantData = await Tenant.findById(tenantId).populate("departments");
    if (!tenantData) {
      return res.status(403).json({ message: "Access denied: Invalid or missing tenant" });
    }

    const companyName = tenantData.name || "Your Company";
    const baseURL = getBaseURL().public;
    const loginLink = `${baseURL}/login`;

    // 🧭 6. Department Mapping (auto-create missing)
    const deptNames = new Set();
    dataRows.forEach(row => {
      const deptName = row[5]?.toString().trim().toLowerCase();
      if (deptName) deptNames.add(deptName);
    });

    const uniqueDeptNames = Array.from(deptNames);
    const deptMap = new Map();

    if (uniqueDeptNames.length) {
      const existingDepts = await Department.find({
        tenant: tenantId,
        name: { $in: uniqueDeptNames },
      });

      existingDepts.forEach(dept => deptMap.set(dept.name.toLowerCase(), dept._id.toString()));

      const missingDepts = uniqueDeptNames.filter(name => !deptMap.has(name));
      if (missingDepts.length) {
        const newDepts = missingDepts.map(name => ({ tenant: tenantId, name, head: "" }));
        const createdDepts = await Department.insertMany(newDepts);
        createdDepts.forEach(dept => deptMap.set(dept.name.toLowerCase(), dept._id.toString()));

        await Tenant.findByIdAndUpdate(tenantId, {
          $push: { departments: { $each: createdDepts.map(d => d._id) } },
        });
      }
    }

    // ⚙️ 8. Process Rows (batched)
    const successes = [];
    const errors = [];
    const batchSize = 10; // handle 10 users concurrently

    for (let i = 0; i < dataRows.length; i += batchSize) {
      const batch = dataRows.slice(i, i + batchSize);

      await Promise.allSettled(
        batch.map(async (row, idx) => {
          const rowIndex = i + idx + 2; // Excel row number
          const [name, email, password, role, statusStr, departmentName, categoriesStr] = row.map(v =>
            v?.toString().trim() || ""
          );

          // ❌ Skip incomplete rows
          if (!email || !password || !departmentName) {
            errors.push({ rowIndex, email, message: "Missing required fields" });
            return;
          }

          // ✅ Schema validation
          const isActive = statusStr.toLowerCase() === "active";
          const { error: validationError } = bulkUserSchema.validate({
            name,
            email,
            password,
            isActive,
            role,
            department: departmentName,
          });
          if (validationError) {
            errors.push({ rowIndex, email, message: validationError.details[0].message });
            return;
          }

          // 🚫 Only 'member' role allowed
          if (role.toLowerCase() !== "member") {
            errors.push({ rowIndex, email, message: "Invalid role, must be 'member'" });
            return;
          }

          // 🏢 Department lookup
          const deptId = deptMap.get(departmentName.toLowerCase());
          if (!deptId) {
            errors.push({ rowIndex, email, message: "Department not found" });
            return;
          }

          // 📬 Skip if user exists
          const existingUser = await User.findOne({ email });
          if (existingUser) {
            errors.push({ rowIndex, email, message: "User already exists" });
            return;
          }

          // 🔐 Create new user
          const hashedPassword = await bcrypt.hash(password, 10);
          const newUser = await User.create({
            name,
            email,
            password: hashedPassword,
            role: "member",
            authProvider: "local",
            tenant: tenantId,
            department: deptId,
            isVerified: false,
            isActive,
            createdBy: currentUser._id,
            deleted: false,
            phone: "",
            bio: "",
            avatar: { public_id: "", url: "" },
            customRoles: [],
            surveyStats: null,
          });

          // 📧 Send verification email
          const verificationCode = generateOTP();
          const expiresAt = moment().add(process.env.OTP_EXPIRE_MINUTES || 15, "minutes").toDate();
          await OTP.create({ email, code: verificationCode, purpose: "verify", expiresAt });

          const verificationLink = `${baseURL}/verify-email?code=${verificationCode}&email=${encodeURIComponent(email)}`;

          try {
            sendEmail({
              to: email,
              templateType: "user_welcome",
              templateData: {
                userName: name,
                userEmail: email,
                userPassword: password,
                companyName,
                loginLink,
                verificationLink,
              },
            });

            Logger.info("bulkCreateUsers", "Welcome email sent", {
              context: {
                userId: req.user?._id,
                status: "EmailSent",
                details: `Welcome email sent to ${email}`
              },
              req
            });

          } catch (emailError) {
            Logger.warn("bulkCreateUsers", "Email sending failed", {
              context: {
                userId: req.user?._id,
                status: "EmailFailed",
                details: `Template email failed for ${email}, sending basic email. Error: ${emailError.message}`,
              },
              req
            });

            // 📨 Fallback basic email
            const fallbackHTML = `
              <p>Hello ${name},</p>
              <p>Your account has been created successfully.</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Password:</strong> ${password}</p>
              <p>Verify your email here: <a href="${verificationLink}" target="_blank">${verificationLink}</a></p>
              <p>This link expires in ${process.env.OTP_EXPIRE_MINUTES} minute(s).</p>
              <br/><p>Regards,<br/>Team ${companyName}</p>
            `;
            sendEmail({
              to: email,
              subject: `Verify your email - ${companyName}`,
              html: fallbackHTML,
            });
          }

          successes.push({ id: newUser._id, email: newUser.email });
        })
      );
    }

    // 🪵 9. Log final summary
    Logger.info("bulkCreateUsers", "Bulk creation completed", {
      context: {
        userId: currentUser._id,
        status: "Completed",
        total: dataRows.length,
        success: successes.length,
        failed: errors.length
      },
      req
    });


    // ✅ 10. Response
    res.status(201).json({
      message: "Bulk user creation completed",
      totalProcessed: dataRows.length,
      successful: successes.length,
      failed: errors.length,
      createdUsers: successes,
      errors: errors.length ? errors : null,
    });

  } catch (err) {
    console.error("BulkCreateUsers error:", err);

    Logger.error("bulkCreateUsers", "Bulk operation failed", {
      error: err,
      context: {
        userId: req.user?._id
      },
      req
    });

    if (err.code === 11000) {
      return res.status(400).json({ message: "Duplicate email found in database" });
    }

    res.status(500).json({ message: "Internal Server Error", error: err.message });
  }
};

// Create User with Role-Based and Tenant-Based Restrictions
exports.createUser = async (req, res) => {
  try {
    // ✅ 1. Input Validation
    const { error } = createUserSchema.validate(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { name, email, password, role, tenant, department, tenantName } = req.body;
    const currentUser = req.user;

    // ✅ 2. Duplicate Email Check
    if (await User.findOne({ email })) {
      return res.status(400).json({ message: 'User already exists with this email.' });
    }

    // ✅ 3. Role-Based Access Control
    if (currentUser.role === 'admin' && !['companyAdmin', 'user'].includes(role)) {
      return res.status(403).json({ message: 'Admin can only create CompanyAdmin or User.' });
    }
    if (currentUser.role === 'companyAdmin' && role !== 'member') {
      return res.status(403).json({ message: 'CompanyAdmin can only create Member role.' });
    }

    // ✅ 4. Permission Check (for custom roles)
    if (currentUser.role === 'member') {
      const populatedUser = await User.findById(currentUser._id).populate({
        path: "customRoles",
        populate: { path: "permissions" }
      });
      if (!populatedUser) return res.status(404).json({ message: "User not found" });

      const hasPermission = populatedUser.customRoles?.some(
        (r) => r.permissions?.some(p => p.name === "user:create")
      );

      if (!hasPermission) {
        return res.status(403).json({ message: "Access denied: Permission 'user:create' required" });
      }
    }

    // ✅ 5. Tenant Validation
    let tenantId = tenant;
    if (currentUser.role === 'companyAdmin' && role === 'member') {
      if (!currentUser.tenant) return res.status(403).json({ message: 'No tenant associated' });
      const userTenantId = currentUser.tenant._id?.toString() || currentUser.tenant;
      tenantId = tenant || userTenantId;
      if (tenant && tenant !== userTenantId) return res.status(403).json({ message: 'Invalid tenant' });
    }

    // ✅ 6. Department Validation (for member creation)
    if (role === 'member' && department) {
      if (!mongoose.Types.ObjectId.isValid(tenantId)) {
        return res.status(400).json({ message: 'Invalid tenant ID' });
      }
      const tenantData = await Tenant.findById(tenantId).populate('departments');
      if (!tenantData || !tenantData.departments.some(d => d._id.toString() === department)) {
        return res.status(400).json({ message: 'Invalid department for this tenant' });
      }
    }

    // ✅ 8. Password Hashing
    const hashedPassword = await bcrypt.hash(password, 10);
    let newUser;
    let newTenant = null; // 🔥 added — to fix reference later in email section

    // ✅ 9. Create User or CompanyAdmin
    if (role === 'companyAdmin') {
      const tempUser = new User({
        name, email, password: hashedPassword, role, tenant: null, department: null,
        isVerified: false, createdBy: currentUser._id,
      });
      await tempUser.save({ validateBeforeSave: false });

      newTenant = await Tenant.create({
        name: tenantName?.trim() || `${name}'s Company`,
        admin: tempUser._id,
        createdBy: currentUser._id,
      });

      tempUser.tenant = newTenant._id;
      await tempUser.save();
      newUser = tempUser;
      tenantId = newTenant._id;

    } else {
      newUser = await User.create({
        name, email, password: hashedPassword, role, tenant: tenantId,
        department: role === 'member' ? department : null,
        isVerified: false, createdBy: currentUser._id,
      });
    }

    // ✅ 10. OTP Generation + Expiry
    const verificationCode = generateOTP();
    const expiresAt = moment().add(process.env.OTP_EXPIRE_MINUTES || 15, 'minutes').toDate();
    await OTP.create({ email, code: verificationCode, purpose: 'verify', expiresAt });

    // ✅ 11. Base URL Logic
    const baseURLs = getBaseURL();
    const baseURL = role === 'user' ? baseURLs.public : baseURLs.admin;
    const verificationLink = `${baseURL}/verify-email?code=${verificationCode}&email=${encodeURIComponent(email)}`;
    const loginLink = `${baseURL}/login`;

    // ✅ 12. Company Name Resolve (for email)
    let companyName = "Our Platform";
    if (role === 'companyAdmin' && newTenant) {
      companyName = newTenant.name;
    } else if (tenantId) {
      const tenantData = await Tenant.findById(tenantId);
      companyName = tenantData?.name || "Our Platform";
    }

    // ✅ 13. Send Email with Template
    try {
      // Fetch template
      const template = await EmailTemplate.findOne({ type: "user_welcome", isActive: true });
      if (!template) throw new Error("Email template not found");

      // Auto-map variables safely
      const templateData = {};
      template.variables.forEach((v) => {
        switch (v) {
          case "userName": templateData[v] = name; break;
          case "userEmail": templateData[v] = email; break;
          case "userPassword": templateData[v] = password; break;
          case "companyName": templateData[v] = companyName; break;
          case "verificationLink": templateData[v] = verificationLink; break;
          case "loginLink": templateData[v] = loginLink; break;
          case "otpExpireMinutes": templateData[v] = process.env.OTP_EXPIRE_MINUTES; break;
          case "currentYear": templateData[v] = new Date().getFullYear(); break;
          default: templateData[v] = ""; // Safe fallback
        }
      });

      sendEmail({
        to: email,
        templateType: template.type,
        templateData
      });

      Logger.info("createUser", "Welcome email sent using template", {
        context: {
          userId: req.user?._id,
          newUserId: newUser._id,
          email
        },
        req
      });

    } catch (emailError) {
      //  ⚠️ 14. Email Fallback (Basic HTML)
      Logger.warn("createUser", "Template email failed, sending basic email", {
        context: {
          userId: req.user?._id,
          error: emailError.message
        },
        req
      });

      const fallbackHTML = `
        <p>Hello ${name || req.body.name},</p>
        <p>Your account has been successfully created.</p>
        <p><strong>Login Email:</strong> ${email || req.body.email}</p>
        <p><strong>Temporary Password:</strong> ${password || req.body.password}</p>
        <p>Please verify your email by clicking the link below:</p>
        <p><a href="${verificationLink}" target="_blank">${verificationLink}</a></p>
        <p>This code will expire in ${process.env.OTP_EXPIRE_MINUTES || 15} minute(s).</p>
        <br/>
        <p>Regards,<br/>Team ${companyName || "Our Platform"}</p>
      `;

      sendEmail({
        to: email,
        subject: 'Verify your email - RatePro',
        html: fallbackHTML,
      });
    }

    // ✅ 15. Success Response
    res.status(201).json({
      message: 'User created successfully. Verification email sent.',
      user: {
        id: newUser._id,
        email: newUser.email,
        role: newUser.role,
        tenant: newUser.tenant,
        isVerified: newUser.isVerified,
      },
    });

  } catch (err) {
    console.error('CreateUser error:', err);

    // 🔴 16. Error Logging
    Logger.error("createUser", "User creation failed", {
      error: err,
      context: {
        userId: req.user?._id
      },
      req
    });

    res.status(500).json({ message: 'Internal Server Error' });
  }
};

// Update User with Role-Based and Tenant-Based Restrictions
exports.updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    let updates = { ...req.body };

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // --- Member custom role restrictions ---
    if (req.user.role === "member") {
      const populatedUser = await User.findById(req.user._id).populate({
        path: "customRoles",
        populate: { path: "permissions" }
      });

      const hasPermission = populatedUser?.customRoles?.some(role =>
        role.permissions.some(p => p.name === "user:update")
      );

      if (!hasPermission) {
        return res.status(403).json({ message: "Access denied: Permission 'user:update' required" });
      }

      if (user.tenant._id.toString() !== req.user.tenant._id.toString()) {
        return res.status(403).json({ message: "Access denied: Cannot update users from a different tenant" });
      }
    }

    // ----- ROLE BASED FIELD CONTROL -----
    const roleFieldsMap = {
      admin: ["name", "role", "isActive", "companyName"],
      companyAdmin: ["name", "isActive", "department"],
      member: ["name", "isActive"]
    };
    const allowedFields = roleFieldsMap[req.user.role] || [];
    Object.keys(updates).forEach(key => {
      if (!allowedFields.includes(key)) delete updates[key];
    });

    // ----- ISACTIVE LOGIC -----
    if (typeof updates.isActive !== "undefined") {
      updates.deactivatedBy = updates.isActive ? null : req.user.role;
    }

    // ----- UPDATE USER -----
    const updatedUser = await User.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true
    }).select("-password");

    // ✅ Log success
    Logger.info("updateUser", "User updated successfully", {
      context: {
        userId: id,
        updatedBy: req.user._id
      },
      req
    });


    res.status(200).json({
      status: "success",
      message: "User updated successfully",
      data: updatedUser,
    });

  } catch (error) {
    console.error("❌ UpdateUser Error:", error.message);

    // 🔴 Log unexpected error
    Logger.error("updateUser", "User update failed", {
      error,
      context: {
        userId: req.user?._id
      },
      req
    });

    next(error);
  }
};

// Delete User with Role-Based and Tenant-Based Restrictions
exports.deleteUser = async (req, res, next) => {
  try {
    const { error } = idSchema.validate(req.params);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    // Tenant scoping
    if (req.user.role !== "admin" && targetUser.tenant && req.tenantId !== targetUser.tenant.toString()) {
      return res.status(403).json({ message: "Access denied: Wrong tenant" });
    }

    // Role-based checks
    if (req.user.role === "companyAdmin" && targetUser.role !== "member") {
      return res.status(403).json({ message: "CompanyAdmin can only delete members" });
    }
    if (req.user.role === "member") {
      const currentUser = await User.findById(req.user._id).populate({
        path: "customRoles",
        populate: { path: "permissions" },
      });
      const hasDeletePermission = currentUser.customRoles.some(role =>
        role.permissions.some(perm => perm.name === "user:delete")
      );
      if (!hasDeletePermission || targetUser.role !== "member") {
        return res.status(403).json({ message: "Not authorized to delete this user" });
      }
    }

    // Delete avatar from Cloudinary
    if (targetUser.avatar?.public_id) {
      await cloudinary.uploader.destroy(targetUser.avatar.public_id);
    }

    let affectedUsers = [];

    // --- Hard Delete ---
    if (req.user.role === "admin" && targetUser.role === "companyAdmin") {
      affectedUsers = await User.find({ tenant: targetUser.tenant, role: "member" }).select("_id");
      await User.deleteMany({ tenant: targetUser.tenant, role: "member" });
      await Department.deleteMany({ tenant: targetUser.tenant });
      await Tenant.findByIdAndDelete(targetUser.tenant);
      await User.findByIdAndDelete(targetUser._id);
    } else {
      await User.findByIdAndDelete(targetUser._id);
    }

    // ✅ Log success
    Logger.info("deleteUser", "User deleted successfully", {
      context: {
        targetUserId: targetUser._id,
        role: targetUser.role,
        deletedBy: req.user._id,
        affectedUsers: affectedUsers.map(u => u._id)
      },
      req
    });

    res.status(200).json({
      message: "User deleted successfully",
      deletedUserId: targetUser._id,
      deletedUserRole: targetUser.role,
      affectedUsers: affectedUsers.map(user => user._id),
    });

  } catch (err) {
    console.error("❌ DeleteUser Error:", err);

    // 🔴 Log unexpected error
    Logger.error("deleteUser", "User deletion failed", {
      error: err,
      context: {
        userId: req.user?._id
      },
      req
    });

    next(err);
  }
};

// Toggle User Active/Inactive with Cascade Logic
exports.toggleActive = async (req, res, next) => {
  try {
    const { id } = req.params;
    const targetUser = await User.findById(id);
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    // Tenant scoping
    if (req.user.role !== "admin" && targetUser.tenant && req.tenantId !== targetUser.tenant.toString()) {
      return res.status(403).json({ message: "Access denied: Wrong tenant" });
    }

    // Role-based checks
    if (req.user.role === "companyAdmin" && targetUser.role !== "member") {
      return res.status(403).json({ message: "CompanyAdmin can only toggle members" });
    }
    if (req.user.role === "member") {
      const currentUser = await User.findById(req.user._id).populate({
        path: "customRoles",
        populate: { path: "permissions" },
      });
      const hasTogglePermission = currentUser.customRoles.some(role =>
        role.permissions.some(perm => perm.name === "user:toggle")
      );
      if (!hasTogglePermission || targetUser.role !== "member") {
        return res.status(403).json({ message: "Not authorized to toggle this user" });
      }
    }

    // --- Toggle ---
    targetUser.isActive = !targetUser.isActive;

    // --- Set deactivatedBy / activatedBy ---
    if (!targetUser.isActive) {
      targetUser.deactivatedBy = req.user.role;
    } else {
      targetUser.deactivatedBy = null;
    }

    await targetUser.save();

    let affectedUsers = [];

    // ============ Cascade Logic ============
    // 1. ADMIN toggles COMPANY ADMIN → affect all tenant members
    if (req.user.role === "admin" && targetUser.role === "companyAdmin") {
      if (!targetUser.isActive) {
        await User.updateMany(
          { tenant: targetUser.tenant, role: "member", isActive: true },
          { $set: { isActive: false, deactivatedBy: "admin" } }
        );
        affectedUsers = await User.find({
          tenant: targetUser.tenant,
          role: "member",
          isActive: false,
          deactivatedBy: "admin",
        }).select("_id isActive");
      } else {
        await User.updateMany(
          { tenant: targetUser.tenant, role: "member", deleted: false, deactivatedBy: "admin" },
          { $set: { isActive: true, deactivatedBy: null } }
        );
        affectedUsers = await User.find({
          tenant: targetUser.tenant,
          role: "member",
          isActive: true,
          deleted: false,
        }).select("_id isActive");
      }
    }

    // 2. COMPANY ADMIN toggles a MEMBER
    if (req.user.role === "companyAdmin" && targetUser.role === "member") {
      targetUser.deactivatedBy = targetUser.isActive ? null : "companyAdmin";
      await targetUser.save();
    }

    // ✅ Log success
    Logger.info("toggleUserActive", "User active status toggled", {
      context: {
        targetUserId: targetUser._id,
        role: targetUser.role,
        isActive: targetUser.isActive,
        affectedUsers: affectedUsers.map(u => ({
          _id: u._id,
          isActive: u.isActive
        }))
      },
      req
    });

    res.status(200).json({
      message: `User ${targetUser.isActive ? "activated" : "deactivated"} successfully`,
      updatedUser: { _id: targetUser._id, isActive: targetUser.isActive },
      affectedUsers: affectedUsers.map(u => ({ _id: u._id, isActive: u.isActive })),
    });

  } catch (error) {
    console.error("❌ toggleActive error:", error);

    // 🔴 Log unexpected error
    Logger.error("toggleUserActive", "Failed to toggle user active status", {
      error,
      context: {
        userId: req.user?._id
      },
      req
    });

    next(error);
  }
};

// Get All Users with Search, Filter, Pagination, and Role-Based Access
exports.getAllUsers = async (req, res, next) => {
  try {
    Logger.info("getAllUsers", "Fetching all users", {
      context: {
        userId: req.user?._id,
        tenantId: req.tenantId,
        query: req.query
      },
      req
    });

    const { error, value } = getAllUsersSchema.validate(req.query);
    if (error) {
      Logger.warn("getAllUsers", "Validation failed", {
        context: {
          error: error.details[0].message,
          userId: req.user?._id
        },
        req
      });
      return res.status(400).json({ message: error.details[0].message });
    }

    const { page, limit, search, sort, role, active } = value;

    const query = { deleted: false };

    // 🔍 Search
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
      Logger.info("getAllUsers", "Applied search filter", {
        context: {
          search
        },
        req
      });
    }

    // 🎭 Role filter
    if (role) {
      query.role = role;
      Logger.info("getAllUsers", "Applied role filter", {
        context: {
          role
        },
        req
      });
    }

    // ✅ Active/Inactive filter
    if (active === "true") query.isActive = true;
    else if (active === "false") query.isActive = false;

    // 🏢 Tenant scoping and role restrictions
    if (req.user.role.toLowerCase() !== "admin") {
      if (req.tenantId) {
        query.tenant = req.tenantId;
        query.role = { $ne: "admin" };
        if (req.user.role.toLowerCase() === "member") {
          query.role = { $nin: ["admin", "companyAdmin"] };
        }
        Logger.info("getAllUsers", "Tenant scoping applied for non-admin", {
          context: {
            tenantId: req.tenantId,
            role: req.user.role
          },
          req
        });
      } else {
        Logger.warn("getAllUsers", "Access denied for non-admin user without tenant", {
          context: {
            userId: req.user?._id
          },
          req
        });
        return res.status(403).json({
          message: "Access denied: No tenant associated with this user",
        });
      }
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select("-password")
      .populate("tenant customRoles department")
      .sort({ [sort]: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    Logger.info("getAllUsers", "Users fetched successfully", {
      context: {
        total,
        page,
        limit,
        userId: req.user?._id
      },
      req
    });

    res.status(200).json({
      total,
      totalPages: Math.ceil(total / limit),
      page: parseInt(page),
      limit: parseInt(limit),
      users,
    });
  } catch (err) {
    Logger.error("getAllUsers", "Error fetching users", {
      error: err,
      context: {
        userId: req.user?._id
      },
      req
    });
    next(err);
  }
};

/**
 * Get Tenant Users for Picker (lightweight endpoint)
 * Returns minimal user data for assignment dropdowns
 */
exports.getTenantUsersForPicker = async (req, res, next) => {
  try {
    const { search, role, limit = 50 } = req.query;

    const query = {
      deleted: false,
      isActive: true,
    };

    // Tenant scoping
    if (req.user.role !== "admin") {
      if (!req.tenantId) {
        return res.status(403).json({ message: "Access denied: No tenant" });
      }
      query.tenant = req.tenantId;
      query.role = { $ne: "admin" }; // Exclude super admins
    }

    // Optional role filter
    if (role && role !== "all") {
      query.role = role;
    }

    // Optional search
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const users = await User.find(query)
      .select("_id name email avatar role")
      .sort({ name: 1 })
      .limit(parseInt(limit))
      .lean();

    res.status(200).json({
      success: true,
      users: users.map(u => ({
        id: u._id,
        _id: u._id,
        name: u.name,
        email: u.email,
        avatar: u.avatar?.url || null,
        role: u.role,
      })),
    });
  } catch (err) {
    Logger.error("getTenantUsersForPicker", "Error fetching users for picker", {
      error: err,
      context: { userId: req.user?._id },
      req
    });
    next(err);
  }
};

// Export User Data as PDF
exports.getUserById = async (req, res, next) => {
  try {
    Logger.info("getUserById", "Fetching user by ID", {
      context: {
        requesterId: req.user?._id,
        targetUserId: req.params.id
      },
      req
    });


    const { error } = idSchema.validate(req.params);
    if (error) {
      Logger.warn("getUserById", "Validation failed", {
        context: {
          error: error.details[0].message,
          userId: req.user?._id
        },
        req
      });
      return res.status(400).json({ message: error.details[0].message });
    }

    const user = await User.findById(req.params.id)
      .select("-password")
      .populate({
        path: "tenant",
        populate: { path: "departments" }, // Populate tenant.departments
      })
      .populate("customRoles department");

    if (!user) {
      Logger.warn("getUserById", "User not found", {
        context: {
          targetUserId: req.params.id
        },
        req
      });
      return res.status(404).json({ message: "User not found" });
    }

    if (req.user.role !== "admin" && user.tenant && req.tenantId !== user.tenant._id.toString()) {
      Logger.warn("getUserById", "Access denied due to tenant mismatch", {
        context: {
          userId: req.user?._id,
          targetUserId: req.params.id
        },
        req
      });
      return res.status(403).json({ message: "Access denied: Wrong tenant" });
    }

    Logger.info("getUserById", "User fetched successfully", {
      context: {
        requesterId: req.user?._id,
        targetUserId: req.params.id
      },
      req
    });
    res.status(200).json({ success: true, user });

  } catch (err) {
    Logger.error("getUserById", "Error fetching user", {
      error: err,
      context: {
        userId: req.user?._id
      },
      req
    });
    next(err);
  }
};

// PDF Export
exports.exportUserDataPDF = async (req, res, next) => {
  try {
    Logger.info("exportUserDataPDF", "Starting user PDF export", {
      context: {
        requesterId: req.user?._id,
        targetUserId: req.params.id
      },
      req
    });

    const { error } = idSchema.validate(req.params);
    if (error) {
      Logger.warn("exportUserDataPDF", "Validation failed", {
        context: {
          error: error.details[0].message,
          requesterId: req.user?._id
        },
        req
      });
      return res.status(400).json({ message: error.details[0].message });
    }

    const user = await User.findById(req.params.id)
      .select("-password")
      .populate("department")
      .populate({
        path: "tenant",
        populate: {
          path: "departments",
          model: "Department",
          select: "name"
        }
      });

    if (!user) {
      Logger.warn("exportUserDataPDF", "User not found for PDF export", {
        context: {
          targetUserId: req.params.id,
          requesterId: req.user?._id
        },
        req
      });
      return res.status(404).json({ message: "User not found" });
    }

    // --- Role based export restrictions ---
    if (req.user.role === "member") {
      const populatedUser = await User.findById(req.user._id).populate({
        path: "customRoles",
        populate: { path: "permissions" },
      });

      const hasPermission = populatedUser?.customRoles?.some((role) =>
        role.permissions.some((p) => p.name === "user:export")
      );

      if (!hasPermission) {
        Logger.warn("exportUserDataPDF", "Member attempted PDF export without permission", {
          context: {
            requesterId: req.user._id
          },
          req
        });
        return res.status(403).json({ message: "Access denied: Permission 'user:export' required" });
      }

      if (user.tenant && user.tenant._id.toString() !== req.user.tenant._id.toString()) {
        Logger.warn("exportUserDataPDF", "Member attempted PDF export for a different tenant", {
          context: {
            requesterId: req.user._id,
            targetTenantId: user.tenant._id
          },
          req
        });
        return res.status(403).json({ message: "Access denied: Cannot export users from a different tenant" });
      }
    } else if (req.user.role === "companyAdmin") {
      if (user.tenant && req.tenantId !== user.tenant._id.toString()) {
        Logger.warn("exportUserDataPDF", "CompanyAdmin attempted PDF export for wrong tenant", {
          context: {
            requesterId: req.user._id,
            targetTenantId: user.tenant._id
          },
          req
        });
        return res.status(403).json({ message: "Access denied: Wrong tenant" });
      }
    } else if (req.user.role !== "admin") {
      Logger.warn("exportUserDataPDF", "Unauthorized role attempted PDF export", {
        context: {
          requesterId: req.user._id,
          role: req.user.role
        },
        req
      });
      return res.status(403).json({ message: "Access denied: Insufficient permissions" });
    }

    Logger.info("exportUserDataPDF", "Generating PDF for user", {
      context: {
        targetUserId: user._id,
        requesterId: req.user._id
      },
      req
    });

    const doc = new PDFDocument({ margin: 50 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="user-${user._id}.pdf"`);

    doc.pipe(res);

    const logoUrl = "https://ratepro-sa.com/assets/img/RATEPRO_-BupZjzpX.png";
    const response = await axios.get(logoUrl, { responseType: "arraybuffer" });
    const logoBuffer = Buffer.from(response.data, "binary");

    doc.rect(0, 0, doc.page.width, 80).fill("#b6ebe0");
    doc.image(logoBuffer, 30, 20, { width: 50 });
    doc.fillColor("#13c5d0")
      .fontSize(26)
      .text("User Data Report", 0, 40, { align: "center" });

    doc.moveDown(2);

    const sectionBox = (title, draw) => {
      doc.moveDown(1);
      const startY = doc.y;
      const paddingY = 15;
      doc.rect(40, startY - 10, doc.page.width - 80, 150).fill("#b6ebe0").stroke();
      doc.fillColor("#13c5d0").fontSize(16).text(title, 50, startY, { underline: true });
      doc.moveDown(0.5);
      doc.fillColor("black").fontSize(12);
      draw(startY + 20 + paddingY);
    };

    sectionBox("User Information", (y) => {
      doc.text(`Name: ${user.name}`, 60, y);
      doc.text(`Email: ${user.email}`);
      doc.text(`Role: ${user.role}`);
      doc.text(`Active: ${user.isActive}`);
      doc.text(`Verified: ${user.isVerified}`);
      doc.text(`Department: ${user.department?.name || "N/A"}`);
    });

    if (user.tenant) {
      sectionBox("Company Information", (y) => {
        doc.text(`Company Name: ${user.tenant.name || "N/A"}`, 60, y);
        doc.text(`Company Email: ${user.tenant.email || "N/A"}`);
        doc.text(
          `Departments: ${user.tenant.departments?.length > 0
            ? user.tenant.departments.map((d) => d.name || "N/A").join(", ")
            : "None"}`
        );
      });
    }

    const stats = user.surveyStats || {};
    sectionBox("Survey Statistics", (y) => {
      doc.text(`Total Surveys Taken: ${stats.totalSurveysTaken || 0}`, 60, y);
      doc.text(`Total Responses: ${stats.totalResponses || 0}`);
      doc.text(`Average Score: ${stats.averageScore || 0}`);
    });

    doc.end();
    Logger.info("exportUserDataPDF", "PDF generated successfully", {
      context: {
        requesterId: req.user._id,
        targetUserId: user._id
      },
      req
    });


  } catch (err) {
    Logger.error("exportUserDataPDF", "PDF export failed", {
      error: err,
      context: {
        requesterId: req.user?._id
      },
      req
    });
    next(err);
  }
};

// send notification email to user
exports.sendNotification = async (req, res, next) => {
  const functionName = 'sendNotification';

  try {
    // 🧩 Step 1: Request validation (body + params dono check)
    const { error: bodyError } = notificationSchema.validate(req.body);
    const { error: paramError } = idSchema.validate(req.params);

    if (bodyError || paramError) {
      // ⚠️ Agar validation fail ho jaye to warning log karo aur 400 bhej do
      Logger.warn("sendNotification", "Invalid request for sendNotification", {
        error: (bodyError || paramError).details[0].message,
        context: {
          requesterId: req.user?._id
        },
        req
      });
      return res.status(400).json({
        message: (bodyError || paramError).details[0].message
      });
    }

    // 🧠 Step 2: Extract fields from request
    const { subject, message } = req.body;
    const user = await User.findById(req.params.id);

    // ❌ Step 3: Check agar user exist nahi karta
    if (!user) {
      Logger.warn("sendNotification", "User not found in sendNotification", {
        context: {
          userId: req.params.id
        },
        req
      });
      return res.status(404).json({ message: "User not found" });
    }

    // 🔒 Step 4: Tenant level access control check
    // sirf admin ya same-tenant user hi doosre tenant ko message bhej sakta hai
    if (req.user.role !== "admin" && user.tenant && req.tenantId !== user.tenant.toString()) {
      Logger.warn("sendNotification", "Access denied due to tenant mismatch", {
        context: {
          requesterId: req.user._id,
          userTenant: user.tenant
        },
        req
      });
      return res.status(403).json({ message: "Access denied: Wrong tenant" });
    }

    // ✉️ Step 5: Try sending email using predefined template
    try {
      const template = await EmailTemplate.findOne({ type: "custom_notification", isActive: true });
      if (!template) throw new Error("Email template not found");

      // Auto-map variables safely
      const templateData = {};
      template.variables.forEach((v) => {
        switch (v) {
          case "userName": templateData[v] = user.name; break;
          case "userEmail": templateData[v] = user.email; break;
          case "notificationSubject": templateData[v] = subject; break;
          case "notificationMessage": templateData[v] = message; break;
          case "companyName": templateData[v] = "RatePro"; break;
          case "currentYear": templateData[v] = new Date().getFullYear(); break;
          default: templateData[v] = ""; // Safe fallback
        }
      });

      sendEmail({
        to: user.email,
        subject,
        templateType: template.type,
        templateData
      });

      Logger.info(functionName, "Notification email sent using template", {
        context: {
          userId: req.user?._id,
          targetUserId: req.params.id,
          userEmail: user.email,
          subject,
          templateType: "custom_notification"
        },
        req
      });

    } catch (templateError) {
      // 🔁 Step 6: Agar template fail ho jaye to fallback simple email se
      Logger.warn(functionName, "Template email failed, using fallback", {
        context: {
          userId: req.user?._id,
          targetUserId: req.params.id,
          error: templateError.message
        },
        req
      });

      sendEmail({
        to: user.email,
        subject,
        html: `<p>${message}</p>`,
      });
    }

    // ✅ Step 7: Response success
    res.status(200).json({ message: "Notification email sent" });

  } catch (err) {
    // 🧯 Step 8: Exception catch & error log
    Logger.error("sendNotification", "Failed to send notification", {
      error: err,
      req
    });
    next(err);
  }
};

// update logged in user profile
exports.updateMe = async (req, res, next) => {
  try {
    // ----------------- VALIDATION -----------------
    const { error } = updateMeSchema.validate(req.body);
    if (error) {
      Logger.warn("updateMe", "Validation failed", {
        context: {
          error: error.details[0].message,
          userId: req.user?._id
        },
        req
      });
      return res.status(400).json({ message: error.details[0].message });
    }

    // ----------------- JWT VERIFY -----------------
    const token = req.cookies?.accessToken;
    if (!token) {
      Logger.warn("updateMe", "No token provided in updateMe", {
        context: {
          userId: req.user?._id
        },
        req
      });
      return res.status(401).json({ message: "No token provided" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      Logger.warn("updateMe", "Invalid/expired token in updateMe", {
        context: {
          error: err.message,
          userId: req.user?._id
        },
        req
      });
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    const userId = decoded._id || decoded.id;

    // ----------------- FETCH USER -----------------
    const user = await User.findById(userId).populate("tenant");
    if (!user) {
      Logger.warn("updateMe", "User not found in updateMe", {
        context: {
          userId
        },
        req
      });
      return res.status(404).json({ message: "User not found" });
    }

    // ----------------- UPDATE USER FIELDS -----------------
    const fieldsToUpdate = ["name", "email", "phone", "bio", "department"];
    fieldsToUpdate.forEach((field) => {
      if (req.body[field] !== undefined) {
        user[field] = req.body[field];
      }
    });

    // ----------------- TENANT/COMPANY UPDATE -----------------
    // Company profile changes go through approval pipeline (not directly saved)
    let profileUpdatePending = false;
    if (req.body.tenant && user.role === "companyAdmin") {
      const ProfileUpdateRequest = require("../models/ProfileUpdateRequest");

      let tenant = await Tenant.findById(user.tenant?._id);
      if (!tenant) {
        Logger.warn("updateMe", "Tenant not found in updateMe", {
          context: { userId, tenantId: user.tenant?._id },
          req,
        });
        return res.status(404).json({ message: "Tenant not found" });
      }

      // Filter to only allowed fields from the submission
      const allowedFields = ProfileUpdateRequest.ALLOWED_FIELDS;
      const proposedChanges = {};
      const currentValues = {};

      for (const [field, value] of Object.entries(req.body.tenant)) {
        if (allowedFields.includes(field) && value !== undefined) {
          proposedChanges[field] = value;
          currentValues[field] = tenant[field] ?? null;
        }
      }

      if (Object.keys(proposedChanges).length > 0) {
        // Check for existing pending request
        const existingPending = await ProfileUpdateRequest.findOne({
          tenant: user.tenant._id,
          status: "pending",
        });

        if (existingPending) {
          return res.status(409).json({
            success: false,
            message: "A pending company profile update request already exists. Please wait for review.",
          });
        }

        await ProfileUpdateRequest.create({
          requestedBy: userId,
          tenant: user.tenant._id,
          proposedChanges,
          currentValues,
        });

        profileUpdatePending = true;

        // Notify system admins
        const notificationService = require("../services/notifications/notificationService");
        const adminUsers = await User.find({ role: "admin", deleted: { $ne: true } }).select("_id");
        for (const admin of adminUsers) {
          await notificationService.createNotification({
            userId: admin._id,
            tenantId: null,
            title: "Company Profile Update Request",
            message: `${user.name} from "${tenant.name}" requested company profile changes.`,
            type: "alert",
            priority: "medium",
            reference: { type: "Tenant", id: tenant._id },
            actionUrl: "/platform/profile-updates",
            source: "system",
          });
        }

        Logger.info("updateMe", "Company profile update submitted for approval", {
          context: { userId, tenantId: tenant._id, fields: Object.keys(proposedChanges) },
          req,
        });
      }
    }

    // ----------------- AVATAR UPLOAD -----------------
    if (req.file) {
      if (user.avatar?.public_id) {
        await cloudinary.uploader.destroy(user.avatar.public_id);
      }

      const uploadResult = await cloudinary.uploader.upload(req.file.path, {
        folder: "avatars",
        width: 300,
        crop: "scale",
      });

      fs.unlinkSync(req.file.path);

      user.avatar = {
        public_id: uploadResult.public_id,
        url: uploadResult.secure_url
      };
      Logger.info("updateMe", "User avatar updated", {
        context: {
          userId
        },
        req
      });
    }

    await user.save();

    // ----------------- SAFE USER OBJECT -----------------
    const safeUser = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      bio: user.bio,
      role: user.role,
      customRoles: user.customRoles,
      authProvider: user.authProvider,
      isActive: user.isActive,
      isVerified: user.isVerified,
      tenant: user.tenant,
      department: user.department,
      avatar: user.avatar,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    Logger.info("updateMe", "Profile updated successfully", {
      context: {
        userId: user._id
      },
      req
    });

    const responseMessage = profileUpdatePending
      ? "Personal profile updated. Company profile changes submitted for admin approval."
      : "Profile updated successfully";

    res.status(200).json({ message: responseMessage, user: safeUser, profileUpdatePending });
  } catch (err) {
    Logger.error("updateMe", "UpdateMe failed", {
      error: err,
      req
    });
    next(err);
  }
};
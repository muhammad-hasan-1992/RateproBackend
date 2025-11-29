// // controllers/tenantController.js
// const mongoose = require("mongoose");
// const Tenant = require('../models/Tenant');
// const User = require('../models/User');
// const Department = require('../models/Department');

// exports.updateTenant = async (req, res, next) => {
//   try {
//     const { tenantId } = req.params;
//     const { name, address, contactEmail, contactPhone, website, totalEmployees, departments } = req.body;

//     // Validate inputs
//     if (!name) {
//       console.log('updateTenant: Name required');
//       return res.status(400).json({ message: 'Company name is required' });
//     }

//     // Validate tenantId
//     if (!tenantId.match(/^[0-9a-fA-F]{24}$/)) {
//       return res.status(400).json({ message: 'Invalid tenant ID' });
//     }

//     // Check authorization
//     if (req.user.role !== 'companyAdmin') {
//       return res.status(403).json({ message: 'User is not a companyAdmin' });
//     }
//     if (!req.user.tenant || req.user.tenant._id.toString() !== tenantId) {
//       return res.status(403).json({ message: 'Unauthorized to update this tenant' });
//     }

//     // Validate and update/create departments
//     const departmentDocs = await Promise.all(
//       (departments || []).map(async (dept) => {
//         if (!dept.name) {
//           throw new Error('Department name is required');
//         }

//         const headName = dept.head || ""; // Head is string, no validation needed

//         if (dept._id) {
//           // Update existing department
//           const updatedDept = await Department.findByIdAndUpdate(
//             dept._id,
//             { name: dept.name, head: headName },
//             { new: true }
//           );
//           if (!updatedDept) {
//             throw new Error(`Department ${dept._id} not found`);
//           }
//           return updatedDept._id;
//         } else {
//           // Create new department
//           const newDept = await Department.create({
//             name: dept.name,
//             head: headName,
//             tenant: tenantId,
//           });
//           return newDept._id;
//         }
//       })
//     );

//     // Update Tenant
//     const updatedTenant = await Tenant.findByIdAndUpdate(
//       tenantId,
//       {
//         name,
//         address,
//         contactEmail,
//         contactPhone,
//         website,
//         totalEmployees: totalEmployees || 0,
//         departments: departmentDocs,
//       },
//       { new: true }
//     ).populate('departments');

//     if (!updatedTenant) {
//       return res.status(404).json({ message: 'Tenant not found' });
//     }

//     // ✅ Flag update in User
//     await User.findByIdAndUpdate(req.user._id, {
//       companyProfileUpdated: true,
//     });

//     return res.status(200).json({ success: true, tenant: updatedTenant });
//   } catch (err) {
//     console.error('updateTenant error:', { message: err.message, stack: err.stack });
//     return res.status(400).json({ message: err.message || 'Server error' });
//   }
// };

// exports.getTenant = async (req, res) => {
//   try {
//     const tenant = await Tenant.findById(req.params.id).populate('departments');
//     if (!tenant) {
//       // console.log('getTenant: Tenant not found', { tenantId: req.params.id });
//       return res.status(404).json({ message: 'Tenant not found' });
//     }
//     // console.log('getTenant: Tenant fetched', { tenant: tenant.toJSON() });
//     res.status(200).json({ success: true, tenant });
//   } catch (err) {
//     console.error('getTenant error:', { message: err.message, stack: err.stack });
//     res.status(500).json({ message: 'Server error' });
//   }
// };
// controllers/tenantController.js
const mongoose = require("mongoose");
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Department = require('../models/Department');
const Logger = require("../utils/auditLog");

// 🔹 UPDATE tenant
exports.updateTenant = async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { name, address, contactEmail, contactPhone, website, totalEmployees, departments } = req.body;

    // Validate inputs
    if (!name) {
      await Logger.warn('updateTenant: Name required', { userId: req.user?._id });
      return res.status(400).json({ message: 'Company name is required' });
    }

    // Validate tenantId
    if (!tenantId.match(/^[0-9a-fA-F]{24}$/)) {
      await Logger.warn('updateTenant: Invalid tenant ID', { tenantId, userId: req.user?._id });
      return res.status(400).json({ message: 'Invalid tenant ID' });
    }

    // Check authorization
    if (req.user.role !== 'companyAdmin') {
      await Logger.warn('updateTenant: User not companyAdmin', { userId: req.user?._id });
      return res.status(403).json({ message: 'User is not a companyAdmin' });
    }
    if (!req.user.tenant || req.user.tenant._id.toString() !== tenantId) {
      await Logger.warn('updateTenant: Unauthorized tenant update attempt', { userId: req.user?._id, tenantId });
      return res.status(403).json({ message: 'Unauthorized to update this tenant' });
    }

    // Validate and update/create departments
    const departmentDocs = await Promise.all(
      (departments || []).map(async (dept) => {
        if (!dept.name) {
          await Logger.warn('updateTenant: Department name missing', { tenantId, userId: req.user?._id });
          throw new Error('Department name is required');
        }

        const headName = dept.head || "";

        if (dept._id) {
          // Update existing department
          const updatedDept = await Department.findByIdAndUpdate(
            dept._id,
            { name: dept.name, head: headName },
            { new: true }
          );
          if (!updatedDept) {
            await Logger.warn('updateTenant: Department not found for update', { deptId: dept._id });
            throw new Error(`Department ${dept._id} not found`);
          }
          return updatedDept._id;
        } else {
          // Create new department
          const newDept = await Department.create({
            name: dept.name,
            head: headName,
            tenant: tenantId,
          });
          await Logger.info('updateTenant: Department created', { deptId: newDept._id, tenantId });
          return newDept._id;
        }
      })
    );

    // Update Tenant
    const updatedTenant = await Tenant.findByIdAndUpdate(
      tenantId,
      {
        name,
        address,
        contactEmail,
        contactPhone,
        website,
        totalEmployees: totalEmployees || 0,
        departments: departmentDocs,
      },
      { new: true }
    ).populate('departments');

    if (!updatedTenant) {
      await Logger.warn('updateTenant: Tenant not found', { tenantId });
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Flag update in User
    await User.findByIdAndUpdate(req.user._id, { companyProfileUpdated: true });

    await Logger.info('updateTenant: Tenant updated successfully', { tenantId, updatedBy: req.user._id });
    return res.status(200).json({ success: true, tenant: updatedTenant });
  } catch (err) {
    await Logger.error('updateTenant error', { message: err.message, stack: err.stack, userId: req.user?._id });
    return res.status(400).json({ message: err.message || 'Server error' });
  }
};


// 🔹 READ tenant by ID
exports.getTenant = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id).populate('departments');
    if (!tenant) {
      await Logger.warn('getTenant: Tenant not found', { tenantId: req.params.id });
      return res.status(404).json({ message: 'Tenant not found' });
    }

    await Logger.info('getTenant: Tenant fetched successfully', { tenantId: tenant._id, fetchedBy: req.user?._id });
    res.status(200).json({ success: true, tenant });
  } catch (err) {
    await Logger.error('getTenant error', { message: err.message, stack: err.stack, tenantId: req.params.id, userId: req.user?._id });
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getMyTenant = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.user.tenant)
      .populate('plan', 'name description features limits');

    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }

    res.json({
      success: true,
      tenant: {
        _id: tenant._id,
        name: tenant.name,
        plan: tenant.plan,
        features: tenant.features || {},
        limits: tenant.limits || {},
        usage: tenant.usage || {}
      }
    });
  } catch (err) {
    console.error("getMyTenant error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateMyPlan = async (req, res) => {
  const { planId } = req.body;
  const plan = await Plan.findById(planId);
  if (!plan) return res.status(404).json({ message: "Plan not found" });

  const updated = await Tenant.findByIdAndUpdate(
    req.user.tenant,
    {
      plan: planId,
      features: plan.features,
      limits: plan.limits
    },
    { new: true }
  ).populate('plan');

  res.json({ success: true, tenant: updated });
};
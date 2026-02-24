// controllers/survey/getTenantMembers.controller.js
// ============================================================================
// Get Tenant Members — Provides data for "Assign Responsible User" dropdown
//
// Returns active companyAdmin/member users within the requesting user's tenant.
// Only accessible by companyAdmin with survey:create permission.
// ============================================================================

const User = require("../../models/User");

module.exports = async function getTenantMembers(req, res, next) {
    try {
        const members = await User.find({
            tenant: req.user.tenant,
            isActive: true,
            deleted: false,
            role: { $in: ["companyAdmin", "member"] }
        })
            .select("_id name email role department")
            .sort({ name: 1 })
            .lean();

        res.json({
            message: "Tenant members retrieved",
            members,
            total: members.length
        });

    } catch (err) {
        next(err);
    }
};

/**
 * Platform Dashboard Controller
 * 
 * Provides platform-wide statistics for System Administrators.
 * This data is NOT tenant-filtered - it shows all companies, users, and surveys.
 * 
 * Access: System Admin only (role === 'admin')
 */

const asyncHandler = require("express-async-handler");
const Tenant = require("../models/Tenant");
const User = require("../models/User");
const Survey = require("../models/Survey");
const Logger = require("../utils/logger");

/**
 * Middleware to check if user is System Admin
 */
const requireSystemAdmin = (req, res, next) => {
    if (req.user?.role !== "admin") {
        return res.status(403).json({
            success: false,
            message: "Access denied. System Admin privileges required."
        });
    }
    next();
};

/**
 * GET /api/platform/dashboard
 * Get platform-wide statistics for System Admin
 * Access: System Admin only
 */
const getPlatformDashboard = asyncHandler(async (req, res) => {
    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // ============================================
        // AGGREGATE PLATFORM STATISTICS
        // ============================================

        // Total counts
        const [
            totalTenants,
            totalUsers,
            totalSurveys,
            activeTenants,
            activeUsers,
            activeSurveys
        ] = await Promise.all([
            Tenant.countDocuments({ status: { $ne: "deleted" } }),
            User.countDocuments({ deleted: { $ne: true } }),
            Survey.countDocuments({ status: { $ne: "deleted" } }),
            Tenant.countDocuments({ status: "active" }),
            User.countDocuments({ status: "active", deleted: { $ne: true } }),
            Survey.countDocuments({ status: "active" })
        ]);

        // New registrations (last 30 days)
        const [
            newTenantsThisMonth,
            newUsersThisMonth,
            newSurveysThisMonth
        ] = await Promise.all([
            Tenant.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
            User.countDocuments({ createdAt: { $gte: thirtyDaysAgo }, deleted: { $ne: true } }),
            Survey.countDocuments({ createdAt: { $gte: thirtyDaysAgo } })
        ]);

        // ============================================
        // SUBSCRIPTION BREAKDOWN
        // ============================================
        const subscriptionBreakdown = await Tenant.aggregate([
            { $match: { status: { $ne: "deleted" } } },
            {
                $lookup: {
                    from: "plans",
                    localField: "plan",
                    foreignField: "_id",
                    as: "planDetails"
                }
            },
            { $unwind: { path: "$planDetails", preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: "$planDetails.name",
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]);

        // Format subscription data for chart
        const subscriptionData = subscriptionBreakdown.map(item => ({
            plan: item._id || "No Plan",
            count: item.count
        }));

        // ============================================
        // RECENT TENANT REGISTRATIONS (Last 10)
        // ============================================
        const recentTenants = await Tenant.find({ status: { $ne: "deleted" } })
            .sort({ createdAt: -1 })
            .limit(10)
            .select("name industry status createdAt")
            .populate("plan", "name")
            .lean();

        const formattedRecentTenants = recentTenants.map(tenant => ({
            id: tenant._id,
            name: tenant.name,
            industry: tenant.industry || "Not specified",
            plan: tenant.plan?.name || "No Plan",
            status: tenant.status,
            registeredAt: tenant.createdAt
        }));

        // ============================================
        // GROWTH TRENDS (Last 7 days)
        // ============================================
        const growthLabels = [];
        const tenantGrowth = [];
        const userGrowth = [];

        for (let i = 6; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateStr = date.toLocaleDateString("en-US", { weekday: "short" });
            growthLabels.push(dateStr);

            const dayStart = new Date(date);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(date);
            dayEnd.setHours(23, 59, 59, 999);

            const [tenantsOnDay, usersOnDay] = await Promise.all([
                Tenant.countDocuments({
                    createdAt: { $gte: dayStart, $lte: dayEnd },
                    status: { $ne: "deleted" }
                }),
                User.countDocuments({
                    createdAt: { $gte: dayStart, $lte: dayEnd },
                    deleted: { $ne: true }
                })
            ]);

            tenantGrowth.push(tenantsOnDay);
            userGrowth.push(usersOnDay);
        }

        // ============================================
        // RESPONSE
        // ============================================
        return res.status(200).json({
            success: true,
            data: {
                // Summary stats
                stats: {
                    totalTenants,
                    totalUsers,
                    totalSurveys,
                    activeTenants,
                    activeUsers,
                    activeSurveys,
                    newTenantsThisMonth,
                    newUsersThisMonth,
                    newSurveysThisMonth
                },
                // Subscription breakdown for chart
                subscriptions: subscriptionData,
                // Recent registrations
                recentTenants: formattedRecentTenants,
                // Growth trends for chart
                trends: {
                    labels: growthLabels,
                    tenants: tenantGrowth,
                    users: userGrowth
                },
                generatedAt: now
            }
        });

    } catch (error) {
        Logger.error("getPlatformDashboard", "Error fetching platform dashboard", {
            error,
            userId: req.user?._id
        });

        return res.status(500).json({
            success: false,
            message: "Failed to fetch platform dashboard data",
            error: error.message
        });
    }
});

module.exports = {
    requireSystemAdmin,
    getPlatformDashboard
};

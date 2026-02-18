// services/analytics/dashboardService.js
const Survey = require("../../models/Survey");
const SurveyResponse = require("../../models/SurveyResponse");
const Action = require("../../models/Action");
const mongoose = require("mongoose");
const Logger = require("../../utils/logger");
const trendService = require("./trendService");

/**
 * Calculate Customer Satisfaction Index (CSI) with breakdown by location and service
 * Uses direct tenant filtering on SurveyResponse — no intermediate Survey.find() needed
 */
exports.calculateCustomerSatisfactionIndex = async (tenantId, startDate) => {
    try {
        const tenantOid = new mongoose.Types.ObjectId(tenantId);

        // Calculate overall satisfaction for current period — direct tenant scoping
        const satisfactionAgg = await SurveyResponse.aggregate([
            {
                $match: {
                    tenant: tenantOid,
                    createdAt: { $gte: startDate },
                    $or: [
                        { rating: { $exists: true, $ne: null } },
                        { score: { $exists: true, $ne: null } }
                    ]
                }
            },
            {
                $group: {
                    _id: null,
                    avgRating: { $avg: "$rating" },
                    avgScore: { $avg: "$score" },
                    totalResponses: { $sum: 1 }
                }
            }
        ]);

        const overall = satisfactionAgg.length > 0
            ? (satisfactionAgg[0].avgRating || (satisfactionAgg[0].avgScore / 2)) || 0
            : 0;

        // Calculate previous period for trend comparison
        const periodDays = Math.round((new Date() - startDate) / (1000 * 60 * 60 * 24));
        const previousStart = new Date(startDate);
        previousStart.setDate(previousStart.getDate() - periodDays);

        const previousAgg = await SurveyResponse.aggregate([
            {
                $match: {
                    tenant: tenantOid,
                    createdAt: { $gte: previousStart, $lt: startDate },
                    $or: [
                        { rating: { $exists: true, $ne: null } },
                        { score: { $exists: true, $ne: null } }
                    ]
                }
            },
            {
                $group: {
                    _id: null,
                    avgRating: { $avg: "$rating" },
                    avgScore: { $avg: "$score" }
                }
            }
        ]);

        const previousOverall = previousAgg.length > 0
            ? (previousAgg[0].avgRating || (previousAgg[0].avgScore / 2)) || 0
            : 0;

        // Calculate trend as difference between current and previous period
        const trend = previousOverall > 0
            ? Number(((overall - previousOverall) / previousOverall * 100).toFixed(1))
            : 0;

        // Aggregate CSI by location from metadata.location field
        const locationAgg = await SurveyResponse.aggregate([
            {
                $match: {
                    tenant: tenantOid,
                    createdAt: { $gte: startDate },
                    "metadata.location": { $exists: true, $ne: null }
                }
            },
            {
                $group: {
                    _id: "$metadata.location",
                    avgRating: { $avg: "$rating" },
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        const locations = locationAgg.map(loc => ({
            name: loc._id || "Unknown",
            score: Number((loc.avgRating || 0).toFixed(1)),
            responses: loc.count
        }));

        // Services require service tagging - returning empty until implemented
        const services = [];

        return {
            overall: Number(overall.toFixed(1)),
            trend,
            locations,
            services
        };
    } catch (error) {
        Logger.error("calculateCustomerSatisfactionIndex", "Error calculating CSI", {
            error,
            context: { tenantId, startDate }
        });
        return { overall: 0, trend: 0, locations: [], services: [] };
    }
};

/**
 * Calculate NPS Score from survey responses
 * Uses direct tenant filtering — no intermediate Survey.find() needed
 */
exports.calculateNPSScore = async (tenantId, startDate) => {
    try {
        const tenantOid = new mongoose.Types.ObjectId(tenantId);

        // Calculate NPS for current period — direct tenant scoping
        const npsResponses = await SurveyResponse.aggregate([
            {
                $match: {
                    tenant: tenantOid,
                    createdAt: { $gte: startDate },
                    score: { $exists: true, $gte: 0, $lte: 10 }
                }
            },
            {
                $group: {
                    _id: null,
                    promoters: { $sum: { $cond: [{ $gte: ["$score", 9] }, 1, 0] } },
                    passives: {
                        $sum: {
                            $cond: [
                                { $and: [{ $gte: ["$score", 7] }, { $lt: ["$score", 9] }] },
                                1,
                                0
                            ]
                        }
                    },
                    detractors: { $sum: { $cond: [{ $lt: ["$score", 7] }, 1, 0] } },
                    total: { $sum: 1 }
                }
            }
        ]);

        if (npsResponses.length === 0) {
            return {
                current: 0,
                trend: 0,
                promoters: 0,
                detractors: 0,
                passives: 0
            };
        }

        const { promoters, passives, detractors, total } = npsResponses[0];
        const npsScore = Math.round(((promoters - detractors) / total) * 100);

        // Calculate previous period for trend
        const periodDays = Math.round((new Date() - startDate) / (1000 * 60 * 60 * 24));
        const previousStart = new Date(startDate);
        previousStart.setDate(previousStart.getDate() - periodDays);

        const previousNps = await SurveyResponse.aggregate([
            {
                $match: {
                    tenant: tenantOid,
                    createdAt: { $gte: previousStart, $lt: startDate },
                    score: { $exists: true, $gte: 0, $lte: 10 }
                }
            },
            {
                $group: {
                    _id: null,
                    promoters: { $sum: { $cond: [{ $gte: ["$score", 9] }, 1, 0] } },
                    detractors: { $sum: { $cond: [{ $lt: ["$score", 7] }, 1, 0] } },
                    total: { $sum: 1 }
                }
            }
        ]);

        let trend = 0;
        if (previousNps.length > 0 && previousNps[0].total > 0) {
            const prevNpsScore = Math.round(
                ((previousNps[0].promoters - previousNps[0].detractors) / previousNps[0].total) * 100
            );
            trend = npsScore - prevNpsScore;
        }

        return {
            current: npsScore,
            trend,
            promoters,
            passives,
            detractors
        };
    } catch (error) {
        Logger.error("calculateNPSScore", "Error calculating NPS", {
            error,
            context: { tenantId, startDate }
        });
        return { current: 0, trend: 0, promoters: 0, detractors: 0, passives: 0 };
    }
};

/**
 * Calculate Response Rate for surveys
 * Uses period-over-period SurveyResponse aggregation for real trend data.
 * Note: rate is 0 because view/open tracking is not yet implemented.
 */
exports.calculateResponseRate = async (tenantId, startDate) => {
    try {
        // Current period response count
        const currentResponses = await SurveyResponse.countDocuments({
            tenant: tenantId,
            createdAt: { $gte: startDate }
        });

        // Total surveys for context
        const totalSurveys = await Survey.countDocuments({ tenant: tenantId });

        // Previous period for trend calculation
        const periodDays = Math.round((new Date() - startDate) / (1000 * 60 * 60 * 24));
        const previousStart = new Date(startDate);
        previousStart.setDate(previousStart.getDate() - periodDays);

        const previousResponses = await SurveyResponse.countDocuments({
            tenant: tenantId,
            createdAt: { $gte: previousStart, $lt: startDate }
        });

        const trend = previousResponses > 0
            ? Number(((currentResponses - previousResponses) / previousResponses * 100).toFixed(1))
            : 0;

        return {
            rate: 0,  // No view tracking — honest zero until implemented
            trend,
            surveysSent: totalSurveys,
            completed: currentResponses
        };
    } catch (error) {
        Logger.error("calculateResponseRate", "Error calculating response rate", {
            error,
            context: { tenantId, startDate }
        });
        return { rate: 0, trend: 0, surveysSent: 0, completed: 0 };
    }
};

/**
 * Calculate Alert Counts by priority
 */
exports.calculateAlertCounts = async (tenantId) => {
    try {
        const actionCounts = await Action.aggregate([
            { $match: { tenant: new mongoose.Types.ObjectId(tenantId), status: { $ne: "resolved" } } },
            { $group: { _id: "$priority", count: { $sum: 1 } } }
        ]);

        const counts = { critical: 0, warning: 0, info: 0 };
        actionCounts.forEach((item) => {
            if (item._id === "high") counts.critical = item.count;
            else if (item._id === "medium") counts.warning = item.count;
            else if (item._id === "low") counts.info = item.count;
        });

        return counts;
    } catch (error) {
        Logger.error("calculateAlertCounts", "Error calculating alert counts", {
            error,
            context: { tenantId }
        });
        return { critical: 0, warning: 0, info: 0 };
    }
};

/**
 * Calculate SLA Metrics using aggregation pipeline
 * Replaces in-memory filtering for scalability
 */
exports.calculateSLAMetrics = async (tenantId, startDate) => {
    try {
        const now = new Date();

        const slaAgg = await Action.aggregate([
            { $match: { tenant: new mongoose.Types.ObjectId(tenantId), createdAt: { $gte: startDate } } },
            {
                $facet: {
                    overdue: [
                        { $match: { dueDate: { $lt: now }, status: { $ne: "resolved" } } },
                        { $count: "count" }
                    ],
                    resolved: [
                        { $match: { status: "resolved" } },
                        {
                            $project: {
                                resolutionMs: {
                                    $subtract: [
                                        { $ifNull: ["$completedAt", "$updatedAt"] },
                                        "$createdAt"
                                    ]
                                },
                                onTime: {
                                    $cond: [
                                        {
                                            $or: [
                                                { $eq: ["$dueDate", null] },
                                                { $lte: [{ $ifNull: ["$completedAt", "$updatedAt"] }, "$dueDate"] }
                                            ]
                                        },
                                        1, 0
                                    ]
                                }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                avgResolutionMs: { $avg: "$resolutionMs" },
                                onTimeCount: { $sum: "$onTime" },
                                totalResolved: { $sum: 1 }
                            }
                        }
                    ]
                }
            }
        ]);

        const overdueCount = slaAgg[0]?.overdue[0]?.count || 0;
        const resolvedData = slaAgg[0]?.resolved[0];

        let averageResponseTime = "N/A";
        let onTimeResolution = 0;

        if (resolvedData && resolvedData.totalResolved > 0) {
            onTimeResolution = Math.round((resolvedData.onTimeCount / resolvedData.totalResolved) * 100);

            const avgHours = (resolvedData.avgResolutionMs || 0) / (1000 * 60 * 60);
            if (avgHours < 1) {
                averageResponseTime = `${Math.round(avgHours * 60)} mins`;
            } else if (avgHours < 24) {
                averageResponseTime = `${avgHours.toFixed(1)} hours`;
            } else {
                averageResponseTime = `${(avgHours / 24).toFixed(1)} days`;
            }
        }

        return {
            averageResponseTime,
            onTimeResolution,
            overdueActions: overdueCount
        };
    } catch (error) {
        Logger.error("calculateSLAMetrics", "Error calculating SLA metrics", {
            error,
            context: { tenantId }
        });
        return { averageResponseTime: "N/A", onTimeResolution: 0, overdueActions: 0 };
    }
};

/**
 * Get Top Complaints categories from AI-analyzed response themes
 * Uses direct tenant filtering — no intermediate Survey.find() needed
 */
exports.getTopComplaints = async (tenantId, startDate) => {
    try {
        const tenantOid = new mongoose.Types.ObjectId(tenantId);

        // Get previous period for trend calculation
        const periodDays = Math.round((new Date() - startDate) / (1000 * 60 * 60 * 24));
        const previousStart = new Date(startDate);
        previousStart.setDate(previousStart.getDate() - periodDays);

        // Aggregate themes from responses marked as complaints — direct tenant scoping
        const complaintThemes = await SurveyResponse.aggregate([
            {
                $match: {
                    tenant: tenantOid,
                    createdAt: { $gte: startDate },
                    "analysis.classification.isComplaint": true
                }
            },
            { $unwind: { path: "$analysis.themes", preserveNullAndEmptyArrays: false } },
            {
                $group: {
                    _id: "$analysis.themes",
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]);

        // Get previous period counts for trend
        const previousComplaints = await SurveyResponse.aggregate([
            {
                $match: {
                    tenant: tenantOid,
                    createdAt: { $gte: previousStart, $lt: startDate },
                    "analysis.classification.isComplaint": true
                }
            },
            { $unwind: { path: "$analysis.themes", preserveNullAndEmptyArrays: false } },
            {
                $group: {
                    _id: "$analysis.themes",
                    count: { $sum: 1 }
                }
            }
        ]);

        const previousCounts = {};
        previousComplaints.forEach(p => { previousCounts[p._id] = p.count; });

        return complaintThemes.map(theme => {
            const prevCount = previousCounts[theme._id] || 0;
            let trend = 'stable';
            if (theme.count > prevCount) trend = 'up';
            else if (theme.count < prevCount) trend = 'down';

            return {
                category: theme._id || 'Uncategorized',
                count: theme.count,
                trend
            };
        });
    } catch (error) {
        Logger.error("getTopComplaints", "Error getting top complaints", { error, context: { tenantId } });
        return [];
    }
};

/**
 * Get Top Praises categories from AI-analyzed response themes
 * Uses direct tenant filtering — no intermediate Survey.find() needed
 */
exports.getTopPraises = async (tenantId, startDate) => {
    try {
        const tenantOid = new mongoose.Types.ObjectId(tenantId);

        // Get previous period for trend calculation
        const periodDays = Math.round((new Date() - startDate) / (1000 * 60 * 60 * 24));
        const previousStart = new Date(startDate);
        previousStart.setDate(previousStart.getDate() - periodDays);

        // Aggregate themes from responses marked as praises — direct tenant scoping
        const praiseThemes = await SurveyResponse.aggregate([
            {
                $match: {
                    tenant: tenantOid,
                    createdAt: { $gte: startDate },
                    "analysis.classification.isPraise": true
                }
            },
            { $unwind: { path: "$analysis.themes", preserveNullAndEmptyArrays: false } },
            {
                $group: {
                    _id: "$analysis.themes",
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]);

        // Get previous period counts for trend
        const previousPraises = await SurveyResponse.aggregate([
            {
                $match: {
                    tenant: tenantOid,
                    createdAt: { $gte: previousStart, $lt: startDate },
                    "analysis.classification.isPraise": true
                }
            },
            { $unwind: { path: "$analysis.themes", preserveNullAndEmptyArrays: false } },
            {
                $group: {
                    _id: "$analysis.themes",
                    count: { $sum: 1 }
                }
            }
        ]);

        const previousCounts = {};
        previousPraises.forEach(p => { previousCounts[p._id] = p.count; });

        return praiseThemes.map(theme => {
            const prevCount = previousCounts[theme._id] || 0;
            let trend = 'stable';
            if (theme.count > prevCount) trend = 'up';
            else if (theme.count < prevCount) trend = 'down';

            return {
                category: theme._id || 'Uncategorized',
                count: theme.count,
                trend
            };
        });
    } catch (error) {
        Logger.error("getTopPraises", "Error getting top praises", { error, context: { tenantId } });
        return [];
    }
};

/**
 * Get Satisfaction Trend data - delegates to trendService for real data
 */
exports.getSatisfactionTrend = async (tenantId, startDate, days) => {
    try {
        const trend = await trendService.getSatisfactionTrend(tenantId, { days });

        // Transform to expected format for dashboard
        return {
            labels: trend.trend.map(t => {
                const date = new Date(t.date);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }),
            values: trend.trend.map(t => t.avgRating || 0)
        };
    } catch (error) {
        Logger.error("getSatisfactionTrend", "Error getting satisfaction trend", { error });
        return { labels: [], values: [] };
    }
};

/**
 * Get Volume Trend data - delegates to trendService for real data
 */
exports.getVolumeTrend = async (tenantId, startDate, days) => {
    try {
        const trend = await trendService.getVolumeTrend(tenantId, { days });

        // Transform to expected weekly format for dashboard
        // Group by week if we have enough data points
        const weeklyData = [];
        const weekSize = Math.ceil(trend.trend.length / 4) || 1;

        for (let i = 0; i < 4; i++) {
            const weekResponses = trend.trend.slice(i * weekSize, (i + 1) * weekSize);
            const totalCount = weekResponses.reduce((sum, t) => sum + (t.count || 0), 0);
            weeklyData.push({
                label: `Week ${i + 1}`,
                surveys: 0, // Not available from volume data — requires separate query
                responses: totalCount
            });
        }

        return {
            labels: weeklyData.map(w => w.label),
            surveys: weeklyData.map(w => w.surveys),
            responses: weeklyData.map(w => w.responses)
        };
    } catch (error) {
        Logger.error("getVolumeTrend", "Error getting volume trend", { error });
        return { labels: [], surveys: [], responses: [] };
    }
};

/**
 * Generate Smart Alerts from recent actions and responses
 */
exports.generateSmartAlerts = async (actions, responses, tenantId) => {
    const alerts = [];

    const highPriorityActions = actions.filter(a => a.priority === 'high');
    if (highPriorityActions.length > 0) {
        alerts.push({
            id: 'high-priority-' + Date.now(),
            type: 'critical',
            title: 'High Priority Actions Detected',
            message: `${highPriorityActions.length} high priority actions require immediate attention`,
            timestamp: new Date(),
            action: 'Review and assign urgent actions to appropriate teams'
        });
    }

    const lowRatingResponses = responses.filter(r => r.rating && r.rating <= 2);
    if (lowRatingResponses.length >= 3) {
        alerts.push({
            id: 'low-satisfaction-' + Date.now(),
            type: 'warning',
            title: 'Satisfaction Drop Detected',
            message: `${lowRatingResponses.length} responses with ratings ≤ 2 stars in the last 24 hours`,
            timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
            action: 'Investigate service quality and address customer concerns'
        });
    }

    if (responses.length > 20) {
        alerts.push({
            id: 'volume-spike-' + Date.now(),
            type: 'info',
            title: 'High Response Volume',
            message: `Received ${responses.length} survey responses in the last 24 hours`,
            timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000),
            action: 'Monitor for patterns and prepare for increased feedback processing'
        });
    }

    return alerts;
};

/**
 * Get survey stats by ID
 */
exports.getSurveyStatsService = async (surveyId) => {
    const totalResponses = await SurveyResponse.countDocuments({ survey: surveyId });
    return { surveyId, totalResponses };
};

/**
 * Get tenant-wide stats
 */
exports.getTenantStatsService = async (tenantId) => {
    const surveys = await Survey.find({ tenant: tenantId }).select("_id");
    const surveyIds = surveys.map((s) => s._id);
    const totalSurveys = surveys.length;
    const totalResponses = await SurveyResponse.countDocuments({ survey: { $in: surveyIds } });
    return { tenantId, totalSurveys, totalResponses };
};

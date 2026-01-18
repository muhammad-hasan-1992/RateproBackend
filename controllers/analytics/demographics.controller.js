// controllers/analytics/demographics.controller.js
const asyncHandler = require("express-async-handler");
const Survey = require("../../models/Survey");
const SurveyResponse = require("../../models/SurveyResponse");
const Logger = require("../../utils/logger");

/**
 * Get response demographics breakdown for a tenant
 * Aggregates by device, browser, OS, location, and time patterns
 * 
 * @route   GET /api/analytics/demographics
 * @access  Private
 */
exports.getDemographics = asyncHandler(async (req, res) => {
    const { days = 30, surveyId } = req.query;
    const tenantId = req.tenantId || req.user?.tenant;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Get surveys for this tenant
    let surveyFilter = { tenant: tenantId };
    if (surveyId) {
        surveyFilter._id = surveyId;
    }

    const surveys = await Survey.find(surveyFilter).select("_id");
    const surveyIds = surveys.map(s => s._id);

    if (surveyIds.length === 0) {
        return res.status(200).json({
            success: true,
            data: {
                totalResponses: 0,
                byDevice: [],
                byBrowser: [],
                byOS: [],
                byLocation: [],
                byHour: [],
                byDayOfWeek: [],
                period: { days: parseInt(days), startDate, endDate: new Date() }
            }
        });
    }

    // Parallel aggregations for performance
    const [
        deviceAgg,
        browserAgg,
        osAgg,
        locationAgg,
        hourAgg,
        dayOfWeekAgg,
        totalCount
    ] = await Promise.all([
        // Device breakdown
        SurveyResponse.aggregate([
            { $match: { survey: { $in: surveyIds }, createdAt: { $gte: startDate } } },
            { $group: { _id: "$metadata.device", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]),

        // Browser breakdown
        SurveyResponse.aggregate([
            { $match: { survey: { $in: surveyIds }, createdAt: { $gte: startDate } } },
            { $group: { _id: "$metadata.browser", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]),

        // OS breakdown
        SurveyResponse.aggregate([
            { $match: { survey: { $in: surveyIds }, createdAt: { $gte: startDate } } },
            { $group: { _id: "$metadata.os", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]),

        // Location breakdown (top 10)
        SurveyResponse.aggregate([
            { $match: { survey: { $in: surveyIds }, createdAt: { $gte: startDate }, "metadata.location": { $ne: null } } },
            { $group: { _id: "$metadata.location", count: { $sum: 1 }, avgRating: { $avg: "$rating" } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]),

        // Hour of day distribution (0-23)
        SurveyResponse.aggregate([
            { $match: { survey: { $in: surveyIds }, createdAt: { $gte: startDate } } },
            { $group: { _id: { $hour: "$createdAt" }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]),

        // Day of week distribution (1=Sunday to 7=Saturday)
        SurveyResponse.aggregate([
            { $match: { survey: { $in: surveyIds }, createdAt: { $gte: startDate } } },
            { $group: { _id: { $dayOfWeek: "$createdAt" }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]),

        // Total count
        SurveyResponse.countDocuments({ survey: { $in: surveyIds }, createdAt: { $gte: startDate } })
    ]);

    // Format results
    const formatBreakdown = (agg, defaultLabel = "Unknown") =>
        agg.map(item => ({
            name: item._id || defaultLabel,
            count: item.count,
            percentage: totalCount > 0 ? Math.round((item.count / totalCount) * 100) : 0
        }));

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    const demographics = {
        totalResponses: totalCount,
        period: {
            days: parseInt(days),
            startDate,
            endDate: new Date()
        },
        byDevice: formatBreakdown(deviceAgg),
        byBrowser: formatBreakdown(browserAgg),
        byOS: formatBreakdown(osAgg),
        byLocation: locationAgg.map(item => ({
            name: item._id || "Unknown",
            count: item.count,
            percentage: totalCount > 0 ? Math.round((item.count / totalCount) * 100) : 0,
            avgRating: item.avgRating ? Number(item.avgRating.toFixed(1)) : null
        })),
        byHour: Array.from({ length: 24 }, (_, hour) => {
            const found = hourAgg.find(h => h._id === hour);
            return {
                hour,
                label: `${hour.toString().padStart(2, '0')}:00`,
                count: found?.count || 0
            };
        }),
        byDayOfWeek: Array.from({ length: 7 }, (_, i) => {
            const dayNum = i + 1; // MongoDB dayOfWeek is 1-indexed
            const found = dayOfWeekAgg.find(d => d._id === dayNum);
            return {
                day: dayNum,
                name: dayNames[i],
                count: found?.count || 0
            };
        }),
        // Peak engagement insights
        insights: {
            peakHour: hourAgg.length > 0 ? hourAgg.reduce((max, h) => h.count > max.count ? h : max, hourAgg[0])._id : null,
            peakDay: dayOfWeekAgg.length > 0 ? dayNames[dayOfWeekAgg.reduce((max, d) => d.count > max.count ? d : max, dayOfWeekAgg[0])._id - 1] : null,
            topDevice: deviceAgg.length > 0 ? deviceAgg[0]._id : null,
            topLocation: locationAgg.length > 0 ? locationAgg[0]._id : null
        }
    };

    Logger.info("getDemographics", "Demographics data fetched", {
        context: { tenantId, days: parseInt(days), totalResponses: totalCount },
        req
    });

    res.status(200).json({
        success: true,
        data: demographics
    });
});

/**
 * Get survey-specific demographics
 * 
 * @route   GET /api/analytics/demographics/:surveyId
 * @access  Private
 */
exports.getSurveyDemographics = asyncHandler(async (req, res) => {
    const { surveyId } = req.params;
    const { days = 30 } = req.query;
    const tenantId = req.tenantId || req.user?.tenant;

    // Verify survey belongs to tenant
    const survey = await Survey.findOne({ _id: surveyId, tenant: tenantId });
    if (!survey) {
        return res.status(404).json({ success: false, message: "Survey not found" });
    }

    // Redirect to main function with surveyId filter
    req.query.surveyId = surveyId;
    return exports.getDemographics(req, res);
});

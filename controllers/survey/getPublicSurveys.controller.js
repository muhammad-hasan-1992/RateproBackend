// controllers/survey/getPublicSurveys.controller.js
const Survey = require("../../models/Survey");
const Logger = require("../../utils/logger");

/**
 * Get all public surveys for the public-facing survey list
 * No authentication required
 */
exports.getPublicSurveys = async (req, res, next) => {
    try {
        const {
            category,
            page = 1,
            limit = 12,
            sort = "-createdAt",
            language,
        } = req.query;

        const skip = (page - 1) * limit;

        const query = {
            "settings.isPublic": true,
            status: "active",
            deleted: false,
        };

        if (category && category !== "all") {
            query.category = category;
        }

        if (language && language !== "all") {
            query.language = { $in: [language, "en", "ar"] };
        }

        const total = await Survey.countDocuments(query);
        const surveys = await Survey.find(query)
            .populate("tenant", "name")
            .select(
                "title description category createdAt themeColor questions estimatedTime averageRating language settings.totalResponses tenant"
            )
            .sort(sort)
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const publicSurveys = surveys.map((survey) => ({
            _id: survey._id,
            title: survey.title,
            description: survey.description,
            category: survey.category,
            createdAt: survey.createdAt,
            themeColor: survey.themeColor,
            averageRating: survey.averageRating || (Math.random() * 2 + 3).toFixed(1),
            estimatedTime:
                survey.estimatedTime ||
                `${Math.ceil(survey.questions?.length * 0.5 || 5)}-${Math.ceil(
                    survey.questions?.length * 0.8 || 7
                )} minutes`,
            totalResponses:
                survey.settings?.totalResponses ||
                Math.floor(Math.random() * 500) + 50,
            language: survey.language || ["English"],
            isPublic: true,
            isPasswordProtected: survey.settings?.isPasswordProtected || false,
            questionCount: survey.questions?.length || 0,
            companyName: survey.tenant?.name || "Unknown Company",
            tenant: survey.tenant?._id,
        }));

        res.status(200).json({
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit),
            surveys: publicSurveys,
        });
    } catch (err) {
        Logger.error("getPublicSurveys", "Error fetching public surveys", {
            error: err,
            context: { queryParams: req.query },
            req,
        });
        next(err);
    }
};

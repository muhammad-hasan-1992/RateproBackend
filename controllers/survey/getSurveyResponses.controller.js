// controllers/survey/getSurveyResponses.controller.js
const mongoose = require("mongoose");
const Survey = require("../../models/Survey");
const SurveyResponse = require("../../models/SurveyResponse");
const Logger = require("../../utils/logger");

/**
 * Get survey responses with advanced filtering and pagination
 */
exports.getSurveyResponses = async (req, res, next) => {
    try {
        const { surveyId } = req.params;
        const {
            page = 1,
            limit = 10,
            minRating,
            maxRating,
            startDate,
            endDate,
            sort = "-createdAt",
            anonymous,
            sentiment,
            npsCategory,
            hasContact
        } = req.query;

        // Validate surveyId
        if (!mongoose.Types.ObjectId.isValid(surveyId)) {
            return res.status(400).json({ message: "Invalid surveyId" });
        }

        // Ensure survey exists and belongs to tenant
        const survey = await Survey.findOne({
            _id: surveyId,
            tenant: req.user.tenant,
            deleted: false
        }).select("_id tenant title");

        if (!survey) {
            return res.status(404).json({ message: "Survey not found or access denied" });
        }

        // Build query
        const query = { survey: new mongoose.Types.ObjectId(surveyId) };

        // Rating range filter
        if (minRating !== undefined || maxRating !== undefined) {
            query.rating = {};
            if (minRating !== undefined) query.rating.$gte = Number(minRating);
            if (maxRating !== undefined) query.rating.$lte = Number(maxRating);
        }

        // Date range filter
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) {
                const sd = new Date(startDate);
                if (isNaN(sd)) return res.status(400).json({ message: "Invalid startDate" });
                query.createdAt.$gte = sd;
            }
            if (endDate) {
                const ed = new Date(endDate);
                if (isNaN(ed)) return res.status(400).json({ message: "Invalid endDate" });
                query.createdAt.$lte = ed;
            }
        }

        // Anonymous filter
        if (anonymous !== undefined) {
            const a = String(anonymous).toLowerCase();
            if (a === "true") query.isAnonymous = true;
            else if (a === "false") query.isAnonymous = false;
        }

        // Sentiment filter
        if (sentiment && ["positive", "neutral", "negative"].includes(sentiment)) {
            query["analysis.sentiment"] = sentiment;
        }

        // NPS Category filter
        if (npsCategory && ["promoter", "passive", "detractor"].includes(npsCategory)) {
            query["analysis.npsCategory"] = npsCategory;
        }

        // Has contact filter
        if (hasContact !== undefined) {
            const hc = String(hasContact).toLowerCase();
            if (hc === "true") {
                query.contact = { $ne: null };
            } else if (hc === "false") {
                query.$or = [{ contact: null }, { contact: { $exists: false } }];
            }
        }

        // Pagination
        const pageNum = Math.max(parseInt(page, 10) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

        const total = await SurveyResponse.countDocuments(query);
        const totalPages = Math.ceil(total / limitNum);

        // Fetch responses
        const responses = await SurveyResponse.find(query)
            .select("-__v")
            .populate("user", "name email avatar")
            .populate("contact", "name email phone tags")
            .sort(sort)
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum)
            .lean();

        // Transform responses to include respondent info
        const transformedResponses = responses.map(response => {
            let respondent = null;
            let respondentType = "anonymous";

            if (response.isAnonymous) {
                respondentType = "anonymous";
                respondent = { displayName: "Anonymous", type: "anonymous" };
            } else if (response.contact) {
                respondentType = "invited";
                respondent = {
                    type: "contact",
                    id: response.contact._id,
                    name: response.contact.name || null,
                    email: response.contact.email || null,
                    phone: response.contact.phone || null,
                    displayName: response.contact.name || response.contact.email || response.contact.phone || "Unknown Contact",
                    tags: response.contact.tags || []
                };
            } else if (response.user) {
                respondentType = "authenticated";
                respondent = {
                    type: "user",
                    id: response.user._id,
                    name: response.user.name || null,
                    email: response.user.email || null,
                    displayName: response.user.name || response.user.email || "Unknown User",
                    avatar: response.user.avatar || null
                };
            } else {
                respondentType = "public";
                respondent = { displayName: "Public Respondent", type: "public" };
            }

            return {
                ...response,
                respondent,
                respondentType,
                user: response.user,
                contact: response.contact
            };
        });

        // Calculate summary stats
        const stats = {
            total,
            byRespondentType: {
                anonymous: transformedResponses.filter(r => r.respondentType === "anonymous").length,
                invited: transformedResponses.filter(r => r.respondentType === "invited").length,
                authenticated: transformedResponses.filter(r => r.respondentType === "authenticated").length,
                public: transformedResponses.filter(r => r.respondentType === "public").length
            },
            bySentiment: {
                positive: transformedResponses.filter(r => r.analysis?.sentiment === "positive").length,
                neutral: transformedResponses.filter(r => r.analysis?.sentiment === "neutral").length,
                negative: transformedResponses.filter(r => r.analysis?.sentiment === "negative").length
            },
            byNpsCategory: {
                promoter: transformedResponses.filter(r => r.analysis?.npsCategory === "promoter").length,
                passive: transformedResponses.filter(r => r.analysis?.npsCategory === "passive").length,
                detractor: transformedResponses.filter(r => r.analysis?.npsCategory === "detractor").length
            }
        };

        res.status(200).json({
            total,
            totalPages,
            page: pageNum,
            limit: limitNum,
            survey: {
                _id: survey._id,
                title: survey.title
            },
            stats,
            responses: transformedResponses,
        });
    } catch (err) {
        Logger.error("getSurveyResponses", "Error fetching survey responses", {
            error: err,
            context: { surveyId: req.params?.surveyId, tenantId: req.user?.tenant },
            req,
        });
        next(err);
    }
};

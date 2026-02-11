// controllers\surveyController.js
const mongoose = require("mongoose");
const Survey = require("../models/Survey");
const SurveyResponse = require("../models/SurveyResponse");
const Action = require("../models/Action");
const cloudinary = require("../utils/cloudinary");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const path = require("path");
const { Parser } = require("json2csv");
const { getNextQuestion } = require("../utils/logicEngine");
const aiClient = require("../utils/aiClient");
const { analyzeFeedbackLogic } = require("./feedbackController")
const { sendSurveyWhatsApp } = require('./distributionController');
const Logger = require("../utils/logger");
const Joi = require("joi");
const generateSurveyToken = require("../utils/generateSurveyToken");
const resolveSurveyRecipients = require("../utils/resolveSurveyRecipients");
const SurveyInvite = require("../models/SurveyInvite");

const createSchema = Joi.object({
    title: Joi.string().required(),
    description: Joi.string().optional(),
    category: Joi.string().optional(),
    questions: Joi.array().min(1).required(),
    settings: Joi.object().optional(),
    themeColor: Joi.string().optional(),
    status: Joi.string().valid("draft", "active").default("draft"),
    targetAudience: Joi.object({
        type: Joi.string().valid("all", "specific").optional(),
        emails: Joi.array().items(Joi.string().email()).optional(),
        phones: Joi.array().items(Joi.string().pattern(/^\+\d{10,15}$/)).optional(),
        userIds: Joi.array().items(Joi.string().hex().length(24)).optional(),
    }).optional(),
    schedule: Joi.object({
        startDate: Joi.date().optional(),
        endDate: Joi.date().optional(),
        timezone: Joi.string().optional().default("Asia/Karachi"),
        autoPublish: Joi.boolean().optional().default(true),
        repeat: Joi.object().optional(),
    }).optional(),
});

exports.createSurvey = async (req, res) => {
    try {
        const { targetAudience, publishSettings, questions, ...surveyData } = req.body;

        // STEP 1: Save survey as draft first
        const newSurvey = new Survey({
            ...surveyData,
            questions,
            createdBy: req.user._id,
            tenant: req.tenantId,
            status: "draft",
            targetAudience: null,
            schedule: null
        });

        // STEP 2: Agar publishNow = true → turant active karo
        if (publishSettings?.publishNow) {
            newSurvey.status = "active";
            newSurvey.schedule = {
                startDate: new Date(),
                publishedAt: new Date(),
                autoPublish: true
            };

            // STEP 3: Audience ke hisaab se recipients banayein
            let recipients = [];

            if (targetAudience?.includes("customers")) {
                const customers = await User.find({ role: "customer", tenant: req.tenantId });
                recipients = customers.map(c => c.phone || c.email);
            }

            if (targetAudience?.includes("employees")) {
                const employees = await User.find({ role: "employee", tenant: req.tenantId });
                recipients.push(...employees.map(e => e.phone));
            }

            recipients = [...new Set(recipients)]; // Remove duplicates

            newSurvey.targetAudience = {
                phones: recipients.filter(r => r.startsWith("+")),
                emails: recipients.filter(r => r.includes("@")),
            };

            newSurvey.publishLog.push({
                publishedBy: req.user._id,
                method: "manual",
                recipientsCount: recipients.length,
            });

            // STEP 4: Send via WhatsApp/SMS
            if (recipients.length > 0) {
                const mockReq = {
                    body: { surveyId: newSurvey._id, recipients },
                    tenantId: req.tenantId,
                };
                await sendSurveyWhatsApp(mockReq, res, () => { });
            }
        }

        // STEP 5: Schedule publish if specified
        else if (publishSettings?.scheduleDate && publishSettings?.scheduleTime) {
            const startDate = new Date(`${publishSettings.scheduleDate}T${publishSettings.scheduleTime}:00`);
            newSurvey.status = "scheduled";
            newSurvey.schedule = {
                startDate,
                autoPublish: true,
                timezone: "Asia/Karachi",
            };
        }

        await newSurvey.save();
        res.json({ survey: newSurvey, message: "Survey created successfully!" });

    } catch (err) {
        console.error("❌ createSurvey error:", err);
        res.status(500).json({ message: "Server error during survey creation", error: err.message });
    }
};

exports.publishSurvey = async (req, res, next) => {
    try {
        const survey = await Survey.findOne({
            _id: req.params.surveyId,
            tenant: req.user.tenant,
            status: "draft",
            deleted: false
        });

        if (!survey) {
            return res.status(404).json({ message: "Survey not found or already published" });
        }

        // ✅ Resolve recipients
        const recipients = await resolveSurveyRecipients(survey);

        if (!recipients.length) {
            return res.status(400).json({ message: "No recipients found for this survey" });
        }

        let created = 0;

        for (const r of recipients) {
            // ✅ Prevent duplicate invite
            const exists = await SurveyInvite.findOne({
                survey: survey._id,
                tenant: survey.tenant,
                $or: [
                    { "contact.email": r.email },
                    { "contact.phone": r.phone }
                ]
            });

            if (exists) continue;

            await SurveyInvite.create({
                survey: survey._id,
                tenant: survey.tenant,
                contact: r,
                token: generateSurveyToken()
            });

            created++;
        }

        survey.status = "active";
        survey.schedule.publishedAt = new Date();
        survey.publishLog.push({
            publishedBy: req.user._id,
            method: "manual",
            recipientsCount: created
        });

        await survey.save();

        res.json({
            message: "Survey published successfully",
            invitesCreated: created
        });

    } catch (err) {
        next(err);
    }
};

exports.getSurveyByToken = async (req, res, next) => {
    try {
        const { token } = req.params;

        const invite = await SurveyInvite.findOne({ inviteToken: token })
            .populate("survey");

        if (!invite) {
            return res.status(404).json({ message: "Invalid or expired link" });
        }

        if (invite.submittedAt) {
            return res.status(410).json({
                message: "Survey already submitted"
            });
        }

        // ✅ mark opened
        if (!invite.openedAt) {
            invite.openedAt = new Date();
            invite.status = "opened";
            await invite.save();
        }

        res.json({
            survey: invite.survey,
            inviteId: invite._id
        });

    } catch (err) {
        next(err);
    }
};


// ===== AUTO ACTION GENERATION FROM SURVEY RESPONSES (Flow.md Section 7) =====
const generateActionsFromResponse = async (response, survey, tenantId) => {
    try {
        const feedbackText = response.review || response.answers.map(a => a.answer).join(" ");
        if (!feedbackText.trim()) return;

        await Logger.info("🤖 Generating action for feedback", { feedbackPreview: feedbackText.substring(0, 100), responseId: response._id, surveyId: survey._id });

        // AI Call
        const prompt = `Analyze this feedback and suggest one high-priority action: "${feedbackText}"`;
        const aiResult = await aiClient.complete({ prompt, maxTokens: 300 });

        let description = "Review customer feedback";
        let priority = "medium";

        // Clean AI response
        let cleaned = (aiResult.text || "")
            .replace(/```json\n?/g, '')
            .replace(/\n?```/g, '')
            .trim();

        try {
            const parsed = JSON.parse(cleaned);
            description = parsed.description || parsed.summary || description;
            priority = parsed.priority || priority;
        } catch {
            // Fallback
            description = `Auto: Address "${feedbackText.substring(0, 80)}..."`;
            priority = "high";
            await Logger.warn("⚠️ Failed to parse AI response, using fallback", { responseId: response._id, surveyId: survey._id });
        }

        const { createAction } = require("../services/action/actionService");

        // Create Action via unified service
        const action = await createAction({
            data: {
                title: "Customer Feedback Review",
                description,
                priority,
                team: "Customer Service",
                category: "Customer Issue",
                source: "ai_generated",
                tags: ["auto-generated", "survey"],
                problemStatement: description.substring(0, 2000),
                metadata: { responseId: response._id, surveyId: survey._id }
            },
            tenantId,
            userId: null,
            options: { skipNotification: false }
        });

        await Logger.info("✅ Auto-generated action created", { actionId: action._id, responseId: response._id, surveyId: survey._id });

        // Optional: Follow-up
        await followUp({
            actionIds: [action._id],
            messageTemplate: "Your feedback is being addressed!"
        });
        await Logger.info("💬 Follow-up triggered for action", { actionId: action._id });

    } catch (error) {
        await Logger.error("💥 Error in generateActionsFromResponse", { error: error.message, stack: error.stack, responseId: response._id, surveyId: survey._id });
        console.error("Error in generateActionsFromResponse:", error.message);
        // Don't break submission
    }
};

// Helper function to detect negative feedback
const hasNegativeFeedback = (response) => {
    const lowStarRating = response.rating && response.rating <= 2;
    const npsDetractor = response.score && response.score <= 6;
    if (lowStarRating || npsDetractor) return true;

    const textContent = [response.review, ...(response.answers || []).map(a => a.answer)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    if (!textContent) return false;

    const negativeKeywords = ['bad', 'terrible', 'awful', 'disappointed', 'problem', 'issue', 'complaint', 'slow', 'dirty', 'rude', 'poor', 'worst', 'hate', 'angry'];
    const positiveNegationPatterns = [/not\s+(bad|terrible|awful|poor)/g];

    const cleanedText = positiveNegationPatterns.reduce((text, pattern) => text.replace(pattern, ""), textContent);

    return negativeKeywords.some(keyword => cleanedText.includes(keyword));
};

// AI-powered feedback sentiment analysis
const analyzeFeedbackSentiment = async (response, survey) => {
    try {
        const textFeedback = [
            response.review,
            ...(response.answers || []).map(a => a.answer).filter(answer => typeof answer === 'string')
        ].filter(Boolean).join(' ');

        await Logger.info("📝 Starting sentiment analysis", { responseId: response._id, surveyId: survey._id, feedbackPreview: textFeedback.substring(0, 100) });

        if (!textFeedback.trim()) {
            const rating = response.rating || response.score || 5;
            const fallbackAnalysis = {
                sentiment: rating <= 2 ? 'negative' : rating <= 3 ? 'neutral' : 'positive',
                confidence: 0.6,
                shouldGenerateAction: rating <= 3,
                urgency: rating <= 1 ? 'high' : rating <= 2 ? 'medium' : 'low',
                categories: ['general']
            };
            await Logger.info("⚠️ No textual feedback, using rating-based analysis", { responseId: response._id, fallbackAnalysis });
            return fallbackAnalysis;
        }

        // AI detailed sentiment analysis
        const aiResponse = await aiClient.complete({
            contents: [{
                parts: [{
                    text: `Analyze this customer feedback and extract actionable insights:
                    
                    Feedback: "${textFeedback}"
                    Rating: ${response.rating || 'N/A'}/5
                    NPS Score: ${response.score || 'N/A'}/10
                    Survey: ${survey.title}
                    Category: ${survey.category}
                    
                    Provide JSON response:
                    {
                        "sentiment": "positive|neutral|negative",
                        "confidence": 0.0-1.0,
                        "shouldGenerateAction": boolean,
                        "urgency": "low|medium|high",
                        "categories": ["service", "staff", "facility", "price", "product"],
                        "actionRequired": "immediate|planned|none",
                        "department": "reception|housekeeping|maintenance|management|kitchen",
                        "summary": "brief issue description"
                    }`
                }]
            }]
        });

        let analysis = {};
        try {
            analysis = JSON.parse(aiResponse.text || '{}');
            await Logger.info("✅ AI sentiment analysis success", { responseId: response._id, analysis });
        } catch (parseError) {
            await Logger.warn("⚠️ Failed to parse AI response, using fallback", { responseId: response._id, rawAIText: aiResponse.text });
        }

        return {
            sentiment: analysis.sentiment || 'neutral',
            confidence: analysis.confidence || 0.5,
            shouldGenerateAction: analysis.shouldGenerateAction || false,
            urgency: analysis.urgency || 'low',
            categories: analysis.categories || ['general'],
            actionRequired: analysis.actionRequired || 'none',
            department: analysis.department || 'management',
            summary: analysis.summary || textFeedback.substring(0, 100)
        };

    } catch (error) {
        await Logger.error("💥 AI sentiment analysis failed, fallback used", { error: error.message, stack: error.stack, responseId: response._id, surveyId: survey._id });
        console.error('AI sentiment analysis failed:', error);
        return {
            sentiment: hasNegativeFeedback(response) ? 'negative' : 'neutral',
            confidence: 0.3,
            shouldGenerateAction: hasNegativeFeedback(response),
            urgency: 'medium',
            categories: ['general'],
            department: 'management',
            summary: response.review || 'Customer feedback requires attention'
        };
    }
};

// Notify managers of urgent actions (Flow.md Section 6 - Routing)
const notifyManagersOfUrgentAction = async (action, tenantId) => {
    try {
        // Logging for tracking urgent action
        await Logger.info("🚨 URGENT ACTION ALERT", {
            actionId: action._id,
            title: action.title,
            department: action.department,
            dueDate: action.dueDate,
            priority: action.priority,
            tenantId
        });
        // Placeholder for real notification integrations
        // Email, SMS, Push, In-app notifications

    } catch (error) {
        await Logger.error("Error sending urgent action notification", {
            error: error.message,
            stack: error.stack,
            actionId: action._id,
            tenantId
        });
        console.error('Error sending urgent action notification:', error);
    }
};

// ===== GET ALL SURVEYS (with filters) =====
exports.getAllSurveys = async (req, res, next) => {
    try {
        await Logger.info("getAllSurveys: Request received", {
            userId: req.user?._id,
            role: req.user?.role,
            tenantId: req.user?.tenant,
            queryParams: req.query,
        });

        const { search = "", status, page = 1, limit = 10, sort = "-createdAt" } = req.query;
        const skip = (page - 1) * limit;

        const query = {
            deleted: false,
            title: { $regex: search, $options: "i" },
        };

        // role-based tenant logic
        if (req.user?.role === "admin") {
            await Logger.info("getAllSurveys: Admin access");
        } else if (req.user?.tenant) {
            query.tenant = req.user.tenant;
        } else {
            await Logger.warn("getAllSurveys: Access denied — no tenant", {
                userId: req.user?._id,
            });
            return res.status(403).json({ message: "Access denied: No tenant associated with this user" });
        }

        if (status) query.status = status;
        if (req.user?.role === "companyAdmin") query.createdBy = req.user._id;

        await Logger.info("getAllSurveys: Executing query", { query, skip, limit, sort });

        const total = await Survey.countDocuments(query);
        const surveys = await Survey.find(query)
            .populate("createdBy", "name email role")
            .sort(sort)
            .skip(skip)
            .limit(parseInt(limit));

        await Logger.info("getAllSurveys: Query successful", {
            totalResults: surveys.length,
            totalCount: total,
            page,
        });

        res.status(200).json({ total, page, surveys });
    } catch (err) {
        await Logger.error("getAllSurveys: Error occurred", {
            error: err.message,
            stack: err.stack,
            userId: req.user?._id,
            tenantId: req.user?.tenant,
        });
        next(err);
    }
};

// ===== GET PUBLIC SURVEY BY ID (for taking surveys) =====
exports.getPublicSurveys = async (req, res, next) => {
    try {
        await Logger.info("getPublicSurveys: Request received", {
            queryParams: req.query,
            ip: req.ip,
            userAgent: req.headers["user-agent"],
        });

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

        await Logger.info("getPublicSurveys: Executing query", { query, sort, skip, limit });

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

        await Logger.info("getPublicSurveys: Surveys fetched", {
            totalResults: surveys.length,
            totalCount: total,
        });

        const publicSurveys = surveys.map((survey) => ({
            _id: survey._id,
            title: survey.title,
            description: survey.description,
            category: survey.category,
            createdAt: survey.createdAt,
            themeColor: survey.themeColor,
            averageRating:
                survey.averageRating || (Math.random() * 2 + 3).toFixed(1),
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

        await Logger.info("getPublicSurveys: Response ready", {
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        });

        res.status(200).json({
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit),
            surveys: publicSurveys,
        });
    } catch (err) {
        await Logger.error("getPublicSurveys: Error occurred", {
            error: err.message,
            stack: err.stack,
            queryParams: req.query,
        });
        next(err);
    }
};

// ===== GET SINGLE SURVEY =====
exports.getPublicSurveyById = async (req, res, next) => {
    try {
        await Logger.info("getPublicSurveyById: Request received", {
            surveyId: req.params.id,
            ip: req.ip,
            userAgent: req.headers["user-agent"],
        });

        const survey = await Survey.findOne({
            _id: req.params.id,
            "settings.isPublic": true,
            status: "active",
            deleted: false,
        }).select("title description questions themeColor estimatedTime thankYouPage");

        if (!survey) {
            await Logger.warn("getPublicSurveyById: Survey not found or not public", {
                surveyId: req.params.id,
            });
            return res
                .status(404)
                .json({ message: "Survey not found or not public" });
        }

        await Logger.info("getPublicSurveyById: Survey retrieved successfully", {
            surveyId: survey._id,
            questionCount: survey.questions?.length || 0,
        });

        res.status(200).json({ survey });
    } catch (err) {
        await Logger.error("getPublicSurveyById: Error occurred", {
            error: err.message,
            stack: err.stack,
            surveyId: req.params.id,
        });
        next(err);
    }
};

// ===== GET SINGLE SURVEY =====
exports.getSurveyById = async (req, res, next) => {
    try {
        const survey = await Survey.findById({
            _id: req.params.id,
            tenant: req.user.tenant,
        }).populate("createdBy", "name");

        if (!survey || survey.deleted) {
            await Logger.warn('getSurveyById: Survey not found or deleted', { surveyId: req.params.id, tenantId: req.user.tenant });
            return res.status(404).json({ message: "Not found" });
        }

        await Logger.info('getSurveyById: Survey fetched successfully', { surveyId: survey._id, tenantId: req.user.tenant });

        res.status(200).json(survey);
    } catch (err) {
        await Logger.error('getSurveyById: Server error', { message: err.message, stack: err.stack, surveyId: req.params.id, tenantId: req.user.tenant });
        next(err);
    }
};

// ===== TAKE SURVEY / SUBMIT RESPONSE =====
exports.submitSurveyResponse = async (req, res, next) => {
    try {
        const { token } = req.params;
        const answers = req.body.answers;

        const invite = await SurveyInvite.findOne({ inviteToken: token });

        if (!invite) {
            return res.status(404).json({ message: "Invalid link" });
        }

        if (invite.submittedAt) {
            return res.status(409).json({ message: "Response already submitted" });
        }

        await SurveyResponse.create({
            survey: invite.survey,
            tenant: invite.tenant,
            invite: invite._id,
            answers
        });

        invite.submittedAt = new Date();
        invite.status = "submitted";
        await invite.save();

        res.json({ message: "Response submitted successfully" });

    } catch (err) {
        next(err);
    }
};

// ===== UPDATE SURVEY =====
exports.updateSurvey = async (req, res, next) => {
    let uploaded = null;
    try {
        const surveyId = req.params.id;

        await Logger.info("updateSurvey: Incoming request", {
            surveyId,
            userId: req.user?._id,
            tenantId: req.user?.tenant,
            hasFile: !!req.file,
        });

        if (!mongoose.Types.ObjectId.isValid(surveyId)) {
            await Logger.warn("updateSurvey: Invalid survey ID", { surveyId });
            return res.status(400).json({ message: "Invalid survey id" });
        }

        // Find survey ensuring tenant ownership
        const survey = await Survey.findOne({
            _id: surveyId,
            tenant: req.user.tenant,
            deleted: false,
        });

        if (!survey) {
            await Logger.warn("updateSurvey: Survey not found or forbidden", {
                surveyId,
                tenantId: req.user.tenant,
            });
            return res
                .status(404)
                .json({ message: "Survey not found or access denied" });
        }

        const allowedFields = [
            "title",
            "description",
            "category",
            "questions",
            "themeColor",
            "translations",
            "thankYouPage",
            "settings",
            "status",
        ];

        allowedFields.forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                if (typeof req.body[field] === "object" && field !== "questions") {
                    survey[field] = Object.assign({}, survey[field] || {}, req.body[field]);
                } else {
                    survey[field] = req.body[field];
                }
            }
        });

        // 🔹 Logo Upload Handling
        if (req.file) {
            try {
                const result = await cloudinary.uploader.upload(req.file.path, {
                    folder: "survey-logos",
                });
                uploaded = result;

                if (survey.logo?.public_id) {
                    try {
                        await cloudinary.uploader.destroy(survey.logo.public_id);
                        await Logger.info("updateSurvey: Old logo removed", {
                            oldLogoId: survey.logo.public_id,
                        });
                    } catch (err) {
                        await Logger.warn("updateSurvey: Failed to destroy old logo", {
                            error: err.message,
                            oldLogoId: survey.logo.public_id,
                        });
                    }
                }

                // Assign new logo
                survey.logo = { public_id: result.public_id, url: result.secure_url };
                await Logger.info("updateSurvey: New logo uploaded", {
                    public_id: result.public_id,
                    url: result.secure_url,
                });
            } finally {
                if (req.file.path && fs.existsSync(req.file.path)) {
                    try {
                        fs.unlinkSync(req.file.path);
                        await Logger.info("updateSurvey: Temp file removed", {
                            path: req.file.path,
                        });
                    } catch (e) {
                        await Logger.warn("updateSurvey: Failed to remove temp file", {
                            error: e.message,
                        });
                    }
                }
            }
        }

        // 🔹 Password Protection Logic
        if (req.body.settings && typeof req.body.settings.isPasswordProtected !== "undefined") {
            if (req.body.settings.isPasswordProtected) {
                if (req.body.settings.password) {
                    survey.settings = survey.settings || {};
                    survey.settings.isPasswordProtected = true;
                    survey.settings.password = await bcrypt.hash(
                        String(req.body.settings.password),
                        10
                    );
                    await Logger.info("updateSurvey: Password protection enabled with new password");
                } else if (!survey.settings?.password) {
                    await Logger.warn("updateSurvey: Password missing while enabling protection");
                    return res.status(400).json({
                        message: "Password required when enabling password protection",
                    });
                } else {
                    survey.settings.isPasswordProtected = true;
                }
            } else {
                survey.settings.isPasswordProtected = false;
                survey.settings.password = undefined;
                await Logger.info("updateSurvey: Password protection disabled");
            }
        } else if (req.body.settings?.password) {
            survey.settings = survey.settings || {};
            survey.settings.password = await bcrypt.hash(
                String(req.body.settings.password),
                10
            );
            survey.settings.isPasswordProtected = true;
            await Logger.info("updateSurvey: Password updated");
        }

        await survey.save();

        await Logger.info("updateSurvey: Survey updated successfully", {
            surveyId,
            tenantId: req.user.tenant,
            updatedFields: Object.keys(req.body),
        });

        res.status(200).json({ message: "Survey updated", survey });
    } catch (err) {
        if (uploaded && uploaded.public_id) {
            try {
                await cloudinary.uploader.destroy(uploaded.public_id);
                await Logger.warn("updateSurvey: Rolled back uploaded logo due to error", {
                    uploadedLogoId: uploaded.public_id,
                });
            } catch (cleanupErr) {
                await Logger.error("updateSurvey: Cleanup failed", {
                    error: cleanupErr.message,
                });
            }
        }

        await Logger.error("updateSurvey: Error occurred", {
            error: err.message,
            stack: err.stack,
            surveyId: req.params.id,
            userId: req.user?._id,
        });
        next(err);
    }
};

// ===== DELETE SURVEY =====
exports.deleteSurvey = async (req, res, next) => {
    try {
        await Logger.info("🗑️ Deleting survey...", {
            surveyId: req.params.id,
            userId: req.user?._id,
            tenantId: req.user?.tenant,
        });

        await Survey.findByIdAndUpdate(req.params.id, { deleted: true });

        await Logger.info("✅ Survey deleted successfully", {
            surveyId: req.params.id,
            userId: req.user?._id,
        });

        res.status(200).json({ message: "Survey deleted" });
    } catch (err) {
        await Logger.error("💥 Error deleting survey", {
            surveyId: req.params.id,
            error: err.message,
            stack: err.stack,
        });
        next(err);
    }
};

// ===== TOGGLE ACTIVE/INACTIVE =====
exports.toggleSurveyStatus = async (req, res, next) => {
    try {
        await Logger.info("🔄 Toggling survey status...", {
            surveyId: req.params.id,
            userId: req.user?._id,
            tenantId: req.user?.tenant,
        });

        const survey = await Survey.findById({
            _id: req.params.id,
            tenant: req.user.tenant,
        });

        if (!survey) {
            await Logger.warn("⚠️ Survey not found for status toggle", {
                surveyId: req.params.id,
                userId: req.user?._id,
            });
            return res.status(404).json({ message: "Not found" });
        }

        survey.status = survey.status === "active" ? "inactive" : "active";
        await survey.save();

        await Logger.info("✅ Survey status updated", {
            surveyId: req.params.id,
            newStatus: survey.status,
            userId: req.user?._id,
        });

        res.status(200).json({ message: `Survey is now ${survey.status}` });
    } catch (err) {
        await Logger.error("💥 Error toggling survey status", {
            surveyId: req.params.id,
            error: err.message,
            stack: err.stack,
        });
        next(err);
    }
};

// ===== GENERATE QR CODE =====
exports.getSurveyQRCode = async (req, res, next) => {
    try {
        await Logger.info("📡 Generating QR Code for survey...", {
            surveyId: req.params.id,
            userId: req.user?._id,
        });

        const { id } = req.params;
        const url = `${process.env.FRONTEND_URL}/take-survey/${id}`;
        const qr = await QRCode.toDataURL(url);

        await Logger.info("✅ QR Code generated successfully", {
            surveyId: id,
            url,
        });

        res.status(200).json({ qr });
    } catch (err) {
        await Logger.error("💥 Error generating survey QR Code", {
            surveyId: req.params?.id,
            error: err.message,
            stack: err.stack,
        });
        next(err);
    }
};

// ===== EXPORT SURVEY REPORT PDF =====
exports.exportSurveyReport = async (req, res, next) => {
    try {
        await Logger.info("📊 Exporting survey report...", {
            surveyId: req.params.id,
            userId: req.user?._id,
            tenantId: req.user?.tenant,
        });

        const survey = await Survey.findById({
            _id: req.params.id,
            tenant: req.user.tenant,
        });

        if (!survey) {
            await Logger.warn("⚠️ Survey not found for export", { surveyId: req.params.id });
            return res.status(404).json({ message: "Survey not found" });
        }

        const responses = await SurveyResponse.find({ survey: survey._id });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=survey-${survey._id}.pdf`);

        const doc = new PDFDocument();
        const filePath = `./uploads/survey-${survey._id}-${Date.now()}.pdf`;
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        doc.fontSize(20).text("Survey Report", { align: "center" });
        doc.moveDown();
        doc.text(`Title: ${survey.title}`);
        doc.text(`Category: ${survey.category}`);
        doc.text(`Created: ${survey.createdAt}`);
        doc.text(`Total Responses: ${responses.length}`);
        doc.text(`Average Score: ${survey.averageScore}`);
        doc.text(`Average Rating: ${survey.averageRating}`);
        doc.moveDown();

        doc.fontSize(16).text("Recent Reviews:");
        responses.slice(-5).forEach((r, i) => {
            doc.moveDown(0.5);
            doc.text(`${i + 1}. Rating: ${r.rating} | Score: ${r.score}`);
            doc.text(`Review: ${r.review}`);
        });

        doc.end();

        stream.on("finish", async () => {
            await Logger.info("✅ Survey report PDF generated", {
                surveyId: survey._id,
                path: filePath,
            });
            res.download(filePath, `survey-${survey._id}.pdf`, () => fs.unlinkSync(filePath));
        });
    } catch (err) {
        await Logger.error("💥 Error exporting survey report", {
            surveyId: req.params?.id,
            error: err.message,
            stack: err.stack,
        });
        next(err);
    }
};

// ===== EXPORT SURVEY REPORT CSV =====
exports.exportResponses = async (req, res, next) => {
    try {
        await Logger.info("📤 Exporting survey responses...", {
            surveyId: req.params.id,
            userId: req.user?._id,
            tenantId: req.user?.tenant,
        });

        const survey = await Survey.findById(req.params.id);
        if (!survey) {
            await Logger.warn("⚠️ Survey not found for response export", { surveyId: req.params.id });
            return res.status(404).json({ message: "Survey not found" });
        }

        const responses = await SurveyResponse.find({ survey: survey._id });
        const fields = ["user", "score", "rating", "review", "createdAt"];
        const parser = new Parser({ fields });
        const csv = parser.parse(responses);

        await Logger.info("✅ Survey responses CSV generated", {
            surveyId: survey._id,
            totalResponses: responses.length
        });

        res.header("Content-Type", "text/csv");
        res.attachment(`survey-${survey._id}-responses.csv`);
        res.send(csv);
    } catch (err) {
        await Logger.error("💥 Error exporting survey responses", {
            surveyId: req.params?.id,
            error: err.message,
            stack: err.stack
        });
        next(err);
    }
};

// ===== GET SURVEY RESPONSES =====
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
            anonymous, // optional: true|false to filter by anonymity
            sentiment, // optional: positive|neutral|negative
            npsCategory, // optional: promoter|passive|detractor
            hasContact // optional: true|false to filter by identified respondents
        } = req.query;

        await Logger.info("📥 Fetching survey responses started", {
            surveyId,
            userId: req.user?._id,
            tenantId: req.user?.tenant,
            query: req.query
        });

        // Validate surveyId
        if (!mongoose.Types.ObjectId.isValid(surveyId)) {
            await Logger.warn("⚠️ Invalid surveyId provided", { surveyId });
            return res.status(400).json({ message: "Invalid surveyId" });
        }

        // Ensure survey exists and belongs to tenant
        const survey = await Survey.findOne({ _id: surveyId, tenant: req.user.tenant, deleted: false }).select("_id tenant title");
        if (!survey) {
            await Logger.warn("⚠️ Survey not found or access denied", { surveyId, tenantId: req.user?.tenant });
            return res.status(404).json({ message: "Survey not found or access denied" });
        }

        // Build query
        const query = { survey: new mongoose.Types.ObjectId(surveyId) };

        // Rating range filter
        if (typeof minRating !== "undefined" || typeof maxRating !== "undefined") {
            query.rating = {};
            if (typeof minRating !== "undefined") query.rating.$gte = Number(minRating);
            if (typeof maxRating !== "undefined") query.rating.$lte = Number(maxRating);
        }

        // Date range filter
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) {
                const sd = new Date(startDate);
                if (isNaN(sd)) {
                    await Logger.warn("⚠️ Invalid startDate provided", { startDate });
                    return res.status(400).json({ message: "Invalid startDate" });
                }
                query.createdAt.$gte = sd;
            }
            if (endDate) {
                const ed = new Date(endDate);
                if (isNaN(ed)) {
                    await Logger.warn("⚠️ Invalid endDate provided", { endDate });
                    return res.status(400).json({ message: "Invalid endDate" });
                }
                query.createdAt.$lte = ed;
            }
        }

        // Anonymous filter
        if (typeof anonymous !== "undefined") {
            const a = String(anonymous).toLowerCase();
            if (a === "true") query.isAnonymous = true;
            else if (a === "false") query.isAnonymous = false;
        }

        // Sentiment filter (from AI analysis)
        if (sentiment && ["positive", "neutral", "negative"].includes(sentiment)) {
            query["analysis.sentiment"] = sentiment;
        }

        // NPS Category filter
        if (npsCategory && ["promoter", "passive", "detractor"].includes(npsCategory)) {
            query["analysis.npsCategory"] = npsCategory;
        }

        // Has identified contact filter
        if (typeof hasContact !== "undefined") {
            const hc = String(hasContact).toLowerCase();
            if (hc === "true") {
                query.contact = { $ne: null };
            } else if (hc === "false") {
                query.$or = [{ contact: null }, { contact: { $exists: false } }];
            }
        }

        // Pagination safety
        const pageNum = Math.max(parseInt(page, 10) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100); // cap to 100

        const total = await SurveyResponse.countDocuments(query);
        const totalPages = Math.ceil(total / limitNum);

        // Fetch responses - populate BOTH user AND contact
        const responses = await SurveyResponse.find(query)
            .select("-__v")
            .populate("user", "name email avatar")
            .populate("contact", "name email phone tags") // 🔥 NEW: Populate contact for invited responses
            .sort(sort)
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum)
            .lean();

        // 🔥 Transform responses to include respondent info
        const transformedResponses = responses.map(response => {
            // Determine respondent type and info
            let respondent = null;
            let respondentType = "anonymous";

            if (response.isAnonymous) {
                respondentType = "anonymous";
                respondent = { displayName: "Anonymous", type: "anonymous" };
            } else if (response.contact) {
                // Invited response - identified via contact
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
                // Authenticated user response
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
                // Public response without identification
                respondentType = "public";
                respondent = { displayName: "Public Respondent", type: "public" };
            }

            return {
                ...response,
                respondent,
                respondentType,
                // Keep original fields for backward compatibility
                user: response.user,
                contact: response.contact
            };
        });

        // Calculate summary stats for this result set
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

        await Logger.info("✅ Survey responses fetched successfully", {
            surveyId,
            total,
            page: pageNum,
            limit: limitNum,
            tenantId: req.user?.tenant,
            stats
        });


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
        await Logger.error("💥 Error fetching survey responses", { error: err.message, stack: err.stack });
        next(err);
    }
};

// Replace the existing getSurveyAnalytics function with this:

// ===== GET SURVEY ANALYTICS (COMPREHENSIVE) =====
exports.getSurveyAnalytics = async (req, res, next) => {
    try {
        const { surveyId } = req.params;
        const { range = '30d', startDate, endDate } = req.query;

        await Logger.info("📥 Fetching comprehensive survey analytics", {
            surveyId,
            range,
            userId: req.user?._id,
            tenantId: req.user?.tenant
        });

        // Verify survey exists
        const survey = await Survey.findById(surveyId).lean();
        if (!survey) {
            await Logger.warn("⚠️ Survey not found", { surveyId });
            return res.status(404).json({ message: "Survey not found" });
        }

        // Parse date range
        const days = parseInt(range.replace('d', '')) || 30;
        let rangeStart, rangeEnd, previousStart, previousEnd;

        if (startDate && endDate) {
            rangeStart = new Date(startDate);
            rangeEnd = new Date(endDate);
            const periodDuration = rangeEnd - rangeStart;
            previousStart = new Date(rangeStart - periodDuration);
            previousEnd = new Date(rangeStart);
        } else {
            rangeEnd = new Date();
            rangeStart = new Date();
            rangeStart.setDate(rangeStart.getDate() - days);
            previousEnd = new Date(rangeStart);
            previousStart = new Date(rangeStart);
            previousStart.setDate(previousStart.getDate() - days);
        }

        const dateFilter = { createdAt: { $gte: rangeStart, $lte: rangeEnd } };
        const previousPeriodFilter = { createdAt: { $gte: previousStart, $lte: previousEnd } };

        // Fetch current and previous period responses
        const [responses, previousResponses] = await Promise.all([
            SurveyResponse.find({ survey: surveyId, ...dateFilter }).lean(),
            SurveyResponse.find({ survey: surveyId, ...previousPeriodFilter }).lean()
        ]);

        const totalResponses = responses.length;
        const previousTotal = previousResponses.length;

        // ============================================================================
        // HELPER: Extract rating/score from response
        // Handles both response-level rating AND answer-level ratings
        // ============================================================================
        const extractRating = (response) => {
            // First check response-level rating
            if (response.rating !== null && response.rating !== undefined) {
                return Number(response.rating);
            }

            // Check answers for rating-type questions
            if (response.answers && Array.isArray(response.answers)) {
                for (const answer of response.answers) {
                    if (typeof answer.answer === 'number' && answer.answer >= 1 && answer.answer <= 5) {
                        return answer.answer;
                    }
                }
            }

            return null;
        };

        const extractNPSScore = (response) => {
            // First check response-level score
            if (response.score !== null && response.score !== undefined) {
                return Number(response.score);
            }

            // Check answers for NPS-type questions (0-10 scale)
            if (response.answers && Array.isArray(response.answers)) {
                for (const answer of response.answers) {
                    if (typeof answer.answer === 'number' && answer.answer >= 0 && answer.answer <= 10) {
                        return answer.answer;
                    }
                }
            }

            return null;
        };

        // ============================================================================
        // 1. OVERVIEW METRICS WITH TRENDS
        // ============================================================================

        // Calculate average rating (using helper)
        const ratingsArray = responses
            .map(r => extractRating(r))
            .filter(r => r !== null);
        const averageRating = ratingsArray.length > 0
            ? Number((ratingsArray.reduce((a, b) => a + b, 0) / ratingsArray.length).toFixed(2))
            : 0;

        const prevRatings = previousResponses
            .map(r => extractRating(r))
            .filter(r => r !== null);
        const prevAvgRating = prevRatings.length > 0
            ? Number((prevRatings.reduce((a, b) => a + b, 0) / prevRatings.length).toFixed(2))
            : 0;

        // Calculate completion rate
        const completedResponses = responses.filter(r => r.status === 'submitted').length;
        const completionRate = totalResponses > 0
            ? Number(((completedResponses / totalResponses) * 100).toFixed(1))
            : 0;

        const prevCompleted = previousResponses.filter(r => r.status === 'submitted').length;
        const prevCompletionRate = previousTotal > 0
            ? Number(((prevCompleted / previousTotal) * 100).toFixed(1))
            : 0;

        // Calculate NPS (using helper for score extraction)
        const { calculateNPS } = require("../utils/analyticsUtils");

        // Enhance responses with extracted scores for NPS calculation
        const responsesWithScores = responses.map(r => ({
            ...r,
            score: extractNPSScore(r)
        }));
        const prevResponsesWithScores = previousResponses.map(r => ({
            ...r,
            score: extractNPSScore(r)
        }));

        const npsData = calculateNPS(responsesWithScores);
        const prevNpsData = calculateNPS(prevResponsesWithScores);

        // Calculate trends (percentage change)
        const calculateTrend = (current, previous) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return Number((((current - previous) / previous) * 100).toFixed(1));
        };

        const responseTrend = calculateTrend(totalResponses, previousTotal);
        const ratingTrend = calculateTrend(averageRating, prevAvgRating);
        const completionTrend = calculateTrend(completionRate, prevCompletionRate);
        const npsTrend = npsData.score !== null && prevNpsData.score !== null
            ? Number((npsData.score - prevNpsData.score).toFixed(1))
            : 0;

        // Response rate and satisfaction
        const totalInvited = survey.targetAudience?.emails?.length ||
            survey.targetAudience?.phones?.length ||
            totalResponses || 1;
        const responseRate = totalInvited > 0
            ? Number(((totalResponses / totalInvited) * 100).toFixed(1))
            : 0;

        const satisfactionScore = averageRating > 0
            ? Number(((averageRating / 5) * 100).toFixed(1))
            : 0;

        const avgCompletionTime = (() => {
            const times = responses.filter(r => r.completionTime).map(r => r.completionTime);
            return times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
        })();

        // ============================================================================
        // 2. TRENDS DATA
        // ============================================================================

        const responsesByDate = {};
        responses.forEach(r => {
            const date = new Date(r.createdAt).toISOString().split('T')[0];
            if (!responsesByDate[date]) {
                responsesByDate[date] = { date, count: 0, ratings: [], scores: [] };
            }
            responsesByDate[date].count++;

            const rating = extractRating(r);
            if (rating !== null) responsesByDate[date].ratings.push(rating);

            const score = extractNPSScore(r);
            if (score !== null) responsesByDate[date].scores.push(score);
        });

        const responsesByDateArray = Object.values(responsesByDate).map(day => ({
            date: day.date,
            count: day.count,
            avgRating: day.ratings.length > 0
                ? Number((day.ratings.reduce((a, b) => a + b, 0) / day.ratings.length).toFixed(2))
                : 0
        })).sort((a, b) => new Date(a.date) - new Date(b.date));

        // Rating trends (use averageRating field to match frontend)
        const ratingTrends = responsesByDateArray
            .filter(d => d.avgRating > 0)
            .map(d => ({
                date: d.date,
                averageRating: d.avgRating
            }));

        // NPS history (by week)
        const weeklyGroups = {};
        responses.forEach(r => {
            const weekStart = new Date(r.createdAt);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            const weekKey = weekStart.toISOString().split('T')[0];
            if (!weeklyGroups[weekKey]) weeklyGroups[weekKey] = [];
            weeklyGroups[weekKey].push({ ...r, score: extractNPSScore(r) });
        });

        const npsHistory = Object.entries(weeklyGroups)
            .map(([week, weekResponses]) => {
                const weekNps = calculateNPS(weekResponses);
                return {
                    date: week,
                    npsScore: weekNps.score || 0
                };
            })
            .filter(item => item.npsScore !== 0 || weeklyGroups[item.date]?.some(r => r.score !== null))
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        // Completion trends
        const completionTrends = responsesByDateArray.map(d => ({
            date: d.date,
            rate: completionRate
        }));

        // ============================================================================
        // 3. SENTIMENT ANALYSIS
        // ============================================================================

        const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
        const keywords = {};
        const themes = {};

        responses.forEach(r => {
            if (r.analysis?.sentiment) {
                sentimentCounts[r.analysis.sentiment]++;
            } else {
                // Infer sentiment from rating if no analysis
                const rating = extractRating(r);
                if (rating !== null) {
                    if (rating >= 4) sentimentCounts.positive++;
                    else if (rating >= 3) sentimentCounts.neutral++;
                    else sentimentCounts.negative++;
                }
            }

            if (r.analysis?.keywords) {
                r.analysis.keywords.forEach(kw => {
                    keywords[kw] = (keywords[kw] || 0) + 1;
                });
            }
            if (r.analysis?.themes) {
                r.analysis.themes.forEach(theme => {
                    themes[theme] = (themes[theme] || 0) + 1;
                });
            }
        });

        const topKeywords = Object.entries(keywords)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([word, count]) => ({ word, count }));

        const topThemes = Object.entries(themes)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([theme, count]) => ({ theme, count }));

        // ============================================================================
        // 4. DEMOGRAPHICS
        // ============================================================================

        const deviceCounts = {};
        const locationCounts = {};
        const hourCounts = {};
        const dayCounts = {};

        responses.forEach(r => {
            // Device - use metadata if available, otherwise infer from IP or default
            const device = r.metadata?.device || r.device || 'Unknown';
            deviceCounts[device] = (deviceCounts[device] || 0) + 1;

            // Location
            const location = r.metadata?.location || r.metadata?.city || r.location || 'Unknown';
            locationCounts[location] = (locationCounts[location] || 0) + 1;

            // Time of day
            const hour = new Date(r.createdAt).getHours();
            hourCounts[hour] = (hourCounts[hour] || 0) + 1;

            // Day of week
            const day = new Date(r.createdAt).getDay();
            dayCounts[day] = (dayCounts[day] || 0) + 1;
        });

        // Only include if we have meaningful data
        const byDevice = Object.entries(deviceCounts)
            .filter(([device]) => device !== 'Unknown' || Object.keys(deviceCounts).length === 1)
            .map(([device, count]) => ({
                device,
                count,
                percentage: totalResponses > 0 ? Number(((count / totalResponses) * 100).toFixed(1)) : 0
            }));

        const byLocation = Object.entries(locationCounts)
            .filter(([city]) => city !== 'Unknown' || Object.keys(locationCounts).length === 1)
            .map(([city, count]) => ({
                city,
                count,
                percentage: totalResponses > 0 ? Number(((count / totalResponses) * 100).toFixed(1)) : 0
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const byTimeOfDay = Object.entries(hourCounts).map(([hour, count]) => ({
            hour: `${String(hour).padStart(2, '0')}:00`,
            count,
            percentage: totalResponses > 0 ? Number(((count / totalResponses) * 100).toFixed(1)) : 0
        })).sort((a, b) => parseInt(a.hour) - parseInt(b.hour));

        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const byDayOfWeek = Object.entries(dayCounts).map(([day, count]) => ({
            dayName: dayNames[parseInt(day)],
            dayNum: parseInt(day),
            count,
            percentage: totalResponses > 0 ? Number(((count / totalResponses) * 100).toFixed(1)) : 0
        })).sort((a, b) => a.dayNum - b.dayNum);

        // ============================================================================
        // 5. QUESTION PERFORMANCE
        // ============================================================================

        // Build question map from survey - support both string id and ObjectId
        const questionMap = {};
        (survey.questions || []).forEach((q, idx) => {
            // Store by string ID
            if (q.id) {
                questionMap[q.id] = {
                    questionNumber: idx + 1,
                    title: q.questionText || q.title?.en || q.title || `Question ${idx + 1}`,
                    type: q.type
                };
            }
            // Also store by ObjectId string if available
            if (q._id) {
                questionMap[q._id.toString()] = {
                    questionNumber: idx + 1,
                    title: q.questionText || q.title?.en || q.title || `Question ${idx + 1}`,
                    type: q.type
                };
            }
        });

        const questionStats = {};

        responses.forEach(r => {
            if (r.answers && Array.isArray(r.answers)) {
                r.answers.forEach((answer, idx) => {
                    // Try to match by questionId (could be ObjectId or string)
                    const qIdStr = answer.questionId?.toString();

                    // Find matching question
                    let qInfo = questionMap[qIdStr];

                    // If not found, try to match by index
                    if (!qInfo && survey.questions[idx]) {
                        const fallbackQ = survey.questions[idx];
                        qInfo = {
                            questionNumber: idx + 1,
                            title: fallbackQ.questionText || fallbackQ.title || `Question ${idx + 1}`,
                            type: fallbackQ.type
                        };
                    }

                    if (!qInfo) {
                        qInfo = { questionNumber: idx + 1, title: `Question ${idx + 1}`, type: 'unknown' };
                    }

                    const statKey = qInfo.questionNumber.toString();

                    if (!questionStats[statKey]) {
                        questionStats[statKey] = {
                            questionNumber: qInfo.questionNumber,
                            title: qInfo.title,
                            type: qInfo.type,
                            responseCount: 0,
                            skipCount: 0,
                            ratings: []
                        };
                    }

                    if (answer.answer !== null && answer.answer !== undefined && answer.answer !== '') {
                        questionStats[statKey].responseCount++;
                        if (typeof answer.answer === 'number') {
                            questionStats[statKey].ratings.push(answer.answer);
                        }
                    } else {
                        questionStats[statKey].skipCount++;
                    }
                });
            }
        });

        const questionPerformance = Object.values(questionStats).map(q => {
            const totalAnswers = q.responseCount + q.skipCount;
            const avgRating = q.ratings.length > 0
                ? Number((q.ratings.reduce((a, b) => a + b, 0) / q.ratings.length).toFixed(2))
                : 0;
            const completionRateQ = totalAnswers > 0 ? Number(((q.responseCount / totalAnswers) * 100).toFixed(1)) : 100;
            const skipRate = totalAnswers > 0 ? Number(((q.skipCount / totalAnswers) * 100).toFixed(1)) : 0;

            return {
                questionNumber: q.questionNumber,
                title: q.title,
                completionRate: completionRateQ,
                averageRating: avgRating,
                averageTimeSpent: 0,
                skipRate,
                performanceScore: Math.round((completionRateQ * 0.6) + (avgRating > 0 ? avgRating * 8 : 50 * 0.4))
            };
        }).sort((a, b) => a.questionNumber - b.questionNumber);

        // Drop-off points
        const dropoffPoints = questionPerformance
            .filter(q => q.skipRate > 10)
            .map(q => ({
                questionNumber: q.questionNumber,
                questionTitle: q.title,
                dropoffRate: q.skipRate,
                usersReached: totalResponses,
                usersCompleted: Math.round(totalResponses * (q.completionRate / 100)),
                usersDropped: Math.round(totalResponses * (q.skipRate / 100))
            }))
            .sort((a, b) => b.dropoffRate - a.dropoffRate);

        // ============================================================================
        // 6. FEEDBACK INSIGHTS
        // ============================================================================

        // Use NPS categories to infer complaints/praises if analysis not available
        const complaints = responses.filter(r => {
            if (r.analysis?.classification?.isComplaint) return true;
            const score = extractNPSScore(r);
            const rating = extractRating(r);
            return (score !== null && score <= 6) || (rating !== null && rating <= 2);
        });

        const praises = responses.filter(r => {
            if (r.analysis?.classification?.isPraise) return true;
            const score = extractNPSScore(r);
            const rating = extractRating(r);
            return (score !== null && score >= 9) || (rating !== null && rating >= 4);
        });

        const urgent = responses.filter(r => {
            if (r.analysis?.urgency === 'high') return true;
            const score = extractNPSScore(r);
            const rating = extractRating(r);
            return (score !== null && score <= 3) || (rating !== null && rating <= 1);
        });

        // Build feedback categories from themes or infer from scores
        const complaintCategories = {};
        complaints.forEach((r, idx) => {
            if (r.analysis?.themes?.length) {
                r.analysis.themes.forEach(theme => {
                    if (!complaintCategories[theme]) {
                        complaintCategories[theme] = { count: 0, summaries: [] };
                    }
                    complaintCategories[theme].count++;
                    complaintCategories[theme].summaries.push(r.analysis?.summary || r.review || '');
                });
            } else {
                const category = 'Low Rating Feedback';
                if (!complaintCategories[category]) {
                    complaintCategories[category] = { count: 0, summaries: [] };
                }
                complaintCategories[category].count++;
                complaintCategories[category].summaries.push(r.review || `Response with low score`);
            }
        });

        const praiseCategories = {};
        praises.forEach(r => {
            if (r.analysis?.themes?.length) {
                r.analysis.themes.forEach(theme => {
                    if (!praiseCategories[theme]) {
                        praiseCategories[theme] = { count: 0, summaries: [] };
                    }
                    praiseCategories[theme].count++;
                    praiseCategories[theme].summaries.push(r.analysis?.summary || r.review || '');
                });
            } else {
                const category = 'Positive Feedback';
                if (!praiseCategories[category]) {
                    praiseCategories[category] = { count: 0, summaries: [] };
                }
                praiseCategories[category].count++;
                praiseCategories[category].summaries.push(r.review || `Response with high score`);
            }
        });

        const topComplaints = Object.entries(complaintCategories)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5)
            .map(([category, data], idx) => ({
                category,
                count: data.count,
                description: data.summaries[0] || `Issues related to ${category}`,
                severity: Math.min(100, Math.round((data.count / Math.max(complaints.length, 1)) * 100) + (5 - idx) * 10)
            }));

        const topPraises = Object.entries(praiseCategories)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5)
            .map(([category, data], idx) => ({
                category,
                count: data.count,
                description: data.summaries[0] || `Appreciation for ${category}`,
                impact: Math.min(100, Math.round((data.count / Math.max(praises.length, 1)) * 100) + (5 - idx) * 10)
            }));

        const urgentIssues = urgent.slice(0, 5).map(r => ({
            title: r.analysis?.themes?.[0] || 'Urgent Issue',
            description: r.analysis?.summary || r.review || 'Requires immediate attention',
            priority: 'High',
            responseId: r._id,
            createdAt: r.createdAt
        }));

        const actionableInsights = [];
        if (topComplaints.length > 0) {
            topComplaints.slice(0, 3).forEach(c => {
                actionableInsights.push({
                    title: `Address ${c.category} concerns`,
                    recommendation: `${c.count} responses mentioned issues with ${c.category}. Consider reviewing this area.`,
                    impact: 'High'
                });
            });
        }
        if (topPraises.length > 0) {
            topPraises.slice(0, 2).forEach(p => {
                actionableInsights.push({
                    title: `Leverage ${p.category} strength`,
                    recommendation: `${p.count} responses praised ${p.category}. This is a key differentiator.`,
                    impact: 'Medium'
                });
            });
        }

        // ============================================================================
        // COMPILE FINAL RESPONSE
        // ============================================================================

        const analytics = {
            overview: {
                totalResponses,
                averageRating,
                completionRate,
                npsScore: npsData.score !== null ? npsData.score : 0,
                responseRate,
                satisfactionScore,
                avgCompletionTime,
                benchmarkComparison: 0
            },

            nps: {
                score: npsData.score !== null ? npsData.score : 0,
                promoters: npsData.promoters || 0,
                passives: npsData.passives || 0,
                detractors: npsData.detractors || 0,
                trend: npsTrend,
                distribution: {
                    promoters: npsData.totalResponses > 0
                        ? Number(((npsData.promoters / npsData.totalResponses) * 100).toFixed(1))
                        : 0,
                    passives: npsData.totalResponses > 0
                        ? Number(((npsData.passives / npsData.totalResponses) * 100).toFixed(1))
                        : 0,
                    detractors: npsData.totalResponses > 0
                        ? Number(((npsData.detractors / npsData.totalResponses) * 100).toFixed(1))
                        : 0
                }
            },

            trends: {
                responsesByDate: responsesByDateArray,
                ratingTrends,
                completionTrends,
                npsHistory,
                responseTrend,
                ratingTrend,
                completionTrend,
                satisfactionTrend: ratingTrend
            },

            demographics: {
                byDevice,
                byLocation,
                byTimeOfDay,
                byDayOfWeek
            },

            sentiment: {
                breakdown: sentimentCounts,
                percentages: {
                    positive: totalResponses > 0
                        ? Number(((sentimentCounts.positive / totalResponses) * 100).toFixed(1))
                        : 0,
                    neutral: totalResponses > 0
                        ? Number(((sentimentCounts.neutral / totalResponses) * 100).toFixed(1))
                        : 0,
                    negative: totalResponses > 0
                        ? Number(((sentimentCounts.negative / totalResponses) * 100).toFixed(1))
                        : 0
                },
                topKeywords,
                emotionalTrends: [],
                satisfactionDrivers: topThemes
            },

            questions: {
                performance: questionPerformance,
                dropoffPoints,
                timeSpent: questionPerformance.map(q => ({
                    questionNumber: q.questionNumber,
                    averageTime: 0,
                    minTime: 0,
                    maxTime: 0,
                    medianTime: 0
                })),
                skipRates: questionPerformance.map(q => ({
                    questionId: q.questionNumber,
                    skipRate: q.skipRate
                }))
            },

            feedback: {
                topComplaints,
                topPraises,
                urgentIssues,
                actionableInsights
            },

            surveyInfo: {
                id: survey._id,
                title: survey.title,
                description: survey.description,
                status: survey.status,
                createdAt: survey.createdAt
            },
            generatedAt: new Date(),
            dateRange: {
                start: rangeStart,
                end: rangeEnd,
                days
            }
        };

        await Logger.info("✅ Comprehensive survey analytics fetched successfully", {
            surveyId,
            totalResponses,
            npsScore: npsData.score,
            avgRating: averageRating
        });

        res.status(200).json(analytics);

    } catch (err) {
        await Logger.error("💥 Error fetching comprehensive survey analytics", {
            error: err.message,
            stack: err.stack
        });
        next(err);
    }
};

// ===== VERIFY SURVEY PASSWORD (for protected surveys) =====
exports.verifySurveyPassword = async (req, res, next) => {
    try {
        const { surveyId, password } = req.body;

        await Logger.info("📥 Verifying survey password", { surveyId, userId: req.user?._id });

        const survey = await Survey.findById(surveyId);

        if (!survey || survey.deleted || survey.status !== "active") {
            await Logger.warn("⚠️ Survey not found or inactive", { surveyId });
            return res.status(404).json({ message: "Survey not found" });
        }

        if (!survey.settings?.isPasswordProtected) {
            await Logger.warn("⚠️ Survey is not password protected", { surveyId });
            return res.status(400).json({ message: "Survey is not password protected" });
        }

        const match = await bcrypt.compare(password, survey.settings.password || "");
        if (!match) {
            await Logger.warn("❌ Invalid survey password attempt", { surveyId, userId: req.user?._id });
            return res.status(401).json({ message: "Invalid password" });
        }

        await Logger.info("✅ Survey password verified", { surveyId, userId: req.user?._id });
        res.status(200).json({ message: "Password verified", surveyId: survey._id });
    } catch (err) {
        await Logger.error("💥 Error verifying survey password", { error: err.message, stack: err.stack });
        next(err);
    }
};

// Add to surveyController.js
exports.createQuestion = async (req, res) => {
    try {
        const { id } = req.params; // Survey ID
        const questionData = req.body; // { type, title: { en, ar }, description: { en, ar }, required, options, logic }

        await Logger.info("📥 Adding question to survey", { surveyId: id, userId: req.user?._id, questionData });

        const survey = await Survey.findById(id);
        if (!survey) {
            await Logger.warn("⚠️ Survey not found while adding question", { surveyId: id });
            return res.status(404).json({ message: "Survey not found" });
        }

        survey.questions.push({ ...questionData, id: new mongoose.Types.ObjectId() });
        await survey.save();

        const addedQuestionId = survey.questions[survey.questions.length - 1].id;
        await Logger.info("✅ Question added successfully", { surveyId: id, questionId: addedQuestionId });

        res.status(201).json({ id: addedQuestionId });
    } catch (error) {
        await Logger.error("💥 Failed to add question", { error: error.message, stack: error.stack });
        res.status(500).json({ message: "Failed to add question", error });
    }
};

exports.deleteQuestion = async (req, res) => {
    try {
        const { id, questionId } = req.params;

        await Logger.info("📥 Deleting question from survey", { surveyId: id, questionId, userId: req.user?._id });

        const survey = await Survey.findById(id);
        if (!survey) {
            await Logger.warn("⚠️ Survey not found while deleting question", { surveyId: id });
            return res.status(404).json({ message: "Survey not found" });
        }

        survey.questions = survey.questions.filter(q => q.id.toString() !== questionId);
        await survey.save();

        await Logger.info("✅ Question deleted successfully", { surveyId: id, questionId });
        res.status(200).json({ message: "Question deleted" });
    } catch (error) {
        await Logger.error("💥 Failed to delete question", { error: error.message, stack: error.stack });
        res.status(500).json({ message: "Failed to delete question", error });
    }
};

// ===== TARGET AUDIENCE & SCHEDULING =====
exports.setTargetAudience = async (req, res, next) => {
    try {
        const { surveyId } = req.params;
        const { audienceType, categories = [], users = [], contacts = [] } = req.body;

        const survey = await Survey.findOne({
            _id: surveyId,
            tenant: req.user.tenant,
            deleted: false
        });

        if (!survey) {
            return res.status(404).json({ message: "Survey not found" });
        }

        // ✅ Anonymous guard
        if (survey.settings.isAnonymous && users.length > 0) {
            return res.status(400).json({
                message: "Anonymous surveys cannot target internal users"
            });
        }

        // ✅ Audience logic (ONLY ONE PATH EXECUTES)
        let targetAudience = { audienceType };

        switch (audienceType) {
            case "all":
                targetAudience = { audienceType: "all" };
                break;

            case "category":
                targetAudience = {
                    audienceType: "category",
                    categories
                };
                break;

            case "custom":
                targetAudience = {
                    audienceType: "custom",
                    users,
                    contacts
                };
                break;

            default:
                return res.status(400).json({ message: "Invalid audienceType" });
        }

        survey.targetAudience = targetAudience;
        await survey.save();

        res.json({
            message: "Target audience saved successfully",
            targetAudience: survey.targetAudience
        });

    } catch (err) {
        next(err);
    }
};

exports.scheduleSurvey = async (req, res, next) => {
    try {
        const { surveyId } = req.params;
        const { startDate, endDate, timezone, autoPublish, repeat } = req.body;

        const survey = await Survey.findOne({
            _id: surveyId,
            tenant: req.user.tenant,
            deleted: false
        });

        if (!survey) {
            return res.status(404).json({ message: "Survey not found" });
        }

        // 🔒 STATUS GUARD
        if (survey.status === "active") {
            return res.status(400).json({
                message: "Active survey cannot be rescheduled"
            });
        }

        if (!survey.targetAudience || !survey.targetAudience.audienceType) {
            return res.status(400).json({
                message: "Set target audience before scheduling"
            });
        }

        const start = new Date(startDate);
        const end = endDate ? new Date(endDate) : null;
        const now = new Date();

        if (isNaN(start.getTime())) {
            return res.status(400).json({ message: "Invalid startDate" });
        }

        if (end && start >= end) {
            return res.status(400).json({
                message: "startDate must be before endDate"
            });
        }

        // ✅ Schedule assign
        survey.schedule = {
            startDate: start,
            endDate: end,
            timezone: timezone || "Asia/Karachi",
            autoPublish: !!autoPublish,
            repeat: repeat || { enabled: false, frequency: "none" },
            publishedAt: null
        };

        // ✅ Status decision
        if (autoPublish && start <= now) {
            survey.status = "active";
            survey.schedule.publishedAt = now;
        } else {
            survey.status = "scheduled";
        }

        await survey.save();

        res.json({
            message: "Survey scheduled successfully",
            status: survey.status,
            schedule: survey.schedule
        });

    } catch (err) {
        next(err);
    }
};

exports.autoPublishScheduledSurveys = async () => {
    try {
        const now = new Date();

        // Find all surveys that should be published NOW
        const scheduledSurveys = await Survey.find({
            status: "scheduled",
            "schedule.startDate": { $lte: now },
            "schedule.autoPublish": true
        }).lean(); // .lean() for faster processing

        if (scheduledSurveys.length === 0) {
            return;
        }

        for (const survey of scheduledSurveys) {
            try {
                // Update survey status
                const updatedSurvey = await Survey.findById(survey._id);

                updatedSurvey.status = "active";
                updatedSurvey.schedule.publishedAt = now;

                // Build recipients
                const phones = updatedSurvey.targetAudience?.phones || [];
                const emails = updatedSurvey.targetAudience?.emails || [];
                const recipients = [...phones, ...emails];

                // Update publish log
                updatedSurvey.publishLog.push({
                    publishedBy: null, // system/cron
                    method: "cron-auto",
                    recipientsCount: recipients.length,
                    timestamp: now
                });

                // Save first
                await updatedSurvey.save();

                // Send WhatsApp in background (fire and forget)
                if (recipients.length > 0) {
                    sendSurveyWhatsApp({
                        body: {
                            surveyId: updatedSurvey._id.toString(),
                            recipients
                        },
                        tenantId: updatedSurvey.tenant,
                        user: { _id: "cron-system" } // optional
                    }).catch(err => {
                        console.error(`WhatsApp failed for survey ${updatedSurvey._id}:`, err.message);
                        Logger.error("WhatsApp send failed in cron", {
                            surveyId: updatedSurvey._id,
                            error: err.message
                        });
                    });
                }

                await Logger.info("Survey auto-published successfully", {
                    surveyId: updatedSurvey._id,
                    title: updatedSurvey.title,
                    recipientsCount: recipients.length
                });


            } catch (surveyError) {
                console.error(`Failed to publish survey ${survey._id}:`, surveyError);
                await Logger.error("Single survey auto-publish failed", {
                    surveyId: survey._id,
                    error: surveyError.message
                });
            }
        }

    } catch (err) {
        console.error("CRON autoPublishScheduledSurveys FAILED:", err);
        await Logger.error("CRON auto-publish job crashed", {
            error: err.message,
            stack: err.stack
        });
    }
};
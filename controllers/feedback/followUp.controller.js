// controllers/feedback/followUp.controller.js
const Action = require("../../models/Action");
const User = require("../../models/User");
const EmailTemplate = require("../../models/EmailTemplate");
const sendEmail = require("../../utils/sendEmail");
const sendSMS = require("../../utils/sendSMS");
const { followUpSchema } = require("../../validators/feedbackValidator");
const Logger = require("../../utils/logger");

/**
 * Send follow-up notifications for actions
 */
exports.followUp = async (req, res) => {
    try {
        const { error, value } = followUpSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message });
        }

        const { actionIds, messageTemplate, method } = value;

        const actions = await Action.find({ _id: { $in: actionIds } }).populate({
            path: "feedback",
            populate: { path: "response", model: "SurveyResponse" }
        });

        const results = [];

        for (const action of actions) {
            const resp = action.feedback?.response;
            let toEmail = null;
            let toPhone = null;
            let foundUser = null;

            if (resp?.user) {
                foundUser = await User.findById(resp.user).select("email phone name");
                if (foundUser) {
                    toEmail = foundUser.email;
                    toPhone = foundUser.phone;
                }
            }

            const sent = { actionId: action._id, email: null, sms: null };

            const message = messageTemplate
                .replace(/\{\{action\}\}/g, action.description)
                .replace(/\{\{feedback\}\}/g, resp?.review || "");

            // Email
            if ((method === "email" || method === "both") && toEmail) {
                try {
                    const template = await EmailTemplate.findOne({
                        type: "followUp_Notification",
                        isActive: true
                    });

                    if (template) {
                        const templateData = {};
                        template.variables.forEach(v => {
                            switch (v) {
                                case "notificationSubject": templateData[v] = "Follow-up on Feedback"; break;
                                case "companyName": templateData[v] = "RatePro"; break;
                                case "currentYear": templateData[v] = new Date().getFullYear(); break;
                                case "userName": templateData[v] = foundUser?.name || "User"; break;
                                case "actionDescription": templateData[v] = action.description; break;
                                case "feedbackText": templateData[v] = resp?.review || ""; break;
                                default: templateData[v] = "";
                            }
                        });

                        sendEmail({
                            to: toEmail,
                            subject: "Follow-up on Feedback",
                            templateType: template.type,
                            templateData
                        });
                    } else {
                        sendEmail({
                            to: toEmail,
                            subject: "Follow-up on Feedback",
                            html: `<p>${message}</p>`
                        });
                    }

                    sent.email = true;
                } catch (emailError) {
                    console.error("Follow-up email error:", emailError);
                }
            }

            // SMS
            if ((method === "sms" || method === "both") && toPhone) {
                await sendSMS({ to: toPhone, body: message });
                sent.sms = true;
            }

            // Update action status
            action.status = action.status === "open" ? "in-progress" : action.status;
            await action.save();

            results.push(sent);
        }

        res.status(200).json({
            success: true,
            message: "Follow-up messages sent successfully",
            data: results
        });

    } catch (err) {
        Logger.error("followUp", "Failed to process follow-up actions", {
            error: err,
            context: {},
            req
        });
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

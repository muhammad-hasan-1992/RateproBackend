// controllers/feedbackController.js
const Survey = require("../models/Survey");
const SurveyResponse = require("../models/SurveyResponse");
const FeedbackAnalysis = require("../models/FeedbackAnalysis");
const Action = require("../models/Action");
const User = require("../models/User");
const aiClient = require("../utils/aiClient");
const sendEmail = require("../utils/sendEmail");
const sendSMS = require("../utils/sendSMS"); // optional helper to implement
const Joi = require("joi");
const { generateActionsFromFeedback } = require("./actionController")
const Logger = require("../utils/logger");

// analyzeFeedback: analyze one or multiple responses (can be called on-demand or from webhook)
const analyzeSchema = Joi.object({
  responseIds: Joi.array().items(Joi.string().hex().length(24)).optional(),
  runAllUnanalyzed: Joi.boolean().optional().default(false),
});

// helper
exports.analyzeFeedbackLogic = async (options, tenantId) => {
  try {
    const { responseIds, runAllUnanalyzed } = options;
    let responses = [];

    if (runAllUnanalyzed) {
      responses = await SurveyResponse.find({ tenant: tenantId }).lean();
    } else if (responseIds?.length) {
      responses = await SurveyResponse.find({ _id: { $in: responseIds }, tenant: tenantId }).lean();
    } else {
      const errMsg = "Provide responseIds or set runAllUnanalyzed=true";
      throw new Error(errMsg);
    }

    const analyses = [];

    for (const resp of responses) {
      const existing = await FeedbackAnalysis.findOne({ response: resp._id });
      if (existing) {
        analyses.push({ responseId: resp._id, status: "skipped", reason: "already analyzed" });
        continue;
      }

      const text = resp.review || (resp.answers || []).map(a => a.answer).join(" ");
      const prompt = `Analyze sentiment... Feedback: ${text}`;

      let aiResult;
      try {
        aiResult = await aiClient.complete({ prompt, maxTokens: 200 });
      } catch (err) {
        console.error("💥 AI Error:", err.message);
        aiResult = { text: null };
      }

      const aiText = aiResult?.text || aiResult?.choices?.[0]?.message?.content || "";
      let sentiment = "neutral";
      let categories = [];

      try {
        if (aiText) {
          const parsed = JSON.parse(aiText);
          sentiment = parsed.sentiment || sentiment;
          categories = parsed.categories || [];
        } else {
          sentiment = naiveSentiment(text);
        }
      } catch {
        sentiment = naiveSentiment(text);
      }

      const fa = await FeedbackAnalysis.create({
        response: resp._id,
        sentiment,
        categories,
        tenant: tenantId,
      });

      analyses.push({ responseId: resp._id, status: "analyzed", analysis: fa });

      if (fa.sentiment === "negative") {
        await generateActionsFromFeedback({
          body: { feedbackIds: [fa._id] },
          user: { tenant: tenantId }
        });
        await sendNotification({ type: "negative_feedback", feedbackId: fa._id });
      } else if (fa.sentiment === "positive") {
        await sendSurveyWhatsApp({ feedbackId: fa._id, messageType: "thank_you" });
      }
    }

    // ✅ Log success only after all analyses done
    // Logger.info("analyzeFeedbackLogic", "Feedback analysis logic executed successfully", {
    //   context: {
    //     tenantId,
    //     totalResponses: responses.length,
    //     totalAnalyzed: analyses.filter(a => a.status === "analyzed").length,
    //     totalSkipped: analyses.filter(a => a.status === "skipped").length
    //   },
    //   req
    // });


    return analyses;

  } catch (err) {
    console.error("💥 Error in analyzeFeedbackLogic:", err.message);
    Logger.error("analyzeFeedbackLogic", "Error during feedback analysis", {
      error: err,
      context: {
        tenantId
      },
      req
    });
    throw err;
  }
};

function naiveSentiment(text) {
  const lower = (text || "").toLowerCase();
  const negative = /(bad|poor|terrible|awful|disappoint|angry|hate|dissatisfied)/.test(lower);
  const positive = /(good|great|excellent|love|awesome|satisfied|happy|very awesome)/.test(lower);

  if (negative && positive) return "mixed"; // NEW
  if (negative) return "negative";
  if (positive) return "positive";
  return "neutral";
}

exports.analyzeFeedback = async (req, res) => {
  try {
    const { error, value } = analyzeSchema.validate(req.body);
    if (error) {
      Logger.error("analyzeFeedback", "Validation failed", {
        error,
        context: {},
        req
      });

      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const analyses = await exports.analyzeFeedbackLogic(value, req.tenantId);

    // Logger.info("analyzeFeedback", "Feedback analysis completed successfully", {
    //   context: {
    //     tenantId: req.tenantId,
    //     analysisCount: analyses?.length || 0
    //   },
    //   req
    // });


    res.status(200).json({
      success: true,
      message: "Feedback analysis completed successfully",
      analyses,
    });
  } catch (error) {
    console.error('analyzeFeedback error:', error);
    Logger.error("analyzeFeedback", "Failed to analyze feedback", {
      error,
      context: {
        tenantId: req.tenantId
      },
      req
    });
    res.status(500).json({
      success: false,
      message: "Failed to analyze feedback",
      error: error.message,
    });
  }
};

const generateSchema = Joi.object({
  feedbackIds: Joi.array().items(Joi.string().hex().length(24)).optional(),
  autoAssignTo: Joi.string().optional(), // userId to assign or team string
});

exports.generateActions = async (req, res) => {
  try {
    const { error, value } = generateSchema.validate(req.body);
    if (error) {
      Logger.error("generateActions", "Validation failed", {
        error,
        context: {},
        req
      });

      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const feedbacks =
      value.feedbackIds && value.feedbackIds.length
        ? await FeedbackAnalysis.find({ _id: { $in: value.feedbackIds }, tenant: req.tenantId }).populate('response')
        : await FeedbackAnalysis.find({ tenant: req.tenantId, createdAt: { $gte: new Date(0) } }).populate('response');

    const created = [];

    for (const fb of feedbacks) {
      let priority = "medium";
      if (fb.sentiment === "negative") priority = "high";
      if (fb.categories && fb.categories.includes("safety")) priority = "high";

      const action = await Action.create({
        feedback: fb._id,
        description: `Follow up on: ${fb.categories?.join(", ") || "General feedback"}. Response excerpt: ${fb.response?.review?.slice(0, 200) || ""
          }`,
        priority,
        assignedTo: value.autoAssignTo || null,
        team: fb.categories?.[0] || "operations",
        tenant: req.tenantId,
        status: "open",
      });

      created.push(action);
    }

    // Logger.info("generateActions", "Actions generated successfully", {
    //   context: {
    //     tenantId: req.tenantId,
    //     count: created.length
    //   },
    //   req
    // });


    res.status(201).json({
      success: true,
      message: "Actions generated successfully",
      actions: created,
    });
  } catch (error) {
    console.error('generateActions error:', error);
    Logger.error("generateActions", "Failed to generate actions", {
      error,
      context: {
        tenantId: req.tenantId
      },
      req
    });
    res.status(500).json({
      success: false,
      message: "Failed to generate actions",
      error: error.message,
    });
  }
};

// followUp: send notifications (email/SMS) based on action/feedback
const followUpSchema = Joi.object({
  actionIds: Joi.array().items(Joi.string().hex().length(24)).required(),
  messageTemplate: Joi.string().required(),
  method: Joi.string().valid("email", "sms", "both").default("email"),
});

// followUp function
// exports.followUp = async (req, res) => {
//   try {
//     const { actionIds, messageTemplate, method = "email" } = req.body;
//     const user = req.user;

//     const actions = await Action.find({ _id: { $in: actionIds } }).populate({
//       path: "feedback",
//       populate: { path: "response", model: "SurveyResponse" }
//     });

//     const results = [];

//     for (const action of actions) {
//       const resp = action.feedback?.response;
//       let toEmail = null;
//       let toPhone = null;

//       if (resp?.user) {
//         const foundUser = await User.findById(resp.user).select("email phone");
//         if (foundUser) {
//           toEmail = foundUser.email;
//           toPhone = foundUser.phone;
//         }
//       }

//       const message = messageTemplate
//         .replace(/\{\{action\}\}/g, action.description)
//         .replace(/\{\{feedback\}\}/g, resp?.review || "");

//       const sent = { actionId: action._id, email: null, sms: null };

//       if ((method === "email" || method === "both") && toEmail) {
//         sendEmail({
//           to: toEmail,
//           subject: "Follow-up on Feedback",
//           html: `<p>${message}</p>`
//         });
//         sent.email = true;
//       }

//       if ((method === "sms" || method === "both") && toPhone) {
//         await sendSMS({
//           to: toPhone,
//           body: message
//         });
//         sent.sms = true;
//       }

//       // update action status
//       action.status = action.status === "open" ? "in-progress" : action.status;
//       await action.save();

//       results.push(sent);
//     }

//     // ✅ Success log
//     await Logger.info('followUp', 'Follow-up actions processed successfully', {
//       triggeredBy: user?.email,
//       method,
//       totalActions: actionIds.length,
//       successCount: results.length
//     });

//     res.status(200).json({
//       success: true,
//       message: "Follow-up messages sent successfully",
//       data: results
//     });
//   } catch (error) {
//     console.error("❌ followUp error:", error);

//     // ❌ Error log
//     await Logger.error('followUp', 'Failed to process follow-up actions', {
//       message: error.message,
//       stack: error.stack
//     });

//     res.status(500).json({
//       success: false,
//       message: error.message
//     });
//   }
// };
exports.followUp = async (req, res) => {
  try {
    const { actionIds, messageTemplate, method = "email" } = req.body;
    const user = req.user;

    const actions = await Action.find({ _id: { $in: actionIds } }).populate({
      path: "feedback",
      populate: { path: "response", model: "SurveyResponse" }
    });

    const results = [];

    for (const action of actions) {
      const resp = action.feedback?.response;
      let toEmail = null;
      let toPhone = null;

      if (resp?.user) {
        const foundUser = await User.findById(resp.user).select("email phone name");
        if (foundUser) {
          toEmail = foundUser.email;
          toPhone = foundUser.phone;
        }
      }

      const sent = { actionId: action._id, email: null, sms: null };

      // Prepare message
      const message = messageTemplate
        .replace(/\{\{action\}\}/g, action.description)
        .replace(/\{\{feedback\}\}/g, resp?.review || "");

      // ----------------- Email -----------------
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
                case "userName": templateData[v] = foundUser.name || "User"; break;
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
            // fallback simple email
            sendEmail({
              to: toEmail,
              subject: "Follow-up on Feedback",
              html: `<p>${message}</p>`
            });
          }

          sent.email = true;
        } catch (emailError) {
          console.error("❌ Follow-up email error:", emailError);
        }
      }

      // ----------------- SMS -----------------
      if ((method === "sms" || method === "both") && toPhone) {
        await sendSMS({ to: toPhone, body: message });
        sent.sms = true;
      }

      // update action status
      action.status = action.status === "open" ? "in-progress" : action.status;
      await action.save();

      results.push(sent);
    }

    // ✅ Success log
    // Logger.info("followUp", "Follow-up actions processed successfully", {
    //   context: {
    //     triggeredBy: user?.email,
    //     method,
    //     totalActions: actionIds.length,
    //     successCount: results.length
    //   },
    //   req
    // });

    res.status(200).json({
      success: true,
      message: "Follow-up messages sent successfully",
      data: results
    });

  } catch (error) {
    console.error("❌ followUp error:", error);

    Logger.error("followUp", "Failed to process follow-up actions", {
      error,
      context: {},
      req
    });


    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// sendsurveyWhatsApp: dummy function to send WhatsApp message
const sendSurveyWhatsApp = async ({ feedbackId, messageType }) => {
  console.log("📱 WhatsApp Thank-you (dummy):", { feedbackId, messageType });
  // Later: Integrate Twilio/WhatsApp API
};

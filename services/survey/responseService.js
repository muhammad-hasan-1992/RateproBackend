// // services/survey/responseService.js
// const SurveyInvite = require("../../models/SurveyInvite");
// const SurveyResponse = require("../../models/SurveyResponse");
// const actionPipeline = require("./responsePipelines/actionPipeline");
// const sentimentPipeline = require("./responsePipelines/sentimentPipeline");
// const Logger = require("../../utils/auditLog");

// module.exports.processResponse = async (token, answers) => {
//   // ---- 1) Validate invite ----
//   const invite = await SurveyInvite.findOne({ inviteToken: token });

//   if (!invite) {
//     throw new Error("Invalid survey link");
//   }

//   if (invite.submittedAt) {
//     throw new Error("Response already submitted");
//   }

//   // ---- 2) Create response ----
//   const response = await SurveyResponse.create({
//     survey: invite.survey,
//     tenant: invite.tenant,
//     invite: invite._id,
//     answers
//   });

//   invite.submittedAt = new Date();
//   invite.status = "submitted";
//   await invite.save();

//   // ---- 3) Trigger background pipelines (non-blocking) ----
//   sentimentPipeline.start(response._id).catch(err => {
//     Logger.error("Sentiment pipeline failed", { error: err.message });
//   });

//   actionPipeline.start(response._id).catch(err => {
//     Logger.error("Auto-action pipeline failed", { error: err.message });
//   });

//   return {
//     responseId: response._id,
//     inviteId: invite._id
//   };
// };
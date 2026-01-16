// controllers/survey/questions.controller.js
const mongoose = require("mongoose");
const Survey = require("../../models/Survey");
const Logger = require("../../utils/logger");

/**
 * Add a question to a survey
 */
exports.createQuestion = async (req, res, next) => {
    try {
        const { id } = req.params;
        const questionData = req.body;

        const survey = await Survey.findById(id);
        if (!survey) {
            return res.status(404).json({ message: "Survey not found" });
        }

        survey.questions.push({ ...questionData, id: new mongoose.Types.ObjectId() });
        await survey.save();

        const addedQuestionId = survey.questions[survey.questions.length - 1].id;

        res.status(201).json({ id: addedQuestionId });
    } catch (err) {
        Logger.error("createQuestion", "Failed to add question", {
            error: err,
            context: { surveyId: req.params?.id },
            req,
        });
        next(err);
    }
};

/**
 * Delete a question from a survey
 */
exports.deleteQuestion = async (req, res, next) => {
    try {
        const { id, questionId } = req.params;

        const survey = await Survey.findById(id);
        if (!survey) {
            return res.status(404).json({ message: "Survey not found" });
        }

        survey.questions = survey.questions.filter(
            (q) => String(q._id) !== String(questionId) && String(q.id) !== String(questionId)
        );
        await survey.save();

        res.status(200).json({ message: "Question deleted" });
    } catch (err) {
        Logger.error("deleteQuestion", "Failed to delete question", {
            error: err,
            context: { surveyId: req.params?.id, questionId: req.params?.questionId },
            req,
        });
        next(err);
    }
};

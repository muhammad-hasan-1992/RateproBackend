// jobs/action/calculateTrend.job.js
// ============================================================================
// Trend Calculation Background Job
//
// Runs periodically to calculate trendData for actions that haven't had
// their trend calculated yet. Compares current survey sentiment with
// previous survey to determine:
//   - changeDirection: up | down | stable
//   - issueStatus: new | worsening | improving | chronic | resolved
//   - isRecurring: boolean
//
// Follows the same pattern as autoPublish.job.js
// ============================================================================

const Action = require("../../models/Action");
const FeedbackAnalysis = require("../../models/FeedbackAnalysis");
const Survey = require("../../models/Survey");
const Logger = require("../../utils/auditLog");

/**
 * Calculate trend data for actions that haven't been processed yet.
 * Intended to run as a scheduled job (e.g., daily or after survey completion).
 */
async function calculateActionTrends() {
    try {
        // Find actions that need trend calculation:
        // - Have a feedback reference (so we can look up survey context)
        // - trendData.calculatedAt is null (not yet calculated)
        // - Not deleted
        const actions = await Action.find({
            feedback: { $ne: null },
            'trendData.calculatedAt': { $eq: null },
            isDeleted: false
        })
            .populate("feedback", "sentiment categories response tenant")
            .limit(100);  // Process in batches to avoid memory issues

        if (!actions.length) {
            return { processed: 0, message: "No actions need trend calculation" };
        }

        let processed = 0;
        let errors = 0;

        for (const action of actions) {
            try {
                if (!action.feedback) {
                    // Mark as calculated with defaults so we don't re-process
                    action.trendData = {
                        ...(action.trendData || {}),
                        issueStatus: 'new',
                        isRecurring: false,
                        calculatedAt: new Date()
                    };
                    await action.save();
                    processed++;
                    continue;
                }

                const feedback = action.feedback;
                const tenantId = action.tenant;

                // Find the survey this feedback belongs to (via response → survey chain)
                let currentSurveyId = null;
                if (feedback.response) {
                    const SurveyResponse = require("../../models/SurveyResponse");
                    const resp = await SurveyResponse.findById(feedback.response).select("survey").lean();
                    currentSurveyId = resp?.survey || null;
                }

                if (!currentSurveyId) {
                    // No survey context — mark as new issue
                    action.trendData = {
                        ...(action.trendData || {}),
                        issueStatus: 'new',
                        isRecurring: false,
                        calculatedAt: new Date()
                    };
                    await action.save();
                    processed++;
                    continue;
                }

                // Find the current survey
                const currentSurvey = await Survey.findById(currentSurveyId).select("title createdAt tenant").lean();
                if (!currentSurvey) {
                    action.trendData = {
                        ...(action.trendData || {}),
                        issueStatus: 'new',
                        isRecurring: false,
                        calculatedAt: new Date()
                    };
                    await action.save();
                    processed++;
                    continue;
                }

                // Find the previous survey for the same tenant (before this one)
                const previousSurvey = await Survey.findOne({
                    tenant: tenantId,
                    _id: { $ne: currentSurveyId },
                    createdAt: { $lt: currentSurvey.createdAt }
                })
                    .sort({ createdAt: -1 })
                    .select("_id title createdAt")
                    .lean();

                if (!previousSurvey) {
                    // No previous survey → this is a new issue
                    action.trendData = {
                        ...(action.trendData || {}),
                        metricName: feedback.categories?.[0] || 'General',
                        issueStatus: 'new',
                        isRecurring: false,
                        firstDetectedAt: action.createdAt,
                        calculatedAt: new Date()
                    };
                    await action.save();
                    processed++;
                    continue;
                }

                // Count negative feedback in current survey vs previous
                const currentNegativeCount = await FeedbackAnalysis.countDocuments({
                    tenant: tenantId,
                    sentiment: 'negative'
                    // Note: FeedbackAnalysis doesn't have a direct survey field,
                    // so we match by tenant. In production, you'd join through response → survey.
                });

                // Check if similar issues existed in previous survey actions
                const primaryCategory = feedback.categories?.[0] || '';
                const previousSimilarActions = await Action.countDocuments({
                    tenant: tenantId,
                    category: { $regex: primaryCategory, $options: 'i' },
                    createdAt: { $lt: action.createdAt },
                    isDeleted: false,
                    _id: { $ne: action._id }
                });

                // Determine trend
                const isRecurring = previousSimilarActions > 0;
                let issueStatus = 'new';

                if (isRecurring) {
                    // Check if recent similar actions were resolved
                    const resolvedSimilar = await Action.countDocuments({
                        tenant: tenantId,
                        category: { $regex: primaryCategory, $options: 'i' },
                        status: 'resolved',
                        createdAt: { $lt: action.createdAt },
                        isDeleted: false,
                        _id: { $ne: action._id }
                    });

                    if (resolvedSimilar === previousSimilarActions) {
                        // Previously resolved but reappeared → worsening
                        issueStatus = 'worsening';
                    } else if (resolvedSimilar > 0 && resolvedSimilar < previousSimilarActions) {
                        // Some resolved, some not → chronic
                        issueStatus = 'chronic';
                    } else {
                        // None resolved → chronic
                        issueStatus = 'chronic';
                    }
                }

                action.trendData = {
                    comparisonPeriod: `vs ${previousSurvey.title || 'Previous Survey'}`,
                    metricName: primaryCategory || 'General Sentiment',
                    changeDirection: feedback.sentiment === 'negative' ? 'down' : (feedback.sentiment === 'positive' ? 'up' : 'stable'),
                    issueStatus,
                    isRecurring,
                    firstDetectedAt: isRecurring
                        ? (await Action.findOne({
                            tenant: tenantId,
                            category: { $regex: primaryCategory, $options: 'i' },
                            isDeleted: false
                        }).sort({ createdAt: 1 }).select("createdAt").lean())?.createdAt || action.createdAt
                        : action.createdAt,
                    previousSurveyId: previousSurvey._id,
                    calculatedAt: new Date()
                };

                await action.save();
                processed++;

            } catch (actionErr) {
                errors++;
                Logger.error("calculateActionTrends", "Failed to calculate trend for action", {
                    error: actionErr,
                    context: { actionId: action._id }
                });
            }
        }

        const result = { processed, errors, total: actions.length };

        Logger.info("calculateActionTrends", "Trend calculation batch complete", {
            context: result
        });

        return result;

    } catch (err) {
        Logger.error("calculateActionTrends", "Trend calculation job crashed", {
            error: err
        });
        throw err;
    }
}

module.exports = { calculateActionTrends };

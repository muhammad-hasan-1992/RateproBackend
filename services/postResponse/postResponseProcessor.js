// services/postResponse/postResponseProcessor.js
/**
 * Post-Response Processor
 * 
 * Client Requirement 1: Automatic Analysis Trigger on Feedback Submission
 * - Analysis runs immediately after successful response persistence
 * - No manual action required from administrators
 * - Every submitted response treated as a business signal
 */
const analyticsService = require("../analytics/analyticsService");
const aiInsightService = require("../ai/aiInsightService");
const autoActionService = require("../actions/autoActionService");
const notificationService = require("../notifications/notificationService");
const sentimentService = require("../analytics/sentimentService");
const npsService = require("../analytics/npsService");
const SurveyResponse = require("../../models/SurveyResponse");
const Logger = require("../../utils/auditLog");

exports.processPostSurveyResponse = async ({
  response,
  survey,
  tenantId
}) => {
  const responseId = response?._id || response?.id || 'unknown';
  const surveyId = survey?._id || survey?.id || 'unknown';
  
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🔄 [PostResponseProcessor] STARTED`);
  console.log(`   Response ID: ${responseId}`);
  console.log(`   Survey ID: ${surveyId}`);
  console.log(`   Tenant ID: ${tenantId}`);
  console.log(`   Is Anonymous: ${response?.isAnonymous || false}`);
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  console.log(`${'─'.repeat(60)}`);

  try {
    Logger.info("Post-response processing started", {
      responseId: response._id,
      surveyId: survey._id,
      isAnonymous: response.isAnonymous
    });

    // ============================================================
    // STEP 1: UPDATE SURVEY ANALYTICS (Non-blocking)
    // Client Requirement 4: Survey-Level Insight Aggregation
    // ============================================================
    console.log(`\n📊 [Step 1/6] Updating survey analytics (async)...`);
    analyticsService
      .updateSurveyAnalytics({ response, survey })
      .then(() => console.log(`   ✅ Survey analytics updated successfully`))
      .catch(err => {
        console.error(`   ❌ Survey analytics update failed:`, err.message);
        Logger.error("Analytics update failed", { err: err.message });
      });

    // ============================================================
    // STEP 2: AI-DRIVEN CONTENT ANALYSIS
    // Client Requirement 2: Response-Level Content Analysis
    // - Sentiment classification
    // - Emotion/tone detection
    // - Keyword and theme extraction
    // - Complaints/praises/suggestions identification
    // ============================================================
    console.log(`\n🤖 [Step 2/6] Running AI content analysis...`);
    const startAI = Date.now();
    const insight = await aiInsightService.analyzeResponse({
      response,
      survey
    });
    console.log(`   ✅ AI analysis completed in ${Date.now() - startAI}ms`);
    console.log(`   Sentiment: ${insight?.sentiment || 'N/A'}`);
    console.log(`   Urgency: ${insight?.urgency || 'N/A'}`);
    console.log(`   Should generate action: ${insight?.shouldGenerateAction || false}`);

    // ============================================================
    // STEP 3: QUANTITATIVE METRICS CALCULATION
    // Client Requirement 3: Quantitative Feedback Interpretation
    // - Normalize and validate scores
    // - Map to CSI, NPS metrics
    // ============================================================
    console.log(`\n📈 [Step 3/6] Processing quantitative metrics...`);
    const metrics = processQuantitativeMetrics(response, survey);
    console.log(`   Rating: ${metrics.rating || 'N/A'}`);
    console.log(`   NPS Score: ${metrics.npsScore || 'N/A'}`);
    console.log(`   NPS Category: ${metrics.npsCategory || 'N/A'}`);
    console.log(`   Rating Category: ${metrics.ratingCategory || 'N/A'}`);

    // ============================================================
    // STEP 4: ENRICH RESPONSE WITH ANALYSIS METADATA
    // Client Requirement 2: Enrich response with analytical metadata
    // ============================================================
    console.log(`\n📝 [Step 4/6] Enriching response with metadata...`);
    await enrichResponseWithMetadata(responseId, insight, metrics);
    console.log(`   ✅ Response enriched with analysis metadata`);

    // ============================================================
    // STEP 5: AUTO ACTION GENERATION (Rule-based + AI-driven)
    // Client Requirement 5: Action & Workflow Triggering
    // - Negative sentiment triggers follow-up tasks
    // - Repeated complaints generate alerts
    // - High-risk feedback escalates to higher priority
    // - Positive feedback contributes to recognition tracking
    // ============================================================
    console.log(`\n⚡ [Step 5/6] Evaluating action rules...`);
    
    // Combine AI insight with metrics for comprehensive evaluation
    const combinedInsight = {
      ...insight,
      classification: insight.classification || {
        isComplaint: insight.sentiment === 'negative',
        isPraise: insight.sentiment === 'positive',
        isSuggestion: false
      }
    };

    // Check if we need to track praise (no action, just recognition)
    if (combinedInsight.sentiment === 'positive' && combinedInsight.classification?.isPraise) {
      console.log(`   🌟 Tracking positive feedback for recognition...`);
      await autoActionService.trackPraise({
        response,
        survey,
        tenantId,
        insight: combinedInsight
      });
    }

    // Evaluate rules and create action if needed
    const triggeredRules = autoActionService.evaluateRules(combinedInsight, response);
    console.log(`   Rules triggered: ${triggeredRules.length}`);
    
    if (triggeredRules.length > 0 || combinedInsight.shouldGenerateAction) {
      console.log(`   → Creating action from insight...`);
      const action = await autoActionService.createActionFromInsight({
        insight: combinedInsight,
        response,
        survey,
        tenantId
      });
      
      if (action) {
        console.log(`   ✅ Action created: ${action._id}`);
        console.log(`   Priority: ${action.priority}`);
        console.log(`   Category: ${action.category}`);

        // ============================================================
        // STEP 6: NOTIFICATIONS FOR URGENT ACTIONS
        // Client Requirement 7: Alert Generation & Monitoring
        // ============================================================
        console.log(`\n🔔 [Step 6/6] Checking notifications...`);
        if (action.priority === "high") {
          console.log(`   → Sending urgent notification...`);
          notificationService.notifyUrgentAction(action)
            .then(() => console.log(`   ✅ Notification sent`))
            .catch((err) => console.error(`   ❌ Notification failed:`, err.message));
        } else {
          console.log(`   ℹ️ Priority is "${action.priority}", skipping urgent notification`);
        }
      } else {
        console.log(`   ℹ️ No action created (rules evaluated but no action needed)`);
        console.log(`\n🔔 [Step 6/6] Skipped (no action created)`);
      }
    } else {
      console.log(`   ℹ️ No action rules triggered`);
      console.log(`\n🔔 [Step 6/6] Skipped (no action needed)`);
    }

    // ============================================================
    // CHECK FOR REPEATED COMPLAINT PATTERNS
    // Client Requirement 5: Repeated complaint themes generating alerts
    // ============================================================
    console.log(`\n🔍 Checking for repeated complaint patterns...`);
    const repeatedAlerts = await autoActionService.checkRepeatedComplaints(tenantId, {
      hours: 24,
      threshold: 3
    });
    if (repeatedAlerts.length > 0) {
      console.log(`   ⚠️ Found ${repeatedAlerts.length} repeated complaint patterns`);
      repeatedAlerts.forEach(alert => {
        console.log(`   - ${alert.category}: ${alert.count} issues (${alert.severity})`);
      });
      // Could trigger additional notifications here
    } else {
      console.log(`   ✅ No repeated complaint patterns detected`);
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`✅ [PostResponseProcessor] COMPLETED`);
    console.log(`   Response ID: ${responseId}`);
    console.log(`   Processing Mode: ${response.isAnonymous ? 'Anonymous (aggregate only)' : 'Identified (CRM enrichment enabled)'}`);
    console.log(`${'─'.repeat(60)}\n`);

    Logger.info("Post-response processing completed", {
      responseId: response._id,
      sentiment: insight?.sentiment,
      actionsTriggered: triggeredRules.length,
      isAnonymous: response.isAnonymous
    });

    return {
      success: true,
      insight,
      metrics,
      triggeredRules: triggeredRules.map(r => r.ruleName)
    };

  } catch (error) {
    console.error(`\n${'─'.repeat(60)}`);
    console.error(`❌ [PostResponseProcessor] CRASHED`);
    console.error(`   Response ID: ${responseId}`);
    console.error(`   Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    console.error(`${'─'.repeat(60)}\n`);

    Logger.error("Post-response processor crashed", {
      error: error.message,
      stack: error.stack
    });

    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Process quantitative metrics from response
 * Client Requirement 3: Quantitative Feedback Interpretation
 * 
 * Extracts NPS and rating values from:
 * 1. Top-level response.score and response.rating (if provided)
 * 2. Answers array by matching question types
 */
function processQuantitativeMetrics(response, survey) {
  const metrics = {
    rating: null,
    ratingCategory: null,
    npsScore: null,
    npsCategory: null,
    normalizedScore: null,
    allRatings: [],
    avgRating: null
  };

  // First check top-level fields (if explicitly provided)
  if (response.rating !== undefined && response.rating !== null) {
    metrics.rating = Number(response.rating);
    metrics.ratingCategory = npsService.categorizeRating(metrics.rating, 5);
  }

  if (response.score !== undefined && response.score !== null) {
    metrics.npsScore = Number(response.score);
  }

  // Extract from answers by matching question types
  const answers = response.answers || [];
  const questions = survey?.questions || [];

  // Build a map of questionId -> question for quick lookup
  const questionMap = new Map();
  questions.forEach(q => {
    // Support both ObjectId and string id
    const qId = q._id?.toString() || q.id;
    if (qId) {
      questionMap.set(qId, q);
    }
  });

  // Iterate through answers and extract metrics based on question type
  for (const ans of answers) {
    const questionId = ans.questionId?.toString();
    const question = questionMap.get(questionId);
    
    if (!question) {
      // Try to infer from answer value if question not found
      const ansValue = parseAnswerValue(ans.answer);
      if (ansValue !== null) {
        metrics.allRatings.push(ansValue);
      }
      continue;
    }

    const qType = question.type?.toLowerCase();
    const ansValue = parseAnswerValue(ans.answer);

    if (ansValue === null) continue;

    switch (qType) {
      case 'nps':
        // NPS is 0-10 scale
        if (metrics.npsScore === null) {
          metrics.npsScore = Math.min(10, Math.max(0, ansValue));
        }
        break;
        
      case 'rating':
      case 'scale':
      case 'likert':
        // Rating is typically 1-5 or 1-10
        metrics.allRatings.push(ansValue);
        if (metrics.rating === null) {
          metrics.rating = ansValue;
        }
        break;
        
      case 'numeric':
        // Could be rating or other numeric input
        if (ansValue >= 0 && ansValue <= 10) {
          metrics.allRatings.push(ansValue);
        }
        break;
    }
  }

  // Calculate NPS category if we have an NPS score
  if (metrics.npsScore !== null) {
    if (metrics.npsScore >= 9) {
      metrics.npsCategory = 'promoter';
    } else if (metrics.npsScore <= 6) {
      metrics.npsCategory = 'detractor';
    } else {
      metrics.npsCategory = 'passive';
    }

    // Normalize to 0-100 scale
    metrics.normalizedScore = npsService.normalizeScore(
      metrics.npsScore, 
      { min: 0, max: 10 }, 
      { min: 0, max: 100 }
    );
  }

  // Calculate rating category if we have a rating
  if (metrics.rating !== null) {
    metrics.ratingCategory = npsService.categorizeRating(metrics.rating, 5);
  }

  // Calculate average of all ratings
  if (metrics.allRatings.length > 0) {
    metrics.avgRating = metrics.allRatings.reduce((a, b) => a + b, 0) / metrics.allRatings.length;
    metrics.avgRating = Math.round(metrics.avgRating * 100) / 100; // Round to 2 decimal places
  }

  return metrics;
}

/**
 * Parse answer value to a number
 * Handles various formats: number, string number, "Very Likely" etc.
 */
function parseAnswerValue(answer) {
  if (answer === null || answer === undefined) return null;
  
  // Already a number
  if (typeof answer === 'number') {
    return answer;
  }
  
  // String that's a number
  if (typeof answer === 'string') {
    const trimmed = answer.trim();
    
    // Direct number parsing
    const parsed = parseFloat(trimmed);
    if (!isNaN(parsed)) {
      return parsed;
    }
    
    // Common NPS text mappings
    const npsTextMap = {
      'not at all likely': 0,
      'not likely': 2,
      'unlikely': 3,
      'somewhat unlikely': 4,
      'neutral': 5,
      'somewhat likely': 6,
      'likely': 7,
      'very likely': 9,
      'extremely likely': 10
    };
    
    const lowerAnswer = trimmed.toLowerCase();
    if (npsTextMap.hasOwnProperty(lowerAnswer)) {
      return npsTextMap[lowerAnswer];
    }
    
    // Common rating text mappings
    const ratingTextMap = {
      'very poor': 1,
      'poor': 2,
      'average': 3,
      'fair': 3,
      'good': 4,
      'very good': 5,
      'excellent': 5
    };
    
    if (ratingTextMap.hasOwnProperty(lowerAnswer)) {
      return ratingTextMap[lowerAnswer];
    }
  }
  
  return null;
}

/**
 * Enrich response document with analysis metadata
 * Client Requirement 2: Each response enriched with analytical metadata
 */
async function enrichResponseWithMetadata(responseId, insight, metrics) {
  try {
    await SurveyResponse.findByIdAndUpdate(responseId, {
      $set: {
        "analysis.sentiment": insight.sentiment,
        "analysis.sentimentScore": insight.sentimentScore,
        "analysis.urgency": insight.urgency,
        "analysis.emotions": insight.emotions || [],
        "analysis.keywords": insight.keywords || [],
        "analysis.themes": insight.themes || [],
        "analysis.classification": insight.classification || {},
        "analysis.summary": insight.summary,
        "analysis.npsCategory": metrics.npsCategory,
        "analysis.ratingCategory": metrics.ratingCategory,
        "analysis.analyzedAt": new Date()
      }
    });
  } catch (error) {
    console.error(`   ⚠️ Failed to enrich response metadata:`, error.message);
    // Non-fatal error, continue processing
  }
}

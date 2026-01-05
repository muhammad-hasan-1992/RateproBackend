// controllers/ai/analyzeText.controller.js
const aiClient = require("../../utils/aiClient");
const Logger = require("../../utils/auditLog");
const asyncHandler = require("express-async-handler");

/**
 * Extract JSON from AI response that may be wrapped in markdown code blocks
 */
function extractJSON(text) {
  if (!text) return null;
  let cleaned = text.trim();
  const codeBlockMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }
  return cleaned;
}

/**
 * Analyze text for sentiment and insights
 * Client Requirement 2: AI-driven content analysis
 * 
 * @route   POST /api/ai/text/analyze
 * @access  Private
 */
exports.analyzeText = asyncHandler(async (req, res) => {
  const { text, options = {} } = req.body;
  const tenantId = req.tenantId || req.user?.tenant;

  if (!text || text.length < 3) {
    return res.status(400).json({
      success: false,
      message: "Text is required and must be at least 3 characters"
    });
  }

  const { 
    includeSentiment = true,
    includeEmotions = true,
    includeKeywords = true,
    includeThemes = true,
    includeSummary = true
  } = options;

  const analysisRequest = [];
  if (includeSentiment) analysisRequest.push('"sentiment": "positive|neutral|negative"');
  if (includeSentiment) analysisRequest.push('"sentimentScore": number between -1 and 1');
  if (includeEmotions) analysisRequest.push('"emotions": ["emotion1", "emotion2"]');
  if (includeKeywords) analysisRequest.push('"keywords": ["keyword1", "keyword2"]');
  if (includeThemes) analysisRequest.push('"themes": ["theme1", "theme2"]');
  if (includeSummary) analysisRequest.push('"summary": "brief summary"');

  const aiResult = await aiClient.complete({
    prompt: `
Analyze this text and return JSON only (no markdown):

{
  ${analysisRequest.join(',\n  ')},
  "classification": {
    "isComplaint": boolean,
    "isPraise": boolean,
    "isSuggestion": boolean
  },
  "urgency": "low|medium|high",
  "confidence": number between 0 and 1
}

Text to analyze:
"${text.substring(0, 2000)}"
    `,
    maxTokens: 500
  });

  try {
    const cleanedJSON = extractJSON(aiResult.text);
    const analysis = JSON.parse(cleanedJSON);

    Logger.info("analyzeText", "Text analysis completed", {
      context: {
        tenantId,
        userId: req.user?._id,
        textLength: text.length,
        sentiment: analysis.sentiment
      },
      req
    });

    res.status(200).json({
      success: true,
      message: "Text analysis completed",
      data: {
        input: {
          text: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
          length: text.length
        },
        analysis
      }
    });

  } catch (parseError) {
    Logger.error("analyzeText", "Failed to parse AI response", {
      error: parseError,
      context: {
        tenantId,
        userId: req.user?._id,
        rawResponse: aiResult.text?.substring(0, 200)
      },
      req
    });

    res.status(200).json({
      success: true,
      message: "Analysis completed with fallback",
      data: {
        input: {
          text: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
          length: text.length
        },
        analysis: {
          sentiment: "neutral",
          confidence: 0,
          error: "Could not parse detailed analysis"
        }
      }
    });
  }
});

/**
 * Extract keywords from text
 * 
 * @route   POST /api/ai/text/keywords
 * @access  Private
 */
exports.extractKeywords = asyncHandler(async (req, res) => {
  const { text, limit = 10 } = req.body;
  const tenantId = req.tenantId || req.user?.tenant;

  if (!text || text.length < 10) {
    return res.status(400).json({
      success: false,
      message: "Text must be at least 10 characters"
    });
  }

  const aiResult = await aiClient.complete({
    prompt: `
Extract the top ${limit} most important keywords/phrases from this text.
Return JSON only: { "keywords": ["keyword1", "keyword2", ...] }

Text:
"${text.substring(0, 2000)}"
    `,
    maxTokens: 200
  });

  try {
    const cleanedJSON = extractJSON(aiResult.text);
    const result = JSON.parse(cleanedJSON);

    res.status(200).json({
      success: true,
      message: "Keywords extracted",
      data: {
        keywords: result.keywords || [],
        count: result.keywords?.length || 0
      }
    });

  } catch (error) {
    res.status(200).json({
      success: true,
      message: "Keyword extraction completed with fallback",
      data: {
        keywords: [],
        count: 0,
        error: "Could not extract keywords"
      }
    });
  }
});

/**
 * Summarize text
 * 
 * @route   POST /api/ai/text/summarize
 * @access  Private
 */
exports.summarizeText = asyncHandler(async (req, res) => {
  const { text, maxLength = 100 } = req.body;
  const tenantId = req.tenantId || req.user?.tenant;

  if (!text || text.length < 20) {
    return res.status(400).json({
      success: false,
      message: "Text must be at least 20 characters"
    });
  }

  const aiResult = await aiClient.complete({
    prompt: `
Summarize this text in ${maxLength} words or less.
Return JSON only: { "summary": "your summary here" }

Text:
"${text.substring(0, 3000)}"
    `,
    maxTokens: 300
  });

  try {
    const cleanedJSON = extractJSON(aiResult.text);
    const result = JSON.parse(cleanedJSON);

    res.status(200).json({
      success: true,
      message: "Text summarized",
      data: {
        summary: result.summary || "",
        originalLength: text.length,
        summaryLength: result.summary?.length || 0
      }
    });

  } catch (error) {
    res.status(200).json({
      success: true,
      message: "Summarization completed with fallback",
      data: {
        summary: text.substring(0, maxLength * 5) + "...",
        originalLength: text.length,
        error: "Could not generate AI summary"
      }
    });
  }
});

/**
 * Classify text into categories
 * 
 * @route   POST /api/ai/text/classify
 * @access  Private
 */
exports.classifyText = asyncHandler(async (req, res) => {
  const { text, categories } = req.body;
  const tenantId = req.tenantId || req.user?.tenant;

  if (!text || text.length < 5) {
    return res.status(400).json({
      success: false,
      message: "Text must be at least 5 characters"
    });
  }

  const defaultCategories = [
    "Product Quality",
    "Customer Service",
    "Pricing",
    "Delivery/Shipping",
    "Website/App",
    "General Feedback",
    "Other"
  ];

  const categoriesToUse = categories || defaultCategories;

  const aiResult = await aiClient.complete({
    prompt: `
Classify this feedback into one of these categories: ${categoriesToUse.join(", ")}
Return JSON only: { "category": "chosen category", "confidence": 0.0-1.0 }

Feedback:
"${text.substring(0, 1000)}"
    `,
    maxTokens: 100
  });

  try {
    const cleanedJSON = extractJSON(aiResult.text);
    const result = JSON.parse(cleanedJSON);

    res.status(200).json({
      success: true,
      message: "Text classified",
      data: {
        category: result.category,
        confidence: result.confidence,
        availableCategories: categoriesToUse
      }
    });

  } catch (error) {
    res.status(200).json({
      success: true,
      message: "Classification completed with fallback",
      data: {
        category: "Other",
        confidence: 0,
        availableCategories: categoriesToUse,
        error: "Could not classify text"
      }
    });
  }
});
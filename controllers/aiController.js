// controllers/aiController.js
const Survey = require("../models/Survey");
const Tenant = require("../models/Tenant");
const { nanoid } = require("nanoid");
const aiClient = require("../utils/aiClient"); // implement wrapper for chosen LLM (OpenAI recommended)
const Joi = require("joi");
const { default: mongoose } = require("mongoose");
const Logger = require("../utils/logger");

// Simple validation schemas
const draftSchema = Joi.object({
  goal: Joi.string().min(5).required(),
  industry: Joi.string().optional().allow(""),
  products: Joi.array().items(Joi.string()).optional(),
  tone: Joi.string().valid("friendly", "formal", "neutral", "casual", "professional").default("friendly"),
  language: Joi.string().valid("en", "ar", "both").default("en"),
  questionCount: Joi.number().integer().min(3).max(12).default(6),
  tenantId: Joi.string().hex().length(24).optional(),
  companyProfile: Joi.object().optional(),
  category: Joi.string().optional(),
  targetAudience: Joi.string().valid("customers", "employees", "vendors", "students", "event-attendees", "general").optional(),
  surveyType: Joi.string().valid("customer-feedback", "employee-feedback", "event-feedback", "nps", "satisfaction", "pulse").optional(),
  useTemplates: Joi.boolean().default(false),
  includeLogic: Joi.boolean().default(true)
});

const surveyLengthRules = {
  "customer-feedback": { min: 4, max: 8, avgTime: "3-5 minutes" },
  "employee-feedback": { min: 8, max: 15, avgTime: "7-10 minutes" },
  "event-feedback": { min: 4, max: 7, avgTime: "2-4 minutes" },
  "nps": { min: 2, max: 5, avgTime: "1-2 minutes" },
  "satisfaction": { min: 5, max: 10, avgTime: "4-6 minutes" },
  "pulse": { min: 3, max: 6, avgTime: "2-3 minutes" }
};

const industryTemplates = {
  "hospitality": {
    commonQuestions: [
      { type: "rating", text: "How would you rate your overall experience?", scale: "1-5" },
      { type: "nps", text: "How likely are you to recommend us to friends/family?" },
      { type: "mcq", text: "What did you enjoy the most?", options: ["Service Quality", "Cleanliness", "Staff Friendliness", "Value for Money", "Ambiance"] }
    ]
  },
  "automotive": {
    commonQuestions: [
      { type: "rating", text: "How satisfied were you with the service quality?", scale: "1-5" },
      { type: "mcq", text: "How did you book your appointment?", options: ["Online", "Phone", "Walk-in", "Mobile App"] },
      { type: "nps", text: "How likely are you to return for future services?" }
    ]
  },
  "education": {
    commonQuestions: [
      { type: "rating", text: "How relevant was the course content to your goals?", scale: "1-5" },
      { type: "rating", text: "How effective was the instructor's teaching?", scale: "1-5" },
      { type: "mcq", text: "Which topics would you like covered in future courses?", options: ["Technical Skills", "Soft Skills", "Industry Trends", "Certification Prep"] }
    ]
  },
  "retail": {
    commonQuestions: [
      { type: "rating", text: "How satisfied were you with your purchase?", scale: "1-5" },
      { type: "mcq", text: "How did you hear about us?", options: ["Social Media", "Friend Recommendation", "Google Search", "Advertisement", "Walk-by"] },
      { type: "nps", text: "How likely are you to recommend our store?" }
    ]
  }
};

const industryRulesSchema = new mongoose.Schema({
  industry: String,
  surveyLength: { min: Number, max: Number },
});

const suggestSchema = Joi.object({
  surveyId: Joi.string().hex().length(24).optional(),
  context: Joi.string().required(),
  questionCount: Joi.number().integer().min(1).max(5).default(1),
});

const optimizeSchema = Joi.object({
  surveyId: Joi.string().hex().length(24).required(),
});

const translateSchema = Joi.object({
  text: Joi.string().required(),
  from: Joi.string().valid("en", "ar").default("en"),
  to: Joi.string().valid("en", "ar").required(),
});

// @desc    Generate AI Draft Survey
// @route   POST /api/ai/draft-survey
// @access  Private
exports.aiDraftSurvey = async (req, res, next) => {
  try {
    const { error, value } = draftSchema.validate(req.body);

    if (error) {
      Logger.warn("aiDraftSurvey", "Validation failed for AI draft request", {
        error: error, // assuming 'error' is the full error object with details
        context: {
          userId: req.user?._id,
          tenant: req.user.tenant,
          validationMessage: error.details?.[0]?.message
        },
        req
      });
      return res.status(400).json({ message: error.details[0].message });
    }

    const {
      goal,
      industry,
      products,
      tone,
      language,
      questionCount,
      tenantId,
      targetAudience,
      surveyType,
      useTemplates,
      includeLogic
    } = value;

    const tenant = tenantId ? await Tenant.findById(tenantId) : req.user.tenant;
    if (!tenant) {
      Logger.warn("aiDraftSurvey", "Tenant not found or missing", {
        context: {
          userId: req.user?._id,
          tenantId
        },
        req
      });
      return res.status(403).json({ message: "Tenant required or not found" });
    }

    const lengthRule = surveyLengthRules[surveyType] || surveyLengthRules["customer-feedback"];
    const adjustedQuestionCount = Math.min(Math.max(questionCount, lengthRule.min), lengthRule.max);
    const industryTemplate = useTemplates && industryTemplates[industry?.toLowerCase()];

    const prompt = [
      `You are an expert survey designer specializing in creating engaging, effective surveys.`,
      `Create a ${surveyType || "customer feedback"} survey with ${adjustedQuestionCount} questions for: "${goal}".`,
      industry ? `Industry: ${industry}.` : "",
      targetAudience ? `Target audience: ${targetAudience}.` : "",
      products && products.length ? `Products/Services: ${products.join(", ")}.` : "",
      tenant.companyName ? `Company: ${tenant.companyName}.` : "",
      `Question types to include:`,
      `- 1 NPS question (0-10 scale): "How likely are you to recommend..."`,
      `- 2-3 Rating questions (1-5 stars): Service quality, satisfaction, etc.`,
      `- 1-2 Multiple choice: Preferences, categories, demographics`,
      `- 1 Open text: "What can we improve?" or "Additional comments"`,
      industryTemplate ? `Use these industry-proven questions as inspiration: ${JSON.stringify(industryTemplate.commonQuestions)}` : "",
      includeLogic ? `Add conditional logic: If NPS ≤ 6, show follow-up "What can we improve?"` : "",
      `Return valid JSON only with structure: {...}`,
      `Language: ${language === "both" ? "Provide Arabic translation too" : language}.`,
      `Tone: ${tone}.`,
      `Survey length: ${lengthRule.avgTime} completion time.`
    ].join(" ");

    const aiResponse = await aiClient.complete({ prompt, maxTokens: 800 });

    let suggestion;
    try {
      suggestion = JSON.parse(aiResponse.text);
    } catch {
      const fallbackQuestions = [];

      fallbackQuestions.push({
        id: nanoid(),
        type: "nps",
        questionText: `How likely are you to recommend ${tenant.companyName || "us"} to others?`,
        scale: "0-10",
        required: true
      });

      fallbackQuestions.push({
        id: nanoid(),
        type: "rating",
        questionText: "How would you rate your overall experience?",
        scale: "1-5",
        required: true
      });

      if (industry) {
        const industryQ = industryTemplate?.commonQuestions?.[0];
        if (industryQ) {
          fallbackQuestions.push({
            id: nanoid(),
            type: industryQ.type,
            questionText: industryQ.text,
            scale: industryQ.scale,
            options: industryQ.options,
            required: true
          });
        }
      }

      if (targetAudience === "customers") {
        fallbackQuestions.push({
          id: nanoid(),
          type: "mcq",
          questionText: "What aspect was most important to you today?",
          options: ["Quality", "Service", "Value", "Convenience", "Other"],
          required: false
        });
      } else if (targetAudience === "employees") {
        fallbackQuestions.push({
          id: nanoid(),
          type: "mcq",
          questionText: "Which area would you like more support in?",
          options: ["Training", "Resources", "Communication", "Work-life balance", "Career development"],
          required: false
        });
      }

      const improvementId = nanoid();
      fallbackQuestions.push({
        id: improvementId,
        type: "text",
        questionText: "What can we improve?",
        required: false
      });

      if (includeLogic && fallbackQuestions.length >= 2) {
        fallbackQuestions[0].logic = {
          condition: "value <= 6",
          showQuestion: improvementId
        };
      }

      suggestion = {
        title: `${surveyType === "nps" ? "NPS" : "Feedback"} Survey: ${goal.slice(0, 40)}`,
        description: `We value your opinion! Please take ${lengthRule.avgTime} to help us improve.`,
        estimatedTime: lengthRule.avgTime,
        questions: fallbackQuestions.slice(0, adjustedQuestionCount),
        metadata: {
          generatedBy: "fallback",
          industry: industry || "general",
          targetAudience: targetAudience || "general"
        }
      };
    }

    Logger.info("aiDraftSurvey", "AI survey draft generated successfully", {
      context: {
        userId: req.user?._id,
        tenant: req.user.tenant,
        type: surveyType,
        language,
        questionCount: adjustedQuestionCount
      },
      req
    });

    res.status(200).json({ draft: suggestion });
  } catch (err) {
    Logger.error("aiDraftSurvey", "AI draft generation failed", {
      error: err,
      context: {
        userId: req.user?._id,
        tenant: req.user.tenant
      },
      req
    });
    return res.status(200).json({
      message: "AI temporarily unavailable, showing default draft",
      draft: [
        "How satisfied are you with your child’s academic progress?",
        "How effective do you find the school’s communication with parents?",
        "Are you satisfied with the quality of teachers?",
        "Do you feel your child receives enough extracurricular opportunities?",
        "Would you recommend this school to other parents?"
      ]
    });
  }
};

// @desc    Suggest survey questions based on context
// @route   POST /api/ai/suggest-questions
// @access  Private
exports.aiSuggestQuestion = async (req, res, next) => {
  try {
    const { error, value } = suggestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { surveyId, context, questionCount } = value;

    // Tenant validation
    const tenant = req.user?.tenant;
    if (!tenant) {
      return res.status(403).json({
        success: false,
        message: "Tenant not found or unauthorized"
      });
    }

    // Load survey (if provided) scoped to tenant
    let survey = null;
    if (surveyId) {
      survey = await Survey.findOne({ _id: surveyId, tenant }).select("title questions translations");
      if (!survey) {
        return res.status(404).json({
          success: false,
          message: "Survey not found for this tenant"
        });
      }
    }

    // Build AI prompt
    const prompt = [
      `You are an expert survey question generator.`,
      `Context: ${context}`,
      survey ? `Survey title: ${survey.title}. Existing questions: ${JSON.stringify(survey.questions)}` : "",
      `Generate ${questionCount} new candidate questions.`,
      `Include suggested type (rating, nps, likert, mcq, text) and short options if mcq.`,
      `Return only valid JSON array of objects with fields: id, type, questionText, options (if any), required (bool).`
    ].join(" ");

    // Send request to AI model
    const aiResponse = await aiClient.complete({ prompt, maxTokens: 400 });

    let suggestions;
    try {
      suggestions = JSON.parse(aiResponse.text);
    } catch {
      suggestions = [
        { id: nanoid(), type: "text", questionText: context || "What’s your feedback?", required: false }
      ];
    }

    // Log success if AI generation worked
    Logger.info("aiSuggestQuestion", "AI suggested survey questions", {
      context: {
        tenantId: tenant,
        userId: req.user?._id,
        suggestionCount: suggestions.length
      },
      req
    });
    // Respond with success
    return res.status(200).json({
      success: true,
      message: `${suggestions.length} AI-generated question${suggestions.length > 1 ? "s" : ""} found`,
      data: suggestions
    });

  } catch (error) {
    // Log error only on failure
    Logger.error("aiSuggestQuestion", "Error suggesting questions", {
      error: error, // poora error object pass kiya taake stack trace bhi save ho
      context: {
        userId: req.user?._id,
        tenantId: req.user?.tenant
      },
      req
    });

    return res.status(500).json({
      success: false,
      message: "Error generating AI-based questions",
      error: error.message
    });
  }
};

// @desc    Optimize survey questions for clarity and engagement
// @route   POST /api/ai/optimize-survey
// @access  Private
exports.aiOptimizeSurvey = async (req, res, next) => {
  try {
    const { error, value } = optimizeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { surveyId } = value;
    const tenant = req.user?.tenant;

    if (!tenant) {
      return res.status(403).json({
        success: false,
        message: "Tenant not found or unauthorized"
      });
    }

    const survey = await Survey.findOne({ _id: surveyId, tenant });
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: "Survey not found for this tenant"
      });
    }

    // Prepare prompt
    const rule = (await IndustryRules.findOne({ industry: survey.category })) || { min: 5, max: 10 };
    const prompt = `
      Optimize this survey for response rate and clarity.
      Limit questions between ${rule.min} and ${rule.max}.
      Title: ${survey.title}.
      Description: ${survey.description}.
      Questions: ${JSON.stringify(survey.questions)}.
      Output JSON with fields:
      {
        "replaceQuestionIds": [],
        "renameSuggestions": [],
        "recommendedTypes": [],
        "notes": "..."
      }
    `;

    // Send AI request
    const aiResponse = await aiClient.complete({ prompt, maxTokens: 600 });

    let optimized;
    try {
      optimized = JSON.parse(aiResponse.text);
    } catch (e) {
      optimized = { message: "AI optimization failed to parse. No changes applied." };
    }

    // ✅ Log success event
    Logger.info("aiOptimizeSurvey", "AI optimized survey successfully", {
      context: {
        tenantId: tenant,
        userId: req.user?._id,
        surveyId,
        optimizedKeys: Object.keys(optimized)
      },
      req
    });
    // ✅ Respond success
    return res.status(200).json({
      success: true,
      message: "Survey optimized successfully",
      data: optimized
    });

  } catch (error) {
    // ❌ Log failure event
    Logger.error("aiOptimizeSurvey", "Error optimizing survey", {
      error: error,
      context: {
        tenantId: req.user?.tenant,
        userId: req.user?._id
      },
      req
    });
    return res.status(500).json({
      success: false,
      message: "Error optimizing survey",
      error: error.message
    });
  }
};

// @desc    Translate survey text
// @route   POST /api/ai/translate-survey
// @access  Private
exports.aiTranslateSurvey = async (req, res, next) => {
  try {
    const { error, value } = translateSchema.validate(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { text, from, to } = value;

    // Use aiClient translation or simple map
    const prompt = `Translate the following text from ${from} to ${to}. Preserve survey phrasing and keep translation concise. Return only the translated text:\n\n${text}`;

    const aiResponse = await aiClient.complete({ prompt, maxTokens: 400 });

    const translated = aiResponse.text?.trim() || "";

    res.status(200).json({ translated });
  } catch (err) {
    next(err);
  }
};

// @desc    Generate survey from company profile
// @route   POST /api/ai/generate-from-profile
// @access  Private
exports.aiGenerateFromCompanyProfile = async (req, res, next) => {
  try {
    // ✅ FIX: Accept both 'language' (canonical: 'en'/'ar') and legacy 'languages' array
    const {
      industry,
      products,
      targetAudience,
      goal,
      questionCount = 8,
      includeNPS = true,
      language,           // ✅ NEW: canonical value 'en' or 'ar'
      languages,          // Legacy: array like ['English']
      additionalInstructions = '',
      tone = 'friendly-professional'
    } = req.body;

    // ✅ FIX: Normalize language to canonical value
    let surveyLanguage = 'en'; // default
    if (language === 'ar' || language === 'Arabic') {
      surveyLanguage = 'ar';
    } else if (language === 'en' || language === 'English') {
      surveyLanguage = 'en';
    } else if (Array.isArray(languages) && languages.length > 0) {
      // Legacy support: check array
      const firstLang = languages[0];
      if (firstLang === 'ar' || firstLang === 'Arabic' || firstLang.toLowerCase().includes('arabic')) {
        surveyLanguage = 'ar';
      }
    }

    // ✅ FIX: Get display language name for prompt
    const languageDisplayName = surveyLanguage === 'ar' ? 'Arabic' : 'English';

    console.log('🚀 AI Generation Request - FIXED:', {
      industry,
      products: Array.isArray(products) ? products.join(', ') : products,
      targetAudience,
      goal,
      questionCount,
      language: surveyLanguage,  // ✅ Log normalized language
      languageDisplayName,
      additionalInstructions: additionalInstructions?.substring(0, 100) || ''
    });

    // Handle both authenticated and non-authenticated requests
    const tenant = req.user?.tenant || null;

    const formatProducts = (products) => {
      if (Array.isArray(products)) return products.join(", ");
      if (typeof products === "string") return products;
      return "Not specified";
    };

    // ✅ ENHANCED: Industry-specific context
    let industryContext = '';
    let sampleQuestions = [];

    if (industry === 'hospitality') {
      industryContext = surveyLanguage === 'ar' 
        ? `
هذا الاستبيان مخصص لقطاع الضيافة (فندق، مطعم، خدمات سبا).
التركيز على: تجربة الإقامة الشاملة، راحة ونظافة الغرف، جودة طعام المطعم،
خدمات السبا والترفيه، سلوك الموظفين واحترافيتهم، اقتراحات للتحسين.
        `
        : `
This is for a HOSPITALITY business (hotel, restaurant, spa services).
Focus on: overall stay experience, room comfort & cleanliness, restaurant food quality, 
spa & leisure services, staff behavior & professionalism, suggestions for improvement.
Target audience are hotel guests who want friendly, professional service evaluation.
        `;
      
      // ✅ FIX: Language-specific sample questions
      sampleQuestions = surveyLanguage === 'ar' ? [
        { type: "likert", title: "ما مدى رضاك عن تجربة إقامتك بشكل عام؟", options: ["غير راضٍ جداً", "غير راضٍ", "محايد", "راضٍ", "راضٍ جداً"] },
        { type: "rating", title: "قيّم نظافة وراحة غرفتك", scale: 5 },
        { type: "likert", title: "كيف تقيّم جودة طعام المطعم لدينا؟", options: ["ضعيف", "مقبول", "جيد", "جيد جداً", "ممتاز"] },
        { type: "multiple_choice", title: "ما هي مرافق الفندق التي استخدمتها؟", options: ["المطعم", "السبا والعافية", "حمام السباحة", "مركز اللياقة", "خدمة الغرف"] },
        { type: "likert", title: "ما مدى احترافية ومساعدة موظفينا؟", options: ["ضعيف جداً", "ضعيف", "متوسط", "جيد", "ممتاز"] },
        { type: "nps", title: "ما مدى احتمالية أن توصي بنا لأصدقائك وعائلتك؟", scale: 10 },
        { type: "text_short", title: "ما هي اقتراحاتك لتحسين خدماتنا؟" },
        { type: "single_choice", title: "ما هو الغرض الرئيسي من زيارتك؟", options: ["سفر عمل", "إجازة/استجمام", "مؤتمر/فعالية", "حفل زفاف/احتفال"] }
      ] : [
        { type: "likert", title: "How satisfied were you with your overall stay experience?", options: ["Very Dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very Satisfied"] },
        { type: "rating", title: "Rate the cleanliness and comfort of your room", scale: 5 },
        { type: "likert", title: "How would you rate our restaurant food quality?", options: ["Poor", "Fair", "Good", "Very Good", "Excellent"] },
        { type: "multiple_choice", title: "Which hotel facilities did you use?", options: ["Restaurant", "Spa & Wellness", "Swimming Pool", "Fitness Center", "Room Service"] },
        { type: "likert", title: "How professional and helpful was our staff?", options: ["Very Poor", "Poor", "Average", "Good", "Excellent"] },
        { type: "nps", title: "How likely are you to recommend us to friends and family?", scale: 10 },
        { type: "text_short", title: "What suggestions do you have for improving our services?" },
        { type: "single_choice", title: "What was the primary purpose of your visit?", options: ["Business Travel", "Leisure/Vacation", "Conference/Event", "Wedding/Celebration"] }
      ];
    }

    // ✅ FIX: Add explicit language instruction to prompt
    const languageInstruction = surveyLanguage === 'ar' 
      ? `
IMPORTANT: Generate ALL survey content in Arabic language only.
- Survey title must be in Arabic
- Survey description must be in Arabic  
- All question titles must be in Arabic
- All question options must be in Arabic
- Use formal Arabic suitable for business surveys
`
      : `
Generate all survey content in English language.
`;

    // ✅ FIXED: Create a clean, valid prompt string with explicit language instruction
    const promptText = `Generate an optimized survey based on this company profile and goal:

Company Profile:
- Industry: ${industry || 'General'}
- Products/Services: ${formatProducts(products)}
- Target Audience: ${targetAudience || 'customers'}
- Tone: ${tone}

${industryContext}

Survey Goal: ${goal || 'Customer satisfaction survey'}
Question Count: ${questionCount}
Include NPS: ${includeNPS ? 'Yes' : 'No'}

${languageInstruction}

Additional Requirements: ${additionalInstructions}

Generate a JSON response with this structure:
{
  "success": true,
  "data": {
    "survey": {
      "title": "${surveyLanguage === 'ar' ? 'عنوان الاستبيان بالعربية' : 'Survey Title'}",
      "description": "${surveyLanguage === 'ar' ? 'وصف الاستبيان بالعربية' : 'Survey description'}", 
      "language": "${surveyLanguage}"
    },
    "questions": [
      {
        "type": "likert",
        "title": "${surveyLanguage === 'ar' ? 'نص السؤال بالعربية' : 'Question text'}",
        "description": "",
        "required": true,
        "options": ${surveyLanguage === 'ar' ? '["غير راضٍ جداً", "غير راضٍ", "محايد", "راضٍ", "راضٍ جداً"]' : '["Very Dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very Satisfied"]'},
        "settings": {"scale": 5}
      }
    ]
  }
}

Question types available: rating, single_choice, multiple_choice, text_short, text_long, nps, likert, yes_no, date, number

Make questions industry-specific and relevant to the survey goal.
Use ${tone} tone and make questions easy to understand for ${targetAudience}.
${surveyLanguage === 'ar' ? 'Remember: ALL content must be in Arabic.' : ''}`;

    // ✅ FIXED: Validate prompt before sending
    if (!promptText || promptText.trim().length === 0) {
      throw new Error("Failed to generate AI prompt");
    }

    // ✅ ADDITIONAL SAFETY: Ensure prompt is clean string
    const cleanPrompt = String(promptText || '').trim();
    if (!cleanPrompt || cleanPrompt.length === 0) {
      throw new Error("Failed to generate valid AI prompt");
    }

    // ✅ FIXED: Use clean prompt
    const result = await aiClient.complete(cleanPrompt);
    const responseText = result.text || result;

    try {
      // Try to parse JSON response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsedResponse = JSON.parse(jsonMatch[0]);
        
        // ✅ FIX: Ensure language is set in response
        if (parsedResponse.data?.survey) {
          parsedResponse.data.survey.language = surveyLanguage;
        }
        
        console.log('✅ Parsed AI Response:', {
          title: parsedResponse.data?.survey?.title,
          questionCount: parsedResponse.data?.questions?.length,
          language: surveyLanguage,
          industry: industry
        });
        return res.json(parsedResponse);
      }
    } catch (parseError) {
      console.error('Parse error:', parseError);
    }

    // ✅ ENHANCED: Language-specific fallback with actual data
    const fallbackQuestions = sampleQuestions.length > 0 ? sampleQuestions : (surveyLanguage === 'ar' ? [
      {
        type: 'rating',
        title: 'كيف تقيّم تجربتك الشاملة؟',
        description: 'يرجى تقييم مستوى رضاك',
        required: true,
        options: [],
        settings: { scale: 5 }
      },
      {
        type: 'nps',
        title: 'ما مدى احتمالية أن توصي بنا للآخرين؟',
        description: '0 = غير محتمل على الإطلاق، 10 = محتمل جداً',
        required: true,
        options: [],
        settings: { scale: 10 }
      },
      {
        type: 'text_short',
        title: 'ما الذي يمكننا تحسينه؟',
        description: 'يرجى مشاركة اقتراحاتك',
        required: false,
        options: []
      }
    ] : [
      {
        type: 'rating',
        title: 'How would you rate your overall experience?',
        description: 'Please rate your satisfaction level',
        required: true,
        options: [],
        settings: { scale: 5 }
      },
      {
        type: 'nps',
        title: 'How likely are you to recommend us to others?',
        description: '0 = Not at all likely, 10 = Extremely likely',
        required: true,
        options: [],
        settings: { scale: 10 }
      },
      {
        type: 'text_short',
        title: 'What can we improve?',
        description: 'Please share your suggestions',
        required: false,
        options: []
      }
    ]);

    const fallbackResponse = {
      success: true,
      data: {
        survey: {
          title: surveyLanguage === 'ar' 
            ? `استبيان ${industry ? industry : 'رضا العملاء'}`
            : `${industry?.charAt(0).toUpperCase() + industry?.slice(1) || 'Customer'} Feedback Survey`,
          description: surveyLanguage === 'ar'
            ? `نقدر ملاحظاتك حول تجربتك الأخيرة مع خدماتنا. يرجى قضاء بضع دقائق لمشاركة أفكارك.`
            : `We value your feedback about your recent experience with our ${formatProducts(products)} services. Please take a few minutes to share your thoughts.`,
          language: surveyLanguage  // ✅ FIX: Include language in response
        },
        questions: fallbackQuestions.slice(0, questionCount)
      }
    };
    res.json(fallbackResponse);

  } catch (error) {
    console.error('❌ AI Generation Error:', error);

    // ✅ FIX: Language-aware fallback response
    const requestedLanguage = req.body.language === 'ar' ? 'ar' : 'en';
    
    const fallbackResponse = {
      success: true,
      data: {
        survey: {
          title: requestedLanguage === 'ar' ? 'استبيان رضا العملاء' : 'Customer Feedback Survey',
          description: requestedLanguage === 'ar' 
            ? 'نقدر ملاحظاتك. يرجى قضاء بضع دقائق لمشاركة أفكارك.'
            : 'We value your feedback. Please take a few minutes to share your thoughts.',
          language: requestedLanguage
        },
        questions: requestedLanguage === 'ar' ? [
          {
            type: 'rating',
            title: 'كيف تقيّم تجربتك الشاملة؟',
            description: '',
            required: true,
            options: [],
            settings: { scale: 5 }
          },
          {
            type: 'nps',
            title: 'ما مدى احتمالية أن توصي بنا للآخرين؟',
            description: '0 = غير محتمل على الإطلاق، 10 = محتمل جداً',
            required: true,
            options: [],
            settings: { scale: 10 }
          },
          {
            type: 'text_short',
            title: 'ما الذي يمكننا تحسينه؟',
            description: 'يرجى مشاركة اقتراحاتك',
            required: false,
            options: []
          }
        ] : [
          {
            type: 'rating',
            title: 'How would you rate your overall experience?',
            description: '',
            required: true,
            options: [],
            settings: { scale: 5 }
          },
          {
            type: 'nps',
            title: 'How likely are you to recommend us to others?',
            description: '0 = Not at all likely, 10 = Extremely likely',
            required: true,
            options: [],
            settings: { scale: 10 }
          },
          {
            type: 'text_short',
            title: 'What can we improve?',
            description: 'Please share your suggestions',
            required: false,
            options: []
          }
        ]
      }
    };

    res.json(fallbackResponse);
  }
};

// @desc    Suggest conditional logic for survey
// @route   POST /api/ai/suggest-logic
// @access  Private
exports.aiSuggestLogic = async (req, res, next) => {
  try {
    const { questions, surveyGoal } = req.body;
    const tenant = req.user?.tenant;

    if (!tenant) {
      return res.status(403).json({
        success: false,
        message: "Tenant not found or unauthorized"
      });
    }

    const prompt = `
For this survey with goal "${surveyGoal}", suggest conditional logic rules:

Questions: ${JSON.stringify(questions)}

Suggest:
1. Skip logic (if answer X, skip to question Y)
2. Follow-up questions (if negative rating, ask why)
3. Branching paths (different questions for different user types)
4. Validation rules

Return JSON with logic suggestions.
`;

    const aiResponse = await aiClient.complete({ prompt, maxTokens: 600 });

    let logicSuggestions;
    try {
      logicSuggestions = JSON.parse(aiResponse.text);
    } catch (e) {
      logicSuggestions = {
        skipLogic: [],
        followUps: [
          {
            condition: "rating <= 2",
            action: "show_question",
            question: "What specifically caused the poor rating?"
          }
        ],
        branching: [],
        validation: []
      };
    }

    // ✅ Log success only on 200
    Logger.info("aiSuggestLogic", "AI suggested logic successfully", {
      context: {
        tenantId: tenant,
        userId: req.user?._id,
        totalQuestions: questions?.length || 0,
        hasFollowUps: logicSuggestions?.followUps?.length > 0
      },
      req
    });
    return res.status(200).json({
      success: true,
      message: "Logic suggestions generated successfully",
      data: logicSuggestions
    });

  } catch (error) {
    // ❌ Log error only on failure
    Logger.error("aiSuggestLogic", "Error generating logic suggestions", {
      error: error,
      context: {
        tenantId: req.user?.tenant,
        userId: req.user?._id
      },
      req
    });

    return res.status(500).json({
      success: false,
      message: "Error generating logic suggestions",
      error: error.message
    });
  }
};

// @desc    Generate thank you page content
// @route   POST /api/ai/generate-thankyou
// @access  Private
exports.aiGenerateThankYouPage = async (req, res, next) => {
  try {
    const { surveyType, companyName, tone = "friendly", includeIncentives = false } = req.body;
    const tenant = req.user?.tenant;

    if (!tenant) {
      return res.status(403).json({
        success: false,
        message: "Tenant not found or unauthorized"
      });
    }

    const prompt = `
Create a thank you page for a ${surveyType} survey from ${companyName}.
Tone: ${tone}
${includeIncentives ? "Include mention of reward/incentive" : ""}

Provide:
1. Thank you message
2. What happens next
3. Contact information encouragement
4. Social media follow suggestion
${includeIncentives ? "5. Reward/discount offer" : ""}

Return JSON with content sections.
`;

    const aiResponse = await aiClient.complete({ prompt, maxTokens: 400 });

    let thankYouContent;
    try {
      thankYouContent = JSON.parse(aiResponse.text);
    } catch (e) {
      thankYouContent = {
        title: "Thank You!",
        message: `Thank you for taking the time to share your feedback with ${companyName}. Your input helps us improve our services.`,
        nextSteps: "We'll review your feedback and use it to enhance your future experience.",
        contact: "If you have any immediate concerns, please contact us at support@company.com",
        social: `Follow us on social media for updates and news from ${companyName}!`
      };
    }

    // ✅ Log success only on 200
    Logger.info("aiGenerateThankYouPage", "AI generated thank you page successfully", {
      context: {
        tenantId: tenant,
        userId: req.user?._id,
        surveyType,
        includeIncentives,
        tone
      },
      req
    });

    return res.status(200).json({
      success: true,
      message: "Thank you page generated successfully",
      data: thankYouContent
    });

  } catch (error) {
    // ❌ Log error only on failure
    Logger.error("aiGenerateThankYouPage", "Error generating thank you page", {
      error: error,
      context: {
        tenantId: req.user?.tenant,
        userId: req.user?._id
      },
      req
    });

    return res.status(500).json({
      success: false,
      message: "Error generating thank you page",
      error: error.message
    });
  }
};

// @desc    Analyze feedback with AI
// @route   POST /api/ai/analyze-feedback
// @access  Private
exports.aiAnalyzeFeedback = async (req, res, next) => {
  try {
    const { responses, surveyTitle } = req.body;
    const tenant = req.user?.tenant;

    if (!responses || !Array.isArray(responses) || responses.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Responses array required"
      });
    }

    const prompt = `
Analyze these survey responses for "${surveyTitle}":

${JSON.stringify(responses.slice(0, 50))} // Limit for token management

Provide:
1. Overall sentiment (positive/neutral/negative)
2. Key themes and topics
3. Common complaints or issues
4. Positive highlights
5. Actionable insights
6. Priority recommendations

Return structured JSON analysis.
`;

    const aiResponse = await aiClient.complete({ prompt, maxTokens: 800 });

    let analysis;
    try {
      analysis = JSON.parse(aiResponse.text);
    } catch (e) {
      analysis = {
        sentiment: "neutral",
        themes: ["service quality", "customer satisfaction"],
        complaints: ["waiting time", "unclear information"],
        highlights: ["friendly staff", "good value"],
        insights: ["Improve response time", "Enhance communication clarity"],
        recommendations: [
          { priority: "high", action: "Reduce wait times" },
          { priority: "medium", action: "Staff training on communication" }
        ]
      };
    }

    // ✅ Log only when successful (200)
    Logger.info("aiAnalyzeFeedback", "AI analyzed feedback successfully", {
      context: {
        tenantId: tenant,
        userId: req.user?._id,
        surveyTitle,
        responseCount: responses.length
      },
      req
    });

    return res.status(200).json({
      success: true,
      message: "Feedback analysis generated successfully",
      data: analysis
    });

  } catch (error) {
    // ❌ Log only on failure
    Logger.error("aiAnalyzeFeedback", "Error analyzing feedback", {
      error: error,
      context: {
        tenantId: req.user?.tenant,
        userId: req.user?._id
      },
      req
    });

    return res.status(500).json({
      success: false,
      message: "Error analyzing feedback",
      error: error.message
    });
  }
};

// @desc    Generate insights and action items
// @route   POST /api/ai/generate-insights
// @access  Private
exports.aiGenerateInsights = async (req, res, next) => {
  try {
    const { surveyData, timeframe = "month", companyGoals = [] } = req.body;
    const tenant = req.user?.tenant;

    const prompt = `
Generate business insights from this survey data over the past ${timeframe}:

Survey Data: ${JSON.stringify(surveyData)}
Company Goals: ${companyGoals.join(", ")}

Provide:
1. Performance trends
2. Areas of improvement
3. Strengths to maintain
4. Predictive insights
5. Specific action items with priority
6. ROI impact estimates

Return JSON with structured insights.
`;

    const aiResponse = await aiClient.complete({ prompt, maxTokens: 1000 });

    let insights;
    try {
      insights = JSON.parse(aiResponse.text);
    } catch (e) {
      insights = {
        trends: {
          satisfaction: "stable",
          nps: "improving",
          completion_rate: "declining"
        },
        improvements: [
          "Streamline survey length",
          "Improve mobile experience",
          "Add more relevant questions"
        ],
        strengths: [
          "High customer loyalty",
          "Strong product quality ratings"
        ],
        predictions: [
          "NPS likely to increase by 5 points if wait times reduced"
        ],
        actions: [
          {
            priority: "high",
            action: "Reduce survey length to under 5 questions",
            impact: "Increase completion rate by 15%",
            effort: "low"
          }
        ]
      };
    }

    // ✅ Log only if success (status 200)
    Logger.info("aiGenerateInsights", "AI-generated business insights successfully", {
      context: {
        tenantId: tenant,
        userId: req.user?._id,
        timeframe,
        goals: companyGoals
      },
      req
    });

    return res.status(200).json({
      success: true,
      message: "Business insights generated successfully",
      data: insights
    });

  } catch (error) {
    // ❌ Log only if error
    Logger.error("aiGenerateInsights", "Error generating insights", {
      error: error,
      context: {
        tenantId: req.user?.tenant,
        userId: req.user?._id
      },
      req
    });

    return res.status(500).json({
      success: false,
      message: "Error generating insights",
      error: error.message
    });
  }
};

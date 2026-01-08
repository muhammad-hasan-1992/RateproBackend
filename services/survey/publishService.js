// services/survey/publishService.js
const Survey = require("../../models/Survey");
const Contact = require("../../models/ContactManagement");
const Tenant = require("../../models/Tenant");
const { validateSurveyForPublish } = require("../../validators/publishValidator");
const resolveAudience = require("../distribution/resolveAudienceService");
const { createBulkSurveyInvites } = require("../distribution/createSurveyInvitesService");  // 🔥 FIX
const sendSurveyInvites = require("../email/sendSurveyInviteService"); // ✅ Add email service

/**
 * Parse frontend targetAudience format to backend format
 * Frontend sends: ['segment_abc123', 'category_xyz456', 'custom']
 * Backend needs: { segmentIds: [...], contactIds: [...] }
 */
const parseTargetAudience = (targetAudience = [], selectedContacts = []) => {
  const segmentIds = [];
  const categoryIds = [];
  const contactIds = [...selectedContacts]; // custom selected contacts
  
  for (const item of targetAudience) {
    if (item.startsWith('segment_')) {
      segmentIds.push(item.replace('segment_', ''));
    } else if (item.startsWith('category_')) {
      categoryIds.push(item.replace('category_', ''));
    }
    // 'custom' is handled via selectedContacts
  }
  
  return { segmentIds, categoryIds, contactIds };
};

/**
 * Publish a survey
 * @param {Object} options
 * @param {String} options.surveyId - Optional: existing draft survey ID
 * @param {Object} options.surveyData - Optional: new survey data (for direct publish)
 * @param {String} options.tenantId - Tenant ID
 * @param {String} options.userId - User ID
 */
module.exports.publish = async ({ surveyId, surveyData, tenantId, userId }) => {
  // ✅ Ensure tenantId is just the ID
  const tenantObjectId = tenantId?._id || tenantId;
  
  console.log("📦 [publishService.publish] Starting", { 
    surveyId, 
    hasSurveyData: !!surveyData,
    tenantId: tenantObjectId?.toString() 
  });

  let survey;

  // ═══════════════════════════════════════════════════════════
  // CASE 1: Publish existing survey (draft or updated)
  // ═══════════════════════════════════════════════════════════
  if (surveyId) {
    console.log("📋 [publishService] Loading existing survey...");
    
    survey = await Survey.findOne({
      _id: surveyId,
      tenant: tenantObjectId,
      deleted: false
    });

    if (!survey) {
      throw new Error("Survey not found");
    }
    
    // ✅ FIX: Allow publishing of drafts OR surveys being republished
    if (survey.status === "active" && !surveyData) {
      throw new Error("Survey is already published. Use update endpoint for changes.");
    }
    
    console.log("📋 [publishService] Survey loaded:", survey._id, "Status:", survey.status);
  }
  
  // ═══════════════════════════════════════════════════════════
  // CASE 2: Create new survey & publish directly
  // ═══════════════════════════════════════════════════════════
  else if (surveyData) {
    console.log("📋 [publishService] Creating new survey for direct publish...");
    console.log("📋 [publishService] Survey data received:", {
      title: surveyData.title,
      questionsCount: surveyData.questions?.length,
      targetAudience: surveyData.targetAudience,
      selectedContacts: surveyData.selectedContacts?.length
    });
    
    // ✅ Parse targetAudience from frontend format
    const parsedAudience = parseTargetAudience(
      surveyData.targetAudience, 
      surveyData.selectedContacts || []
    );
    
    console.log("📋 [publishService] Parsed audience:", parsedAudience);

    // ✅ Fetch contact details for embedded documents
    let contactsData = [];
    if (parsedAudience.contactIds.length > 0) {
      const contacts = await Contact.find({
        _id: { $in: parsedAudience.contactIds },
        tenantId: tenantObjectId
      }).select('name email phone');
      
      contactsData = contacts.map(c => ({
        name: c.name || '',
        email: c.email || '',
        phone: c.phone || ''
      }));
      
      console.log("📋 [publishService] Fetched contacts:", contactsData.length);
    }

    survey = new Survey({
      title: surveyData.title,
      description: surveyData.description,
      category: surveyData.category,
      language: surveyData.language,
      themeColor: surveyData.themeColor,
      questions: surveyData.questions,
      settings: surveyData.settings,
      thankYouPage: surveyData.thankYouPage,
      branding: surveyData.branding,
      // ✅ Store in proper backend format with embedded contact objects
      targetAudience: {
        segments: parsedAudience.segmentIds,
        categories: parsedAudience.categoryIds,
        contacts: contactsData  // Now using embedded objects instead of IDs
      },
      schedule: {
        publishNow: surveyData.publishSettings?.publishNow ?? true,
        scheduleDate: surveyData.publishSettings?.scheduleDate,
        scheduleTime: surveyData.publishSettings?.scheduleTime,
        expiryDate: surveyData.publishSettings?.expiryDate,
        maxResponses: surveyData.publishSettings?.maxResponses
      },
      tenant: tenantObjectId,
      createdBy: userId,
      status: "draft", // temporarily draft, will change to active below
    });

    // ✅ Store parsed audience for later use in resolveAudience
    survey._parsedAudienceIds = parsedAudience;

    await survey.save();
    console.log("📋 [publishService] New survey created:", survey._id);
  }
  
  // ═══════════════════════════════════════════════════════════
  // ERROR: No survey ID or data provided
  // ═══════════════════════════════════════════════════════════
  else {
    throw new Error("Either surveyId or surveyData is required");
  }

  // ⬅️ Pre-publish validation
  const validation = validateSurveyForPublish(survey);
  console.log("✔️ [publishService] Validation result:", validation);

  if (!validation.valid) {
    const error = new Error("Survey validation failed");
    error.details = validation.errors;
    error.statusCode = 400;
    throw error;
  }

  // Resolve recipients using resolveAudienceService
  console.log("👥 [publishService] Resolving audience...");
  
  const audience = survey.targetAudience || {};
  
  // ✅ Use stored IDs for new surveys, or extract from embedded contacts for existing drafts
  let contactIdsForResolve = [];
  let segmentIdsForResolve = [];
  let categoryIdsForResolve = [];  // 🔥 ADD THIS
  
  if (survey._parsedAudienceIds) {
    // New survey - use the parsed IDs we stored
    contactIdsForResolve = survey._parsedAudienceIds.contactIds || [];
    segmentIdsForResolve = survey._parsedAudienceIds.segmentIds || [];
    categoryIdsForResolve = survey._parsedAudienceIds.categoryIds || [];  // 🔥 ADD THIS
  } else {
    // Existing draft - need to resolve from embedded contacts or stored refs
    // For embedded contacts, we already have the data - no need to query again
    segmentIdsForResolve = audience.segments || [];
    categoryIdsForResolve = audience.categories || [];  // 🔥 ADD THIS
  }

  const recipients = await resolveAudience({
    contactIds: contactIdsForResolve,
    segmentIds: segmentIdsForResolve,
    categoryIds: categoryIdsForResolve,  // 🔥 ADD THIS
    tenantId: tenantObjectId
  });

  console.log("👥 [publishService] Recipients resolved:", recipients.length);

  // ✅ If no recipients from resolveAudience but we have embedded contacts, use those
  let finalRecipients = recipients;
  if (recipients.length === 0 && audience.contacts && audience.contacts.length > 0) {
    console.log("👥 [publishService] Using embedded contacts as recipients...");
    finalRecipients = audience.contacts.filter(c => c.email).map(c => ({
      name: c.name,
      email: c.email,
      phone: c.phone
    }));
  }

  if (!finalRecipients.length) {
    throw new Error("No recipients found for this survey");
  }

  // Create invites using createSurveyInvitesService
  console.log("📨 [publishService] Creating invites...");
  
  const invites = await createBulkSurveyInvites({  // 🔥 FIX: renamed function
    surveyId: survey._id,
    tenantId: tenantObjectId,
    contacts: finalRecipients
  });

  console.log("📨 [publishService] Invites created:", invites.length);

  // ✅ Send invitation emails
  if (invites.length > 0) {
    console.log("📧 [publishService] Sending invitation emails...");
    
    // Fetch tenant for email template
    const tenant = await Tenant.findById(tenantObjectId).select('name logoUrl');
    
    await sendSurveyInvites({
      survey,
      invites,
      tenant
    });
    
    console.log("📧 [publishService] Invitation emails sent");
  }

  // ⬅️ Version lock - snapshot questions
  survey.publishedSnapshot = {
    questions: survey.questions,
    lockedAt: new Date()
  };
  survey.version = (survey.version || 0) + 1;

  // Update survey data
  survey.status = "active";
  survey.schedule = survey.schedule || {};
  survey.schedule.publishedAt = new Date();

  survey.publishLog = survey.publishLog || [];
  survey.publishLog.push({
    publishedBy: userId,
    method: "manual", // ✅ Changed from "direct" to valid enum value
    recipientsCount: invites.length,
    timestamp: new Date()
  });

  await survey.save();

  console.log("✅ [publishService] Survey published successfully");

  return {
    message: "Survey published successfully",
    surveyId: survey._id,
    invitesCreated: invites.length
  };
};
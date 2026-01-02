// services/distribution/resolveAudienceService.js
const Contact = require("../../models/ContactManagement");
const Segment = require("../../models/AudienceSegment");
const { mongoose } = require("mongoose");

/**
 * Resolve target audience into final unique contact list
 * @param {Object} payload
 * @param {Array} payload.contactIds - Direct contact IDs
 * @param {Array} payload.segmentIds - Segment IDs (dynamic rule-based)
 * @param {Array} payload.categoryIds - Category IDs (static groups)
 * @param {String} payload.tenantId
 */

const normalizeSegmentIds = (segmentIds = []) =>
  segmentIds
    .map(id => {
      if (typeof id !== "string") return null;
      // Handle both formats: with or without "segment_" prefix
      const cleanId = id.startsWith("segment_") ? id.replace("segment_", "") : id;
      return mongoose.Types.ObjectId.isValid(cleanId) 
        ? new mongoose.Types.ObjectId(cleanId) 
        : null;
    })
    .filter(Boolean);

// 🔥 NEW: Normalize category IDs (handle "category_" prefix)
const normalizeCategoryIds = (categoryIds = []) =>
  categoryIds
    .map(id => {
      if (typeof id !== "string") return null;
      // Handle both formats: with or without "category_" prefix
      const cleanId = id.startsWith("category_") ? id.replace("category_", "") : id;
      return mongoose.Types.ObjectId.isValid(cleanId) 
        ? new mongoose.Types.ObjectId(cleanId) 
        : null;
    })
    .filter(Boolean);

const resolveAudience = async ({ contactIds = [], segmentIds = [], categoryIds = [], tenantId }) => {
  // 🔥 FIX: Log all inputs including categoryIds
  console.log("🎯 [resolveAudience] Input:", { 
    contactIds: contactIds.length, 
    segmentIds: segmentIds.length, 
    categoryIds: categoryIds.length,  // 🔥 ADD THIS
    tenantId 
  });

  const contactsMap = new Map();

  // 1️⃣ Resolve direct contacts
  if (contactIds.length > 0) {
    const contacts = await Contact.find({
      _id: { $in: contactIds },
      tenantId,
      status: "Active",  // 🔥 FIX: Use "status" not "isActive"
      email: { $exists: true, $ne: "" },
    }).select("_id name email phone");
    
    console.log("📇 [resolveAudience] Direct contacts found:", contacts.length);

    contacts.forEach(contact => {
      contactsMap.set(contact.email, contact);
    });
  }

  // 2️⃣ Resolve segment based contacts (dynamic rule-based)
  const normalizedSegmentIds = normalizeSegmentIds(segmentIds);
  if (normalizedSegmentIds.length > 0) {
    const segments = await Segment.find({
      _id: { $in: normalizedSegmentIds },
      tenantId,
    });

    console.log("📊 [resolveAudience] Segments found:", segments.length);

    for (const segment of segments) {
      // 🔥 FIX: Use segment.query (compiled MongoDB query) not filterCriteria
      const segmentQuery = segment.query || {};
      
      const segmentContacts = await Contact.find({
        tenantId,
        ...segmentQuery,
        status: "Active",  // 🔥 FIX: Use "status" not "isActive"
        email: { $exists: true, $ne: "" },
      }).select("_id name email phone");

      console.log(`📊 [resolveAudience] Segment "${segment.name}" contacts:`, segmentContacts.length);

      segmentContacts.forEach(contact => {
        contactsMap.set(contact.email, contact);
      });
    }
  }

  // 3️⃣ Resolve category based contacts (static groups)
  const normalizedCategoryIds = normalizeCategoryIds(categoryIds);  // 🔥 ADD: Normalize category IDs
  if (normalizedCategoryIds.length > 0) {
    console.log("🏷️ [resolveAudience] Looking for categories:", normalizedCategoryIds);
    
    const categoryContacts = await Contact.find({
      tenantId,
      contactCategories: { $in: normalizedCategoryIds },  // 🔥 FIX: Use "contactCategories" not "category"
      status: "Active",  // 🔥 FIX: Use "status" not "isActive"
      email: { $exists: true, $ne: "" },
    }).select("_id name email phone");

    console.log("🏷️ [resolveAudience] Category contacts found:", categoryContacts.length);

    categoryContacts.forEach(contact => {
      contactsMap.set(contact.email, contact);
    });
  }

  console.log("🎯 [resolveAudience] Final unique contacts:", contactsMap.size);
  return Array.from(contactsMap.values());
};

module.exports = resolveAudience;
// services/distribution/resolveAudienceService.js
const Contact = require("../../models/ContactManagement");
const Segment = require("../../models/AudienceSegment");
const { mongoose } = require("mongoose");

/**
 * Resolve target audience into final unique contact list
 * @param {Object} payload
 * @param {Array} payload.contactIds
 * @param {Array} payload.segmentIds
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

const resolveAudience = async ({ contactIds = [], segmentIds = [], categoryIds = [], tenantId }) => {
  console.log("🎯 [resolveAudience] Input:", { contactIds: contactIds.length, segmentIds: segmentIds.length, tenantId });

  const contactsMap = new Map();

  // 1️⃣ Resolve direct contacts
  if (contactIds.length > 0) {
    const contacts = await Contact.find({
      _id: { $in: contactIds },
      tenantId,
      isActive: true,
      email: { $exists: true },
    }).select("_id name email");
    console.log("📇 [resolveAudience] Direct contacts found:", contacts.length);


    contacts.forEach(contact => {
      contactsMap.set(contact.email, contact);
    });
  }

  const normalizedSegmentIds = normalizeSegmentIds(segmentIds);

  // 2️⃣ Resolve segment based contacts
  if (normalizedSegmentIds.length > 0) {
    const segments = await Segment.find({
      _id: { $in: normalizedSegmentIds },
      tenantId,
    });

    console.log("📊 [resolveAudience] Segments found:", segments.length);


    for (const segment of segments) {
      const segmentContacts = await Contact.find({
        tenantId,
        ...segment.filterCriteria, // dynamic query
        isActive: true,
        email: { $exists: true },
      }).select("_id name email");

      console.log(`📊 [resolveAudience] Segment "${segment.name}" contacts:`, segmentContacts.length);

      segmentContacts.forEach(contact => {
        contactsMap.set(contact.email, contact);
      });
    }
  }



  // 3️⃣ Resolve category based contacts
  if (categoryIds.length > 0) {
    const categoryContacts = await Contact.find({
      tenantId,
      category: { $in: categoryIds },
      isActive: true,
      email: { $exists: true },
    }).select("_id name email");

    console.log("🏷️ [resolveAudience] Category contacts found:", categoryContacts.length);

    categoryContacts.forEach(contact => {
      contactsMap.set(contact.email, contact);
    });
  }

  console.log("🎯 [resolveAudience] Final unique contacts:", contactsMap.size);
  return Array.from(contactsMap.values());
};

module.exports = resolveAudience;
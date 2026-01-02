// services/contact/contactService.js

const mongoose = require("mongoose");
const Contact = require("../../models/ContactManagement");
const ContactCategory = require("../../models/ContactCategory");
const { enrichContact } = require("../audience/enrichmentService");
const { deriveAutoTags } = require("../audience/taggingService");

/**
 * Utility: normalize tags input
 */
function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map(t => t.trim()).filter(Boolean);
  if (typeof tags === "string")
    return tags.split(",").map(t => t.trim()).filter(Boolean);
  return [];
}

/**
 * Utility: normalize category IDs input
 */
function normalizeCategoryIds(categories) {
  if (!categories) return [];
  if (Array.isArray(categories)) {
    return categories
      .map(c => (typeof c === "string" ? c.trim() : c?.toString?.()))
      .filter(Boolean);
  }
  if (typeof categories === "string") {
    return categories.split(",").map(c => c.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Utility: validate category IDs exist and belong to tenant
 */
async function validateCategories({ tenantId, categoryIds, session = null }) {
  if (!categoryIds || categoryIds.length === 0) {
    throw new Error("Contact must belong to at least one category");
  }

  const query = ContactCategory.find({
    _id: { $in: categoryIds },
    $or: [
      { tenant: tenantId },
      { isDefault: true }, // Allow system-wide default categories
    ],
    active: true,
  });

  if (session) {
    query.session(session);
  }

  const validCategories = await query;

  if (validCategories.length !== categoryIds.length) {
    const validIds = validCategories.map(c => c._id.toString());
    const invalidIds = categoryIds.filter(id => !validIds.includes(id.toString()));
    throw new Error(`Invalid or inactive category IDs: ${invalidIds.join(", ")}`);
  }

  return validCategories.map(c => c._id);
}

/**
 * Utility: recompute tags (manual + auto)
 */
function recomputeTags({ contact }) {
  const autoTags = deriveAutoTags(contact);

  const merged = new Set([
    ...(contact.tags || []),
    ...autoTags,
  ]);

  return {
    tags: Array.from(merged),
    autoTags,
  };
}

class ContactService {
  /**
   * CREATE CONTACT
   */
  static async create({ tenantId, payload }) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        name,
        email,
        phone,
        company,
        tags,
        status,
        contactCategories, // 🔥 NEW: category support
      } = payload;

      // 🔒 Validate categories (required)
      const categoryIds = normalizeCategoryIds(contactCategories);
      const validatedCategoryIds = await validateCategories({
        tenantId,
        categoryIds,
        session,
      });

      // 🔒 Duplicate check (tenant-safe)
      const exists = await Contact.findOne({ tenantId, email }).session(session);
      if (exists) {
        throw new Error("Contact with this email already exists");
      }

      const now = new Date();

      // 🔹 Base contact object
      let contact = new Contact({
        tenantId,
        name,
        email,
        phone,
        company,
        status: status || "Active",
        tags: normalizeTags(tags),
        contactCategories: validatedCategoryIds, // 🔥 NEW
        lastActivity: now,
        createdAt: now,
      });

      // 🔹 Enrichment
      contact.enrichment = enrichContact({ phone, email, company });

      // 🔹 Tagging
      const tagResult = recomputeTags({ contact });
      contact.tags = tagResult.tags;
      contact.autoTags = tagResult.autoTags;

      await contact.save({ session });
      await session.commitTransaction();

      return contact;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  /**
   * UPDATE CONTACT
   */
  static async update({ tenantId, contactId, payload }) {
    const contact = await Contact.findOne({
      _id: contactId,
      tenantId,
    });

    if (!contact) {
      throw new Error("Contact not found");
    }

    const {
      name,
      email,
      phone,
      company,
      tags,
      status,
      contactCategories, // 🔥 NEW: category support
    } = payload;

    // 🔒 Validate categories if provided
    if (contactCategories !== undefined) {
      const categoryIds = normalizeCategoryIds(contactCategories);
      const validatedCategoryIds = await validateCategories({
        tenantId,
        categoryIds,
      });
      contact.contactCategories = validatedCategoryIds;
    }

    // 🔒 Email uniqueness on update
    if (email && email !== contact.email) {
      const exists = await Contact.findOne({
        tenantId,
        email,
        _id: { $ne: contactId },
      });
      if (exists) {
        throw new Error("Another contact already uses this email");
      }
      contact.email = email;
    }

    if (name !== undefined) contact.name = name;
    if (phone !== undefined) contact.phone = phone;
    if (company !== undefined) contact.company = company;
    if (status !== undefined) contact.status = status;

    if (tags !== undefined) {
      contact.tags = normalizeTags(tags);
    }

    // 🔹 Update activity
    contact.lastActivity = new Date();

    // 🔹 Re-enrich (safe & cheap)
    contact.enrichment = enrichContact({
      phone: contact.phone,
      email: contact.email,
      company: contact.company,
    });

    // 🔹 Recompute tags
    const tagResult = recomputeTags({ contact });
    contact.tags = tagResult.tags;
    contact.autoTags = tagResult.autoTags;

    await contact.save();
    return contact;
  }

  /**
   * GET CONTACT BY ID
   */
  static async getById({ tenantId, contactId }) {
    const contact = await Contact.findOne({
      _id: contactId,
      tenantId,
    }).populate("contactCategories", "name type");

    if (!contact) {
      throw new Error("Contact not found");
    }

    return contact;
  }

  /**
   * LIST CONTACTS (pagination + search)
   */
  static async list({
    tenantId,
    page = 1,
    limit = 10,
    search = "",
    status,
    categoryId, // 🔥 NEW: filter by category
  }) {
    const filter = { tenantId };

    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { name: regex },
        { email: regex },
        { company: regex },
        { tags: regex },
      ];
    }

    if (status) {
      filter.status = status;
    }

    // 🔥 NEW: Filter by category
    if (categoryId) {
      filter.contactCategories = categoryId;
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Contact.find(filter)
        .populate("contactCategories", "name type")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Contact.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
    };
  }

  /**
   * DELETE CONTACT
   */
  static async remove({ tenantId, contactId }) {
    const result = await Contact.deleteOne({
      _id: contactId,
      tenantId,
    });

    if (result.deletedCount === 0) {
      throw new Error("Contact not found or already deleted");
    }

    return true;
  }

  /**
   * BULK CREATE (Excel / CSV ready)
   * NOTE: optimized version (no controller logic here)
   */
  static async bulkCreate({ tenantId, rows, defaultCategoryId }) {
    const now = new Date();

    // 🔥 NEW: Validate default category if provided
    let validDefaultCategoryId = null;
    if (defaultCategoryId) {
      const validatedIds = await validateCategories({
        tenantId,
        categoryIds: [defaultCategoryId],
      });
      validDefaultCategoryId = validatedIds[0];
    }

    // 🔥 NEW: Pre-fetch all valid categories for this tenant (for row-level validation)
    const tenantCategories = await ContactCategory.find({
      $or: [
        { tenant: tenantId },
        { isDefault: true },
      ],
      active: true,
    }).select("_id name");

    const categoryNameToId = new Map(
      tenantCategories.map(c => [c.name.toLowerCase(), c._id])
    );

    const contactsToInsert = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        const { name, email, phone, company, tags, status, category } = row;

        if (!name || !email) {
          throw new Error("Name and Email required");
        }

        // 🔥 NEW: Resolve category from row or use default
        let resolvedCategoryIds = [];

        if (category) {
          // Try to match category by name (case-insensitive)
          const categoryNames = category.split(",").map(c => c.trim().toLowerCase());
          for (const catName of categoryNames) {
            const catId = categoryNameToId.get(catName);
            if (catId) {
              resolvedCategoryIds.push(catId);
            }
          }
        }

        // Fallback to default category
        if (resolvedCategoryIds.length === 0 && validDefaultCategoryId) {
          resolvedCategoryIds = [validDefaultCategoryId];
        }

        // 🔥 Enforce at least one category
        if (resolvedCategoryIds.length === 0) {
          throw new Error("Category required (provide 'category' column or set default)");
        }

        // 🔹 temp contact-like object for tagging
        const baseContact = {
          name,
          email,
          phone,
          company,
          tags: normalizeTags(tags),
          status: status || "Active",
          createdAt: now,
          lastActivity: now,
        };

        const enrichment = enrichContact({ phone, email, company });
        const autoTags = deriveAutoTags(baseContact);

        const mergedTags = new Set([
          ...baseContact.tags,
          ...autoTags,
        ]);

        contactsToInsert.push({
          tenantId,
          ...baseContact,
          tags: Array.from(mergedTags),
          autoTags,
          enrichment,
          contactCategories: resolvedCategoryIds, // 🔥 NEW
        });

      } catch (err) {
        errors.push({
          row: row.rowNumber || i + 1,
          message: err.message,
        });
      }
    }

    if (!contactsToInsert.length) {
      return { inserted: 0, errors };
    }

    const inserted = await Contact.insertMany(contactsToInsert, {
      ordered: false,
    }).catch(() => null);

    return {
      inserted: inserted?.length || 0,
      errors,
    };
  }
}

module.exports = ContactService;
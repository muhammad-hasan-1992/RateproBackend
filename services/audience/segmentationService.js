// services/audience/segmentationService.js
const AudienceSegment = require("../../models/AudienceSegment");
const Contact = require("../../models/ContactManagement");
const { buildSafeContactQuery } = require("./segmentQueryBuilder");
const SegmentCache = require("./segmentCacheService");

class SegmentationService {
  static async createSegment({ tenantId, payload }) {
    const { name, description, filters } = payload;

    if (!name || !filters) {
      throw new Error("Name & filters required");
    }

    // 🔥 Use safe query builder with validation
    const query = buildSafeContactQuery(filters);

    // Store both the original filters and compiled query
    return AudienceSegment.create({
      tenantId,
      name,
      description,
      filters,  // 🔥 Store original filters for UI
      query,    // Compiled Mongo query
      isSystem: false,
    });
  }

  static async updateSegment({ tenantId, segmentId, payload }) {
    const segment = await AudienceSegment.findOne({
      _id: segmentId,
      tenantId,
    });

    if (!segment) throw new Error("Segment not found");
    if (segment.isSystem) throw new Error("System segments cannot be modified");

    const { name, description, filters } = payload;

    if (name) segment.name = name;
    if (description !== undefined) segment.description = description;

    if (filters) {
      segment.filters = filters;
      segment.query = buildSafeContactQuery(filters);
    }

    await segment.save();

    // Invalidate cache
    SegmentCache.invalidate(SegmentCache.makeKey(tenantId, segmentId));

    return segment;
  }

  static async deleteSegment({ tenantId, segmentId }) {
    const segment = await AudienceSegment.findOne({
      _id: segmentId,
      tenantId,
    });

    if (!segment) throw new Error("Segment not found");
    if (segment.isSystem) throw new Error("System segments cannot be deleted");

    await segment.deleteOne();

    // Invalidate cache
    SegmentCache.invalidate(SegmentCache.makeKey(tenantId, segmentId));

    return true;
  }

  static async listSegments({ tenantId }) {
    return AudienceSegment.find({ tenantId }).sort({ createdAt: -1 });
  }

  /**
   * List all segments with their contact counts
   * This is useful for UI where we need to show segment sizes
   */
  static async listSegmentsWithCounts({ tenantId }) {
    const segments = await AudienceSegment.find({ tenantId }).sort({ createdAt: -1 });

    // Get counts for all segments in parallel
    const segmentsWithCounts = await Promise.all(
      segments.map(async (segment) => {
        const count = await Contact.countDocuments({
          tenantId,
          ...segment.query,
        });

        return {
          _id: segment._id,
          name: segment.name,
          description: segment.description,
          filters: segment.filters,
          isSystem: segment.isSystem,
          createdAt: segment.createdAt,
          updatedAt: segment.updatedAt,
          contactCount: count, // 🔥 Add contact count
        };
      })
    );

    return segmentsWithCounts;
  }

  static async getSegment({ tenantId, segmentId }) {
    const segment = await AudienceSegment.findOne({
      _id: segmentId,
      tenantId,
    });

    if (!segment) throw new Error("Segment not found");
    return segment;
  }

  static async previewSegment({ tenantId, segmentId, page = 1, limit = 10 }) {
    const segment = await AudienceSegment.findOne({ _id: segmentId, tenantId });
    if (!segment) throw new Error("Segment not found");

    const skip = (page - 1) * limit;

    const [contacts, total] = await Promise.all([
      Contact.find({ tenantId, ...segment.query })
        .populate("contactCategories", "name type")
        .skip(skip)
        .limit(limit)
        .sort({ lastActivity: -1 }),
      Contact.countDocuments({ tenantId, ...segment.query }),
    ]);

    return { segment, contacts, total, page, limit };
  }

  static async listContactsBySegment({
    tenantId,
    segmentId,
    page = 1,
    limit = 10,
    search = "",
  }) {
    const segment = await AudienceSegment.findOne({
      _id: segmentId,
      tenantId,
    });

    if (!segment) throw new Error("Segment not found");

    const filter = {
      tenantId,
      ...segment.query,
    };

    if (search) {
      const regex = new RegExp(search, "i");
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { name: regex },
          { email: regex },
          { company: regex },
          { tags: regex },
        ],
      });
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Contact.find(filter)
        .populate("contactCategories", "name type")
        .sort({ lastActivity: -1 })
        .skip(skip)
        .limit(limit),
      Contact.countDocuments(filter),
    ]);

    return {
      segment: {
        id: segment._id,
        name: segment.name,
      },
      items,
      total,
      page,
      limit,
    };
  }

  static async countSegment({ tenantId, segmentId }) {
    const cacheKey = SegmentCache.makeKey(tenantId, segmentId);

    const cached = SegmentCache.get(cacheKey);
    if (cached?.count !== undefined) {
      return cached;
    }

    const segment = await AudienceSegment.findOne({ _id: segmentId, tenantId });
    if (!segment) throw new Error("Segment not found");

    const count = await Contact.countDocuments({
      tenantId,
      ...segment.query,
    });

    SegmentCache.set(cacheKey, { count });

    return { segmentId, count };
  }

  /**
   * Preview filters without saving (for UI)
   */
  static async previewFilters({ tenantId, filters, page = 1, limit = 10 }) {
    const query = buildSafeContactQuery(filters);

    const skip = (page - 1) * limit;

    const [contacts, total] = await Promise.all([
      Contact.find({ tenantId, ...query })
        .populate("contactCategories", "name type")
        .skip(skip)
        .limit(limit)
        .sort({ lastActivity: -1 }),
      Contact.countDocuments({ tenantId, ...query }),
    ]);

    return { contacts, total, page, limit };
  }
}

module.exports = SegmentationService;
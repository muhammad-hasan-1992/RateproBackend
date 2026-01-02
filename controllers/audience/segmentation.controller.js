// controllers/audience/segmentation.controller.js
const SegmentationService = require("../../services/audience/segmentationService");

/**
 * POST /api/segments
 * Create a new segment
 */
exports.createSegment = async (req, res) => {
  try {
    const segment = await SegmentationService.createSegment({
      tenantId: req.tenantId,
      payload: req.body,
    });
    res.status(201).json({
      success: true,
      data: { segment },
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * GET /api/segments
 * List all segments for tenant
 */
exports.listSegments = async (req, res) => {
  try {
    // Check if withCounts query param is passed
    const withCounts = req.query.withCounts === "true";

    let segments;
    if (withCounts) {
      segments = await SegmentationService.listSegmentsWithCounts({
        tenantId: req.tenantId,
      });
    } else {
      segments = await SegmentationService.listSegments({
        tenantId: req.tenantId,
      });
    }

    res.json({
      success: true,
      count: segments.length,
      data: { segments },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * GET /api/segments/:id
 * Get single segment by ID
 */
exports.getSegment = async (req, res) => {
  try {
    const segment = await SegmentationService.getSegment({
      tenantId: req.tenantId,
      segmentId: req.params.id,
    });
    res.json({
      success: true,
      data: { segment },
    });
  } catch (err) {
    const status = err.message === "Segment not found" ? 404 : 500;
    res.status(status).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * PUT /api/segments/:id
 * Update a segment
 */
exports.updateSegment = async (req, res) => {
  try {
    const segment = await SegmentationService.updateSegment({
      tenantId: req.tenantId,
      segmentId: req.params.id,
      payload: req.body,
    });
    res.json({
      success: true,
      data: { segment },
    });
  } catch (err) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * DELETE /api/segments/:id
 * Delete a segment
 */
exports.deleteSegment = async (req, res) => {
  try {
    await SegmentationService.deleteSegment({
      tenantId: req.tenantId,
      segmentId: req.params.id,
    });
    res.json({
      success: true,
      message: "Segment deleted",
    });
  } catch (err) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * GET /api/segments/:id/preview
 * Preview contacts matching segment
 */
exports.previewSegment = async (req, res) => {
  try {
    const result = await SegmentationService.previewSegment({
      tenantId: req.tenantId,
      segmentId: req.params.id,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
    });
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    const status = err.message === "Segment not found" ? 404 : 500;
    res.status(status).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * GET /api/segments/:id/count
 * Get count of contacts in segment
 */
exports.countSegment = async (req, res) => {
  try {
    const result = await SegmentationService.countSegment({
      tenantId: req.tenantId,
      segmentId: req.params.id,
    });
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    const status = err.message === "Segment not found" ? 404 : 500;
    res.status(status).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * GET /api/segments/:id/contacts
 * List contacts in segment with pagination & search
 */
exports.listContactsBySegment = async (req, res) => {
  try {
    const result = await SegmentationService.listContactsBySegment({
      tenantId: req.tenantId,
      segmentId: req.params.id,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
      search: req.query.search || "",
    });
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    const status = err.message === "Segment not found" ? 404 : 500;
    res.status(status).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * POST /api/segments/preview
 * Preview filters without saving (for segment builder UI)
 */
exports.previewFilters = async (req, res) => {
  try {
    const result = await SegmentationService.previewFilters({
      tenantId: req.tenantId,
      filters: req.body.filters || {},
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
    });
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * GET /api/segments/filters/options
 * Get available filter options for segment builder
 */
exports.getFilterOptions = async (req, res) => {
  try {
    // Return list of available filters for frontend
    const filterOptions = {
      basic: [
        { key: "status", label: "Status", type: "select", options: ["Active", "Inactive", "Blocked"] },
        { key: "hasTag", label: "Has Tag", type: "text" },
        { key: "hasTags", label: "Has Any Tags", type: "tags" },
        { key: "hasAllTags", label: "Has All Tags", type: "tags" },
        { key: "autoTag", label: "Auto Tag", type: "text" },
      ],
      category: [
        { key: "categoryId", label: "Category", type: "categorySelect" },
        { key: "categoryIds", label: "Any of Categories", type: "categoryMultiSelect" },
      ],
      time: [
        { key: "inactiveDays", label: "Inactive for (days)", type: "number" },
        { key: "activeDays", label: "Active within (days)", type: "number" },
        { key: "createdLastDays", label: "Created within (days)", type: "number" },
        { key: "createdBeforeDays", label: "Created before (days)", type: "number" },
      ],
      survey: [
        { key: "respondedLastDays", label: "Responded in last (days)", type: "number" },
        { key: "notRespondedDays", label: "No response in (days)", type: "number" },
        { key: "invitedButNotResponded", label: "Invited but not responded", type: "boolean" },
        { key: "hasResponded", label: "Has responded", type: "boolean" },
        { key: "neverResponded", label: "Never responded", type: "boolean" },
        { key: "minResponses", label: "Min responses", type: "number" },
        { key: "maxResponses", label: "Max responses", type: "number" },
      ],
      nps: [
        { key: "npsBelow", label: "NPS below", type: "number", min: 0, max: 10 },
        { key: "npsAbove", label: "NPS above", type: "number", min: 0, max: 10 },
        { key: "npsBetween", label: "NPS between", type: "range", min: 0, max: 10 },
        { key: "npsCategory", label: "NPS Category", type: "select", options: ["promoter", "passive", "detractor"] },
        { key: "ratingBelow", label: "Rating below", type: "number", min: 1, max: 5 },
        { key: "ratingAbove", label: "Rating above", type: "number", min: 1, max: 5 },
      ],
      location: [
        { key: "country", label: "Country", type: "text" },
        { key: "countries", label: "Countries", type: "tags" },
        { key: "city", label: "City", type: "text" },
        { key: "cities", label: "Cities", type: "tags" },
        { key: "region", label: "Region", type: "text" },
        { key: "regions", label: "Regions", type: "tags" },
      ],
      company: [
        { key: "company", label: "Company (exact)", type: "text" },
        { key: "companyContains", label: "Company (contains)", type: "text" },
        { key: "domain", label: "Email Domain", type: "text" },
      ],
    };

    res.json({
      success: true,
      data: { filterOptions },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

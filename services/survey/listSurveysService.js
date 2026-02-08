// services/survey/listSurveys.service.js
// ============================================================================
// List Surveys Service with Department-Scoped Filtering
// 
// Applies department-level filtering at the query level to prevent:
// - Overfetching data
// - Accidental data leaks
// - Performance issues
// ============================================================================

const mongoose = require("mongoose");
const Survey = require("../../models/Survey");

/**
 * Convert a filter object for use in aggregation pipeline
 * Mongoose .find() automatically converts string IDs to ObjectIds, but aggregation doesn't
 */
function convertFilterForAggregation(filter) {
  const converted = { ...filter };

  // Convert tenant to ObjectId if it's a string
  if (converted.tenant && typeof converted.tenant === 'string') {
    converted.tenant = new mongoose.Types.ObjectId(converted.tenant);
  } else if (converted.tenant && converted.tenant._id) {
    converted.tenant = new mongoose.Types.ObjectId(converted.tenant._id);
  }

  // Convert department to ObjectId if present
  if (converted.department && typeof converted.department === 'string') {
    converted.department = new mongoose.Types.ObjectId(converted.department);
  }

  // Handle $or conditions for department
  if (converted.$or) {
    converted.$or = converted.$or.map(cond => {
      if (cond.department && typeof cond.department === 'string') {
        return { ...cond, department: new mongoose.Types.ObjectId(cond.department) };
      }
      return cond;
    });
  }

  return converted;
}

/**
 * Build department-scoped query filter for surveys
 * @param {Object} user - The requesting user
 * @returns {Object} MongoDB query filter for department scoping
 */
function getDepartmentFilter(user) {
  // CompanyAdmin with cross-department access can see all surveys
  if (user.role === 'companyAdmin' && user.crossDepartmentSurveyAccess === true) {
    return {}; // No department filter
  }

  // CompanyAdmin without cross-department access can see:
  // - Surveys in their department (if they have one)
  // - Surveys with null department (company-level)
  if (user.role === 'companyAdmin') {
    if (user.department) {
      return { $or: [{ department: user.department }, { department: null }] };
    }
    return { department: null };
  }

  // Members can only see surveys in their department
  if (user.department) {
    return { department: user.department };
  }

  // No department = no access for members (matches nothing)
  return { department: { $exists: false } };
}

exports.listSurveysService = async ({ query, user }) => {
  const {
    search = "",
    status,
    page = 1,
    limit = 10,
    sort = "-createdAt",
    department, // Optional filter by specific department
  } = query;

  const skip = (page - 1) * limit;

  // Base filter
  const filter = {
    deleted: false,
    title: { $regex: search, $options: "i" },
  };

  // System Admin cannot access surveys (blocked at route level, but double-check)
  if (user.role === 'admin') {
    return {
      total: 0,
      page: Number(page),
      limit: Number(limit),
      surveys: [],
      error: "System admins cannot access tenant surveys"
    };
  }

  // Tenant scoping
  filter.tenant = user.tenant;

  // Apply department-scoped filtering
  const departmentFilter = getDepartmentFilter(user);
  Object.assign(filter, departmentFilter);

  // Optional: explicit department filter from query params (for CompanyAdmin with cross-dept access)
  if (department && user.role === 'companyAdmin' && user.crossDepartmentSurveyAccess) {
    filter.department = department;
  }

  // Status filter
  if (status) filter.status = status;

  const total = await Survey.countDocuments(filter);

  // Smart sort: if requesting -lastResponseAt, use aggregation for null-safe sorting
  // Surveys with responses appear first (sorted by lastResponseAt DESC)
  // Surveys without responses appear after (sorted by createdAt DESC)
  let surveys;

  if (sort === "-lastResponseAt" || sort === "lastResponseAt") {
    const sortDirection = sort.startsWith("-") ? -1 : 1;

    // Convert filter for aggregation (ObjectId conversion)
    const aggFilter = convertFilterForAggregation(filter);

    surveys = await Survey.aggregate([
      { $match: aggFilter },
      {
        $addFields: {
          // Surveys with responses get priority (hasResponses = 1), others get 0
          hasResponses: { $cond: [{ $gt: ["$lastResponseAt", null] }, 1, 0] },
          // Use lastResponseAt if exists, otherwise fallback to createdAt
          effectiveSortDate: { $ifNull: ["$lastResponseAt", "$createdAt"] }
        }
      },
      // Sort by: hasResponses DESC (surveys with responses first), then by date
      { $sort: { hasResponses: -1, effectiveSortDate: sortDirection } },
      { $skip: skip },
      { $limit: Number(limit) },
      // Lookup createdBy
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "createdBy",
          pipeline: [{ $project: { name: 1, email: 1 } }]
        }
      },
      { $unwind: { path: "$createdBy", preserveNullAndEmptyArrays: true } },
      // Lookup department
      {
        $lookup: {
          from: "departments",
          localField: "department",
          foreignField: "_id",
          as: "department",
          pipeline: [{ $project: { name: 1 } }]
        }
      },
      { $unwind: { path: "$department", preserveNullAndEmptyArrays: true } },
      // Remove temporary fields
      { $project: { hasResponses: 0, effectiveSortDate: 0 } }
    ]);
  } else {
    // Standard sort for other fields
    surveys = await Survey.find(filter)
      .populate("createdBy", "name email")
      .populate("department", "name")
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .lean();
  }

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    surveys,
  };
};

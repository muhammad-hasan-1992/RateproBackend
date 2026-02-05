// services/survey/listSurveys.service.js
// ============================================================================
// List Surveys Service with Department-Scoped Filtering
// 
// Applies department-level filtering at the query level to prevent:
// - Overfetching data
// - Accidental data leaks
// - Performance issues
// ============================================================================

const Survey = require("../../models/Survey");

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

  const surveys = await Survey.find(filter)
    .populate("createdBy", "name email")
    .populate("department", "name") // Include department info in response
    .sort(sort)
    .skip(skip)
    .limit(Number(limit))
    .lean();

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    surveys,
  };
};
# RatePro Backend - Complete System Flow Documentation

## Table of Contents
1. [System Architecture Overview](#system-architecture-overview)
2. [Server Entry Point](#server-entry-point)
3. [Middleware Chain](#middleware-chain)
4. [Controllers](#controllers)
5. [Services](#services)
6. [Models](#models)
7. [Utilities](#utilities)
8. [Data Flow Examples](#data-flow-examples)

---

## System Architecture Overview

The RatePro backend follows a layered architecture pattern:

```
Client Request
       ↓
  [server.js] - Express App Entry Point
       ↓
  [Middlewares] - Rate Limiter → CORS → Auth → Tenant → Permission
       ↓
  [Routes] - API Endpoints
       ↓
  [Controllers] - Business Logic Orchestration
       ↓
  [Validators] - Input Validation (Joi)
       ↓
  [Services] - Reusable Business Logic
       ↓
  [Models] - MongoDB/Mongoose Schemas
       ↓
  [Utils] - Helper Functions (Email, AI, QR, etc.)
```

### Directory Structure
```
RateproBackend/
├── server.js           # Main entry point
├── config/             # DB, Redis, Passport configs
├── controllers/        # 25 controller files + 12 subdirectories
├── services/           # 15 service directories
├── routes/             # 27 route files
├── models/             # 28 MongoDB models
├── middlewares/        # 8 middleware files
├── validators/         # 9 validation files
├── utils/              # 20+ utility files
├── jobs/               # Background jobs
├── crons/              # Scheduled tasks
├── workers/            # Queue workers
└── queues/             # BullMQ queue configs
```

---

## Server Entry Point

### server.js
**Purpose:** Initializes Express app, connects to MongoDB, configures middleware, registers routes, and starts cron jobs.

#### Key Functions:

| Function | Purpose | Flow |
|----------|---------|------|
| `startServer()` | Connects to MongoDB and enables notifications for all tenants | Called on app start |
| Cron `*/5 * * * *` | Auto-publishes scheduled surveys | Runs every 5 minutes |
| Cron `0 2 * * *` | Runs daily maintenance tasks | Runs at 2 AM daily |

#### Registered Routes (27 total):
| Route | Handler | Base Path |
|-------|---------|-----------|
| Auth | authRoutes.js | `/api/auth` |
| Users | userRoutes.js | `/api/users` |
| Contacts | contact.routes.js | `/api/contacts` |
| Segments | segmentation.routes.js | `/api/segments` |
| Surveys | surveyRoutes.js | `/api/surveys` |
| Analytics | analyticsRoutes.js | `/api/analytics` |
| Actions | actionRoutes.js | `/api/actions` |
| AI | aiRoutes.js | `/api/ai` |
| Tickets | ticketRoutes.js | `/api/tickets` |
| Notifications | notificationRoutes.js | `/api/notifications` |
| Email Templates | emailTemplateRoutes.js | `/api/email-templates` |
| Tenants | tenantRoutes.js | `/api/tenants` |
| Roles | roleRoutes.js | `/api/roles` |
| Permissions | permissionRoutes.js | `/api/permissions` |
| Plans | planRoutes.js | `/api/plans` |

---

## Middleware Chain

### 1. authMiddleware.js

**File:** `middlewares/authMiddleware.js`

| Function | Purpose | Parameters | Returns |
|----------|---------|------------|---------|
| `protect(req, res, next)` | Validates JWT token and populates `req.user` | req, res, next | Sets `req.user`, `req.tenantId` |

**Execution Flow:**
1. Skip public paths (`/api/surveys/public`, `/api/auth/login`, `/api/auth/register`)
2. Extract token from `Authorization` header or cookies
3. Verify token with `jwt.verify()`
4. Find user by decoded ID, populate tenant and customRoles
5. Set `req.user` and `req.tenantId`

### 2. tenantMiddleware.js

**File:** `middlewares/tenantMiddleware.js`

| Function | Purpose | Parameters |
|----------|---------|------------|
| `setTenantId(req, res, next)` | Sets tenant ID for non-admin users | req, res, next |
| `tenantCheck(req, res, next)` | Validates resource belongs to user's tenant | req, res, next |

**Execution Flow:**
1. Skip for admin users (can access all tenants)
2. Fetch user's tenant from database
3. Set `req.tenantId`
4. For resource operations, verify resource.tenant matches req.tenantId

### 3. roleMiddleware.js

**File:** `middlewares/roleMiddleware.js`

| Function | Purpose | Parameters |
|----------|---------|------------|
| `allowRoles(...roles)` | Restricts access to specified roles | roles array |

### 4. permissionMiddleware.js

**File:** `middlewares/permissionMiddleware.js`

| Function | Purpose | Parameters |
|----------|---------|------------|
| `allowPermission(permission)` | Checks user has required permission | permission string |

### 5. rateLimiter.js

**File:** `middlewares/rateLimiter.js`

| Limiter | Purpose | Configuration |
|---------|---------|---------------|
| `globalLimiter` | Rate limits all requests | Applied globally |
| `authLimiter` | Rate limits auth endpoints | Stricter limits |
| `surveyResponseLimiter` | Rate limits response submissions | Prevents spam |
| `anonymousSurveyLimiter` | Rate limits anonymous submissions | IP-based |

---

## Controllers

### Authentication Controller

**File:** `controllers/authController.js` (1176 lines)

| Function | Route | Purpose | Parameters |
|----------|-------|---------|------------|
| `registerUser(req, res, next)` | POST /api/auth/register | Register new user and tenant | `{ name, email, password, companyName }` |
| `loginUser(req, res, next)` | POST /api/auth/login | Authenticate user, return JWT | `{ email, password }` |
| `verifyEmail(req, res, next)` | POST /api/auth/verify-email | Verify email with OTP | `{ email, code }` |
| `verifyEmailLink(req, res, next)` | GET /api/auth/verify-email-link | Verify email via link | `?token=<jwt>` |
| `resendOtp(req, res, next)` | POST /api/auth/resend-otp | Resend verification OTP | `{ email, purpose }` |
| `forgotPassword(req, res, next)` | POST /api/auth/forgot-password | Send password reset email | `{ email }` |
| `verifyResetCode(req, res, next)` | POST /api/auth/verify-reset-code | Verify reset OTP | `{ email, code }` |
| `resetPassword(req, res, next)` | POST /api/auth/reset-password | Reset password | `{ email, password }` |
| `updateProfile(req, res, next)` | PUT /api/auth/update-profile | Update user profile | `{ name, bio, phone, avatar }` |
| `getMe(req, res, next)` | GET /api/auth/me | Get current user info | - |
| `logoutUser(req, res)` | POST /api/auth/logout | Clear auth cookies | - |
| `refreshAccessToken(req, res)` | POST /api/auth/refresh | Refresh JWT token | Cookie-based |

**Helper Functions:**
| Function | Purpose |
|----------|---------|
| `generateOTP()` | Generates 6-digit random OTP |

**Data Flow - Registration:**
```
Client → authRoutes → authLimiter → registerUser()
    ↓
Validate with registerSchema (Joi)
    ↓
Check email uniqueness
    ↓
Create Tenant → Create User → Hash password
    ↓
Generate OTP → Save to OTP model
    ↓
Send verification email (via sendEmail util)
    ↓
Return success response
```

---

### Survey Controller

**File:** `controllers/surveyController.js` (2233 lines)

**Main Controller Functions:**

| Function | Route | Purpose | Parameters |
|----------|-------|---------|------------|
| `createSurvey(req, res)` | POST /api/surveys/save-draft | Create/save survey draft | `{ title, description, questions, settings, schedule }` |
| `publishSurvey(req, res, next)` | POST /api/surveys/publish | Publish survey to recipients | `{ surveyId }` or survey data |
| `getAllSurveys(req, res, next)` | GET /api/surveys | List surveys with filters | `?status, page, limit` |
| `getSurveyById(req, res, next)` | GET /api/surveys/:id | Get single survey | `:id` |
| `getPublicSurveys(req, res, next)` | GET /api/surveys/public/all | Get public surveys | - |
| `getPublicSurveyById(req, res, next)` | GET /api/surveys/public/:id | Get public survey by ID | `:id` |
| `updateSurvey(req, res, next)` | PUT /api/surveys/:surveyId | Update survey | `:surveyId, body` |
| `deleteSurvey(req, res, next)` | DELETE /api/surveys/:surveyId | Soft delete survey | `:surveyId` |
| `toggleSurveyStatus(req, res, next)` | PUT /api/surveys/toggle/:id | Toggle active/inactive | `:id, { status }` |
| `submitSurveyResponse(req, res, next)` | POST /api/surveys/:id/response | Submit survey response | `:id, { answers, review, rating }` |
| `getSurveyResponses(req, res, next)` | GET /api/surveys/:surveyId/responses | Get survey responses | `:surveyId, ?page, limit` |
| `getSurveyAnalytics(req, res, next)` | GET /api/surveys/:surveyId/analytics | Get survey analytics | `:surveyId` |
| `getSurveyQRCode(req, res, next)` | GET /api/surveys/qr/:id | Generate QR code | `:id` |
| `exportSurveyReport(req, res, next)` | GET /api/surveys/report/:id | Export PDF report | `:id` |
| `exportResponses(req, res, next)` | GET /api/surveys/:id/export | Export CSV responses | `:id` |
| `verifySurveyPassword(req, res, next)` | POST /api/surveys/:id/verify | Verify survey password | `:id, { password }` |
| `createQuestion(req, res)` | POST /api/surveys/:id/questions | Add question | `:id, { question }` |
| `deleteQuestion(req, res)` | DELETE /api/surveys/:id/questions/:qid | Delete question | `:id, :qid` |
| `setTargetAudience(req, res, next)` | POST /api/surveys/:surveyId/audience | Set target audience | `:surveyId, { audienceType, categories, contacts }` |
| `scheduleSurvey(req, res, next)` | POST /api/surveys/:surveyId/schedule | Schedule survey | `:surveyId, { startDate, endDate, timezone }` |
| `autoPublishScheduledSurveys()` | CRON | Auto-publish scheduled surveys | Called by cron job |

**Helper Functions:**

| Function | Purpose | Parameters |
|----------|---------|------------|
| `generateActionsFromResponse(response, survey, tenantId)` | Generate action items from negative feedback | response, survey, tenantId |
| `hasNegativeFeedback(response)` | Detect negative feedback patterns | response object |
| `analyzeFeedbackSentiment(response, survey)` | AI sentiment analysis | response, survey |
| `notifyManagersOfUrgentAction(action, tenantId)` | Send urgent action notifications | action, tenantId |
| `extractRating(response)` | Extract rating from response | response object |
| `extractNPSScore(response)` | Extract NPS score | response object |
| `calculateTrend(current, previous)` | Calculate percentage change | numbers |

**Modular Survey Controllers:**

**Directory:** `controllers/survey/`

| File | Function | Purpose |
|------|----------|---------|
| `createSurvey.controller.js` | `createSurvey` | Create survey draft |
| `publishSurvey.controller.js` | `publishSurvey` | Publish survey |
| `listSurveys.controller.js` | `listSurveys` | List all surveys |
| `getSurvey.controller.js` | `getSurveyById` | Get single survey |
| `updateSurvey.controller.js` | `updateSurvey` | Update survey |
| `deleteSurvey.controller.js` | `deleteSurvey` | Delete survey |
| `toggleStatus.controller.js` | `toggleSurveyStatus` | Toggle survey status |
| `scheduleSurvey.controller.js` | `scheduleSurvey` | Schedule survey |
| `setAudience.controller.js` | `setAudience` | Set target audience |
| `getSurveyResponses.controller.js` | `getSurveyResponses` | Get responses |
| `exportResponses.controller.js` | `exportResponses` | Export CSV |
| `exportSurveyReport.controller.js` | `exportSurveyReport` | Export PDF |
| `getAnonymousSurveyQRCode.controller.js` | `getAnonymousSurveyQRCode` | Generate anonymous QR |
| `getInviteQRCode.controller.js` | `getInviteQRCode` | Generate invite QR |
| `getSurveyQRCode.controller.js` | `getSurveyQRCode` | Generate survey QR |
| `getPublicSurveys.controller.js` | `getPublicSurveys` | Get public surveys |
| `getPublicSurveyById.controller.js` | `getPublicSurveyById` | Get public survey |
| `verifySurveyPassword.controller.js` | `verifySurveyPassword` | Verify password |
| `questions.controller.js` | `createQuestion, deleteQuestion` | Question CRUD |
| `submitResponse.controller.js` | `submitResponse` | Submit response |

---

### Response Controllers

**Directory:** `controllers/responses/`

| File | Function | Purpose | Parameters |
|------|----------|---------|------------|
| `verifyToken.controller.js` | `verifyInviteToken` | Verify invite token and return survey | `:token` |
| `submitResponse.controller.js` | `submitResponse` | Submit authenticated response | `{ answers, review, rating }` |
| `submitAnonymousResponse.controller.js` | `submitAnonymousResponse` | Submit anonymous response | `:surveyId, { answers }` |
| `submittedInvitedResponse.controller.js` | `submitInvitedResponse` | Submit invited response | `:token, { answers }` |

**Data Flow - Submit Anonymous Response:**
```
Client → POST /api/surveys/responses/anonymous/:surveyId
    ↓
surveyRoutes → surveyResponseLimiter → anonymousSurveyLimiter
    ↓
submitAnonymousResponse controller
    ↓
Call submitResponseService.anonymousResponseService
    ↓
Extract metadata (device, browser, location)
    ↓
Create SurveyResponse document
    ↓
Add to postResponseQueue (BullMQ)
    ↓
postResponse.worker processes:
  - AI Analysis (sentiment, themes)
  - Update survey stats
  - Generate actions if negative
  - Send notifications
    ↓
Return success response
```

---

### Analytics Controller

**File:** `controllers/analyticsController.js` (779 lines)

| Function | Route | Purpose | Parameters |
|----------|-------|---------|------------|
| `getSurveyStats(req, res)` | GET /api/analytics/survey/:surveyId | Get survey statistics | `:surveyId` |
| `getTenantStats(req, res)` | GET /api/analytics/tenant | Get tenant-wide stats | - |
| `getExecutiveDashboard(req, res)` | GET /api/analytics/executive | Executive dashboard | `?range=30d` |
| `getOperationalDashboard(req, res)` | GET /api/analytics/operational | Operational dashboard | `?range=30d` |
| `getTrendsAnalytics(req, res)` | GET /api/analytics/trends | Trends analysis | `?range=30d` |
| `getAlerts(req, res)` | GET /api/analytics/alerts | Get smart alerts | - |

**Helper Functions:**

| Function | Purpose | Parameters |
|----------|---------|------------|
| `calculateCustomerSatisfactionIndex(tenantId, startDate)` | Calculate CSI with location/service breakdown | tenantId, startDate |
| `calculateNPSScore(tenantId, startDate)` | Calculate Net Promoter Score | tenantId, startDate |
| `calculateResponseRate(tenantId, startDate)` | Calculate response rate percentage | tenantId, startDate |
| `calculateAlertCounts(tenantId)` | Count alerts by priority | tenantId |
| `calculateSLAMetrics(tenantId, startDate)` | Calculate SLA compliance | tenantId, startDate |
| `getTopComplaints(tenantId, startDate)` | Get top complaint categories | tenantId, startDate |
| `getTopPraises(tenantId, startDate)` | Get top praise categories | tenantId, startDate |
| `getSatisfactionTrend(tenantId, startDate, days)` | Get satisfaction over time | tenantId, startDate, days |
| `getVolumeTrend(tenantId, startDate, days)` | Get response volume over time | tenantId, startDate, days |
| `generateSmartAlerts(actions, responses, tenantId)` | Generate AI-powered alerts | actions, responses, tenantId |

**Modular Analytics Controllers:**

**Directory:** `controllers/analytics/`

| File | Functions | Purpose |
|------|-----------|---------|
| `demographics.controller.js` | `getDemographics, getSurveyDemographics` | Device/browser/location analytics |
| `sentiment.controller.js` | `getTenantSentimentOverview, getSurveySentiment, getSentimentHeatmap, getComplaintsPraisesBreakdown, analyzeResponseSentiment` | Sentiment analysis |
| `summary.controller.js` | `getTenantSummary, getSurveySummary, getQuickInsights, compareSurveys` | Survey summaries |
| `trends.controller.js` | `getAllTrends, getSatisfactionTrend, getVolumeTrend, getNPSTrend, getComplaintTrend, getEngagementPatterns, getComparativeTrend` | Trend analysis |
| `responses.controller.js` | `getSurveyResponses, getFlaggedResponses, getResponseDetail, getResponseBreakdown, exportResponsesCSV, exportAnalyticsPDF` | Response analytics |
| `getAnalytics.controller.js` | `getAnalytics` | Survey-specific analytics |

**Dashboard Controllers:**

**Directory:** `controllers/analytics/dashboard/`

| File | Function | Purpose |
|------|----------|---------|
| `getSurveyStats.controller.js` | `getSurveyStats` | Individual survey stats |
| `getTenantStats.controller.js` | `getTenantStats` | Tenant-wide stats |
| `executiveDashboard.controller.js` | `getExecutiveDashboard` | Executive metrics |
| `operationalDashboard.controller.js` | `getOperationalDashboard` | Operational metrics |
| `trendsDashboard.controller.js` | `getTrendsAnalytics` | Trends dashboard |
| `alerts.controller.js` | `getAlerts` | Smart alerts |

---

### Action Controller

**File:** `controllers/actionController.js` (918 lines)

| Function | Route | Purpose | Parameters |
|----------|-------|---------|------------|
| `createAction(req, res, next)` | POST /api/actions | Create action item | `{ description, priority, status, dueDate }` |
| `getActions(req, res, next)` | GET /api/actions | List actions with filters | `?priority, status, page, limit` |
| `getActionById(req, res, next)` | GET /api/actions/:id | Get single action | `:id` |
| `updateAction(req, res, next)` | PUT /api/actions/:id | Update action | `:id, { updates }` |
| `deleteAction(req, res, next)` | DELETE /api/actions/:id | Soft delete action | `:id` |
| `assignAction(req, res, next)` | PUT /api/actions/:id/assign | Assign to user/team | `:id, { assignedTo, team }` |
| `getActionsByPriority(req, res, next)` | GET /api/actions/priority/:priority | Filter by priority | `:priority` |
| `getActionsByStatus(req, res, next)` | GET /api/actions/status/:status | Filter by status | `:status` |
| `getActionsAnalytics(req, res, next)` | GET /api/actions/analytics/summary | Actions analytics | - |
| `bulkUpdateActions(req, res, next)` | PUT /api/actions/bulk/update | Bulk update actions | `{ actions: [{ id, updates }] }` |
| `generateActionsFromFeedback(req, res, next)` | POST /api/actions/generate/feedback | AI-generate actions from feedback | `{ surveyId, responseIds }` |

**Helper Functions:**

| Function | Purpose |
|----------|---------|
| `validateUserBelongsToTenant(userId, tenantId)` | Validate user is in tenant |
| `pushAssignmentHistory(action, data)` | Track assignment history |
| `applyAssignmentRules(actionObj, tenantId)` | Apply auto-assignment rules |

**Modular Action Controllers:**

**Directory:** `controllers/action/`

| File | Function |
|------|----------|
| `createAction.controller.js` | `createAction` |
| `getActions.controller.js` | `getActions` |
| `getActionById.controller.js` | `getActionById` |
| `updateAction.controller.js` | `updateAction` |
| `deleteAction.controller.js` | `deleteAction` |
| `assignAction.controller.js` | `assignAction` |
| `getActionsByPriority.controller.js` | `getActionsByPriority` |
| `getActionsByStatus.controller.js` | `getActionsByStatus` |
| `getActionsAnalytics.controller.js` | `getActionsAnalytics` |
| `bulkUpdateActions.controller.js` | `bulkUpdateActions` |
| `generateActionsFromFeedback.controller.js` | `generateActionsFromFeedback` |

---

### AI Controller

**File:** `controllers/aiController.js` (1167 lines)

| Function | Route | Purpose | Parameters |
|----------|-------|---------|------------|
| `aiDraftSurvey(req, res, next)` | POST /api/ai/draft-survey | Generate AI survey draft | `{ title, industry, surveyType, questionCount }` |
| `aiSuggestQuestion(req, res, next)` | POST /api/ai/suggest-questions | Suggest survey questions | `{ context, surveyId }` |
| `aiOptimizeSurvey(req, res, next)` | POST /api/ai/optimize-survey | Optimize survey questions | `{ surveyId }` |
| `aiTranslateSurvey(req, res, next)` | POST /api/ai/translate-survey | Translate survey text | `{ text, from, to }` |
| `aiGenerateFromCompanyProfile(req, res, next)` | POST /api/ai/generate-from-profile | Generate from company profile | `{ industry, size, products }` |
| `aiSuggestLogic(req, res, next)` | POST /api/ai/suggest-logic | Suggest conditional logic | `{ surveyId }` |
| `aiGenerateThankYouPage(req, res, next)` | POST /api/ai/generate-thankyou | Generate thank you content | `{ surveyId }` |
| `aiAnalyzeFeedback(req, res, next)` | POST /api/ai/analyze-feedback | Analyze feedback with AI | `{ responseIds }` |
| `aiGenerateInsights(req, res, next)` | POST /api/ai/generate-insights | Generate insights/actions | `{ surveyId }` |

**Modular AI Controllers:**

**Directory:** `controllers/ai/`

| File | Function |
|------|----------|
| `aiInsights.controller.js` | AI insights generation |
| `analyzeText.controller.js` | Text analysis |
| `aiAnalysis.controller.js` | General AI analysis |

---

### User Controller

**File:** `controllers/userController.js` (1511 lines)

| Function | Route | Purpose | Parameters |
|----------|-------|---------|------------|
| `createUser(req, res)` | POST /api/users | Create user (admin/companyAdmin) | `{ name, email, password, role }` |
| `bulkCreateUsers(req, res)` | POST /api/users/bulk | Bulk create from Excel | Excel file upload |
| `updateUser(req, res, next)` | PUT /api/users/:id | Update user | `:id, { updates }` |
| `deleteUser(req, res, next)` | DELETE /api/users/:id | Delete user | `:id` |
| `toggleActive(req, res, next)` | PUT /api/users/:id/toggle | Toggle active status | `:id` |
| `getAllUsers(req, res, next)` | GET /api/users | List users | `?search, role, status, page, limit` |
| `getUserById(req, res, next)` | GET /api/users/:id | Get single user | `:id` |
| `exportUserDataPDF(req, res, next)` | GET /api/users/:id/export/pdf | Export user to PDF | `:id` |
| `sendNotification(req, res, next)` | POST /api/users/:id/notify | Send notification email | `:id, { subject, message }` |
| `updateMe(req, res, next)` | PUT /api/users/me | Update own profile | `{ name, bio, phone }` |

---

### Ticket Controller

**File:** `controllers/ticketController.js` (1192 lines)

| Function | Route | Purpose | Parameters |
|----------|-------|---------|------------|
| `createTicket(req, res, next)` | POST /api/tickets | Create support ticket | `{ subject, description, category, priority }` |
| `getTickets(req, res, next)` | GET /api/tickets | List tickets | `?status, priority, page, limit` |
| `getTicketById(req, res, next)` | GET /api/tickets/:id | Get single ticket | `:id` |
| `updateTicket(req, res, next)` | PUT /api/tickets/:id | Update ticket | `:id, updates` |
| `updateTicketStatus(req, res)` | PUT /api/tickets/:id/status | Update status only | `:id, { status }` |
| `deleteTicket(req, res, next)` | DELETE /api/tickets/:id | Delete ticket | `:id` |
| `getTicketStats(req, res, next)` | GET /api/tickets/stats | Get ticket statistics | - |
| `addComment(req, res)` | POST /api/tickets/:id/comments | Add comment | `:id, { message }` |
| `getComments(req, res)` | GET /api/tickets/:id/comments | Get comments | `:id` |

---

### Contact Controllers

**Directory:** `controllers/contact/`

| File | Function | Purpose |
|------|----------|---------|
| `createContact.controller.js` | `createContact` | Create contact |
| `listContacts.controller.js` | `listContacts` | List contacts |
| `getContact.controller.js` | `getContact` | Get single contact |
| `updateContact.controller.js` | `updateContact` | Update contact |
| `deleteContact.controller.js` | `deleteContact` | Delete contact |
| `contactBulkUpload.controller.js` | `bulkUploadContacts` | Bulk upload from Excel |
| `exportContacts.controller.js` | `exportContacts` | Export contacts |

---

### Feedback Controllers

**Directory:** `controllers/feedback/`

| File | Function | Purpose |
|------|----------|---------|
| `analyzeFeedback.controller.js` | `analyzeFeedback` | AI feedback analysis |
| `generateActions.controller.js` | `generateActions` | Generate action items |
| `followUp.controller.js` | `followUp` | Create follow-up |

---

### Other Controllers

| File | Functions |
|------|-----------|
| `dashboardController.js` | `getExecutiveDashboard, getOperationalDashboard` |
| `roleController.js` | Role CRUD operations |
| `permissionController.js` | Permission management |
| `permissionAssignmentController.js` | Assign permissions to roles |
| `tenantController.js` | Tenant management |
| `planController.js` | Subscription plans |
| `subscriptionController.js` | Subscription management |
| `notificationController.js` | In-app notifications |
| `emailTemplateController.js` | Email template CRUD |
| `surveyTemplatesController.js` | Survey template CRUD |
| `contactCategoryController.js` | Contact category CRUD |
| `contactManagementController.js` | Contact management |
| `distributionController.js` | Survey distribution |
| `logicEngineController.js` | Survey logic rules |
| `smsController.js` | SMS sending |
| `whatsappController.js` | WhatsApp integration |
| `insightController.js` | Insights |

---

## Services

### Analytics Services

**Directory:** `services/analytics/`

#### dashboardService.js

| Function | Purpose | Returns |
|----------|---------|---------|
| `calculateCustomerSatisfactionIndex(tenantId, startDate)` | Calculate CSI with breakdown | `{ current, previous, change, breakdown }` |
| `calculateNPSScore(tenantId, startDate)` | Calculate NPS with categories | `{ score, promoters, passives, detractors }` |
| `calculateResponseRate(tenantId, startDate)` | Calculate survey response rate | `{ rate, totalInvites, totalResponses }` |
| `calculateAlertCounts(tenantId)` | Count alerts by priority | `{ high, medium, low, total }` |
| `calculateSLAMetrics(tenantId, startDate)` | SLA compliance metrics | `{ compliance, avgResolutionTime }` |
| `getTopComplaints(tenantId, startDate)` | Top complaint themes | `[{ theme, count }]` |
| `getTopPraises(tenantId, startDate)` | Top praise themes | `[{ theme, count }]` |
| `getSatisfactionTrend(tenantId, startDate, days)` | Satisfaction over time | `[{ date, score }]` |
| `getVolumeTrend(tenantId, startDate, days)` | Volume over time | `[{ date, count }]` |
| `generateSmartAlerts(actions, responses, tenantId)` | AI-generated alerts | `[{ type, message, severity }]` |
| `getSurveyStatsService(surveyId)` | Survey stats | Stats object |
| `getTenantStatsService(tenantId)` | Tenant stats | Stats object |

#### Other Analytics Services

| File | Purpose |
|------|---------|
| `analyticsService.js` | General analytics functions |
| `npsService.js` | NPS calculations |
| `sentimentService.js` | Sentiment analysis |
| `trendService.js` | Trend calculations |
| `exportService.js` | Export to CSV/PDF |

---

### Survey Services

**Directory:** `services/survey/`

| File | Function | Purpose |
|------|----------|---------|
| `SchedulingService.js` | Schedule survey publishing | Handle scheduled surveys |
| `publishService.js` | `publishSurveyService` | Complete publish workflow |
| `listSurveysService.js` | `listSurveysService` | List surveys with filters |
| `getSurveyService.js` | `getSurveyService` | Get single survey |
| `toggleSurveyStatusService.js` | `toggleSurveyStatusService` | Toggle survey status |
| `validateSurveyForPublishService.js` | `validateSurveyForPublishService` | Pre-publish validation |
| `audienceService.js` | `resolveAudience` | Resolve target audience |
| `responseService.js` | Response handling | |
| `inviteService.js` | Survey invite management | |
| `anonymousQrService.js` | Anonymous QR generation | |
| `inviteQrService.js` | Invite QR generation | |
| `resolveRecipientsService.js` | Resolve survey recipients | |

---

### Response Services

**Directory:** `services/responses/`

#### submitResponseService.js

| Function | Purpose | Parameters |
|----------|---------|------------|
| `getRequestMetadata(userAgent, ip)` | Extract device/browser/location | userAgent, IP |
| `extractMetricsFromAnswers(answers, survey)` | Extract NPS/rating from answers | answers, survey |
| `parseAnswerValue(answer)` | Parse answer to number | answer |
| `submitSurveyResponseService(data)` | Complete response submission | `{ token, payload, ip, user, userAgent }` |

#### Other Response Services

| File | Purpose |
|------|---------|
| `anonymousResponseService.js` | Handle anonymous responses |
| `invitedResponseService.js` | Handle invited responses |
| `tokenService.js` | Token generation/verification |

---

### Distribution Services

**Directory:** `services/distribution/`

| File | Purpose |
|------|---------|
| `createSurveyInvitesService.js` | Create survey invites |
| `resolveAudienceService.js` | Resolve audience to contacts |
| `emailService.js` | Email distribution |
| `smsService.js` | SMS distribution |
| `whatsappService.js` | WhatsApp distribution |

---

## Models

### Survey Model

**File:** `models/Survey.js`

| Field | Type | Purpose |
|-------|------|---------|
| `title` | String | Survey title |
| `description` | String | Survey description |
| `category` | String | Survey category |
| `logo` | Object | Logo with public_id/url |
| `themeColor` | String | Brand color |
| `translations` | Object | en/ar translations |
| `language` | String | Primary language |
| `questions` | Array | Question schema array |
| `tenant` | ObjectId | Reference to Tenant |
| `settings` | Object | isPublic, isAnonymous, isPasswordProtected |
| `status` | String | draft/active/inactive/scheduled/published/closed |
| `createdBy` | ObjectId | Reference to User |
| `totalResponses` | Number | Response count |
| `averageScore` | Number | Average response score |
| `averageRating` | Number | Average rating |
| `targetAudience` | Object | audienceType, categories, users, contacts |
| `schedule` | Object | startDate, endDate, timezone, autoPublish |
| `publishLog` | Array | Publication history |
| `sections` | Array | Survey sections |
| `logicRules` | Array | Logic rule references |
| `thankYouPage` | Object | Thank you configuration |
| `version` | Number | Survey version |
| `publishedSnapshot` | Object | Locked questions |

**Question Schema:**

| Field | Type | Purpose |
|-------|------|---------|
| `id` | String | Question identifier |
| `questionText` | String | Question text |
| `type` | String | text/textarea/numeric/radio/checkbox/select/rating/nps/etc |
| `options` | Array | MCQ options |
| `required` | Boolean | Required flag |
| `translations` | Object | en/ar translations |
| `logicRules` | Array | Branching logic |

---

### SurveyResponse Model

**File:** `models/SurveyResponse.js`

| Field | Type | Purpose |
|-------|------|---------|
| `survey` | ObjectId | Reference to Survey |
| `user` | ObjectId | Reference to User |
| `contact` | ObjectId | Reference to Contact |
| `answers` | Array | Answer schema array |
| `review` | String | Free-text review |
| `score` | Number | NPS score (0-10) |
| `rating` | Number | Rating (1-5) |
| `submittedAt` | Date | Submission time |
| `tenant` | ObjectId | Reference to Tenant |
| `isAnonymous` | Boolean | Anonymous flag |
| `ip` | String | IP address |
| `status` | String | partial/submitted |
| `resumeToken` | String | Resume partial survey |
| `analysis` | Object | AI analysis metadata |
| `metadata` | Object | device/browser/os/location |
| `startedAt` | Date | Start time |
| `completionTime` | Number | Time to complete |

**Analysis Schema:**

| Field | Type | Purpose |
|-------|------|---------|
| `sentiment` | String | positive/neutral/negative |
| `sentimentScore` | Number | -1 to 1 score |
| `urgency` | String | low/medium/high |
| `emotions` | Array | Detected emotions |
| `keywords` | Array | Extracted keywords |
| `themes` | Array | Identified themes |
| `classification` | Object | isComplaint/isPraise/isSuggestion |
| `summary` | String | AI-generated summary |
| `npsCategory` | String | promoter/passive/detractor |
| `ratingCategory` | String | excellent/good/average/poor/very_poor |
| `flaggedForReview` | Boolean | Dashboard visibility |
| `triggeredRules` | Array | Analysis triggers |
| `analyzedAt` | Date | Analysis timestamp |

---

### Other Models

| Model | File | Purpose |
|-------|------|---------|
| User | `User.js` | User accounts |
| Tenant | `Tenant.js` | Multi-tenant organizations |
| Action | `Action.js` | Action items |
| Ticket | `Ticket.js` | Support tickets |
| Notification | `Notification.js` | In-app notifications |
| ContactManagement | `ContactManagement.js` | Contacts |
| ContactCategory | `ContactCategory.js` | Contact categories |
| EmailTemplate | `EmailTemplate.js` | Email templates |
| SurveyInvite | `SurveyInvite.js` | Survey invitations |
| OTP | `OTP.js` | One-time passwords |
| Permission | `Permission.js` | Permissions |
| PermissionAssignment | `PermissionAssignment.js` | Role-permission mapping |
| CustomRole | `CustomRole.js` | Custom roles |
| Plan | `Plan.js` | Subscription plans |
| LogicRule | `LogicRule.js` | Survey logic rules |
| AudienceSegment | `AudienceSegment.js` | Audience segments |
| SmartSegment | `SmartSegment.js` | Smart segments |
| AssignmentRule | `AssignmentRule.js` | Action assignment rules |
| FeedbackAnalysis | `FeedbackAnalysis.js` | Feedback analysis |
| Department | `Department.js` | Departments |
| DashboardMetrics | `DashboardMetrics.js` | Cached metrics |
| SurveyStats | `SurveyStats.js` | Survey statistics |
| WhatsAppSetting | `WhatsAppSetting.js` | WhatsApp config |
| FeatureFlag | `FeatureFlag.js` | Feature toggles |
| Logs | `Logs.js` | Audit logs |
| surveyTemplates | `surveyTemplates.js` | Survey templates |

---

## Utilities

### Email Utilities

| File | Function | Purpose |
|------|----------|---------|
| `sendEmail.js` | `sendEmail(options)` | Send emails via transporter |
| `emailTransporter.js` | `transporter` | Nodemailer config |
| `renderEmailTemplate.js` | `renderEmailTemplate(template, data)` | Render email templates |
| `emailTemplate.js` | Template helpers | Template utilities |

### AI Utilities

**Directory:** `utils/ai/`

| File | Purpose |
|------|---------|
| `aiClient.js` | AI API client (OpenAI/Gemini) |

### Other Utilities

| File | Purpose |
|------|---------|
| `logger.js` | Winston logging |
| `auditLog.js` | Audit logging |
| `generateToken.js` | JWT token generation |
| `generateSurveyToken.js` | Survey-specific tokens |
| `qrUtils.js` | QR code generation |
| `cloudinary.js` | Cloudinary image upload |
| `logicEngine.js` | Survey logic evaluation |
| `getBaseURL.js` | Get base URL helper |
| `sendNotification.js` | In-app notifications |
| `sendSMS.js` | SMS sending |
| `sendWhatsApp.js` | WhatsApp sending |
| `resolveSurveyRecipients.js` | Resolve recipients |
| `analyticsUtils.js` | Analytics helpers |
| `insightUtils.js` | Insight helpers |
| `responseUtils.js` | Response helpers |

---

## Data Flow Examples

### 1. User Registration Flow

```
Client POST /api/auth/register
    ↓
authRoutes.js → authLimiter middleware
    ↓
authController.registerUser()
    ↓
1. Validate input (Joi schema)
2. Check email uniqueness
3. Create Tenant document
4. Hash password (bcrypt)
5. Create User document
6. Generate OTP
7. Save OTP to database
8. Send verification email (sendEmail util)
    ↓
Response: { success, message, user }
```

### 2. Survey Creation Flow

```
Client POST /api/surveys/save-draft
    ↓
surveyRoutes.js → protect → setTenantId → tenantCheck → allowRoles → allowPermission
    ↓
createSurvey.controller.js
    ↓
1. Validate input (Joi schema)
2. Process questions
3. Upload logo to Cloudinary (if provided)
4. Create Survey document with tenant
    ↓
Response: { success, survey }
```

### 3. Survey Response Submission Flow

```
Client POST /api/surveys/responses/anonymous/:surveyId
    ↓
surveyRoutes.js → surveyResponseLimiter → anonymousSurveyLimiter
    ↓
submitAnonymousResponse.controller.js
    ↓
anonymousResponseService.js
    ↓
1. Validate survey exists and is active
2. Extract metadata (device, browser, location via geoip)
3. Extract metrics (NPS, rating from answers)
4. Create SurveyResponse document
5. Update Survey.totalResponses
6. Add job to postResponseQueue (BullMQ)
    ↓
postResponse.worker.js (async)
    ↓
1. Fetch response
2. Analyze sentiment (AI service)
3. Extract keywords/themes
4. Classify (complaint/praise/suggestion)
5. Generate actions if negative
6. Update response.analysis
7. Send notifications (if urgent)
8. Sync contact survey history
    ↓
Response: { success, responseId }
```

### 4. Analytics Dashboard Flow

```
Client GET /api/analytics/executive?range=30d
    ↓
analyticsRoutes.js → protect → setTenantId
    ↓
executiveDashboard.controller.js
    ↓
dashboardService.js
    ↓
1. Parse range, calculate startDate
2. calculateCustomerSatisfactionIndex()
   - Aggregate SurveyResponse ratings
   - Group by location/service
   - Calculate period comparison
3. calculateNPSScore()
   - Count promoters/passives/detractors
   - Calculate NPS score
4. calculateResponseRate()
   - Count invites vs responses
5. getSatisfactionTrend() via trendService
6. getVolumeTrend() via trendService
    ↓
Response: { success, data: { csi, nps, responseRate, trends } }
```

### 5. Action Generation Flow

```
Client POST /api/actions/generate/feedback
    ↓
actionRoutes.js → protect → setTenantId → allowRoles
    ↓
generateActionsFromFeedback.controller.js
    ↓
1. Fetch survey responses
2. Filter negative/low-rated responses
3. Call AI service for analysis
4. Generate action items with:
   - Description
   - Priority (based on urgency)
   - Category
   - Source reference
5. Apply assignment rules (applyAssignmentRules)
   - Match conditions
   - Single owner / Round robin / Least load
6. Create Action documents
7. Push assignment history
8. Send notifications
    ↓
Response: { success, actions: [] }
```

---

## Inter-File Dependencies

### Controller → Service → Model Pattern

```
Controller File
    ↓ calls
Service File
    ↓ queries
Model (MongoDB)
```

**Example:**
```
controllers/survey/publishSurvey.controller.js
    ↓
services/survey/publishService.js
    ↓
models/Survey.js + models/SurveyInvite.js

services/distribution/emailService.js
    ↓
utils/sendEmail.js
    ↓
config/nodemailer
```

### Event-Based Processing

```
Response Submission
    ↓ emits event
utils/events/eventEmitter.js
    ↓ listens
workers/responseProcessor.worker.js
    ↓ processes
services/ai/sentimentService.js
    ↓ updates
models/SurveyResponse.js
```

### Queue-Based Processing

```
Response Submission
    ↓ adds job
queues/postResponse.queue.js (BullMQ)
    ↓ processes
workers/postResponse.worker.js
    ↓ calls
services/analytics/sentimentService.js
services/actions/generateActions.js
```

---

## Validators

| File | Schemas | Purpose |
|------|---------|---------|
| `surveyValidator.js` | createSchema, updateSchema | Survey validation |
| `surveyResponseValidator.js` | responseSchema | Response validation |
| `actionValidator.js` | createSchema, updateSchema | Action validation |
| `feedbackValidator.js` | feedbackSchema | Feedback validation |
| `analyticsValidator.js` | querySchema | Analytics query validation |
| `audienceValidator.js` | audienceSchema | Audience validation |
| `publishValidator.js` | publishSchema | Publish validation |
| `scheduleValidator.js` | scheduleSchema | Schedule validation |
| `aiAnalysis.validator.js` | analysisSchema | AI analysis validation |

---

## Configuration Files

| File | Purpose |
|------|---------|
| `config/db.js` | MongoDB connection |
| `config/redis.js` | Redis connection |
| `config/passportConfig.js` | OAuth configuration |

---

## Background Jobs & Crons

### Jobs

| File | Purpose |
|------|---------|
| `jobs/retagInactiveContacts.job.js` | Tag inactive contacts |
| `jobs/audience/recomputeAudienceIntelligence.job.js` | Recompute audience stats |

### Crons

| File | Schedule | Purpose |
|------|----------|---------|
| `crons/systemSegments.cron.js` | Daily 2 AM | Sync system segments |
| `crons/autoCloseSurveys.cron.js` | Daily 2 AM | Auto-close expired surveys |

### Workers

| File | Purpose |
|------|---------|
| `workers/responseProcessor.worker.js` | Event-based response processing |
| `workers/postResponse.worker.js` | BullMQ queue processing |

---

## Summary

The RatePro backend is a comprehensive survey management system with:

- **Multi-tenant architecture** - Full tenant isolation
- **Modular controller pattern** - Each function in separate file
- **Service layer** - Reusable business logic
- **AI integration** - Sentiment analysis, action generation
- **Real-time processing** - Event and queue-based
- **Advanced analytics** - NPS, CSI, trends, demographics
- **Multiple distribution channels** - Email, SMS, WhatsApp
- **Role-based access control** - Permissions and roles

Total Components:
- **27 API routes**
- **25+ main controllers** + **50+ modular controllers**
- **15 service directories** with **50+ service files**
- **28 MongoDB models**
- **8 middlewares**
- **9 validators**
- **20+ utility files**

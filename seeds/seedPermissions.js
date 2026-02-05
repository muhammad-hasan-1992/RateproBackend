const mongoose = require("mongoose");
const Permission = require("../models/Permission");

const permissions = [
    // User
    { name: "user:create", description: "Create new users", group: "user" },
    { name: "user:read", description: "View user details", group: "user" },
    { name: "user:update", description: "Update user details", group: "user" },
    { name: "user:delete", description: "Delete users", group: "user" },
    { name: "user:toggle", description: "Toggle user active status", group: "user" },
    { name: "user:export", description: "Export user data as PDF", group: "user" },
    { name: "user:notify", description: "Send notifications to users", group: "user" },
    { name: "user:mass-upload", description: "Bulk upload users via file", group: "user" },
    { name: "user:file-template", description: "Download user upload template", group: "user" },
    // Role
    { name: "role:create", description: "Create custom roles", group: "role" },
    { name: "role:read", description: "View custom roles", group: "role" },
    { name: "role:update", description: "Update custom roles", group: "role" },
    { name: "role:delete", description: "Delete custom roles", group: "role" },
    { name: "role:assign", description: "Assign roles to users", group: "role" },
    { name: "role:remove", description: "Remove roles to users", group: "role" },
    { name: 'permission:assign', description: 'Assign permissions to users' },
    { name: 'permission:read', description: 'Read permission assignments' },
    // Survey
    { name: "survey:read", description: "View all surveys", group: "survey" },
    { name: "survey:create", description: "Create new surveys", group: "survey" },
    { name: "survey:templates", description: "Access survey templates", group: "survey" },
    { name: "survey:schedule", description: "Manage survey scheduling", group: "survey" },
    { name: "survey:responses:view", description: "View survey responses", group: "survey" },
    { name: "survey:analytics:view", description: "View survey analytics", group: "survey" },
    { name: "survey:customize", description: "Customize survey appearance", group: "survey" },
    { name: "survey:share", description: "Share surveys with others", group: "survey" },
    { name: "survey:settings:update", description: "Update survey settings", group: "survey" },
    { name: "survey:detail:view", description: "View survey details", group: "survey" },
    { name: "survey:questions:create", description: "Create questions for a survey" },
    { name: "survey:questions:delete", description: "Delete questions from a survey" },
    // Survey Actions (Department-scoped)
    { name: "survey:delete", description: "Delete surveys within department", group: "survey" },
    { name: "survey:activate", description: "Activate surveys within department", group: "survey" },
    { name: "survey:deactivate", description: "Deactivate surveys within department", group: "survey" },

    { name: "feedback:analyze", description: "Analyze survey feedback", group: "feedback" },
    { name: "action:generate", description: "Generate action lists", group: "action" },
    { name: "feedback:follow-up", description: "Send follow-up notifications", group: "feedback" },
    { name: "dashboard:view", description: "View executive and operational dashboards", group: "dashboard" },
    // Analytics Permissions
    { name: "analytics:view", description: "Access analytics overview dashboard", group: "analytics" },
    { name: "analytics:realtime", description: "View real-time survey results", group: "analytics" },
    { name: "analytics:trends", description: "Analyze survey response trends", group: "analytics" },
    { name: "analytics:custom", description: "Generate and view custom reports", group: "analytics" },
    { name: "analytics:responses", description: "View survey response overview", group: "analytics" },
    // Audience Management
    { name: "audience:view", description: "View all audiences list", group: "audience" },
    { name: "audience:segment", description: "Manage audience segmentation", group: "audience" },
    { name: "audience:contacts", description: "Manage audience contacts", group: "audience" },
    // Content Management
    { name: "content:features", description: "Manage platform features", group: "content" },
    { name: "content:pricing", description: "Manage pricing content", group: "content" },
    { name: "content:testimonials", description: "Manage testimonials", group: "content" },
    { name: "content:widgets", description: "Manage widgets and add-ons", group: "content" },
    // Support
    { name: "support:tickets", description: "Access and manage support tickets", group: "support" },
    // Settings
    { name: "settings:general", description: "Manage general system settings", group: "settings" },
    { name: "settings:email-templates", description: "Manage email templates", group: "settings" },
    { name: "settings:notifications", description: "Manage notification settings", group: "settings" },
    { name: "settings:smtp", description: "Configure SMTP server", group: "settings" },
    { name: "settings:thank-you-page", description: "Customize thank you page", group: "settings" },
    { name: "settings:theme", description: "Customize theme settings", group: "settings" },
    // Template Management (Admin Only)
    { name: "template:create", description: "Create survey templates", group: "template" },
    { name: "template:update", description: "Update survey templates", group: "template" },
    { name: "template:delete", description: "Delete survey templates", group: "template" },
    // Template Usage (Assignable to Members by CompanyAdmin)
    { name: "template:read", description: "View survey templates list", group: "template" },
    { name: "template:detail:view", description: "View template details", group: "template" },
    { name: "template:use", description: "Use templates to create surveys", group: "template" },
    { name: "template:preview", description: "Preview survey templates", group: "template" },
    // Action Management (Assignable to Members by CompanyAdmin)
    { name: "surveyAction:view", description: "View survey actions", group: "action" },
    { name: "surveyAction:assign", description: "Assign actions to team members", group: "action" },
    { name: "surveyAction:notify", description: "Send notifications for actions", group: "action" },
];

const seedPermissions = async () => {
    try {
        for (const perm of permissions) {
            const existingPermission = await Permission.findOne({ name: perm.name });
            if (!existingPermission) {
                await Permission.create({
                    name: perm.name,
                    description: perm.description || `Permission to ${perm.name.split(":")[1]} ${perm.name.split(":")[0]}s`,
                    group: perm.group || null,
                });
            } else {
                // Update existing permission to add group if missing
                await Permission.updateOne(
                    { name: perm.name },
                    { $set: { group: perm.group || null } }
                );
            }
        }
        // console.log("Permissions seeded successfully");
    } catch (err) {
        console.error("Error seeding permissions:", err);
        throw err;
    }
};

module.exports = seedPermissions;
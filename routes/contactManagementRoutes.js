/**
 * @deprecated This file is deprecated. Use contact.routes.js instead.
 * 
 * This file is kept for backward compatibility only.
 * All new development should use the consolidated routes in contact.routes.js
 * 
 * Migration completed: January 2026
 * Safe to delete after confirming no external dependencies.
 */

console.warn(
  "⚠️  WARNING: contactManagementRoutes.js is deprecated. Use contact.routes.js instead."
);

// Re-export the new consolidated routes for backward compatibility
module.exports = require("./contact.routes");
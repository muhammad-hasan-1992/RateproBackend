// crons/escalation.cron.js
const { checkAllTenantsForEscalation } = require("../services/action/escalationService");
const Logger = require("../utils/logger");

/**
 * Escalation Cron Job
 * 
 * Checks all tenants for actions that need to be escalated based on
 * configured escalation rules (SLA breach, no progress, etc.)
 * 
 * Recommended schedule: Every 15 minutes
//  * Cron expression: '*/15 
exports.runEscalationCheck = async () => {
    const startTime = Date.now();

    try {
        Logger.info("escalationCron", "Starting escalation check...", {
            context: { startTime: new Date().toISOString() }
        });

        const escalatedCount = await checkAllTenantsForEscalation();

        const duration = Date.now() - startTime;
        Logger.info("escalationCron", "Escalation check completed", {
            context: {
                escalatedCount,
                durationMs: duration
            }
        });

        return { success: true, escalatedCount, durationMs: duration };

    } catch (error) {
        Logger.error("escalationCron", "Escalation cron failed", {
            error,
            context: { durationMs: Date.now() - startTime }
        });

        return { success: false, error: error.message };
    }
};

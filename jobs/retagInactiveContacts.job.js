// jobs/retagInactiveContacts.job.js

const Contact = require("../models/ContactManagement");
const { deriveAutoTags } = require("../services/audience/taggingService");

const DAYS_30 = 30 * 24 * 60 * 60 * 1000;

async function retagInactiveContacts() {
  const cutoff = new Date(Date.now() - DAYS_30);

  const cursor = Contact.find({
    lastActivity: { $lte: cutoff },
  }).cursor();

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for await (const contact of cursor) {
    try {
      const autoTags = deriveAutoTags(contact);

      const merged = new Set([
        ...(contact.tags || []),
        ...autoTags,
      ]);

      contact.tags = Array.from(merged);
      contact.autoTags = autoTags;

      // ✅ FIX: Use updateOne to bypass full document validation
      // This only updates specific fields without triggering contactCategories validation
      await Contact.updateOne(
        { _id: contact._id },
        {
          $set: {
            tags: contact.tags,
            autoTags: contact.autoTags
          }
        }
      );
      
      processed++;
    } catch (err) {
      console.error(`⚠️ Failed to retag contact ${contact._id}:`, err.message);
      errors++;
    }
  }

  console.log(`🔁 Retagged inactive contacts: ${processed}, errors: ${errors}`);
  return { processed, skipped, errors };
}

module.exports = retagInactiveContacts;

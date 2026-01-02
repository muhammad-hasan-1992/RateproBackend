// seedUserCategories.js
const ContactCategory = require("../models/ContactCategory"); // 🔥 Renamed
const User = require("../models/User");
const defaultUserCategories = require("./defaultUserCategories");

const seedUserCategories = async () => {
  try {
    console.log("🚀 Starting user category seeding...");

    // ✅ Admin user find karo
    const adminUser = await User.findOne({ email: "admin@ratepro.com" });
    if (!adminUser) {
      throw new Error("Admin user not found. Please create one first.");
    }

    console.log(`👤 Using admin user: ${adminUser.name}`);

    // ✅ Purani categories delete kar do (optional)
    await ContactCategory.deleteMany({});
    console.log("🗑️ Existing user categories cleared.");

    // ✅ Tenant ID (agar multi-tenant system hai)
    const tenantId = adminUser.tenant || null;

    // ✅ Default categories map karo with tenant + createdBy
    const categoriesWithMeta = defaultUserCategories.map((cat) => ({
      ...cat,
      tenant: tenantId,
      createdBy: adminUser._id,
      isDefault: true,
      active: true,
    }));

    // ✅ Insert karo
    const inserted = await ContactCategory.insertMany(categoriesWithMeta);
    console.log(`✅ ${inserted.length} user categories seeded successfully.`);

    return inserted;
  } catch (err) {
    console.error("❌ Error seeding user categories:", err.message);
    throw err;
  }
};

module.exports = seedUserCategories;

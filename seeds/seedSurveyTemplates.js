const mongoose = require("mongoose");
const User = require("../models/User");
const SurveyTemplate = require("../models/surveyTemplates");

const surveyTemplates = [
  {
    name: "Employee Engagement Survey",
    description: "Professional employee engagement survey template for corporate sector",
    category: "corporate",
    categoryName: "Corporate / HR",
    questions: [
      {
        questionText: "How satisfied are you with your current role?",
        type: "rating",
        options: ["1", "2", "3", "4", "5"],
        required: true,
        order: 1,
      },
      {
        questionText: "What do you appreciate most about our company culture?",
        type: "text",
        required: false,
        order: 2,
      },
      {
        questionText: "How likely are you to recommend this company as a great place to work?",
        type: "multiple_choice",
        options: ["Very Likely", "Likely", "Neutral", "Unlikely", "Very Unlikely"],
        required: true,
        order: 3,
      },
    ],
    estimatedTime: "5 min",
    language: ["English", "Arabic"],
    tags: ["corporate", "employee", "engagement"],
    isPremium: false,
    usageCount: 45,
    rating: 4.5,
    isActive: true,
  },
  {
    name: "Student Satisfaction Survey",
    description: "Comprehensive student feedback survey for educational institutions",
    category: "education",
    categoryName: "Education",
    questions: [
      {
        questionText: "How would you rate the overall quality of education?",
        type: "rating",
        options: ["1", "2", "3", "4", "5"],
        required: true,
        order: 1,
      },
      {
        questionText: "What aspects of the course did you find most valuable?",
        type: "text",
        required: false,
        order: 2,
      },
      {
        questionText: "How satisfied are you with the faculty support?",
        type: "multiple_choice",
        options: ["Very Satisfied", "Satisfied", "Neutral", "Dissatisfied", "Very Dissatisfied"],
        required: true,
        order: 3,
      },
    ],
    estimatedTime: "7 min",
    language: ["English", "Arabic"],
    tags: ["education", "student", "feedback"],
    isPremium: false,
    usageCount: 32,
    rating: 4.2,
    isActive: true,
  },
  {
    name: "Customer Satisfaction Survey",
    description: "General customer satisfaction survey for various businesses",
    category: "retail",
    categoryName: "Retail & E-Commerce",
    questions: [
      {
        questionText: "How would you rate your overall experience with our service?",
        type: "rating",
        options: ["1", "2", "3", "4", "5"],
        required: true,
        order: 1,
      },
      {
        questionText: "What can we do to improve our service?",
        type: "text",
        required: false,
        order: 2,
      },
      {
        questionText: "How likely are you to use our services again?",
        type: "multiple_choice",
        options: ["Definitely", "Probably", "Not Sure", "Probably Not", "Definitely Not"],
        required: true,
        order: 3,
      },
    ],
    estimatedTime: "4 min",
    language: ["English"],
    tags: ["customer", "satisfaction", "feedback"],
    isPremium: true,
    usageCount: 78,
    rating: 4.7,
    isActive: true,
  },
  {
    name: "Patient Feedback Survey",
    description: "Healthcare patient satisfaction and feedback survey",
    category: "healthcare",
    categoryName: "Healthcare",
    questions: [
      {
        questionText: "How would you rate the quality of medical care received?",
        type: "rating",
        options: ["1", "2", "3", "4", "5"],
        required: true,
        order: 1,
      },
      {
        questionText: "Were the medical staff helpful and professional?",
        type: "multiple_choice",
        options: ["Excellent", "Good", "Average", "Poor", "Very Poor"],
        required: true,
        order: 2,
      },
      {
        questionText: "Do you have any suggestions for improving our healthcare services?",
        type: "text",
        required: false,
        order: 3,
      },
    ],
    estimatedTime: "6 min",
    language: ["English", "Arabic"],
    tags: ["healthcare", "patient", "medical"],
    isPremium: false,
    usageCount: 23,
    rating: 4.3,
    isActive: true,
  },
];

const seedSurveyTemplates = async () => {
  try {

    // ✅ Find admin user
    const adminUser = await User.findOne({ email: "admin@ratepro.com" });
    if (!adminUser) {
      throw new Error("Admin user not found. Please create one first.");
    }

    // ✅ Clear existing templates
    await SurveyTemplate.deleteMany({});

    // ✅ Assign createdBy = adminUser._id
    const templatesWithCreator = surveyTemplates.map((tpl) => ({
      ...tpl,
      createdBy: adminUser._id,
    }));

    // ✅ Insert templates
    const inserted = await SurveyTemplate.insertMany(templatesWithCreator);
    return inserted;
  } catch (err) {
    console.error("❌ Error seeding survey templates:", err.message);
    throw err;
  }
};

module.exports = seedSurveyTemplates;

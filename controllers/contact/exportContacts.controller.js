// controllers/contact/exportContacts.controller.js
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const Contact = require("../../models/ContactManagement");

/**
 * GET /api/contacts/export/excel
 */
exports.exportContactsExcel = async (req, res) => {
  try {
    const contacts = await Contact.find({ tenantId: req.tenantId })
      .populate("contactCategories", "name type")
      .sort({ createdAt: -1 });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Contacts");

    // Header row with styling
    sheet.columns = [
      { header: "Name", key: "name", width: 25 },
      { header: "Email", key: "email", width: 30 },
      { header: "Phone", key: "phone", width: 18 },
      { header: "Company", key: "company", width: 25 },
      { header: "Categories", key: "categories", width: 25 },
      { header: "Tags", key: "tags", width: 25 },
      { header: "Status", key: "status", width: 12 },
      { header: "NPS Score", key: "npsScore", width: 12 },
      { header: "NPS Category", key: "npsCategory", width: 14 },
      { header: "Responses", key: "responses", width: 12 },
      { header: "Last Activity", key: "lastActivity", width: 15 },
      { header: "Created At", key: "createdAt", width: 15 },
    ];

    // Style header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    // Add data rows
    contacts.forEach((c) => {
      sheet.addRow({
        name: c.name,
        email: c.email,
        phone: c.phone || "",
        company: c.company || "",
        categories: c.contactCategories?.map((cat) => cat.name).join(", ") || "",
        tags: Array.isArray(c.tags) ? c.tags.join(", ") : "",
        status: c.status,
        npsScore: c.surveyStats?.latestNpsScore ?? "",
        npsCategory: c.surveyStats?.npsCategory || "",
        responses: c.surveyStats?.respondedCount || 0,
        lastActivity: c.lastActivity?.toISOString().split("T")[0] || "",
        createdAt: c.createdAt?.toISOString().split("T")[0] || "",
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=contacts_${Date.now()}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Export Excel failed:", err);
    res.status(500).json({
      success: false,
      message: "Export failed",
      error: err.message,
    });
  }
};

/**
 * GET /api/contacts/export/pdf
 */
exports.exportContactsPDF = async (req, res) => {
  try {
    const contacts = await Contact.find({ tenantId: req.tenantId })
      .populate("contactCategories", "name")
      .sort({ createdAt: -1 });

    const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=contacts_${Date.now()}.pdf`
    );

    doc.pipe(res);

    // Title
    doc.fontSize(20).text("Contacts List", { align: "center" });
    doc.fontSize(10).text(`Exported on: ${new Date().toLocaleDateString()}`, {
      align: "center",
    });
    doc.moveDown(2);

    // Table header
    const tableTop = 100;
    const colWidths = [120, 150, 100, 100, 80, 80, 80];
    const headers = ["Name", "Email", "Phone", "Company", "Status", "NPS", "Responses"];

    let xPos = 30;
    doc.fontSize(10).font("Helvetica-Bold");
    headers.forEach((header, i) => {
      doc.text(header, xPos, tableTop, { width: colWidths[i] });
      xPos += colWidths[i];
    });

    // Horizontal line
    doc.moveTo(30, tableTop + 15).lineTo(770, tableTop + 15).stroke();

    // Table rows
    let yPos = tableTop + 25;
    doc.font("Helvetica").fontSize(9);

    contacts.forEach((c, index) => {
      // Check for page break
      if (yPos > 520) {
        doc.addPage();
        yPos = 50;
      }

      xPos = 30;
      const row = [
        c.name?.substring(0, 20) || "",
        c.email?.substring(0, 25) || "",
        c.phone || "",
        c.company?.substring(0, 15) || "",
        c.status || "",
        c.surveyStats?.latestNpsScore?.toString() || "-",
        c.surveyStats?.respondedCount?.toString() || "0",
      ];

      row.forEach((cell, i) => {
        doc.text(cell, xPos, yPos, { width: colWidths[i] });
        xPos += colWidths[i];
      });

      yPos += 18;
    });

    // Footer
    doc.fontSize(8).text(
      `Total: ${contacts.length} contacts`,
      30,
      doc.page.height - 50
    );

    doc.end();
  } catch (err) {
    console.error("Export PDF failed:", err);
    res.status(500).json({
      success: false,
      message: "Export failed",
      error: err.message,
    });
  }
};

/**
 * GET /api/contacts/export/csv
 */
exports.exportContactsCSV = async (req, res) => {
  try {
    const contacts = await Contact.find({ tenantId: req.tenantId })
      .populate("contactCategories", "name")
      .sort({ createdAt: -1 });

    // CSV headers
    const headers = [
      "Name",
      "Email",
      "Phone",
      "Company",
      "Categories",
      "Tags",
      "Status",
      "NPS Score",
      "NPS Category",
      "Responses",
      "Last Activity",
      "Created At",
    ];

    // Build CSV content
    let csv = headers.join(",") + "\n";

    contacts.forEach((c) => {
      const row = [
        `"${(c.name || "").replace(/"/g, '""')}"`,
        `"${(c.email || "").replace(/"/g, '""')}"`,
        `"${(c.phone || "").replace(/"/g, '""')}"`,
        `"${(c.company || "").replace(/"/g, '""')}"`,
        `"${c.contactCategories?.map((cat) => cat.name).join("; ") || ""}"`,
        `"${Array.isArray(c.tags) ? c.tags.join("; ") : ""}"`,
        c.status || "",
        c.surveyStats?.latestNpsScore ?? "",
        c.surveyStats?.npsCategory || "",
        c.surveyStats?.respondedCount || 0,
        c.lastActivity?.toISOString().split("T")[0] || "",
        c.createdAt?.toISOString().split("T")[0] || "",
      ];
      csv += row.join(",") + "\n";
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=contacts_${Date.now()}.csv`
    );
    res.send(csv);
  } catch (err) {
    console.error("Export CSV failed:", err);
    res.status(500).json({
      success: false,
      message: "Export failed",
      error: err.message,
    });
  }
};
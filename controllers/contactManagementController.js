// controllers/contactManagementController.js
const Contact = require("../models/ContactManagement");
// const AudienceSegment = require("../../removed files backup/AudienceSegmentation");
const ExcelJS = require('exceljs');
const PDFDocument = require("pdfkit");
const path = require('path');
const fs = require("fs");
const XLSX = require('xlsx');
const Logger = require("../utils/auditLog");
const { default: mongoose } = require("mongoose");


// GET /api/contacts
exports.getContacts = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = "", segment, status } = req.query;

        // ALWAYS restrict to tenant
        let filter = { tenantId: req.tenantId };

        // Search filter
        if (search) {
            const regex = new RegExp(search, "i");
            filter.$or = [
                { name: regex },
                { email: regex },
                { company: regex }
            ];
        }

        // Segment filter
        if (segment) {
            const seg = await AudienceSegment.findOne({
                name: segment,
                tenantId: req.tenantId   // segment must also belong to same tenant
            });

            if (seg) filter.segment = seg._id;
        }

        // Status filter
        if (status) {
            filter.status = new RegExp(status, "i");
        }

        // Query contacts with tenant filter
        const total = await Contact.countDocuments(filter);

        const contacts = await Contact.find(filter)
            .populate("segment", "name")
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(Number(limit));

        res.json({
            contacts,
            total,
            page: Number(page),
            limit: Number(limit),
        });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/contacts/:id
exports.getContactById = async (req, res) => {
    try {
        const contact = await Contact.findOne({
            _id: req.params.id,
            tenantId: req.tenantId
        }).populate("segment", "name");

        if (!contact) {
            return res.status(404).json({
                message: "Contact not found or you don't have permission"
            });
        }

        res.json(contact);

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Bulk create contacts from Excel
exports.bulkCreateContacts = async (req, res) => {
    try {
        console.log("🔵 BULK IMPORT STARTED");

        const currentUser = req.user;
        console.log("👤 Current User:", currentUser?.email, "Role:", currentUser?.role);

        // Role check
        if (currentUser.role !== 'companyAdmin') {
            console.log("❌ Permission denied - not companyAdmin");
            return res.status(403).json({ message: 'Access denied: Only CompanyAdmin can perform bulk upload' });
        }

        // File check
        if (!req.file) {
            console.log("❌ No file received in request");
            return res.status(400).json({ message: 'No Excel file uploaded' });
        }

        console.log("📄 File received:", req.file.originalname, "Size:", req.file.size);

        // Read Excel
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        console.log("📄 Excel sheet name:", sheetName);

        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });

        console.log("📊 Total rows including header:", rows.length);

        if (rows.length < 2) {
            console.log("❌ No data rows found in Excel");
            return res.status(400).json({ message: 'Empty or invalid Excel file. Must have at least one data row.' });
        }

        const dataRows = rows.slice(1);
        const tenantId = currentUser.tenant._id ? currentUser.tenant._id.toString() : currentUser.tenant;

        console.log("🏢 Tenant ID:", tenantId);
        console.log("📊 Data rows to process:", dataRows.length);

        const successes = [];
        const errors = [];

        for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];
            console.log(`\n🟡 Processing row ${i + 1}:`, row);

            const [name, email, phone, company, segmentName, tags, statusStr, contactCategoriesStr] = row.map(
                val => val?.toString().trim() || ''
            );

            if (!name || !email) {
                console.log("⚠️ Missing required fields:", { name, email });
                errors.push({ row: row.join(','), message: 'Name and Email are required' });
                continue;
            }

            // Contact Categories processing
            // Contact Category: only ONE category allowed
            let contactCategory = null;

            if (contactCategoriesStr) {
                const categoryName = contactCategoriesStr.trim().toLowerCase();

                const matchedCategory = await Contact.findOne({
                    tenantId,
                    name: { $regex: new RegExp(`^${categoryName}$`, 'i') } // case-insensitive
                });

                if (matchedCategory) {
                    contactCategory = matchedCategory._id;
                } else {
                    console.log(`⚠️ No matching contact category found for: ${contactCategoriesStr}`);
                }
            }

            // Segment check / create
            let segmentDoc = null;
            if (segmentName) {
                segmentDoc = await AudienceSegment.findOne({ tenantId, name: segmentName });
                if (!segmentDoc) {
                    console.log(`⚠️ Segment "${segmentName}" not found for email ${email}. Contact created without segment.`);
                    // errors.push({ email, message: `Segment "${segmentName}" does not exist` }); // optional
                } else {
                    segmentDoc.size += 1;
                    await segmentDoc.save();
                }
            }

            // Check duplicate email
            const existingContact = await Contact.findOne({ email, tenantId });
            if (existingContact) {
                console.log("⚠️ Email already exists:", email);
                errors.push({ email, message: 'Contact already exists with this email' });
                continue;
            }

            // Create contact
            console.log("🟢 Creating new contact:", email);

            const newContact = await Contact.create({
                tenantId,
                name,
                email,
                phone,
                company,
                segment: segmentDoc ? segmentDoc._id : null,
                tags,
                status: statusStr || 'Active',
                contactCategoryId: contactCategory,
                lastActivity: new Date(),
            });

            successes.push({ id: newContact._id, email: newContact.email });
        }

        console.log("\n✅ BULK IMPORT FINISHED");
        console.log("➡️ Total:", dataRows.length);
        console.log("➡️ Success:", successes.length);
        console.log("➡️ Errors:", errors.length);

        // Logging
        await Logger.info({
            user: currentUser._id,
            action: "Bulk Create Contacts",
            status: "Success",
            details: `Processed: ${dataRows.length}, Success: ${successes.length}, Failed: ${errors.length}`
        });

        res.status(201).json({
            message: 'Bulk contact creation completed',
            totalProcessed: dataRows.length,
            successful: successes.length,
            failed: errors.length,
            createdContacts: successes,
            errors: errors.length > 0 ? errors : null,
        });

    } catch (err) {
        console.error("❌ BulkCreateContacts error:", err);

        await Logger.error({
            user: req.user?._id,
            action: "Bulk Create Contacts",
            status: "Failed",
            details: err.message,
        });

        res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
};

// POST /api/contacts
exports.createContact = async (req, res) => {
    try {
        console.log("🔹 Request body:", req.body);
        const { name, email, phone, company, segment, tags, status, contactCategories } = req.body;

        let segmentId = null;
        if (segment) {
            segmentId = typeof segment === "string" ? segment : segment._id;
        }

        if (segmentId) {
            segmentDoc = await AudienceSegment.findOne({
                _id: segmentId,
                tenantId: req.tenantId
            });
            if (!segmentDoc) {
                return res.status(403).json({
                    message: "Invalid segment or you don't have permission"
                });
            }
            segmentDoc.size += 1;
            await segmentDoc.save();

        } else {
            console.log("ℹ️ No segment provided, proceeding without segment");
        }

        const contactCategoriesIds = contactCategories?.map(id => new mongoose.Types.ObjectId(id));

        // Create contact with tenantId
        console.log("🔹 Creating new contact...");
        const newContact = await Contact.create({
            tenantId: req.tenantId,      // IMPORTANT
            name,
            email,
            phone,
            company,
            contactCategories: contactCategoriesIds || [],
            segment: segmentDoc ? segmentDoc._id : null,
            tags,
            status: status || "Active",
            lastActivity: new Date(),
        });

        console.log("✅ Contact created:", newContact._id);

        const contactWithSegment = await Contact.findOne({
            _id: newContact._id,
            tenantId: req.tenantId
        }).populate("segment", "name");

        console.log("🔹 Returning contact with populated segment");
        res.status(201).json(contactWithSegment);

    } catch (err) {
        console.error("❌ Error creating contact:", err);
        res.status(500).json({ message: err.message });
    }
};

// PUT /api/contacts/:id
exports.updateContact = async (req, res) => {
    try {
        const { name, email, phone, company, contactCategories, segment, tags, status } = req.body;

        console.log("🔥 Incoming segment raw:", segment); // ← ye add karo

        let contact = await Contact.findOne({
            _id: req.params.id,
            tenantId: req.tenantId
        }).populate('segment');

        if (!contact) {
            return res.status(404).json({ message: "Contact not found" });
        }

        const oldSegmentId = contact.segment?._id?.toString() || null;

        // ← YEH SABSE STRONG FIX HAI (string, object, mongoose doc – sab handle karega)
        let newSegmentId = null;
        if (segment) {
            if (typeof segment === 'string' && segment.trim() !== '') {
                newSegmentId = segment.trim();
            }
            else if (segment && segment._id) {
                newSegmentId = segment._id.toString();
            }
            else if (segment && segment.id) {
                newSegmentId = segment.id.toString();
            }
        }

        console.log("Old Segment ID:", oldSegmentId);
        console.log("New Segment ID:", newSegmentId);

        // Agar segment change hua hai
        if (oldSegmentId !== newSegmentId) {

            // Purana segment size ghataye
            if (oldSegmentId) {
                await AudienceSegment.updateOne(
                    { _id: oldSegmentId, tenantId: req.tenantId },
                    { $inc: { size: -1 } }
                );
            }

            // Naya segment size badhaye + valid hai ya nahi check
            if (newSegmentId) {
                const segmentDoc = await AudienceSegment.findOne({
                    _id: newSegmentId,
                    tenantId: req.tenantId
                });

                if (!segmentDoc) {
                    return res.status(400).json({
                        message: "Segment not found ya aapka tenant ka nahi hai!"
                    });
                }

                await AudienceSegment.updateOne(
                    { _id: newSegmentId },
                    { $inc: { size: 1 } }
                );

                contact.segment = newSegmentId; // ← yeh line important hai
            } else {
                contact.segment = null;
            }
        }
        console.log("Segment updated to:", contact.segment);

        // Baaki fields
        if (name !== undefined) contact.name = name;
        if (email !== undefined) contact.email = email;
        if (phone !== undefined) contact.phone = phone;
        if (company !== undefined) contact.company = company;
        if (contactCategories !== undefined) {
            contact.contactCategories = contactCategories.map(id => new mongoose.Types.ObjectId(id));
        }
        if (tags !== undefined) contact.tags = tags;
        if (status !== undefined) contact.status = status;

        contact.lastActivity = new Date();
        await contact.save();

        // Final populated response
        const finalContact = await Contact.findById(contact._id)
            .populate('segment', 'name size');

        res.json(finalContact);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
    }
};

// DELETE /api/contacts/:id
exports.deleteContact = async (req, res) => {
    try {
        const contact = await Contact.findOne({
            _id: req.params.id,
            tenantId: req.tenantId // 🔥 Tenant boundary
        });

        if (!contact) return res.status(404).json({ message: "Contact not found" });

        // Reduce segment count only in same tenant
        if (contact.segment) {
            await AudienceSegment.findOneAndUpdate(
                { _id: contact.segment, tenantId: req.tenantId },
                { $inc: { size: -1 } }
            );
        }

        await Contact.deleteOne({ _id: req.params.id, tenantId: req.tenantId });

        res.json({ message: "Contact deleted successfully" });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Export contacts to Excel
exports.exportContactsExcel = async (req, res) => {
    try {
        const contacts = await Contact.find({ tenantId: req.tenantId })
            .populate("segment", "name");

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Contacts");

        sheet.addRow(["Name", "Email", "Phone", "Company", "Segment", "Tags", "Status", "Last Activity"]);

        contacts.forEach((c) => {
            sheet.addRow([
                c.name,
                c.email,
                c.phone,
                c.company,
                c.segment ? c.segment.name : "",
                c.tags.join(", "),
                c.status,
                c.lastActivity?.toISOString().split("T")[0] || "",
            ]);
        });

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader("Content-Disposition", "attachment; filename=contacts.xlsx");

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Export contacts to PDF
exports.exportContactsPDF = async (req, res) => {
    try {
        const contacts = await Contact.find({ tenantId: req.tenantId })
            .populate("segment", "name");

        const doc = new PDFDocument({ margin: 30, size: "A4" });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "attachment; filename=contacts.pdf");

        doc.pipe(res);

        doc.fontSize(18).text("Contacts List", { align: "center" });
        doc.moveDown();

        contacts.forEach((c, index) => {
            doc.fontSize(12).text(
                `${index + 1}. ${c.name} | ${c.email} | ${c.phone} | ${c.company} | ${c.segment ? c.segment.name : ""} | ${c.tags.join(", ")} | ${c.status} | ${c.lastActivity?.toISOString().split("T")[0] || ""}`
            );
            doc.moveDown(0.5);
        });

        doc.end();
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
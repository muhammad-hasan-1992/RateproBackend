// // controllers/emailTemplateControllers.js
// const EmailTemplate = require("../models/emailTemplate");

// // CREATE template
// exports.createTemplate = async (req, res) => {
//     try {
//         const { name, type, subject, body, variables, description, isActive = true } = req.body;

//         // Check if template name or type already exists
//         const existingTemplate = await EmailTemplate.findOne({
//             $or: [{ name }, { type }]
//         });

//         if (existingTemplate) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Template name or type already exists"
//             });
//         }

//         const template = new EmailTemplate({
//             name,
//             type,
//             subject,
//             body,
//             variables: variables || [],
//             description,
//             isActive
//         });

//         await template.save();
//         res.status(201).json({
//             success: true,
//             message: "Template created successfully",
//             data: template
//         });
//     } catch (error) {
//         res.status(400).json({
//             success: false,
//             message: error.message
//         });
//     }
// };

// // READ ALL templates with counts
// exports.getTemplates = async (req, res) => {
//     try {
//         const { isActive } = req.query;
//         let filter = {};

//         if (isActive !== undefined) {
//             filter.isActive = isActive === 'true';
//         }

//         const templates = await EmailTemplate.find(filter).sort({ createdAt: -1 });

//         // Get counts
//         const totalCount = await EmailTemplate.countDocuments();
//         const activeCount = await EmailTemplate.countDocuments({ isActive: true });
//         const inactiveCount = await EmailTemplate.countDocuments({ isActive: false });

//         res.json({
//             success: true,
//             data: templates,
//             counts: {
//                 total: totalCount,
//                 active: activeCount,
//                 inactive: inactiveCount
//             }
//         });
//     } catch (error) {
//         res.status(500).json({
//             success: false,
//             message: error.message
//         });
//     }
// };

// // READ ONE template
// exports.getTemplateById = async (req, res) => {
//     try {
//         const template = await EmailTemplate.findById(req.params.id);
//         if (!template) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Template not found"
//             });
//         }

//         res.json({
//             success: true,
//             data: template
//         });
//     } catch (error) {
//         res.status(500).json({
//             success: false,
//             message: error.message
//         });
//     }
// };

// // UPDATE template
// exports.updateTemplate = async (req, res) => {
//     try {
//         const { name, subject, body, variables, description, isActive } = req.body;

//         const template = await EmailTemplate.findById(req.params.id);
//         if (!template) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Template not found"
//             });
//         }

//         // Check if name or type already exists (excluding current template)
//         if (name || type) {
//             const existingTemplate = await EmailTemplate.findOne({
//                 $and: [
//                     { _id: { $ne: req.params.id } },
//                     { $or: [{ name }, { type }] }
//                 ]
//             });

//             if (existingTemplate) {
//                 return res.status(400).json({
//                     success: false,
//                     message: "Template name or type already exists"
//                 });
//             }
//         }

//         const updateData = {
//             name: name || template.name,
//             type: template.type, // Type cannot be changed after creation
//             subject: subject || template.subject,
//             body: body || template.body,
//             variables: variables || template.variables,
//             description: description || template.description,
//             isActive: isActive !== undefined ? isActive : template.isActive
//         };

//         const updatedTemplate = await EmailTemplate.findByIdAndUpdate(
//             req.params.id,
//             updateData,
//             { new: true, runValidators: true }
//         );

//         res.json({
//             success: true,
//             message: "Template updated successfully",
//             data: updatedTemplate
//         });
//     } catch (error) {
//         res.status(400).json({
//             success: false,
//             message: error.message
//         });
//     }
// };

// // DELETE template
// exports.deleteTemplate = async (req, res) => {
//     try {
//         const template = await EmailTemplate.findById(req.params.id);
//         if (!template) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Template not found"
//             });
//         }

//         await EmailTemplate.findByIdAndDelete(req.params.id);

//         res.json({
//             success: true,
//             message: "Template deleted successfully"
//         });
//     } catch (error) {
//         res.status(500).json({
//             success: false,
//             message: error.message
//         });
//     }
// };

// // TOGGLE template status
// exports.toggleTemplateStatus = async (req, res) => {
//     try {
//         const template = await EmailTemplate.findById(req.params.id);
//         if (!template) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Template not found"
//             });
//         }

//         template.isActive = !template.isActive;
//         await template.save();

//         res.json({
//             success: true,
//             message: `Template ${template.isActive ? 'activated' : 'deactivated'} successfully`,
//             data: template
//         });
//     } catch (error) {
//         res.status(500).json({
//             success: false,
//             message: error.message
//         });
//     }
// };
// controllers/emailTemplateController.js
const EmailTemplate = require("../models/EmailTemplate");
const Logger = require("../utils/logger");

const extractVariables = (body) => {
    if (!body) return [];
    // Regex to detect ${variableName}
    const regex = /\$\{(\w+)\}/g;
    const vars = new Set();
    let match;
    while ((match = regex.exec(body)) !== null) {
        vars.add(match[1]);
    }
    return Array.from(vars);
};


// CREATE template
// exports.createTemplate = async (req, res) => {
//     try {
//         const { name, subject, body, variables, description, type } = req.body;

//         const existingTemplate = await EmailTemplate.findOne({ name });
//         if (existingTemplate) {
//             return res.status(400).json({ message: "Template name already exists" });
//         }

//         const template = new EmailTemplate({
//             name,
//             subject,
//             body,
//             variables: variables || [],
//             description,
//             type: type || "default",
//             isActive: true
//         });

//         await template.save();

//         await Logger.info('createTemplate', 'Email template created', { templateId: template._id, name });

//         res.status(201).json({
//             success: true,
//             message: "Template created successfully",
//             data: template
//         });
//     } catch (error) {
//         console.error('createTemplate error:', error);
//         await Logger.error('createTemplate', 'Failed to create email template', { message: error.message, stack: error.stack });
//         res.status(500).json({
//             success: false,
//             message: error.message
//         });
//     }
// };
exports.createTemplate = async (req, res) => {
    try {
        const { name, subject, body, description, type } = req.body;

        // Check duplicate template name
        const existingTemplate = await EmailTemplate.findOne({ name });
        if (existingTemplate) {
            return res.status(400).json({ message: "Template name already exists" });
        }

        // Auto-detect variables from body
        const variables = extractVariables(body);

        const template = new EmailTemplate({
            name,
            subject,
            body,
            variables,
            description: description || '',
            type: type || 'default',
            isActive: true
        });

        await template.save();
        // Logger.info("createTemplate", "Email template created", {
        //     context: {
        //         templateId: template._id,
        //         name
        //     },
        //     req
        // });

        res.status(201).json({
            success: true,
            message: "Template created successfully",
            data: template
        });

    } catch (error) {
        console.error('createTemplate error:', error);
        Logger.error("createTemplate", "Failed to create email template", {
            error,
            context: {},
            req
        });
        res.status(500).json({ success: false, message: error.message });
    }
};

// READ ALL templates with counts
exports.getTemplates = async (req, res) => {
    try {
        const { isActive } = req.query;
        let filter = {};

        if (isActive !== undefined) {
            filter.isActive = isActive === 'true';
        }

        const templates = await EmailTemplate.find(filter).sort({ createdAt: -1 });

        const totalCount = await EmailTemplate.countDocuments();
        const activeCount = await EmailTemplate.countDocuments({ isActive: true });
        const inactiveCount = await EmailTemplate.countDocuments({ isActive: false });

        // Logger.info("getTemplates", "Fetched all email templates", {
        //     context: {
        //         total: templates.length
        //     },
        //     req
        // });

        res.status(200).json({
            success: true,
            data: templates,
            counts: {
                total: totalCount,
                active: activeCount,
                inactive: inactiveCount
            }
        });
    } catch (error) {
        console.error('getTemplates error:', error);
        Logger.error("getTemplates", "Failed to fetch email templates", {
            error,
            context: {},
            req
        });

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// READ ONE template
exports.getTemplateById = async (req, res) => {
    try {
        const template = await EmailTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({
                success: false,
                message: "Template not found"
            });
        }

        // Logger.info("getTemplateById", "Fetched email template by ID", {
        //     context: {
        //         templateId: template._id
        //     },
        //     req
        // });
    } catch (error) {
        console.error('getTemplateById error:', error);
        Logger.error("getTemplateById", "Failed to fetch email template", {
            error,
            context: {},
            req
        });
    }
};

// UPDATE template
// exports.updateTemplate = async (req, res) => {
//     try {
//         const { name, subject, body, variables, description, isActive } = req.body;

//         const template = await EmailTemplate.findById(req.params.id);
//         if (!template) {
//             return res.status(404).json({ success: false, message: "Template not found" });
//         }

//         // Check if name already exists (excluding current template)
//         if (name && name !== template.name) {
//             const existingTemplate = await EmailTemplate.findOne({ name });
//             if (existingTemplate) {
//                 return res.status(400).json({ message: "Template name already exists" });
//             }
//         }

//         const updateData = {
//             name: name || template.name,
//             subject: subject || template.subject,
//             body: body || template.body,
//             variables: variables || template.variables,
//             description: description || template.description,
//             isActive: isActive !== undefined ? isActive : template.isActive
//         };

//         const updatedTemplate = await EmailTemplate.findByIdAndUpdate(
//             req.params.id,
//             updateData,
//             { new: true, runValidators: true }
//         );

//         await Logger.info('updateTemplate', 'Email template updated', { templateId: updatedTemplate._id });

//         res.status(200).json({
//             success: true,
//             message: "Template updated successfully",
//             data: updatedTemplate
//         });
//     } catch (error) {
//         console.error('updateTemplate error:', error);
//         await Logger.error('updateTemplate', 'Failed to update email template', { message: error.message, stack: error.stack });
//         res.status(500).json({ success: false, message: error.message });
//     }
// };
exports.updateTemplate = async (req, res) => {
    try {
        const { name, subject, body, description, isActive, type } = req.body;

        const template = await EmailTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ success: false, message: "Template not found" });
        }

        // Check if name already exists (excluding current template)
        if (name && name !== template.name) {
            const existingTemplate = await EmailTemplate.findOne({ name });
            if (existingTemplate) {
                return res.status(400).json({ message: "Template name already exists" });
            }
        }

        // Auto-detect variables from body
        const updatedBody = body || template.body;
        const variables = extractVariables(updatedBody);

        const updateData = {
            name: name || template.name,
            subject: subject || template.subject,
            body: updatedBody,
            variables,
            description: description || template.description,
            isActive: isActive !== undefined ? isActive : template.isActive,
            type: type || template.type
        };

        const updatedTemplate = await EmailTemplate.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        );

        // Logger.info("updateTemplate", "Email template updated", {
        //     context: {
        //         templateId: updatedTemplate._id
        //     },
        //     req
        // });

        res.status(200).json({
            success: true,
            message: "Template updated successfully",
            data: updatedTemplate
        });

    } catch (error) {
        console.error('updateTemplate error:', error);
        Logger.error("updateTemplate", "Failed to update email template", {
            error,
            context: {},
            req
        });
        res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE template
exports.deleteTemplate = async (req, res) => {
    try {
        const template = await EmailTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ success: false, message: "Template not found" });
        }

        await EmailTemplate.findByIdAndDelete(req.params.id);

        // Logger.info("deleteTemplate", "Email template deleted", {
        //     context: {
        //         templateId: req.params.id
        //     },
        //     req
        // });
    } catch (error) {
        console.error('deleteTemplate error:', error);
        Logger.error("deleteTemplate", "Failed to delete email template", {
            error,
            context: {},
            req
        });
        res.status(500).json({ success: false, message: error.message });
    }
};

// TOGGLE template status
exports.toggleTemplateStatus = async (req, res) => {
    try {
        const template = await EmailTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ success: false, message: "Template not found" });
        }

        template.isActive = !template.isActive;
        await template.save();

        // Logger.info("toggleTemplateStatus", `Template ${template.isActive ? 'activated' : 'deactivated'}`, {
        //     context: {
        //         templateId: template._id
        //     },
        //     req
        // });

        res.status(200).json({
            success: true,
            message: `Template ${template.isActive ? 'activated' : 'deactivated'} successfully`,
            data: template
        });
    } catch (error) {
        console.error('toggleTemplateStatus error:', error);
        Logger.error("toggleTemplateStatus", "Failed to toggle email template status", {
            error,
            context: {},
            req
        });
        res.status(500).json({ success: false, message: error.message });
    }
};
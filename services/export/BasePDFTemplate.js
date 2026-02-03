/**
 * Base PDF Template
 * 
 * Provides structured, branded PDF generation with consistent headers, footers,
 * and reusable section components. All report templates should extend this base.
 * 
 * Features:
 * - Consistent header with logo, title, date
 * - Footer with page numbers and branding
 * - Reusable table, section, and summary components
 * - Tenant-specific branding or RatePro defaults
 */

const PDFDocument = require('pdfkit');
const { getTenantBranding, hexToRgb, isLightColor } = require('./brandService');
const path = require('path');
const fs = require('fs');

class BasePDFTemplate {
    constructor(options = {}) {
        this.doc = new PDFDocument({
            size: 'A4',
            margins: {
                top: 100,     // Space for header
                bottom: 80,   // Space for footer
                left: 50,
                right: 50,
            },
            bufferPages: true, // Enable page buffering for page numbers
            ...options.docOptions,
        });

        this.options = {
            title: 'Report',
            subtitle: '',
            showDate: true,
            showPageNumbers: true,
            ...options,
        };

        this.branding = null;
        this.pageCount = 0;
        this.currentY = 100;
    }

    /**
     * Initialize branding for tenant
     */
    async initBranding(tenantId) {
        this.branding = await getTenantBranding(tenantId);
        return this;
    }

    /**
     * Get the PDFKit document
     */
    getDocument() {
        return this.doc;
    }

    /**
     * Render the document header (logo, title, date)
     */
    renderHeader() {
        const doc = this.doc;
        const branding = this.branding;
        const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

        // Save current position
        const savedY = doc.y;
        doc.y = 25;

        // Background stripe (optional)
        doc.rect(0, 0, doc.page.width, 80)
            .fill(branding.headerBgColor);

        // Logo (left side)
        try {
            if (branding.logoPath && fs.existsSync(branding.logoPath)) {
                doc.image(branding.logoPath, 50, 20, { height: 45 });
            } else if (branding.logoUrl) {
                // For URL-based logos, we skip for now (would need async fetch)
                // Instead show company name
                doc.font('Helvetica-Bold')
                    .fontSize(18)
                    .fillColor(branding.primaryColor)
                    .text(branding.companyName, 50, 30, { width: 150 });
            } else {
                // Default: Show company name text
                doc.font('Helvetica-Bold')
                    .fontSize(18)
                    .fillColor(branding.primaryColor)
                    .text(branding.companyName, 50, 30, { width: 150 });
            }
        } catch (err) {
            // Fallback: company name
            doc.font('Helvetica-Bold')
                .fontSize(18)
                .fillColor(branding.primaryColor)
                .text(branding.companyName, 50, 30, { width: 150 });
        }

        // Title (center-right)
        doc.font('Helvetica-Bold')
            .fontSize(16)
            .fillColor(branding.textColor)
            .text(this.options.title, 200, 25, { width: width - 150, align: 'right' });

        // Subtitle (if provided)
        if (this.options.subtitle) {
            doc.font('Helvetica')
                .fontSize(11)
                .fillColor(branding.accentColor)
                .text(this.options.subtitle, 200, 45, { width: width - 150, align: 'right' });
        }

        // Date (if enabled)
        if (this.options.showDate) {
            const dateStr = new Date().toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric'
            });
            doc.font('Helvetica')
                .fontSize(9)
                .fillColor(branding.accentColor)
                .text(dateStr, 200, 60, { width: width - 150, align: 'right' });
        }

        // Header divider line
        doc.moveTo(50, 80)
            .lineTo(doc.page.width - 50, 80)
            .strokeColor(branding.primaryColor)
            .lineWidth(2)
            .stroke();

        // Reset Y position for content
        doc.y = 100;
        this.currentY = 100;

        return this;
    }

    /**
     * Render the document footer (page number, branding)
     */
    renderFooter() {
        const doc = this.doc;
        const branding = this.branding;
        const footerY = doc.page.height - 60;

        // Footer divider line
        doc.moveTo(50, footerY)
            .lineTo(doc.page.width - 50, footerY)
            .strokeColor(branding.accentColor)
            .lineWidth(0.5)
            .stroke();

        // Footer text (left)
        doc.font('Helvetica')
            .fontSize(8)
            .fillColor(branding.accentColor)
            .text(branding.footerText, 50, footerY + 10, { width: 300 });

        // Page number (right) - will be filled in finalize()
        return this;
    }

    /**
     * Add a section title
     */
    addSectionTitle(title, options = {}) {
        const doc = this.doc;
        const branding = this.branding;

        this.checkPageBreak(40);

        doc.font('Helvetica-Bold')
            .fontSize(options.fontSize || 14)
            .fillColor(options.color || branding.primaryColor)
            .text(title, { continued: false });

        // Underline
        if (options.underline !== false) {
            const lineY = doc.y + 2;
            doc.moveTo(doc.page.margins.left, lineY)
                .lineTo(doc.page.margins.left + 100, lineY)
                .strokeColor(branding.primaryColor)
                .lineWidth(1)
                .stroke();
        }

        doc.moveDown(0.5);
        this.currentY = doc.y;

        return this;
    }

    /**
     * Add a paragraph of text
     */
    addParagraph(text, options = {}) {
        const doc = this.doc;
        const branding = this.branding;

        this.checkPageBreak(20);

        doc.font(options.font || 'Helvetica')
            .fontSize(options.fontSize || 10)
            .fillColor(options.color || branding.textColor)
            .text(text, { align: options.align || 'left' });

        doc.moveDown(options.spacing || 0.5);
        this.currentY = doc.y;

        return this;
    }

    /**
     * Add a key-value row (label: value)
     */
    addDataRow(label, value, options = {}) {
        const doc = this.doc;
        const branding = this.branding;

        this.checkPageBreak(20);

        const startX = doc.page.margins.left;
        const labelWidth = options.labelWidth || 150;

        doc.font('Helvetica-Bold')
            .fontSize(10)
            .fillColor(branding.textColor)
            .text(label + ':', startX, doc.y, { width: labelWidth, continued: true });

        doc.font('Helvetica')
            .fillColor(options.valueColor || branding.textColor)
            .text(' ' + value, { width: 350 });

        this.currentY = doc.y;

        return this;
    }

    /**
     * Add a summary box (highlighted stats)
     */
    addSummaryBox(items, options = {}) {
        const doc = this.doc;
        const branding = this.branding;

        this.checkPageBreak(100);

        const boxWidth = options.width || (doc.page.width - doc.page.margins.left - doc.page.margins.right);
        const boxHeight = options.height || 70;
        const startX = doc.page.margins.left;
        const startY = doc.y;

        // Box background
        doc.roundedRect(startX, startY, boxWidth, boxHeight, 5)
            .fill('#f8f9fa');

        // Calculate column width
        const colWidth = boxWidth / items.length;

        items.forEach((item, index) => {
            const colX = startX + (index * colWidth);
            const centerX = colX + colWidth / 2;

            // Value (large)
            doc.font('Helvetica-Bold')
                .fontSize(24)
                .fillColor(item.color || branding.primaryColor)
                .text(String(item.value), colX + 10, startY + 15, {
                    width: colWidth - 20,
                    align: 'center'
                });

            // Label (small)
            doc.font('Helvetica')
                .fontSize(9)
                .fillColor(branding.accentColor)
                .text(item.label, colX + 10, startY + 45, {
                    width: colWidth - 20,
                    align: 'center'
                });
        });

        doc.y = startY + boxHeight + 15;
        this.currentY = doc.y;

        return this;
    }

    /**
     * Add a simple table
     */
    addTable(headers, rows, options = {}) {
        const doc = this.doc;
        const branding = this.branding;

        const tableWidth = options.width || (doc.page.width - doc.page.margins.left - doc.page.margins.right);
        const startX = doc.page.margins.left;
        const colWidth = tableWidth / headers.length;
        const rowHeight = options.rowHeight || 25;

        this.checkPageBreak(rowHeight * 2);

        let y = doc.y;

        // Header row
        doc.rect(startX, y, tableWidth, rowHeight).fill(branding.primaryColor);

        headers.forEach((header, i) => {
            doc.font('Helvetica-Bold')
                .fontSize(9)
                .fillColor('#ffffff')
                .text(header, startX + (i * colWidth) + 5, y + 8, {
                    width: colWidth - 10,
                    align: 'left'
                });
        });

        y += rowHeight;

        // Data rows
        rows.forEach((row, rowIndex) => {
            this.checkPageBreak(rowHeight);

            // Alternating background
            if (rowIndex % 2 === 0) {
                doc.rect(startX, y, tableWidth, rowHeight).fill('#f8f9fa');
            }

            row.forEach((cell, i) => {
                doc.font('Helvetica')
                    .fontSize(9)
                    .fillColor(branding.textColor)
                    .text(String(cell), startX + (i * colWidth) + 5, y + 8, {
                        width: colWidth - 10,
                        align: 'left'
                    });
            });

            y += rowHeight;
        });

        doc.y = y + 10;
        this.currentY = doc.y;

        return this;
    }

    /**
     * Add spacing
     */
    addSpace(lines = 1) {
        this.doc.moveDown(lines);
        this.currentY = this.doc.y;
        return this;
    }

    /**
     * Check if we need a page break and add one if necessary
     */
    checkPageBreak(requiredSpace) {
        const doc = this.doc;
        const maxY = doc.page.height - doc.page.margins.bottom - 30;

        if (doc.y + requiredSpace > maxY) {
            this.addPage();
        }
    }

    /**
     * Add a new page
     */
    addPage() {
        this.doc.addPage();
        this.pageCount++;
        this.renderHeader();
        this.currentY = this.doc.y;
        return this;
    }

    /**
     * Finalize the document (add page numbers, etc.)
     */
    finalize() {
        const doc = this.doc;
        const branding = this.branding;

        // Add page numbers to all pages
        const range = doc.bufferedPageRange();
        const totalPages = range.count;

        for (let i = 0; i < totalPages; i++) {
            doc.switchToPage(i);

            // Render footer on each page
            const footerY = doc.page.height - 60;

            // Footer divider
            doc.moveTo(50, footerY)
                .lineTo(doc.page.width - 50, footerY)
                .strokeColor(branding.accentColor)
                .lineWidth(0.5)
                .stroke();

            // Footer text
            doc.font('Helvetica')
                .fontSize(8)
                .fillColor(branding.accentColor)
                .text(branding.footerText, 50, footerY + 10, { width: 300 });

            // Page number
            doc.text(
                `Page ${i + 1} of ${totalPages}`,
                doc.page.width - 150,
                footerY + 10,
                { width: 100, align: 'right' }
            );
        }

        return this;
    }

    /**
     * End the document and return the stream
     */
    end() {
        this.finalize();
        this.doc.end();
        return this.doc;
    }
}

module.exports = BasePDFTemplate;

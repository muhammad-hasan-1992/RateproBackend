/**
 * Analytics Report Template
 * 
 * Specialized PDF template for survey analytics reports.
 * Extends BasePDFTemplate with analytics-specific sections.
 */

const BasePDFTemplate = require('./BasePDFTemplate');

class AnalyticsReportTemplate extends BasePDFTemplate {
    constructor(options = {}) {
        super({
            ...options,
            title: options.title || 'Survey Analytics Report',
        });

        this.survey = options.survey || null;
        this.analytics = options.analytics || {};
    }

    /**
     * Build the complete analytics report
     */
    async build() {
        this.renderHeader();

        // Survey Overview Section
        if (this.survey) {
            this.addSurveyOverview();
        }

        // Key Metrics Summary
        if (this.analytics.summary) {
            this.addKeyMetrics();
        }

        // NPS Section
        if (this.analytics.nps) {
            this.addNPSSection();
        }

        // CSI Section
        if (this.analytics.csi) {
            this.addCSISection();
        }

        // Sentiment Analysis
        if (this.analytics.sentiment) {
            this.addSentimentSection();
        }

        // Response Trend
        if (this.analytics.trend) {
            this.addTrendSection();
        }

        return this;
    }

    /**
     * Survey Overview Section
     */
    addSurveyOverview() {
        const survey = this.survey;

        this.addSectionTitle('Survey Overview');

        this.addDataRow('Survey Title', survey.title || 'N/A');
        this.addDataRow('Status', survey.status || 'N/A');
        this.addDataRow('Created', survey.createdAt ? new Date(survey.createdAt).toLocaleDateString() : 'N/A');

        if (survey.closedAt) {
            this.addDataRow('Closed', new Date(survey.closedAt).toLocaleDateString());
        }

        this.addSpace(1);
        return this;
    }

    /**
     * Key Metrics Summary Box
     */
    addKeyMetrics() {
        const summary = this.analytics.summary || {};
        const branding = this.branding;

        this.addSectionTitle('Key Metrics');

        const items = [
            {
                label: 'Total Responses',
                value: summary.totalResponses || 0,
                color: branding.primaryColor
            },
            {
                label: 'Completion Rate',
                value: `${summary.completionRate || 0}%`,
                color: '#28a745'
            },
            {
                label: 'Avg. Response Time',
                value: summary.avgResponseTime || 'N/A',
                color: branding.secondaryColor
            },
        ];

        // Add NPS if available
        if (this.analytics.nps?.score !== undefined) {
            items.push({
                label: 'NPS Score',
                value: this.analytics.nps.score,
                color: this.getNPSColor(this.analytics.nps.score),
            });
        }

        this.addSummaryBox(items);
        return this;
    }

    /**
     * NPS Section
     */
    addNPSSection() {
        const nps = this.analytics.nps;

        this.addSectionTitle('Net Promoter Score (NPS)');

        const npsColor = this.getNPSColor(nps.score);

        this.addDataRow('NPS Score', nps.score, { valueColor: npsColor });
        this.addDataRow('Classification', this.getNPSClassification(nps.score));

        this.addSpace(0.5);

        // Distribution table
        if (nps.promoters !== undefined) {
            this.addTable(
                ['Category', 'Count', 'Percentage'],
                [
                    ['Promoters (9-10)', nps.promoters || 0, `${nps.promoterPercent || 0}%`],
                    ['Passives (7-8)', nps.passives || 0, `${nps.passivePercent || 0}%`],
                    ['Detractors (0-6)', nps.detractors || 0, `${nps.detractorPercent || 0}%`],
                ]
            );
        }

        return this;
    }

    /**
     * CSI Section
     */
    addCSISection() {
        const csi = this.analytics.csi;

        this.addSectionTitle('Customer Satisfaction Index (CSI)');

        this.addDataRow('CSI Score', `${csi.score || 0}%`);
        this.addDataRow('Rating', `${csi.averageRating || 0} / 5`);

        if (csi.totalRatings) {
            this.addDataRow('Total Ratings', csi.totalRatings);
        }

        this.addSpace(1);
        return this;
    }

    /**
     * Sentiment Analysis Section
     */
    addSentimentSection() {
        const sentiment = this.analytics.sentiment;

        this.addSectionTitle('Sentiment Analysis');

        this.addDataRow('Overall Sentiment', sentiment.overall || 'Neutral');
        this.addDataRow('Confidence', `${sentiment.confidence || 0}%`);

        this.addSpace(0.5);

        // Sentiment distribution
        if (sentiment.distribution) {
            this.addTable(
                ['Sentiment', 'Count', 'Percentage'],
                [
                    ['Positive', sentiment.distribution.positive || 0, `${sentiment.distribution.positivePercent || 0}%`],
                    ['Neutral', sentiment.distribution.neutral || 0, `${sentiment.distribution.neutralPercent || 0}%`],
                    ['Negative', sentiment.distribution.negative || 0, `${sentiment.distribution.negativePercent || 0}%`],
                ]
            );
        }

        return this;
    }

    /**
     * Response Trend Section
     */
    addTrendSection() {
        const trend = this.analytics.trend;

        this.addSectionTitle('Response Volume Trend');

        this.addDataRow('Total Responses', trend.totalResponses || 0);
        this.addDataRow('Period', trend.period || 'N/A');

        if (trend.peakDate) {
            this.addDataRow('Peak Response Date', trend.peakDate);
            this.addDataRow('Peak Count', trend.peakCount || 0);
        }

        this.addSpace(1);
        return this;
    }

    /**
     * Get NPS color based on score
     */
    getNPSColor(score) {
        if (score >= 50) return '#28a745'; // Green - Excellent
        if (score >= 0) return '#ffc107';  // Yellow - Good
        return '#dc3545';                   // Red - Needs Improvement
    }

    /**
     * Get NPS classification
     */
    getNPSClassification(score) {
        if (score >= 70) return 'Excellent';
        if (score >= 50) return 'Great';
        if (score >= 30) return 'Good';
        if (score >= 0) return 'Needs Improvement';
        return 'Critical';
    }
}

module.exports = AnalyticsReportTemplate;

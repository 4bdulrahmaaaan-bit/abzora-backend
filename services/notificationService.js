const User = require('../models/User');

class FCMProvider {
  async send(payload) {
    console.log('[FCMProvider] Send push notification:', payload);
    return { success: true, messageId: `fcm-${Date.now()}` };
  }
}

class SendGridProvider {
  async send(payload) {
    console.log('[SendGridProvider] Send email:', payload);
    return { success: true, messageId: `sg-${Date.now()}` };
  }
}

class TwilioProvider {
  async send(payload) {
    console.log('[TwilioProvider] Send SMS:', payload);
    return { success: true, messageId: `twilio-${Date.now()}` };
  }
}

class NotificationService {
  constructor() {
    this.fcm = new FCMProvider();
    this.sendgrid = new SendGridProvider();
    this.twilio = new TwilioProvider();
  }

  async sendMulticastNotification(tokens = [], title = '', body = '', data = {}) {
    const uniqueTokens = [...new Set((Array.isArray(tokens) ? tokens : []).map((token) => String(token || '').trim()).filter(Boolean))];
    if (uniqueTokens.length === 0) {
      return { success: true, sent: 0, delivered: 0, failed: 0 };
    }

    const res = await this.fcm.send({
      tokens: uniqueTokens,
      title,
      body,
      data,
    });

    return {
      success: Boolean(res?.success),
      sent: uniqueTokens.length,
      delivered: Boolean(res?.success) ? uniqueTokens.length : 0,
      failed: Boolean(res?.success) ? 0 : uniqueTokens.length,
      messageId: res?.messageId || '',
    };
  }

  async dispatch(campaign) {
    const recipientCount = await User.countDocuments({
      role: campaign.audienceRole,
      isActive: { $ne: false },
    });

    const results = {
      sent: 0,
      delivered: 0,
      failed: 0,
      openRate: 0,
    };

    if (campaign.channels.includes('Push')) {
      const res = await this.fcm.send({
        title: campaign.title,
        body: campaign.body,
        audience: campaign.audienceRole,
      });
      if (res.success) {
        results.sent += recipientCount;
        results.delivered += recipientCount;
      }
    }

    if (campaign.channels.includes('Email')) {
      const res = await this.sendgrid.send({
        subject: campaign.title,
        html: campaign.body,
        audience: campaign.audienceRole,
      });
      if (res.success) {
        results.sent += recipientCount;
        results.delivered += recipientCount;
      }
    }

    if (campaign.channels.includes('SMS')) {
      const res = await this.twilio.send({
        text: campaign.body,
        audience: campaign.audienceRole,
      });
      if (res.success) {
        results.sent += recipientCount;
        results.delivered += recipientCount;
      }
    }

    return results;
  }
}

module.exports = new NotificationService();

class FCMProvider {
  async send(payload) {
    console.log('[FCMProvider] Mock send push notification:', payload);
    return { success: true, messageId: `fcm-${Date.now()}` };
  }
}

class SendGridProvider {
  async send(payload) {
    console.log('[SendGridProvider] Mock send email:', payload);
    return { success: true, messageId: `sg-${Date.now()}` };
  }
}

class TwilioProvider {
  async send(payload) {
    console.log('[TwilioProvider] Mock send SMS:', payload);
    return { success: true, messageId: `twilio-${Date.now()}` };
  }
}

class NotificationService {
  constructor() {
    this.fcm = new FCMProvider();
    this.sendgrid = new SendGridProvider();
    this.twilio = new TwilioProvider();
  }

  async dispatch(campaign) {
    const results = {
      sent: 0,
      delivered: 0,
      failed: 0,
      openRate: 0,
    };

    // Mock dispatching logic based on channels
    if (campaign.channels.includes('Push')) {
      const res = await this.fcm.send({ title: campaign.title, body: campaign.body, audience: campaign.audienceRole });
      if (res.success) {
        results.sent += 100; // Mock 100 recipients
        results.delivered += 95;
      }
    }
    if (campaign.channels.includes('Email')) {
      const res = await this.sendgrid.send({ subject: campaign.title, html: campaign.body, audience: campaign.audienceRole });
      if (res.success) {
        results.sent += 100;
        results.delivered += 98;
        results.openRate = 45; // 45% mock open rate
      }
    }
    if (campaign.channels.includes('SMS')) {
      const res = await this.twilio.send({ text: campaign.body, audience: campaign.audienceRole });
      if (res.success) {
        results.sent += 100;
        results.delivered += 99;
      }
    }

    return results;
  }
}

module.exports = new NotificationService();

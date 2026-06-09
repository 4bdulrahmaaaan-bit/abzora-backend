const InvoiceEmailLog = require('../models/InvoiceEmailLog');
const logger = require('./structuredLogger');
const { isSuppressed } = require('./invoiceEmailLifecycleService');

let resendClient = null;
function getResendClient() {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY || '';
  if (!apiKey) return null;
  try {
    const { Resend } = require('resend');
    resendClient = new Resend(apiKey);
    return resendClient;
  } catch (_) {
    return null;
  }
}

function invoiceEmailTemplate({ customerName, invoiceNumber, orderId, amount, signedUrl }) {
  return `
  <html>
    <body style="font-family:Arial,sans-serif;background:#f6f2e8;padding:24px;color:#1a1a1a;">
      <table style="max-width:640px;margin:auto;background:#fff;border:1px solid #eadfcd;border-radius:16px;padding:24px;">
        <tr><td>
          <h2 style="margin:0 0 8px;">Abianzo Invoice Ready</h2>
          <p style="margin:0 0 16px;color:#6f6658;">Hi ${customerName || 'Abianzo Member'}, your payment is confirmed.</p>
          <p style="margin:0 0 6px;"><strong>Invoice:</strong> ${invoiceNumber}</p>
          <p style="margin:0 0 6px;"><strong>Order:</strong> ${orderId}</p>
          <p style="margin:0 0 16px;"><strong>Amount Paid:</strong> INR ${Number(amount || 0).toFixed(2)}</p>
          <a href="${signedUrl}" style="display:inline-block;background:#111;color:#f5dfb4;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700;">Download Invoice</a>
          <p style="margin:20px 0 0;color:#8a7f70;font-size:12px;">Need help? support@abzora.in</p>
        </td></tr>
      </table>
    </body>
  </html>`;
}

async function queueInvoiceEmailLog({ invoice, customerEmail = '', signedUrl = '', subjectPrefix = 'Invoice' }) {
  if (!customerEmail) return null;
  if (await isSuppressed(customerEmail)) {
    return InvoiceEmailLog.create({
      invoiceId: invoice?._id || null,
      customerId: invoice?.customerId || '',
      email: String(customerEmail).trim().toLowerCase(),
      subject: `${subjectPrefix} ${invoice?.invoiceNumber || ''}`,
      status: 'suppressed',
      lastError: 'Email suppressed due to prior bounce/complaint.',
      suppressedAt: new Date(),
      payload: { signedUrl, invoiceNumber: invoice?.invoiceNumber || '' },
    });
  }
  const html = invoiceEmailTemplate({
    customerName: invoice?.shippingAddress?.name || '',
    invoiceNumber: invoice?.invoiceNumber || '',
    orderId: String(invoice?.orderId || ''),
    amount: invoice?.grandTotal || 0,
    signedUrl,
  });

  const log = await InvoiceEmailLog.create({
    invoiceId: invoice?._id || null,
    customerId: invoice?.customerId || '',
    email: customerEmail,
    subject: `${subjectPrefix} ${invoice?.invoiceNumber || ''}`,
    status: 'queued',
    payload: {
      html,
      signedUrl,
      invoiceNumber: invoice?.invoiceNumber || '',
    },    
  });
  const { queueInvoiceEmail } = require('./invoiceBullMqOrchestrator');
  await queueInvoiceEmail(String(log._id));
  return log;
}

async function sendInvoiceEmail({ invoice, customerEmail, subject, html, signedUrl = '' }) {
  const client = getResendClient();
  const to = String(customerEmail || '').trim();
  if (!to) {
    throw new Error('Missing customer email');
  }
  if (await isSuppressed(to)) {
    throw new Error('Suppressed recipient email.');
  }

  if (!client) {
    logger.info('invoice_email_stub_sent', {
      module: 'invoiceNotificationService',
      invoiceId: String(invoice?._id || ''),
      to,
    });
    return { id: `stub-${Date.now()}` };
  }

  const finalHtml = html || invoiceEmailTemplate({
    customerName: invoice?.shippingAddress?.name || '',
    invoiceNumber: invoice?.invoiceNumber || '',
    orderId: String(invoice?.orderId || ''),
    amount: invoice?.grandTotal || 0,
    signedUrl,
  });

  const response = await client.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'Abianzo <invoices@abianzo.in>',
    to: [to],
    subject: subject || `Invoice ${invoice?.invoiceNumber || ''}`,
    html: finalHtml,
  });

  return response;
}

async function sendInvoicePush({ invoice, userId }) {
  logger.info('invoice_push_queued', {
    module: 'invoiceNotificationService',
    userId: userId || '',
    invoiceId: String(invoice?._id || ''),
    title: 'Your invoice is ready',
  });

  try {
    const User = require('../models/User');
    const { sendMulticastNotification } = require('./notificationService');
    const user = await User.findOne({ 
      $or: [{ uid: userId }, { firebaseUid: userId }, { _id: userId }] 
    });

    if (user && user.fcmTokens && user.fcmTokens.length > 0) {
      await sendMulticastNotification(
        user.fcmTokens,
        'Your invoice is ready',
        `Invoice ${invoice?.invoiceNumber || ''} has been generated.`,
        { invoiceId: String(invoice?._id || '') }
      );
    }
  } catch (error) {
    logger.error('invoice_push_failed', {
      module: 'invoiceNotificationService',
      userId,
      error: error.message,
    });
  }
  return true;
}

module.exports = {
  sendInvoiceEmail,
  sendInvoicePush,
  queueInvoiceEmailLog,
  invoiceEmailTemplate,
};

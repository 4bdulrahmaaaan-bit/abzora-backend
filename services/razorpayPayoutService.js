const crypto = require('crypto');

function nowIso() {
  return new Date().toISOString();
}

function getPayoutConfig() {
  return {
    keyId: process.env.RAZORPAYX_KEY_ID || process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY || '',
    keySecret:
      process.env.RAZORPAYX_KEY_SECRET ||
      process.env.RAZORPAY_KEY_SECRET ||
      process.env.RAZORPAY_SECRET ||
      '',
    accountNumber: process.env.RAZORPAYX_ACCOUNT_NUMBER || '',
    webhookSecret:
      process.env.RAZORPAYX_WEBHOOK_SECRET || process.env.RAZORPAY_PAYOUT_WEBHOOK_SECRET || '',
    baseUrl: process.env.RAZORPAYX_BASE_URL || 'https://api.razorpay.com/v1',
  };
}

function ensurePayoutConfig() {
  const config = getPayoutConfig();
  if (!config.keyId || !config.keySecret) {
    throw new Error('RazorpayX credentials are missing.');
  }
  if (!config.accountNumber) {
    throw new Error('RAZORPAYX_ACCOUNT_NUMBER is missing.');
  }
  return config;
}

async function razorpayRequest(path, { method = 'GET', body, headers = {} } = {}) {
  const config = ensurePayoutConfig();
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const description =
      data?.error?.description || data?.error?.reason || data?.message || 'RazorpayX request failed.';
    const error = new Error(description);
    error.statusCode = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

async function createOrUpdateContact({ name, email, phone, userType, existingContactId = '' }) {
  if (existingContactId) {
    return { id: existingContactId, reused: true };
  }

  return razorpayRequest('/contacts', {
    method: 'POST',
    body: {
      name: name || 'ABZORA Beneficiary',
      email: email || '',
      contact: phone || '',
      type: userType === 'vendor' ? 'vendor' : 'employee',
      reference_id: `abzora-${userType}-${Date.now()}`,
      notes: {
        userType,
        syncedAt: nowIso(),
      },
    },
  });
}

async function createOrUpdateFundAccount({
  contactId,
  methodType,
  accountHolderName,
  upiId,
  bankAccountNumber,
  bankIfsc,
  bankName,
  existingFundAccountId = '',
}) {
  if (existingFundAccountId) {
    return { id: existingFundAccountId, reused: true };
  }

  if (methodType === 'vpa') {
    if (!upiId) {
      throw new Error('UPI ID is required for UPI payouts.');
    }
    return razorpayRequest('/fund_accounts', {
      method: 'POST',
      body: {
        contact_id: contactId,
        account_type: 'vpa',
        vpa: {
          address: upiId,
        },
      },
    });
  }

  if (!bankAccountNumber || !bankIfsc) {
    throw new Error('Bank account number and IFSC are required for bank payouts.');
  }

  return razorpayRequest('/fund_accounts', {
    method: 'POST',
    body: {
      contact_id: contactId,
      account_type: 'bank_account',
      bank_account: {
        name: accountHolderName || 'ABZORA Beneficiary',
        ifsc: bankIfsc,
        account_number: bankAccountNumber,
        bank_name: bankName || '',
      },
    },
  });
}

async function createPayout({
  fundAccountId,
  amount,
  mode,
  referenceId,
  idempotencyKey,
  narration,
  notes = {},
}) {
  const config = ensurePayoutConfig();
  return razorpayRequest('/payouts', {
    method: 'POST',
    headers: {
      'X-Payout-Idempotency': idempotencyKey,
    },
    body: {
      account_number: config.accountNumber,
      fund_account_id: fundAccountId,
      amount: Math.round(Number(amount || 0) * 100),
      currency: 'INR',
      mode,
      purpose: 'payout',
      queue_if_low_balance: true,
      reference_id: referenceId,
      narration: narration || 'ABZORA settlement',
      notes,
    },
  });
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = getPayoutConfig().webhookSecret;
  if (!secret) {
    return true;
  }
  if (!signature) {
    return false;
  }
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return digest === signature;
}

module.exports = {
  createOrUpdateContact,
  createOrUpdateFundAccount,
  createPayout,
  getPayoutConfig,
  verifyWebhookSignature,
};

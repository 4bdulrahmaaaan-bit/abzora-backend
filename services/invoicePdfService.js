const fs = require('fs');
const path = require('path');

const DEFAULT_TEMPLATE_PATH = path.join(
  __dirname,
  'templates',
  'abzoraPremiumInvoiceTemplate.html',
);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizeText(value, fallback = 'N/A') {
  const normalized = String(value ?? '').trim();
  return normalized ? escapeHtml(normalized) : fallback;
}

function sanitizeMoney(value) {
  if (value == null || value === '') {
    return 'N/A';
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return `INR ${numeric.toFixed(2)}`;
  }

  return escapeHtml(String(value));
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function marketplaceItemsRows(items = []) {
  const safeItems = ensureArray(items);
  if (!safeItems.length) {
    return `
      <tr>
        <td colspan="4" class="muted">No marketplace items in this order.</td>
      </tr>
    `;
  }

  return safeItems
    .map((item) => {
      const title = sanitizeText(item.name || item.title || item.productName, 'Marketplace Item');
      const qty = sanitizeText(item.qty || item.quantity || 1, '1');
      const unitPrice = sanitizeMoney(item.unitPrice ?? item.price ?? item.unit_amount);
      const lineTotal = sanitizeMoney(item.amount ?? item.total ?? item.lineTotal ?? item.line_total);
      const secondary = [
        item.sku ? `SKU: ${sanitizeText(item.sku)}` : '',
        item.size ? `Size: ${sanitizeText(item.size)}` : '',
        item.color ? `Color: ${sanitizeText(item.color)}` : '',
      ]
        .filter(Boolean)
        .join(' • ');

      return `
        <tr>
          <td>
            <div class="item-title">${title}</div>
            ${secondary ? `<div class="item-sub">${secondary}</div>` : ''}
          </td>
          <td>${qty}</td>
          <td>${unitPrice}</td>
          <td>${lineTotal}</td>
        </tr>
      `;
    })
    .join('');
}

function customTailoringItemsRows(items = []) {
  const safeItems = ensureArray(items);
  if (!safeItems.length) {
    return `
      <tr>
        <td colspan="4" class="muted">No custom tailoring items in this order.</td>
      </tr>
    `;
  }

  return safeItems
    .map((item) => {
      const title = sanitizeText(item.name || item.title || item.productName, 'Custom Tailored Piece');
      const qty = sanitizeText(item.qty || item.quantity || 1, '1');
      const unitPrice = sanitizeMoney(item.unitPrice ?? item.price ?? item.unit_amount);
      const lineTotal = sanitizeMoney(item.amount ?? item.total ?? item.lineTotal ?? item.line_total);

      const detailLine = [
        item.fabric ? `Fabric: ${sanitizeText(item.fabric)}` : '',
        item.fit ? `Fit: ${sanitizeText(item.fit)}` : '',
        item.designDetails || item.design
          ? `Design: ${sanitizeText(item.designDetails || item.design)}`
          : '',
      ]
        .filter(Boolean)
        .join(' • ');

      return `
        <tr>
          <td>
            <div class="item-title">${title}</div>
            ${detailLine ? `<div class="item-sub">${detailLine}</div>` : ''}
          </td>
          <td>${qty}</td>
          <td>${unitPrice}</td>
          <td>${lineTotal}</td>
        </tr>
      `;
    })
    .join('');
}

function replacePlaceholders(template, data) {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      return '';
    }

    return String(data[key] ?? '');
  });
}

function buildInvoiceHtml(input = {}, options = {}) {
  const templatePath = options.templatePath || DEFAULT_TEMPLATE_PATH;
  const template = fs.readFileSync(templatePath, 'utf8');

  const marketplaceItems = ensureArray(input.marketplaceItems);
  const customItems = ensureArray(input.customTailoringItems);
  const fitConfidenceValue = Number(input.fitConfidence);
  const fitConfidence = Number.isFinite(fitConfidenceValue)
    ? fitConfidenceValue.toFixed(0)
    : sanitizeText(input.fitConfidence || 'N/A');

  const tokens = {
    orderId: sanitizeText(input.orderId),
    invoiceDate: sanitizeText(input.invoiceDate || new Date().toISOString().split('T')[0]),
    customerName: sanitizeText(input.customerName),
    customerAddressLine1: sanitizeText(input.customerAddressLine1),
    customerAddressLine2: sanitizeText(input.customerAddressLine2 || '-'),
    customerCity: sanitizeText(input.customerCity),
    customerState: sanitizeText(input.customerState),
    customerPostalCode: sanitizeText(input.customerPostalCode),
    customerCountry: sanitizeText(input.customerCountry),
    customerPhone: sanitizeText(input.customerPhone || '-'),
    deliveryEstimatedDate: sanitizeText(input.deliveryEstimatedDate || '-'),
    deliveryMethod: sanitizeText(input.deliveryMethod || '-'),
    deliveryTrackingId: sanitizeText(input.deliveryTrackingId || '-'),
    deliveryAddress: sanitizeText(input.deliveryAddress || '-'),
    marketplaceItemsRows: marketplaceItemsRows(marketplaceItems),
    customTailoringItemsRows: customTailoringItemsRows(customItems),
    customFabric: sanitizeText(input.customFabric || '-'),
    customFitProfile: sanitizeText(input.customFitProfile || '-'),
    fitConfidence,
    customDesignDetails: sanitizeText(input.customDesignDetails || '-'),
    personalizationDetails: sanitizeText(input.personalizationDetails || '-'),
    craftedForYouMessage: sanitizeText(
      input.craftedForYouMessage ||
        'This garment has been carefully tailored to your profile with close attention to fit, proportion, and finish.',
    ),
    subtotal: sanitizeMoney(input.subtotal),
    taxLabel: sanitizeText(input.taxLabel || 'Tax'),
    taxAmount: sanitizeMoney(input.taxAmount),
    grandTotal: sanitizeMoney(input.grandTotal),
    paymentMethod: sanitizeText(input.paymentMethod || '-'),
    paymentStatus: sanitizeText(input.paymentStatus || 'Pending'),
    transactionId: sanitizeText(input.transactionId || '-'),
    vendorName: sanitizeText(input.vendorName || 'ABZORA Partner Studio'),
    vendorAddress: sanitizeText(input.vendorAddress || '-'),
    vendorTaxId: sanitizeText(input.vendorTaxId || '-'),
    vendorContact: sanitizeText(input.vendorContact || '-'),
    stylePersona: sanitizeText(input.stylePersona || '-'),
    preferredSilhouette: sanitizeText(input.preferredSilhouette || '-'),
    occasionIntent: sanitizeText(input.occasionIntent || '-'),
  };

  return replacePlaceholders(template, tokens);
}

async function getPuppeteer() {
  try {
    // Lazy-loaded so service can be imported even before dependency is installed.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    return require('puppeteer');
  } catch (error) {
    throw new Error(
      'Missing dependency "puppeteer". Install it in backend with: npm install puppeteer',
    );
  }
}

async function generatePremiumInvoicePdf(input = {}, options = {}) {
  const html = buildInvoiceHtml(input, options);
  const puppeteer = await getPuppeteer();
  const ownsBrowser = !options.browser;
  const browser =
    options.browser ||
    (await puppeteer.launch({
      headless: true,
      ...(options.launchOptions || {}),
    }));

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
      ...(options.pdfOptions || {}),
    });

    if (options.outputPath) {
      fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
      fs.writeFileSync(options.outputPath, pdfBuffer);
    }

    await page.close();
    return {
      html,
      pdfBuffer,
      outputPath: options.outputPath || null,
    };
  } finally {
    if (ownsBrowser) {
      await browser.close();
    }
  }
}

module.exports = {
  buildInvoiceHtml,
  generatePremiumInvoicePdf,
};

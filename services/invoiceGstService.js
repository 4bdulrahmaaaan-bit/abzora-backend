function resolveSupplyType(originState, destinationState) {
  const fromState = String(originState || '').trim().toLowerCase();
  const toState = String(destinationState || '').trim().toLowerCase();
  if (!fromState || !toState) {
    return 'intra';
  }
  return fromState === toState ? 'intra' : 'inter';
}

function round2(value) {
  return Number((Number(value || 0)).toFixed(2));
}

function splitGst({ taxableValue, gstRate, supplyType }) {
  const base = Number(taxableValue || 0);
  const rate = Number(gstRate || 0);
  const gstAmount = round2((base * rate) / 100);

  if (supplyType === 'inter') {
    return {
      cgst: 0,
      sgst: 0,
      igst: gstAmount,
      gstAmount,
    };
  }

  const half = round2(gstAmount / 2);
  return {
    cgst: half,
    sgst: half,
    igst: 0,
    gstAmount,
  };
}

function deriveHsnForItem(item = {}) {
  const category = String(item.category || '').toLowerCase();
  if (category.includes('apparel') || category.includes('clothing')) return '6109';
  if (category.includes('footwear')) return '6403';
  if (category.includes('accessories')) return '7117';
  return '9997';
}

function computeInvoiceTax({ order, items, originState, destinationState }) {
  const supplyType = resolveSupplyType(originState, destinationState);

  const computedItems = (items || []).map((item) => {
    const quantity = Number(item.quantity || 1);
    const unitPrice = Number(item.price || item.unitPrice || 0);
    const discount = Number(item.discount || 0);
    const taxableValue = round2(Math.max(0, quantity * unitPrice - discount));
    const gstRate = Number(item.gstRate || 18);
    const split = splitGst({ taxableValue, gstRate, supplyType });
    return {
      productId: item.productId?.toString?.() || '',
      name: item.name || 'Product',
      hsnSac: item.hsnSac || deriveHsnForItem(item),
      quantity,
      unitPrice: round2(unitPrice),
      discount: round2(discount),
      taxableValue,
      gstRate,
      cgstAmount: split.cgst,
      sgstAmount: split.sgst,
      igstAmount: split.igst,
      total: round2(taxableValue + split.gstAmount),
    };
  });

  const subtotal = round2(computedItems.reduce((sum, item) => sum + item.taxableValue, 0));
  const cgst = round2(computedItems.reduce((sum, item) => sum + item.cgstAmount, 0));
  const sgst = round2(computedItems.reduce((sum, item) => sum + item.sgstAmount, 0));
  const igst = round2(computedItems.reduce((sum, item) => sum + item.igstAmount, 0));
  const tax = round2(cgst + sgst + igst);
  const shippingCharge = round2(order.deliveryFee || 0);
  const discount = round2(order.discountAmount || 0);
  const grandTotal = round2(subtotal + tax + shippingCharge - discount);

  return {
    supplyType,
    items: computedItems,
    subtotal,
    discount,
    cgst,
    sgst,
    igst,
    tax,
    shippingCharge,
    grandTotal,
  };
}

module.exports = {
  computeInvoiceTax,
  resolveSupplyType,
};

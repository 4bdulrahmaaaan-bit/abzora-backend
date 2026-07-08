const crypto = require('crypto');
const { getShiprocketConfig, isShiprocketEnabled } = require('./deliveryModeService');
const { getJson, setJson } = require('./redisCacheService');

const BASE_URL = 'https://apiv2.shiprocket.in';

class ShiprocketService {
  isConfigured() {
    if (!isShiprocketEnabled()) return false;
    const config = getShiprocketConfig();
    return Boolean(config.email && config.password);
  }

  async _getToken() {
    const cacheKey = 'shiprocket:auth:token';
    const cachedToken = await getJson(cacheKey);
    if (cachedToken && cachedToken.token) {
      return cachedToken.token;
    }

    const config = getShiprocketConfig();
    if (!config.email || !config.password) {
      throw new Error('Shiprocket credentials are not configured.');
    }

    const response = await fetch(`${BASE_URL}/v1/external/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: config.email,
        password: config.password,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Shiprocket auth failed: ${response.status} ${errText}`);
    }

    const data = await response.json();
    if (data.token) {
      await setJson(cacheKey, { token: data.token }, 777600);
      return data.token;
    }
    throw new Error('No token returned from Shiprocket auth');
  }

  async _authFetch(endpoint, options = {}) {
    const token = await this._getToken();
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    };

    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Shiprocket API error at ${endpoint}:`, errText);
      throw new Error(`Shiprocket API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getAvailableCouriers({ pickupPostcode, deliveryPostcode, weight, cod }) {
    if (!this.isConfigured()) return null;
    try {
      const data = await this._authFetch(
        `/v1/external/courier/serviceability/?pickup_postcode=${pickupPostcode}&delivery_postcode=${deliveryPostcode}&weight=${weight}&cod=${cod ? 1 : 0}`
      );
      return data;
    } catch (err) {
      console.error('Shiprocket getAvailableCouriers error:', err);
      return null;
    }
  }

  async createShipment({ order, store, customerAddress }) {
    if (!this.isConfigured()) {
      return this._mockCreateShipment({ order, store, customerAddress });
    }
    const config = getShiprocketConfig();
    const length = order.packageLength || 10;
    const breadth = order.packageBreadth || 10;
    const height = order.packageHeight || 10;
    const weight = order.packageWeight || 0.5;

    const payload = {
      order_id: String(order._id || order.id),
      order_date: new Date(order.createdAt || Date.now()).toISOString().substring(0, 10),
      pickup_location: store?.name?.substring(0, 30) || 'Primary', 
      channel_id: config.channelId || '',
      comment: 'Abzora order',
      billing_customer_name: customerAddress?.name?.split(' ')[0] || 'Customer',
      billing_last_name: customerAddress?.name?.split(' ').slice(1).join(' ') || '',
      billing_address: customerAddress?.addressLine1 || 'No Address',
      billing_address_2: customerAddress?.addressLine2 || '',
      billing_city: customerAddress?.city || 'City',
      billing_pincode: customerAddress?.pincode || '000000',
      billing_state: customerAddress?.state || 'State',
      billing_country: 'India',
      billing_email: customerAddress?.email || 'test@abzora.com',
      billing_phone: customerAddress?.phone || '9999999999',
      shipping_is_billing: true,
      order_items: order.items?.map(item => ({
        name: item.productName || 'Product',
        sku: String(item.productId || 'SKU'),
        units: item.quantity || 1,
        selling_price: item.price || 0,
        discount: 0,
        tax: 0,
        hsn: 0
      })) || [{
        name: 'Package',
        sku: 'PKG-1',
        units: 1,
        selling_price: order.totalAmount || 0,
      }],
      payment_method: order.paymentMethod === 'COD' ? 'COD' : 'Prepaid',
      sub_total: order.subtotalAmount || order.totalAmount || 0,
      length,
      breadth,
      height,
      weight
    };

    try {
      const data = await this._authFetch('/v1/external/orders/create/adhoc', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      return {
        success: true,
        shipmentId: String(data.shipment_id || ''),
        orderId: String(data.order_id || ''),
        trackingNumber: '',
        trackingUrl: '',
        deliveryProvider: 'Shiprocket',
        pickupStatus: 'Ready to ship',
      };
    } catch (err) {
      console.error('Shiprocket createShipment error:', err);
      return this._mockCreateShipment({ order, store, customerAddress });
    }
  }

  async schedulePickup({ order }) {
    if (!this.isConfigured()) {
      return this._mockSchedulePickup({ order });
    }

    const shipmentId = order.shipmentId;
    if (!shipmentId) {
      throw new Error('Shipment ID required for pickup scheduling');
    }

    try {
      const payload = { shipment_id: [shipmentId] };
      await this._authFetch('/v1/external/courier/generate/pickup', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      return {
        success: true,
        pickupStatus: 'Pickup scheduled',
        scheduledAt: new Date().toISOString(),
      };
    } catch (err) {
      console.error('Shiprocket schedulePickup error:', err);
      return this._mockSchedulePickup({ order });
    }
  }

  async cancelShipment({ order }) {
    if (!this.isConfigured()) return { success: true };
    const orderIds = [String(order._id || order.id)];

    try {
      await this._authFetch('/v1/external/orders/cancel', {
        method: 'POST',
        body: JSON.stringify({ ids: orderIds })
      });
      return { success: true };
    } catch (err) {
      console.error('Shiprocket cancelShipment error:', err);
      return { success: false, error: err.message };
    }
  }

  async getTracking({ order }) {
    if (!this.isConfigured()) {
      return this._mockGetTracking({ order });
    }

    const trackingNumber = String(order?.trackingNumber || order?.awbNumber || '').trim();
    if (!trackingNumber) {
      return {
        success: true,
        provider: 'Shiprocket',
        trackingNumber: '',
        trackingStatus: 'Ready to ship',
        timeline: [],
      };
    }

    try {
      const data = await this._authFetch(`/v1/external/courier/track/awb/${trackingNumber}`);
      const trackData = data.tracking_data || {};
      const scans = trackData.shipment_track_activities || [];
      const timeline = scans.map(scan => ({
        label: scan.activity || scan.status,
        status: 'completed',
        date: scan.date,
        location: scan.location
      }));

      return {
        success: true,
        provider: 'Shiprocket',
        trackingNumber,
        shipmentId: String(order?.shipmentId || '').trim(),
        awbNumber: String(order?.awbNumber || '').trim(),
        trackingUrl: trackData.track_url || `https://www.shiprocket.in/shipment-tracking/${encodeURIComponent(trackingNumber)}`,
        trackingStatus: String(trackData.current_status || order?.deliveryStatus || 'In transit'),
        timeline,
      };
    } catch (err) {
      console.error('Shiprocket getTracking error:', err);
      return this._mockGetTracking({ order });
    }
  }

  _safeId(prefix) {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
  }

  _buildMockTrackingUrl(trackingNumber) {
    return `https://www.shiprocket.in/shipment-tracking/${encodeURIComponent(trackingNumber)}`;
  }

  async _mockCreateShipment({ order, store, customerAddress }) {
    const orderId = String(order?._id || order?.id || '').trim();
    const trackingNumber = order.trackingNumber || this._safeId('SRK');
    const shipmentId = order.shipmentId || this._safeId('SHP');
    const awbNumber = order.awbNumber || this._safeId('AWB');
    return {
      success: true,
      shipmentId,
      awbNumber,
      trackingNumber,
      trackingUrl: this._buildMockTrackingUrl(trackingNumber),
      deliveryProvider: 'Shiprocket',
      pickupStatus: 'Ready to ship',
      pickupLocation: [store?.name, store?.address, store?.city].filter(Boolean).join(', '),
      dropLocation: [
        customerAddress?.name,
        customerAddress?.addressLine1,
        customerAddress?.city,
      ].filter(Boolean).join(', '),
      orderId,
    };
  }

  async _mockSchedulePickup({ order }) {
    return {
      success: true,
      pickupId: this._safeId('PICK'),
      pickupStatus: 'Pickup scheduled',
      scheduledAt: new Date().toISOString(),
      shipment: await this._mockCreateShipment({ order })
    };
  }

  async _mockGetTracking({ order }) {
    const trackingNumber = String(order?.trackingNumber || order?.trackingId || '').trim();
    if (!trackingNumber) {
      return {
        success: true,
        provider: 'Shiprocket',
        trackingNumber: '',
        trackingStatus: 'Ready to ship',
        timeline: [],
      };
    }
    return {
      success: true,
      provider: 'Shiprocket',
      trackingNumber,
      shipmentId: String(order?.shipmentId || '').trim(),
      awbNumber: String(order?.awbNumber || '').trim(),
      trackingUrl: this._buildMockTrackingUrl(trackingNumber),
      trackingStatus: String(order?.deliveryStatus || 'Ready to ship'),
      timeline: [
        { label: 'Order placed', status: 'completed' },
        { label: 'Ready to ship', status: 'current' },
        { label: 'Pickup scheduled', status: 'upcoming' },
        { label: 'In transit', status: 'upcoming' },
        { label: 'Delivered', status: 'upcoming' },
      ],
    };
  }
}

module.exports = new ShiprocketService();

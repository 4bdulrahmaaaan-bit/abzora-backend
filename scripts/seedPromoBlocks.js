const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const HomeVisualConfig = require('../models/HomeVisualConfig');

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    let config = await HomeVisualConfig.findOne({ key: 'home-visual-config' });
    if (!config) {
      config = new HomeVisualConfig({ key: 'home-visual-config' });
    }

    const promoBlocks = [
      {
        id: 'promo-streetwear-1',
        slot: 1,
        eyebrow: 'MENSWEAR DROP',
        title: 'ELEVATED STREETWEAR',
        subtitle: 'Discover the latest in premium streetwear and oversized fits.',
        ctaText: 'Shop Streetwear',
        imageUrl: 'https://images.unsplash.com/photo-1523398002811-999aa8e95707?ixlib=rb-4.0.3&auto=format&fit=crop&w=1400&q=80',
        redirectType: 'custom',
        redirectId: 'Streetwear',
        sortOrder: 1,
        isActive: true,
      },
      {
        id: 'promo-summer-2',
        slot: 2,
        eyebrow: 'WOMENSWEAR CURATION',
        title: 'THE SUMMER EDIT',
        subtitle: 'Breezy dresses and resort-ready essentials for the season.',
        ctaText: 'Shop Summer',
        imageUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?ixlib=rb-4.0.3&auto=format&fit=crop&w=1400&q=80',
        redirectType: 'custom',
        redirectId: 'Summer',
        sortOrder: 2,
        isActive: true,
      },
    ];

    config.promoBlocks = promoBlocks;
    await config.save();
    console.log('Successfully seeded promo blocks!');
  } catch (error) {
    console.error('Error seeding promo blocks:', error);
  } finally {
    await mongoose.disconnect();
  }
}

run();

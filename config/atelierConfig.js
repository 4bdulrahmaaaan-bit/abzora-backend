const atelierCatalog = {
  stores: {
    recommended: [
      {
        id: 'noir-line',
        name: 'Noir Line Atelier',
        tagline: 'Couture discipline, modern drape',
        rating: 4.9,
        distance: '2.2 km',
        startPrice: 4200,
        image:
          'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=80',
      },
      {
        id: 'saffron-cut',
        name: 'Saffron Cut Studio',
        tagline: 'Festive tailoring with soft luxury',
        rating: 4.8,
        distance: '3.7 km',
        startPrice: 3800,
        image:
          'https://images.unsplash.com/photo-1551232864-3f0890e580d9?auto=format&fit=crop&w=1200&q=80',
      },
    ],
    nearby: [
      {
        id: 'loom-room',
        name: 'Loom Room',
        tagline: 'Heritage fabrics, precision finishing',
        rating: 4.7,
        distance: '1.8 km',
        startPrice: 3600,
        image:
          'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=1200&q=80',
      },
      {
        id: 'river-atelier',
        name: 'River Atelier',
        tagline: 'Clean lines and breathable tailoring',
        rating: 4.6,
        distance: '4.1 km',
        startPrice: 3400,
        image:
          'https://images.unsplash.com/photo-1485230895905-ec40ba36b9bc?auto=format&fit=crop&w=1200&q=80',
      },
    ],
    designers: [
      {
        id: 'atelier-11',
        name: 'Atelier 11',
        tagline: 'Designer-led bespoke silhouettes',
        rating: 5.0,
        distance: 'By appointment',
        startPrice: 8200,
        image:
          'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1200&q=80',
      },
      {
        id: 'arya-signature',
        name: 'Arya Signature House',
        tagline: 'Occasion couture and bridal craft',
        rating: 4.9,
        distance: 'Designer visit',
        startPrice: 9600,
        image:
          'https://images.unsplash.com/photo-1551803091-e20673f15770?auto=format&fit=crop&w=1200&q=80',
      },
    ],
  },
  styles: [
    { id: 'shirt', name: 'Shirt', subtitle: 'Daily luxury', basePrice: 3200 },
    { id: 'kurta', name: 'Kurta', subtitle: 'Festive elegance', basePrice: 3900 },
    { id: 'suit', name: 'Suit', subtitle: 'Formal structure', basePrice: 7900 },
    { id: 'dress', name: 'Dress', subtitle: 'Fluid couture', basePrice: 6400 },
  ],
  fabrics: [
    {
      id: 'italian-cotton-satin',
      name: 'Italian Cotton Satin',
      material: 'Cotton',
      occasion: 'Office',
      delta: 800,
      description: 'Crisp handfeel and soft sheen.',
    },
    {
      id: 'belgian-linen',
      name: 'Belgian Linen',
      material: 'Linen',
      occasion: 'Festive',
      delta: 1200,
      description: 'Breathable weave with graceful drape.',
    },
    {
      id: 'super-130-wool',
      name: 'Super 130 Wool',
      material: 'Wool',
      occasion: 'Formal',
      delta: 2400,
      description: 'Fine structure with premium fall.',
    },
    {
      id: 'mulberry-silk-blend',
      name: 'Mulberry Silk Blend',
      material: 'Silk',
      occasion: 'Wedding',
      delta: 3100,
      description: 'Luminous celebration texture.',
    },
  ],
  designOptions: {
    neckline: ['Classic', 'Band', 'Cutaway'],
    sleeve: ['Full', '3/4', 'Short'],
    length: ['Regular', 'Longline', 'Cropped'],
  },
  measurementModes: ['manual', 'saved', 'ai'],
  pricing: {
    stitchingMultiplier: 0.35,
    necklineDelta: 180,
    sleeveDelta: 140,
    lengthDelta: 160,
    manualMeasurementCharge: 100,
  },
};

function findStyleById(styleId) {
  return atelierCatalog.styles.find((style) => style.id === styleId) || null;
}

function findFabricById(fabricId) {
  return atelierCatalog.fabrics.find((fabric) => fabric.id === fabricId) || null;
}

function findStoreById(storeId) {
  const sections = atelierCatalog.stores;
  const allStores = [...sections.recommended, ...sections.nearby, ...sections.designers];
  return allStores.find((store) => store.id === storeId) || null;
}

module.exports = {
  atelierCatalog,
  findStyleById,
  findFabricById,
  findStoreById,
};
